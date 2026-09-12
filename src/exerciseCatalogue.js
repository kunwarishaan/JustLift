export const DEFAULT_EXERCISE_ID = 'push-ups'

const groups = [
  ['chest', 'Chest', [
    ['push-ups', 'Push-ups'],
    ['bench-press', 'Bench Press'],
    ['incline-dumbbell-press', 'Incline Dumbbell Press'],
    ['weighted-dips', 'Weighted Dips'],
    ['pec-fly', 'Pec Fly'],
  ]],
  ['back', 'Back', [
    ['dumbbell-row', 'Dumbbell Row'],
    ['seated-cable-row', 'Seated Cable Row'],
    ['pull-ups', 'Pull-ups'],
    ['chin-ups', 'Chin-ups'],
    ['barbell-row', 'Barbell Row'],
    ['lat-pulldown', 'Lat Pulldown'],
  ]],
  ['biceps', 'Biceps', [
    ['standing-dumbbell-curls', 'Standing Dumbbell Curls'],
    ['preacher-curls', 'Preacher Curls'],
    ['dumbbell-hammer-curls', 'Dumbbell Hammer Curls'],
  ]],
  ['triceps', 'Triceps', [
    ['rope-pushdown', 'Rope Pushdown'],
    ['skull-crushers', 'Skull Crushers'],
  ]],
  ['shoulders', 'Shoulders', [
    ['dumbbell-lateral-raises', 'Dumbbell Lateral Raises'],
    ['dumbbell-shoulder-press', 'Dumbbell Shoulder Press'],
  ]],
  ['legs', 'Legs', [
    ['squats', 'Squats'],
    ['leg-press', 'Leg Press'],
    ['hip-thrusts', 'Hip Thrusts'],
    ['leg-extensions', 'Leg Extensions'],
    ['hamstring-curls', 'Hamstring Curls'],
    ['calf-raises', 'Calf Raises'],
  ]],
]

export const EXERCISE_GROUPS = Object.freeze(groups.map(([id, name, exercises]) => Object.freeze({
  id,
  name,
  exercises: Object.freeze(exercises.map(([exerciseId, exerciseName]) => Object.freeze({
    id: exerciseId,
    name: exerciseName,
    groupId: id,
    groupName: name,
    diagram: exerciseId,
  }))),
})))

export const EXERCISES = Object.freeze(EXERCISE_GROUPS.flatMap((group) => group.exercises))
const exerciseById = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]))

export function getExercise(id) {
  return exerciseById.get(id) ?? exerciseById.get(DEFAULT_EXERCISE_ID)
}
