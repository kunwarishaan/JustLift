import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PLAYER_NAMES_KEY,
  GAME_KEY_PREFIX,
  loadPlayerNames,
  savePlayerNames,
  createCompletedGame,
  saveCompletedGame,
  loadGames,
} from './gameStorage.js'
import { MAX_NAME_LENGTH } from './gameState.js'

const NOW = '2026-09-12T15:00:00.000Z'

function mockStorage(entries = []) {
  const data = new Map(entries)
  const storage = {
    get length() { return data.size },
    key: vi.fn((index) => [...data.keys()][index] ?? null),
    getItem: vi.fn((key) => data.get(String(key)) ?? null),
    setItem: vi.fn((key, value) => { data.set(String(key), String(value)) }),
    removeItem: vi.fn((key) => { data.delete(String(key)) }),
    clear: vi.fn(() => data.clear()),
    snapshot: () => [...data.entries()],
  }
  vi.stubGlobal('localStorage', storage)
  return storage
}

function record(overrides = {}) {
  return {
    version: 1,
    id: 'game-one',
    date: NOW,
    players: [{ name: 'Dana', score: 2 }, { name: 'Lee', score: 5 }],
    winner: 1,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
  let id = 0
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `game-${++id}`) })
  mockStorage()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('player name preferences', () => {
  it('returns empty optional fields when no names are saved, without writing defaults', () => {
    const storage = mockStorage()
    expect(loadPlayerNames()).toEqual({ names: ['', ''], error: '' })
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('saves normalized names while preserving blank optional fields', () => {
    const storage = mockStorage()
    expect(savePlayerNames(['  Avery  ', '   '])).toEqual({ ok: true, error: '' })
    expect(storage.getItem(PLAYER_NAMES_KEY)).toBe(JSON.stringify(['Avery', '']))
    expect(loadPlayerNames()).toEqual({ names: ['Avery', ''], error: '' })

    expect(savePlayerNames(['x'.repeat(MAX_NAME_LENGTH + 10), 'Riley']).ok).toBe(true)
    expect(loadPlayerNames().names).toEqual(['x'.repeat(MAX_NAME_LENGTH), 'Riley'])
  })

  it.each([
    ['malformed JSON', '{broken'],
    ['null', 'null'],
    ['object', '{}'],
    ['wrong player count', '["Only one"]'],
    ['nonstring name', '[42,"Riley"]'],
    ['oversized name', JSON.stringify(['x'.repeat(MAX_NAME_LENGTH + 1), 'Riley'])],
  ])('ignores %s preferences without deleting or rewriting them', (_, raw) => {
    const storage = mockStorage([[PLAYER_NAMES_KEY, raw]])
    const before = storage.snapshot()
    const result = loadPlayerNames()
    expect(result.names).toEqual(['', ''])
    expect(result.error).toBeTruthy()
    expect(storage.snapshot()).toEqual(before)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
  })
})

describe('completed game snapshots', () => {
  it('copies player names and scores and identifies same-named competitors by slot', () => {
    const players = [
      { name: 'Alex', score: 3, repCount: 2, finished: true },
      { name: 'Alex', score: 7, repCount: 4, finished: true },
    ]
    const result = createCompletedGame(players)
    expect(result).toEqual({
      version: 1,
      id: 'game-1',
      date: NOW,
      players: [{ name: 'Alex', score: 3 }, { name: 'Alex', score: 7 }],
      winner: 1,
    })
    expect(result.players).not.toBe(players)
    expect(result.players[0]).not.toBe(players[0])
    players[0].name = 'Changed'
    players[0].score = 100
    players.push({ name: 'Extra', score: 999 })
    expect(result.players).toEqual([{ name: 'Alex', score: 3 }, { name: 'Alex', score: 7 }])
    expect(result.winner).toBe(1)
  })

  it('records guest games and ties with independent IDs even at the same timestamp', () => {
    const guests = [{ name: '', score: 0 }, { name: '   ', score: 0 }]
    const first = createCompletedGame(guests)
    const second = createCompletedGame(guests)
    expect(first.players).toEqual([{ name: 'Player 1', score: 0 }, { name: 'Player 2', score: 0 }])
    expect(first.winner).toBeNull()
    expect(first.id).not.toBe(second.id)
    expect(first.date).toBe(second.date)
  })

  it('trims whitespace introduced by truncating a long name so the result remains savable', () => {
    const result = createCompletedGame([
      { name: `${'a'.repeat(MAX_NAME_LENGTH - 1)} b`, score: 1 },
      { name: 'Other', score: 2 },
    ])
    expect(result.players[0].name).toBe('a'.repeat(MAX_NAME_LENGTH - 1))
    expect(saveCompletedGame(result)).toEqual({ ok: true, error: '' })
  })
})

describe('saving completed games', () => {
  it('uses separate game keys, retains repeated names, and stores detached snapshots', () => {
    const storage = mockStorage()
    const players = [{ name: '__proto__', score: 2 }, { name: '__proto__', score: 1 }]
    const first = createCompletedGame(players)
    const second = createCompletedGame(players)
    expect(saveCompletedGame(first)).toEqual({ ok: true, error: '' })
    expect(saveCompletedGame(second)).toEqual({ ok: true, error: '' })
    expect(storage.getItem(`${GAME_KEY_PREFIX}${first.id}`)).toBe(JSON.stringify(first))
    expect(storage.getItem(`${GAME_KEY_PREFIX}${second.id}`)).toBe(JSON.stringify(second))
    expect(storage.length).toBe(2)
    first.players[0].name = 'Mutated after save'
    first.players[0].score = 0
    const saved = loadGames().games
    expect(saved).toHaveLength(2)
    expect(saved.every((game) => game.players[0].name === '__proto__' && game.winner === 0)).toBe(true)
  })

  it('treats the same serialized game as an idempotent save without rewriting', () => {
    const storage = mockStorage()
    const result = record()
    expect(saveCompletedGame(result).ok).toBe(true)
    expect(saveCompletedGame(JSON.parse(JSON.stringify(result)))).toEqual({ ok: true, error: '' })
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(loadGames().games).toEqual([result])
  })

  it.each(['different valid game', 'unreadable existing value'])('refuses to replace a %s under the same ID', (kind) => {
    const value = kind === 'different valid game'
      ? JSON.stringify(record({ players: [{ name: 'Previous', score: 2 }, { name: 'Lee', score: 5 }] }))
      : '{do not overwrite'
    const storage = mockStorage([[`${GAME_KEY_PREFIX}game-one`, value]])
    const before = storage.snapshot()
    const result = saveCompletedGame(record())
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(storage.snapshot()).toEqual(before)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it.each([
    ['unsupported version', { version: 2 }],
    ['invalid ID', { id: '../other-key' }],
    ['invalid date', { date: 'not a date' }],
    ['wrong player count', { players: [{ name: 'Solo', score: 2 }] }],
    ['negative score', { players: [{ name: 'Dana', score: -1 }, { name: 'Lee', score: 5 }] }],
    ['fractional score', { players: [{ name: 'Dana', score: 1.5 }, { name: 'Lee', score: 5 }] }],
    ['blank name', { players: [{ name: '', score: 2 }, { name: 'Lee', score: 5 }] }],
    ['incorrect winner', { winner: 0 }],
  ])('rejects an %s result before writing storage', (_, overrides) => {
    const storage = mockStorage()
    expect(saveCompletedGame(record(overrides)).ok).toBe(false)
    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('reports quota failures without changing older history or preferences', () => {
    const oldGame = record({ id: 'old-game' })
    const storage = mockStorage([
      [`${GAME_KEY_PREFIX}${oldGame.id}`, JSON.stringify(oldGame)],
      [PLAYER_NAMES_KEY, JSON.stringify(['Existing', 'Names'])],
    ])
    const before = storage.snapshot()
    storage.setItem.mockImplementation(() => { throw new Error('QuotaExceededError') })
    const result = saveCompletedGame(record())
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(savePlayerNames(['Replacement', 'Names']).ok).toBe(false)
    expect(storage.snapshot()).toEqual(before)
    expect(loadGames().games).toEqual([oldGame])
  })
})

describe('reading game history', () => {
  it('loads valid entries newest first, skips corrupt/mismatched records, and never mutates storage', () => {
    const older = record({ id: 'old', date: '2026-09-01T12:00:00.000Z' })
    const newer = record({ id: 'new', date: '2026-09-12T12:00:00.000Z' })
    const storage = mockStorage([
      [`${GAME_KEY_PREFIX}${older.id}`, JSON.stringify(older)],
      ['another-app:game', JSON.stringify(record({ id: 'other' }))],
      [PLAYER_NAMES_KEY, JSON.stringify(['Saved', 'Names'])],
      [`${GAME_KEY_PREFIX}broken`, '{broken'],
      [`${GAME_KEY_PREFIX}bad-winner`, JSON.stringify(record({ id: 'bad-winner', winner: 0 }))],
      [`${GAME_KEY_PREFIX}mismatched-key`, JSON.stringify(record({ id: 'different-id' }))],
      [`${GAME_KEY_PREFIX}${newer.id}`, JSON.stringify(newer)],
    ])
    const before = storage.snapshot()
    const result = loadGames()
    expect(result.games).toEqual([newer, older])
    expect(result.error).toBeTruthy()
    expect(storage.snapshot()).toEqual(before)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
    expect(storage.clear).not.toHaveBeenCalled()
  })

  it('retains readable games when one namespaced record cannot be accessed', () => {
    const valid = record()
    const storage = mockStorage([
      [`${GAME_KEY_PREFIX}unreadable`, '{}'],
      [`${GAME_KEY_PREFIX}${valid.id}`, JSON.stringify(valid)],
    ])
    const getItem = storage.getItem.getMockImplementation()
    storage.getItem.mockImplementation((key) => {
      if (key === `${GAME_KEY_PREFIX}unreadable`) throw new Error('Read denied')
      return getItem(key)
    })
    const result = loadGames()
    expect(result.games).toEqual([valid])
    expect(result.error).toBeTruthy()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it.each(['missing API', 'blocked property getter'])('degrades safely with %s', (kind) => {
    if (kind === 'missing API') vi.stubGlobal('localStorage', undefined)
    else Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError') },
    })

    expect(() => loadPlayerNames()).not.toThrow()
    expect(loadPlayerNames()).toEqual({ names: ['', ''], error: expect.any(String) })
    expect(loadPlayerNames().error).toBeTruthy()
    expect(loadGames()).toEqual({ games: [], error: expect.any(String) })
    expect(loadGames().error).toBeTruthy()
    expect(savePlayerNames(['Dana', 'Lee']).ok).toBe(false)
    expect(saveCompletedGame(record()).ok).toBe(false)
  })
})
