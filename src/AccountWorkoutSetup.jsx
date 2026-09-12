import { useState } from 'react'
import { ExerciseMode } from './GameScreen.jsx'
import ExerciseCatalogue from './ExerciseCatalogue.jsx'
import { getExercise } from './exerciseCatalogue.js'
import { formatPlayerLoad } from './workoutSettings.js'
import { MAX_REP_GOAL } from './gameState.js'

export function latestWorkout(workouts, exerciseId) {
  return workouts.filter(workout => workout.exerciseId === exerciseId)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || b.id.localeCompare(a.id))[0] ?? null
}

export default function AccountWorkoutSetup({ accounts, workouts, exerciseId, onExerciseChange, onContinue }) {
  const [previous] = useState(() => workouts.map(history => latestWorkout(history, exerciseId)))
  const [goals, setGoals] = useState(() => previous.map(workout => workout?.repCount ?? ''))
  const [loads, setLoads] = useState(() => previous.map(workout => ({ amount: workout?.load.amount ?? '', unit: workout?.load.unit ?? 'kg' })))
  const [catalogueOpen, setCatalogueOpen] = useState(false)
  const exercise = getExercise(exerciseId)

  function changeLoad(slot, update) {
    setLoads(current => current.map((load, index) => index === slot ? { ...load, ...update } : load))
  }

  function submit(event) {
    event.preventDefault()
    if (!goals.every(goal => goal !== '' && Number.isInteger(Number(goal)) && Number(goal) >= 1 && Number(goal) <= MAX_REP_GOAL)) return
    onContinue(goals.map(Number), loads.map(load => ({ amount: load.amount === '' ? null : Number(load.amount), unit: load.unit })))
  }

  return <section className="account-setup companion-screen" aria-label="Workout goals">
    <div className="account-setup__intro">
      <p className="eyebrow">One exercise. Two personal goals.</p>
      <h2 className="wide-type">Your floor.<br />Your game.</h2>
      <p>Choose your exercise, set your target, then take turns.</p>
      <ExerciseMode exercise={exercise} onOpenCatalogue={() => setCatalogueOpen(true)} />
    </div>
    <form className="account-setup__form" onSubmit={submit}>
      <div className="player-setup__form-heading"><h3 className="eyebrow">The lineup</h3><span className="player-setup__optional">Your last workout fills the fields</span></div>
      {accounts.map((account, slot) => <fieldset className="account-setup__player" key={account.id}>
        <legend><span className="account-setup__number">0{slot + 1}</span><span>{account.name}<small>Player {slot + 1}</small></span></legend>
        <div className="account-setup__targets">
          <label>Rep goal<input aria-label={`Player ${slot + 1} rep goal`} type="number" min="1" max={MAX_REP_GOAL} step="1" required value={goals[slot]} onChange={event => setGoals(current => current.map((goal, index) => index === slot ? event.target.value : goal))} /></label>
          <label>Weight<input aria-label={`Player ${slot + 1} weight`} type="number" min="0" max="2000" step="any" placeholder="Bodyweight" value={loads[slot].amount} onChange={event => changeLoad(slot, { amount: event.target.value })} /></label>
          <label>Unit<select aria-label={`Player ${slot + 1} weight unit`} value={loads[slot].unit} onChange={event => changeLoad(slot, { unit: event.target.value })}><option value="kg">kg</option><option value="lb">lb</option></select></label>
        </div>
        <p className="account-setup__previous">{previous[slot] ? <>Last workout: {previous[slot].repCount} reps · {formatPlayerLoad(previous[slot].load)}<br /><time dateTime={previous[slot].date}>{new Date(previous[slot].date).toLocaleDateString()}</time>{previous[slot].repCount === 0 && ' · Choose a goal of at least 1 rep.'}</> : 'No previous workout for this exercise. Set your first goal.'}</p>
      </fieldset>)}
      <p className="account-setup__hint">Leave weight blank for bodyweight. Okay or better fills your bar.</p>
      <button type="submit" className="button button--primary">Continue</button>
    </form>
    {catalogueOpen && <ExerciseCatalogue selectedExerciseId={exerciseId} onClose={() => setCatalogueOpen(false)} onSelect={id => { setCatalogueOpen(false); onExerciseChange(id) }} />}
  </section>
}
