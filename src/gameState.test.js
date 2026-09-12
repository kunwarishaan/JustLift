import { describe, expect, it } from 'vitest'
import {
  createInitialGameState, DEFAULT_PLAYER_GOALS, gameReducer, getOutcome, getWinner,
  MAX_REP_GOAL, normalizePlayerGoals, TIER_POINTS,
} from './gameState.js'

const start = (state = createInitialGameState(), sessionId = 1) => (
  gameReducer(state, { type: 'START_TURN', sessionId })
)
const complete = (state, result, sessionId = state.sessionId) => (
  gameReducer(state, { type: 'REP_COMPLETED', sessionId, result })
)
const accepted = (tier, repCount, attemptCount) => ({ repCompleted: true, tier, repCount, attemptCount })
const rejected = (repCount, attemptCount) => ({
  attemptCompleted: true, repCompleted: false, tier: 'X', repCount, attemptCount,
})

describe('goal-based game state', () => {
  it('normalizes goals and fixes calibration identity to player slots independent of display names', () => {
    const state = createInitialGameState([' Octavio ', 'Justin'], [1, MAX_REP_GOAL])
    expect(state.players).toEqual([
      { name: 'Octavio', profileId: 'justin', goal: 1, repCount: 0, attemptCount: 0, score: 0, lastTier: null, finished: false },
      { name: 'Justin', profileId: 'octavio', goal: MAX_REP_GOAL, repCount: 0, attemptCount: 0, score: 0, lastTier: null, finished: false },
    ])
    expect(normalizePlayerGoals()).toEqual(DEFAULT_PLAYER_GOALS)
    for (const invalid of [0, -1, 1.5, '20', Infinity, NaN, MAX_REP_GOAL + 1, null]) {
      expect(normalizePlayerGoals([invalid, 25])).toEqual([10, 25])
    }
  })

  it.each(['Okay', 'Good', 'Perfect'])('accepts %s reps toward the goal with the existing point value', (tier) => {
    const previous = start(createInitialGameState(undefined, [1, 10]))
    const result = complete(previous, accepted(tier, 1, 1))
    expect(result.players[0]).toMatchObject({ repCount: 1, attemptCount: 1, score: TIER_POINTS[tier], lastTier: tier })
    expect(result.phase).toBe('active')
    expect(previous.players[0]).toMatchObject({ repCount: 0, attemptCount: 0, score: 0, lastTier: null })
    expect(result.players[1]).toBe(previous.players[1])
  })

  it('shows X feedback and records attempts without increasing reps, points, or goal qualification', () => {
    let state = start(createInitialGameState(undefined, [1, 10]))
    state = complete(state, rejected(0, 1))
    expect(state.players[0]).toMatchObject({ repCount: 0, attemptCount: 1, score: 0, lastTier: 'X' })
    expect(getOutcome(state.players)).toEqual({ kind: 'no-winner', winner: null })
    state = complete(state, accepted('Good', 1, 2))
    state = complete(state, rejected(1, 3))
    expect(state.players[0]).toMatchObject({ repCount: 1, attemptCount: 3, score: 2, lastTier: 'X' })
    expect(getOutcome(state.players)).toEqual({ kind: 'win', winner: 0 })
  })

  it('keeps legacy accepted event shapes working and deduplicates explicit attempt sequences', () => {
    let state = start()
    state = complete(state, { repCompleted: true, tier: 'Okay', repCount: 1 })
    const afterRejection = complete(state, rejected(1, 2))
    expect(afterRejection.players[0].attemptCount).toBe(2)
    expect(complete(afterRejection, rejected(1, 2))).toBe(afterRejection)
    expect(complete(afterRejection, accepted('Perfect', 2, 4))).toBe(afterRejection)
    const afterAccepted = complete(afterRejection, accepted('Perfect', 2, 3))
    expect(afterAccepted.players[0]).toMatchObject({ attemptCount: 3, repCount: 2, score: 5 })
    expect(complete(afterAccepted, accepted('Perfect', 2, 3))).toBe(afterAccepted)
  })

  it.each([
    { repCompleted: true, tier: 'X', repCount: 1 },
    { repCompleted: false, tier: 'X', repCount: 0 },
    { attemptCompleted: true, repCompleted: false, tier: 'X', repCount: 1 },
    { attemptCompleted: true, repCompleted: false, tier: 'Good', repCount: 0 },
    { repCompleted: true, tier: 'Unknown', repCount: 1 },
    { repCompleted: true, tier: 'Super', repCount: 1 },
    { repCompleted: true, tier: 'Okay', repCount: 2 },
  ])('ignores malformed or out-of-order completion events: %j', (result) => {
    const state = start()
    expect(complete(state, result)).toBe(state)
  })

  it('rejects stale accepted and X callbacks after end, across turns, and after replay', () => {
    let state = start(createInitialGameState(['A', 'B'], [3, 8]), 11)
    state = complete(state, accepted('Good', 1, 1))
    state = gameReducer(state, { type: 'END_TURN' })
    expect(complete(state, rejected(1, 2), 11)).toBe(state)
    state = start(state, 12)
    expect(complete(state, accepted('Okay', 1, 1), 11)).toBe(state)
    expect(complete(state, rejected(0, 1), 11)).toBe(state)
    state = complete(state, rejected(0, 1), 12)
    state = gameReducer(state, { type: 'END_TURN' })
    const locked = state
    expect(complete(state, accepted('Perfect', 1, 2), 12)).toBe(locked)
    expect(gameReducer(state, { type: 'END_TURN' })).toBe(locked)
    state = gameReducer(state, { type: 'PLAY_AGAIN' })
    expect(state).toEqual(createInitialGameState(['A', 'B'], [3, 8]))
    state = start(state, 13)
    expect(complete(state, rejected(0, 1), 12)).toBe(state)
  })
})

describe('goal-based outcomes', () => {
  it.each([
    ['neither completes even with unequal scores', [2, 3], [3, 4], [8, 3], 'no-winner', null],
    ['neither completes and scores are equal', [1, 1], [3, 4], [2, 2], 'no-winner', null],
    ['only player one completes with fewer points', [2, 3], [2, 4], [2, 12], 'win', 0],
    ['only player two completes with fewer points', [3, 2], [4, 2], [12, 2], 'win', 1],
    ['both complete and player one has more points', [4, 3], [2, 3], [8, 7], 'win', 0],
    ['both complete and player two has more points', [2, 3], [2, 3], [7, 8], 'win', 1],
    ['both complete with equal points', [2, 3], [2, 3], [6, 6], 'tie', null],
  ])('%s', (_, reps, goals, scores, kind, winner) => {
    const players = reps.map((repCount, index) => ({ repCount, goal: goals[index], score: scores[index] }))
    expect(getOutcome(players)).toEqual({ kind, winner })
    expect(getWinner(players)).toBe(winner)
  })
})
