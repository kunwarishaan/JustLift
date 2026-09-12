// Points awarded for a completed rep. X still counts as a rep but earns no points.
export const TIER_POINTS = Object.freeze({ X: 0, Okay: 1, Good: 2, Super: 3, Perfect: 4 })
export const DEFAULT_PLAYER_NAMES = Object.freeze(['Player 1', 'Player 2'])
export const MAX_NAME_LENGTH = 40

export function normalizePlayerNames(names) {
  return DEFAULT_PLAYER_NAMES.map((fallback, index) => (
    typeof names?.[index] === 'string' ? names[index].trim().slice(0, MAX_NAME_LENGTH).trim() || fallback : fallback
  ))
}

export function createInitialGameState(names) {
  return {
    phase: 'ready',
    currentPlayer: 0,
    sessionId: null,
    players: normalizePlayerNames(names).map((name) => ({
      name, repCount: 0, score: 0, lastTier: null, finished: false,
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
      if (!result?.repCompleted || !Object.hasOwn(TIER_POINTS, result.tier)
        || result.repCount !== player.repCount + 1) return state

      return {
        ...state,
        players: state.players.map((entry, index) => index === state.currentPlayer ? {
          ...entry,
          repCount: result.repCount,
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
      return state.phase === 'results' ? createInitialGameState(state.players.map((player) => player.name)) : state

    default:
      return state
  }
}

// Returns the winning player index, or null for a tie.
export function getWinner(players) {
  if (players[0].score === players[1].score) return null
  return players[0].score > players[1].score ? 0 : 1
}
