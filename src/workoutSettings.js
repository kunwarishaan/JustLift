import { DEFAULT_EXERCISE_ID, getExercise } from './exerciseCatalogue.js'

export const WORKOUT_SETTINGS_KEY = 'just-lift:workout-settings:v1'
export const DEFAULT_PLAYER_LOADS = Object.freeze([
  Object.freeze({ amount: null, unit: 'kg' }),
  Object.freeze({ amount: null, unit: 'kg' }),
])

const validAmount = (amount) => amount === null
  || (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && amount <= 2000)
const validUnit = (unit) => unit === 'kg' || unit === 'lb'
const validExercise = (exerciseId) => typeof exerciseId === 'string'
  && getExercise(exerciseId)?.id === exerciseId
const validLoads = (loads) => Array.isArray(loads) && loads.length === 2
  && loads.every((load) => load && validAmount(load.amount) && validUnit(load.unit))

// Keep an empty optional field distinct from an explicitly entered zero.
// Return fresh objects so one player's edits never affect the other player.
export function normalizePlayerLoads(loads) {
  return DEFAULT_PLAYER_LOADS.map((fallback, index) => ({
    amount: validAmount(loads?.[index]?.amount) ? loads[index].amount : fallback.amount,
    unit: validUnit(loads?.[index]?.unit) ? loads[index].unit : fallback.unit,
  }))
}

export function formatPlayerLoad(load) {
  const [normalized] = normalizePlayerLoads([load])
  return normalized.amount === null || normalized.amount === 0
    ? 'Bodyweight' : `${normalized.amount} ${normalized.unit}`
}

const defaults = (error = '') => ({
  exerciseId: DEFAULT_EXERCISE_ID,
  loads: normalizePlayerLoads(),
  error,
})

export function loadWorkoutSettings() {
  try {
    const raw = globalThis.localStorage.getItem(WORKOUT_SETTINGS_KEY)
    if (raw === null) return defaults()
    const settings = JSON.parse(raw)
    if (settings?.version !== 1 || !validExercise(settings.exerciseId) || !validLoads(settings.loads)) {
      return defaults('Saved workout settings could not be read. You can choose new settings.')
    }
    return { exerciseId: settings.exerciseId, loads: normalizePlayerLoads(settings.loads), error: '' }
  } catch {
    return defaults('Saved workout settings are unavailable. You can still play.')
  }
}

export function saveWorkoutSettings({ exerciseId, loads } = {}) {
  if (!validExercise(exerciseId)) {
    return { ok: false, error: 'Choose an available exercise before saving workout settings.' }
  }
  try {
    globalThis.localStorage.setItem(WORKOUT_SETTINGS_KEY, JSON.stringify({
      version: 1,
      exerciseId,
      loads: normalizePlayerLoads(loads),
    }))
    return { ok: true, error: '' }
  } catch {
    return { ok: false, error: 'Workout settings could not be saved in this browser. You can still play.' }
  }
}
