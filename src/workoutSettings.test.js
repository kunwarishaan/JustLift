import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EXERCISE_ID, EXERCISES } from './exerciseCatalogue.js'
import {
  DEFAULT_PLAYER_LOADS, WORKOUT_SETTINGS_KEY, formatPlayerLoad,
  loadWorkoutSettings, normalizePlayerLoads, saveWorkoutSettings,
} from './workoutSettings.js'

let stored
let storage

beforeEach(() => {
  stored = new Map()
  storage = {
    getItem: vi.fn((key) => stored.get(key) ?? null),
    setItem: vi.fn((key, value) => stored.set(key, value)),
  }
  vi.stubGlobal('localStorage', storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('optional player loads', () => {
  it('preserves blank versus zero and returns independent default objects', () => {
    expect(normalizePlayerLoads([{ amount: null, unit: 'lb' }, { amount: 0, unit: 'kg' }])).toEqual([
      { amount: null, unit: 'lb' }, { amount: 0, unit: 'kg' },
    ])
    const first = normalizePlayerLoads()
    const second = normalizePlayerLoads()
    expect(first).toEqual(DEFAULT_PLAYER_LOADS)
    first[0].amount = 20
    expect(first[1].amount).toBeNull()
    expect(second[0].amount).toBeNull()
    expect(DEFAULT_PLAYER_LOADS[0].amount).toBeNull()
  })

  it('accepts decimal loads within range and normalizes malformed fields safely', () => {
    expect(normalizePlayerLoads([{ amount: 12.25, unit: 'lb' }, { amount: 2000, unit: 'kg' }])).toEqual([
      { amount: 12.25, unit: 'lb' }, { amount: 2000, unit: 'kg' },
    ])
    for (const amount of [-1, 2000.5, NaN, Infinity, '20', undefined]) {
      expect(normalizePlayerLoads([{ amount, unit: 'stone' }, null])).toEqual(DEFAULT_PLAYER_LOADS)
    }
  })

  it('formats blank and zero as bodyweight and preserves the selected unit otherwise', () => {
    expect(formatPlayerLoad()).toBe('Bodyweight')
    expect(formatPlayerLoad({ amount: null, unit: 'lb' })).toBe('Bodyweight')
    expect(formatPlayerLoad({ amount: 0, unit: 'kg' })).toBe('Bodyweight')
    expect(formatPlayerLoad({ amount: 20, unit: 'kg' })).toBe('20 kg')
    expect(formatPlayerLoad({ amount: 12.25, unit: 'lb' })).toBe('12.25 lb')
  })
})

describe('workout settings storage', () => {
  it('returns optional defaults without writing when no settings exist', () => {
    expect(loadWorkoutSettings()).toEqual({ exerciseId: DEFAULT_EXERCISE_ID, loads: DEFAULT_PLAYER_LOADS, error: '' })
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('round-trips every catalogue exercise independently of names, goals, and saved games', () => {
    const unrelated = {
      'just-lift:player-names:v1': '["A","B"]',
      'just-lift:player-goals:v1': '[8,12]',
      'just-lift:game:v2:old': '{"id":"old"}',
    }
    for (const [key, value] of Object.entries(unrelated)) stored.set(key, value)
    const loads = [{ amount: 20.5, unit: 'kg' }, { amount: 0, unit: 'lb' }]
    for (const { id } of EXERCISES) {
      expect(saveWorkoutSettings({ exerciseId: id, loads })).toEqual({ ok: true, error: '' })
      expect(loadWorkoutSettings()).toEqual({ exerciseId: id, loads, error: '' })
      expect(JSON.parse(stored.get(WORKOUT_SETTINGS_KEY))).toEqual({ version: 1, exerciseId: id, loads })
    }
    for (const [key, value] of Object.entries(unrelated)) expect(stored.get(key)).toBe(value)
  })

  it('rejects an unknown exercise ID without overwriting existing settings', () => {
    saveWorkoutSettings({ exerciseId: DEFAULT_EXERCISE_ID, loads: DEFAULT_PLAYER_LOADS })
    const saved = stored.get(WORKOUT_SETTINGS_KEY)
    expect(saveWorkoutSettings({ exerciseId: 'unknown-exercise', loads: DEFAULT_PLAYER_LOADS })).toMatchObject({ ok: false })
    expect(stored.get(WORKOUT_SETTINGS_KEY)).toBe(saved)
  })

  it('ignores malformed saved data without changing or deleting it', () => {
    const valid = { version: 1, exerciseId: DEFAULT_EXERCISE_ID, loads: DEFAULT_PLAYER_LOADS }
    const malformed = [
      '{broken', 'null', '{}',
      JSON.stringify({ ...valid, version: 2 }),
      JSON.stringify({ ...valid, exerciseId: 'unknown-exercise' }),
      JSON.stringify({ ...valid, loads: [{ amount: 20, unit: 'kg' }] }),
      JSON.stringify({ ...valid, loads: [{ amount: -1, unit: 'kg' }, { amount: 2, unit: 'lb' }] }),
      JSON.stringify({ ...valid, loads: [{ amount: 20, unit: 'stone' }, { amount: 2, unit: 'lb' }] }),
    ]
    for (const raw of malformed) {
      stored.set(WORKOUT_SETTINGS_KEY, raw)
      const loaded = loadWorkoutSettings()
      expect(loaded).toMatchObject({ exerciseId: DEFAULT_EXERCISE_ID, loads: DEFAULT_PLAYER_LOADS })
      expect(loaded.error).toBeTruthy()
      expect(stored.get(WORKOUT_SETTINGS_KEY)).toBe(raw)
    }
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('returns recoverable errors when browser storage is blocked', () => {
    storage.getItem.mockImplementation(() => { throw new Error('Blocked') })
    storage.setItem.mockImplementation(() => { throw new Error('Blocked') })
    expect(loadWorkoutSettings()).toMatchObject({ exerciseId: DEFAULT_EXERCISE_ID, loads: DEFAULT_PLAYER_LOADS })
    expect(loadWorkoutSettings().error).toMatch(/still play/i)
    const saved = saveWorkoutSettings({ exerciseId: DEFAULT_EXERCISE_ID, loads: DEFAULT_PLAYER_LOADS })
    expect(saved.ok).toBe(false)
    expect(saved.error).toMatch(/still play/i)
  })
})
