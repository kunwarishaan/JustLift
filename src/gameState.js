// Only accepted reps (Okay through Perfect) count toward the goal and score.
export const TIER_POINTS = Object.freeze({ X: 0, Okay: 1, Good: 2, Perfect: 4 })
export const DEFAULT_PLAYER_NAMES = Object.freeze(['Player 1', 'Player 2'])
export const DEFAULT_PLAYER_GOALS = Object.freeze([10, 10])
export const CALIBRATION_PROFILE_IDS = Object.freeze(['justin', 'octavio'])
export const MAX_NAME_LENGTH = 40
export const MAX_REP_GOAL = 999

export function normalizePlayerNames(names) {
  return DEFAULT_PLAYER_NAMES.map((fallback, index) => (
    typeof names?.[index] === 'string' ? names[index].trim().slice(0, MAX_NAME_LENGTH).trim() || fallback : fallback
  ))
}

export function normalizePlayerGoals(goals) {
  return DEFAULT_PLAYER_GOALS.map((fallback, index) => (
    Number.isSafeInteger(goals?.[index]) && goals[index] >= 1 && goals[index] <= MAX_REP_GOAL
      ? goals[index] : fallback
  ))
}

export function createInitialGameState(names, playerGoals = DEFAULT_PLAYER_GOALS) {
  const goals = normalizePlayerGoals(playerGoals)
  return {
    phase: 'ready',
    currentPlayer: 0,
    sessionId: null,
    players: normalizePlayerNames(names).map((name, index) => ({
      name,
      profileId: CALIBRATION_PROFILE_IDS[index],
      goal: goals[index],
      repCount: 0,
      attemptCount: 0,
      score: 0,
      lastTier: null,
      finished: false,
    })),
  }
}

// Pure transitions, independent of React, cameras, audio, and screen layout.
export function gameReducer(state, action) {
  switch (action.type) {
    case 'START_TURN':
      if (state.phase !== 'ready') return state
      return { ...state, phase: 'active', sessionId: action.sessionId }

    case 'REP_COMPLETED': {
      if (state.phase !== 'active' || action.sessionId !== state.sessionId) return state
      const player = state.players[state.currentPlayer]
      const result = action.result
      if (!result || !Object.hasOwn(TIER_POINTS, result.tier)) return state
      const accepted = result.repCompleted === true && result.tier !== 'X'
      const rejected = result.attemptCompleted === true && result.repCompleted === false && result.tier === 'X'
      if ((!accepted && !rejected)
        || result.repCount !== player.repCount + Number(accepted)
        || (result.attemptCount !== undefined && result.attemptCount !== player.attemptCount + 1)) return state

      return {
        ...state,
        players: state.players.map((entry, index) => index === state.currentPlayer ? {
          ...entry,
          repCount: result.repCount,
          attemptCount: entry.attemptCount + 1,
          score: entry.score + TIER_POINTS[result.tier],
          lastTier: result.tier,
        } : entry),
      }
    }

    case 'END_TURN':
      if (state.phase !== 'active') return state
      return {
        ...state,
        phase: state.currentPlayer === 0 ? 'ready' : 'results',
        currentPlayer: 1,
        sessionId: null,
        players: state.players.map((player, index) => index === state.currentPlayer
          ? { ...player, finished: true } : player),
      }

    case 'PLAY_AGAIN':
      return state.phase === 'results' ? createInitialGameState(
        state.players.map((player) => player.name),
        state.players.map((player) => player.goal),
      ) : state

    default:
      return state
  }
}

// Call for the final two-player result. Qualification is based on accepted reps;
// scores break ties only when both players complete their own goals.
export function getOutcome(players) {
  const qualified = players.map((player) => player.repCount >= player.goal)
  if (!qualified[0] && !qualified[1]) return { kind: 'no-winner', winner: null }
  if (qualified[0] !== qualified[1]) return { kind: 'win', winner: qualified[0] ? 0 : 1 }
  if (players[0].score === players[1].score) return { kind: 'tie', winner: null }
  return { kind: 'win', winner: players[0].score > players[1].score ? 0 : 1 }
}

// Null includes both a tie and neither player completing their goal. Use
// getOutcome when presenting the distinction.
export function getWinner(players) {
  return getOutcome(players).winner
}
