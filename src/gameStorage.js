import {
  CALIBRATION_PROFILE_IDS, DEFAULT_PLAYER_GOALS, getOutcome, MAX_NAME_LENGTH, MAX_REP_GOAL,
  normalizePlayerGoals, normalizePlayerNames,
} from './gameState.js'

export const PLAYER_NAMES_KEY = 'just-lift:player-names:v1'
export const PLAYER_GOALS_KEY = 'just-lift:player-goals:v1'
export const GAME_KEY_PREFIX = 'just-lift:game:v1:'
export const GAME_V2_KEY_PREFIX = 'just-lift:game:v2:'

const failure = (error) => ({ ok: false, error })
const validName = (name) => typeof name === 'string' && name.trim() === name
  && name.length > 0 && name.length <= MAX_NAME_LENGTH

const recordKey = (record) => `${record.version === 1 ? GAME_KEY_PREFIX : GAME_V2_KEY_PREFIX}${record.id}`
const legacyWinner = (players) => players[0].score === players[1].score
  ? null : players[0].score > players[1].score ? 0 : 1

function isGameRecord(record) {
  const validCommonFields = (record?.version === 1 || record?.version === 2)
    && typeof record.id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(record.id)
    && typeof record.date === 'string' && Number.isFinite(Date.parse(record.date))
    && Array.isArray(record.players) && record.players.length === 2
    && record.players.every((player) => validName(player?.name)
      && Number.isSafeInteger(player.score) && player.score >= 0)
    && (record.winner === null || record.winner === 0 || record.winner === 1)
  if (!validCommonFields) return false
  // Historical v1 games had no goals and selected winners by points alone.
  if (record.version === 1) return record.winner === legacyWinner(record.players)

  const validPlayers = record.players.every((player, index) => (
    player.profileId === CALIBRATION_PROFILE_IDS[index]
    && Number.isSafeInteger(player.goal) && player.goal >= 1 && player.goal <= MAX_REP_GOAL
    && Number.isSafeInteger(player.repCount) && player.repCount >= 0
    && Number.isSafeInteger(player.attemptCount) && player.attemptCount >= player.repCount
    && player.score >= player.repCount && player.score <= player.repCount * 4
  ))
  if (!validPlayers) return false
  const outcome = getOutcome(record.players)
  return record.outcome === outcome.kind && record.winner === outcome.winner
}

export function loadPlayerNames() {
  try {
    const raw = globalThis.localStorage.getItem(PLAYER_NAMES_KEY)
    if (raw === null) return { names: ['', ''], error: '' }
    const names = JSON.parse(raw)
    if (!Array.isArray(names) || names.length !== 2
      || !names.every((name) => typeof name === 'string' && name.length <= MAX_NAME_LENGTH)) {
      return { names: ['', ''], error: 'Saved player names could not be read. You can enter new names or skip.' }
    }
    return { names: names.map((name) => name.trim()), error: '' }
  } catch {
    return { names: ['', ''], error: 'Saved player names are unavailable. You can still play.' }
  }
}

export function savePlayerNames(names) {
  try {
    const savedNames = [0, 1].map((index) => (
      typeof names?.[index] === 'string' ? names[index].trim().slice(0, MAX_NAME_LENGTH).trim() : ''
    ))
    globalThis.localStorage.setItem(PLAYER_NAMES_KEY, JSON.stringify(savedNames))
    return { ok: true, error: '' }
  } catch {
    return failure('Player names could not be saved in this browser. You can still play.')
  }
}

export function loadPlayerGoals() {
  try {
    const raw = globalThis.localStorage.getItem(PLAYER_GOALS_KEY)
    if (raw === null) return { goals: [...DEFAULT_PLAYER_GOALS], error: '' }
    const goals = JSON.parse(raw)
    if (!Array.isArray(goals) || goals.length !== 2
      || !goals.every((goal) => Number.isSafeInteger(goal) && goal >= 1 && goal <= MAX_REP_GOAL)) {
      return { goals: [...DEFAULT_PLAYER_GOALS], error: 'Saved rep goals could not be read. You can choose new goals.' }
    }
    return { goals, error: '' }
  } catch {
    return { goals: [...DEFAULT_PLAYER_GOALS], error: 'Saved rep goals are unavailable. You can still play.' }
  }
}

export function savePlayerGoals(goals) {
  try {
    globalThis.localStorage.setItem(PLAYER_GOALS_KEY, JSON.stringify(normalizePlayerGoals(goals)))
    return { ok: true, error: '' }
  } catch {
    return failure('Rep goals could not be saved in this browser. You can still play.')
  }
}

// Called only after both turns finish. Copy the goal and accepted/attempt counts
// with scores so history preserves the rules used for this result. Player slots,
// not names, identify the winner and calibration profile.
export function createCompletedGame(players) {
  const names = normalizePlayerNames(players.map((player) => player.name))
  const snapshot = players.map((player, index) => ({
    name: names[index],
    profileId: CALIBRATION_PROFILE_IDS[index],
    score: player.score,
    repCount: player.repCount,
    attemptCount: player.attemptCount,
    goal: player.goal,
  }))
  const outcome = getOutcome(snapshot)
  return {
    version: 2,
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    date: new Date().toISOString(),
    players: snapshot,
    winner: outcome.winner,
    outcome: outcome.kind,
  }
}

export function saveCompletedGame(record) {
  try {
    if (!isGameRecord(record)) return failure('This game could not be saved because its result is invalid.')
    const storage = globalThis.localStorage
    const key = recordKey(record)
    const serialized = JSON.stringify(record)
    const existing = storage.getItem(key)
    if (existing === serialized) return { ok: true, error: '' }
    // Each game has its own namespaced key: repeated names and simultaneous
    // games never overwrite a shared history array. Repeat saves are idempotent.
    if (existing !== null) return failure('A different saved game already uses this game ID.')
    storage.setItem(key, serialized)
    return { ok: true, error: '' }
  } catch {
    return failure('This game could not be saved in this browser. Your final scores are still shown here.')
  }
}

export function loadGames() {
  const games = []
  let unreadable = 0
  try {
    const storage = globalThis.localStorage
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (!key?.startsWith(GAME_KEY_PREFIX) && !key?.startsWith(GAME_V2_KEY_PREFIX)) continue
      try {
        const raw = storage.getItem(key)
        if (raw === null) continue
        const record = JSON.parse(raw)
        if (!isGameRecord(record) || key !== recordKey(record)) {
          unreadable += 1
          continue
        }
        games.push(record)
      } catch {
        unreadable += 1
      }
    }
    games.sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id))
    return {
      games,
      error: unreadable ? `${unreadable} saved game${unreadable === 1 ? '' : 's'} could not be read.` : '',
    }
  } catch {
    return { games: [], error: 'Game history is unavailable in this browser. You can still play.' }
  }
}
