import { useEffect, useId, useMemo, useRef, useState } from 'react'
import ExerciseCatalogue from './ExerciseCatalogue.jsx'
import ExercisePreview from './ExercisePreview.jsx'
import { DEFAULT_EXERCISE_ID, getExercise } from './exerciseCatalogue.js'
import './WorkoutProgress.css'

const POUNDS_PER_KILOGRAM = 2.2046226218487757
const DAY = 86_400_000
const number = (value) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
const fullDate = (timestamp) => new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
const resultText = (workout) => `${workout.repCount >= workout.goal ? 'Success' : 'Failure'}: ${workout.repCount}/${workout.goal} reps`

function weightInKilograms(load) {
  if (load?.amount === null || load?.amount === 0) return 0
  if (!Number.isFinite(load?.amount) || load.amount < 0 || !['kg', 'lb'].includes(load.unit)) return null
  return load.unit === 'lb' ? load.amount / POUNDS_PER_KILOGRAM : load.amount
}

function displayWeight(workout, unit) {
  if (workout.weightKg === null) return 'Weight not recorded'
  if (workout.weightKg === 0) return 'Bodyweight'
  return `${number(unit === 'lb' ? workout.weightKg * POUNDS_PER_KILOGRAM : workout.weightKg)} ${unit}`
}

function yScale(maximum, integerOnly) {
  const rawStep = Math.max(1, maximum) / 4
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  let step = [1, 2, 2.5, 5, 10].find((value) => value >= rawStep / magnitude) * magnitude
  if (integerOnly) step = Math.max(1, Math.ceil(step))
  const top = Math.max(step, Math.ceil(maximum / step) * step)
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step) }
}

function usePlotWidth(enabled) {
  const element = useRef(null)
  const [width, setWidth] = useState(480)
  useEffect(() => {
    if (!enabled || !element.current) return undefined
    const measure = () => {
      const measured = element.current?.getBoundingClientRect().width
      if (measured) setWidth(Math.max(240, measured))
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(element.current)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [enabled])
  return [element, width]
}

function StatusMark({ success }) {
  return <span className={`workout-status-mark ${success ? 'workout-status-mark--success' : 'workout-status-mark--failure'}`} aria-hidden="true">{success ? '✓' : '×'}</span>
}

function WorkoutChart({ workouts, exerciseName, metric, unit }) {
  const isWeight = metric === 'weight'
  const rows = isWeight ? workouts.filter((workout) => workout.weightKg !== null) : workouts
  const [plot, width] = usePlotWidth(rows.length > 0)
  const [focused, setFocused] = useState(null)
  const [hovered, setHovered] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const titleId = useId(), descriptionId = useId(), tooltipId = useId()
  const title = isWeight ? `Weight (${unit})` : 'Repetitions'
  const height = 270, left = 76, right = width - 22, top = 22, bottom = height - 48
  const valueOf = (workout) => isWeight ? workout.weightKg * (unit === 'lb' ? POUNDS_PER_KILOGRAM : 1) : workout.repCount
  const first = rows[0]?.timestamp, last = rows.at(-1)?.timestamp
  const span = last - first
  const xOf = (timestamp) => span ? left + (timestamp - first) / span * (right - left) : (left + right) / 2
  const scale = yScale(Math.max(0, ...rows.map(valueOf)), !isWeight)
  const yOf = (value) => bottom - value / scale.top * (bottom - top)
  const dateTicks = !rows.length ? [] : span ? [first, first + span / 2, last] : [first]
  const axisDate = (timestamp) => new Date(timestamp).toLocaleString(undefined, span > 0 && span < DAY
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', ...(span > 365 * DAY ? { year: '2-digit' } : {}) })
  // Identical coordinates share one marker and one tooltip containing every
  // workout. Dates never receive invented spacing or jitter to separate dots.
  const grouped = new Map()
  rows.forEach((workout) => {
    const key = `${workout.timestamp}:${valueOf(workout)}`
    if (!grouped.has(key)) grouped.set(key, { key, timestamp: workout.timestamp, value: valueOf(workout), workouts: [] })
    grouped.get(key).workouts.push(workout)
  })
  const groups = [...grouped.values()]
  const active = dismissed ? null : grouped.get(focused ?? hovered)
  const activate = (key, focus = false) => { setDismissed(false); focus ? setFocused(key) : setHovered(key) }
  const tooltipPlacement = active ? {
    ...(xOf(active.timestamp) < width / 3 ? { left: 8 } : xOf(active.timestamp) > width * 2 / 3 ? { right: 8 } : { left: '50%', transform: 'translateX(-50%)' }),
    ...(yOf(active.value) < height * 0.4 ? { top: yOf(active.value) + 20 } : { bottom: height - yOf(active.value) + 20 }),
  } : {}

  return <section className="workout-chart" aria-labelledby={titleId}>
    <header className="workout-chart__header"><div><p className="eyebrow">{isWeight ? 'Load over time' : 'Reps over time'}</p><h3 id={titleId}>{title}</h3></div><span>{rows.length} {rows.length === 1 ? 'workout' : 'workouts'}</span></header>
    {!rows.length ? <div className="workout-chart__empty"><span aria-hidden="true">—</span><h4>{isWeight ? 'No weight history yet.' : 'No rep history yet.'}</h4><p>Complete a {exerciseName.toLowerCase()} workout to start this graph.</p></div> : <>
      <div ref={plot} className="workout-chart__plot" onMouseLeave={() => setHovered(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="group" aria-labelledby={titleId} aria-describedby={descriptionId}>
          <desc id={descriptionId}>Each marker is a recorded workout. Its horizontal position is the actual date and its vertical position is {isWeight ? `weight in ${unit}` : 'completed reps'}. Check marks mean the rep goal was met; crosses mean it was missed. Focus a marker for details.</desc>
          <g className="workout-chart__axes" aria-hidden="true">
            {scale.ticks.map((tick) => <g key={tick}><line x1={left} x2={right} y1={yOf(tick)} y2={yOf(tick)} /><text x={left - 12} y={yOf(tick) + 4} textAnchor="end">{isWeight && tick === 0 ? 'Bodyweight' : number(tick)}</text></g>)}
            {dateTicks.map((timestamp, index) => <g key={timestamp}><line className="workout-chart__date-tick" x1={xOf(timestamp)} x2={xOf(timestamp)} y1={bottom} y2={bottom + 5} /><text x={xOf(timestamp)} y={bottom + 25} textAnchor={dateTicks.length === 1 ? 'middle' : index === 0 ? 'start' : index === dateTicks.length - 1 ? 'end' : 'middle'}>{axisDate(timestamp)}</text></g>)}
          </g>
          {groups.map((group) => <g
            key={group.key}
            className={`workout-chart__point${active?.key === group.key ? ' workout-chart__point--active' : ''}`}
            transform={`translate(${xOf(group.timestamp)} ${yOf(group.value)})`}
            role="button"
            tabIndex={0}
            aria-label={`${fullDate(group.timestamp)}. ${group.workouts.map((workout) => `${resultText(workout)}. ${displayWeight(workout, unit)}`).join('; ')}`}
            aria-describedby={active?.key === group.key ? tooltipId : undefined}
            onMouseEnter={() => activate(group.key)}
            onFocus={() => activate(group.key, true)}
            onBlur={() => setFocused(null)}
            onClick={(event) => { event.currentTarget.focus(); activate(group.key, true) }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); setDismissed(true) }
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(group.key, true) }
            }}
          >
            <circle className="workout-chart__hit-area" r="17" aria-hidden="true" />
            <circle className="workout-chart__focus-ring" r={group.workouts.length > 1 ? 15 : 12} aria-hidden="true" />
            {group.workouts.slice(0, 4).map((workout, index) => {
              const success = workout.repCount >= workout.goal
              const offsets = group.workouts.length === 1 ? [0, 0] : [[-5, -5], [5, -5], [-5, 5], [5, 5]][index]
              return <g key={workout.key} transform={`translate(${offsets[0]} ${offsets[1]})`} aria-hidden="true"><circle r={group.workouts.length === 1 ? 8 : 5.5} className={success ? 'workout-chart__success' : 'workout-chart__failure'} /><path className="workout-chart__symbol" d={success ? 'M-3 0 -1 2 3-2' : 'M-2-2 2 2M2-2-2 2'} /></g>
            })}
            {group.workouts.length > 1 && <text className="workout-chart__duplicates" x="16" y="-12" aria-hidden="true">{group.workouts.length}</text>}
          </g>)}
        </svg>
        {active && <div className="workout-chart__tooltip" id={tooltipId} role="tooltip" style={tooltipPlacement}>
          <time dateTime={active.workouts[0].date}>{fullDate(active.timestamp)}</time>
          {active.workouts.length > 1 && <span className="workout-chart__tooltip-count">{active.workouts.length} workouts at this date and value</span>}
          {active.workouts.map((workout) => <div className="workout-chart__tooltip-record" key={workout.key}><strong><StatusMark success={workout.repCount >= workout.goal} />{resultText(workout)}</strong><span>{displayWeight(workout, unit)}{workout.weightKg > 0 && workout.load.unit !== unit ? ` · recorded as ${number(workout.load.amount)} ${workout.load.unit}` : ''}</span></div>)}
        </div>}
      </div>
      <p className="workout-chart__hint">Hover or focus a dot for details.{groups.some((group) => group.workouts.length > 1) ? ' Coincident workouts share a marker.' : ''}</p>
    </>}
  </section>
}

/** Account scoping and persistence belong to the caller; this view only reads. */
export default function WorkoutProgress({ workouts = [], initialExerciseId = DEFAULT_EXERCISE_ID, accountName = '', onBack }) {
  const [exerciseId, setExerciseId] = useState(() => getExercise(initialExerciseId).id)
  const [catalogueOpen, setCatalogueOpen] = useState(false)
  const [unit, setUnit] = useState('kg')
  const exercise = getExercise(exerciseId)
  const selectedWorkouts = useMemo(() => (Array.isArray(workouts) ? workouts : [])
    .map((workout, index) => ({ ...workout, key: `${workout?.id ?? 'workout'}:${index}`, timestamp: Date.parse(workout?.date), weightKg: weightInKilograms(workout?.load) }))
    .filter((workout) => workout.exerciseId === exerciseId && Number.isFinite(workout.timestamp) && Number.isInteger(workout.repCount) && workout.repCount >= 0 && Number.isInteger(workout.goal) && workout.goal > 0)
    .sort((a, b) => a.timestamp - b.timestamp), [workouts, exerciseId])

  return <section className="workout-progress" aria-label="Workout progress">
    <header className="workout-progress__header"><div><p className="eyebrow">{accountName ? `${accountName} / Workout history` : 'Your workout history'}</p><h2 className="wide-type">Your progress.</h2></div>{onBack && <button type="button" className="button button--quiet" onClick={onBack}>Back</button>}</header>
    <section className="workout-progress__exercise" aria-label="Exercise progress selection">
      <div><p className="eyebrow">{exercise.groupName}</p><h3 className="wide-type">{exercise.name}</h3><p>{selectedWorkouts.length} recorded {selectedWorkouts.length === 1 ? 'workout' : 'workouts'}</p></div>
      <button type="button" className="button" onClick={() => setCatalogueOpen(true)} aria-haspopup="dialog">Change exercise</button>
      <ExercisePreview exerciseId={exercise.id} className="workout-progress__illustration" />
    </section>
    <div className="workout-progress__controls"><div className="workout-progress__legend" aria-label="Workout result legend"><span><StatusMark success />Goal met</span><span><StatusMark success={false} />Goal missed</span></div><label className="workout-progress__unit">Weight display <select value={unit} onChange={(event) => setUnit(event.target.value)}><option value="kg">Kilograms (kg)</option><option value="lb">Pounds (lb)</option></select></label></div>
    <div className="workout-progress__charts"><WorkoutChart key={`${exerciseId}:reps`} workouts={selectedWorkouts} exerciseName={exercise.name} metric="reps" unit={unit} /><WorkoutChart key={`${exerciseId}:weight`} workouts={selectedWorkouts} exerciseName={exercise.name} metric="weight" unit={unit} /></div>
    <p className="workout-progress__notes">Reps are the number you completed. Dot color and symbol show whether you met your rep goal. All weights are shown in {unit}; bodyweight is plotted at zero.</p>
    {selectedWorkouts.length > 0 && <details className="workout-progress__data"><summary>View workout data ({selectedWorkouts.length})</summary><div className="workout-progress__table-scroll"><table><caption className="sr-only">{exercise.name} workout history, oldest first</caption><thead><tr><th scope="col">Date</th><th scope="col">Reps</th><th scope="col">Goal</th><th scope="col">Weight ({unit})</th><th scope="col">Result</th></tr></thead><tbody>{selectedWorkouts.map((workout) => <tr key={workout.key}><td><time dateTime={workout.date}>{fullDate(workout.timestamp)}</time></td><td>{workout.repCount}</td><td>{workout.goal}</td><td>{displayWeight(workout, unit)}</td><td><StatusMark success={workout.repCount >= workout.goal} />{workout.repCount >= workout.goal ? 'Success' : 'Failure'}</td></tr>)}</tbody></table></div></details>}
    {catalogueOpen && <ExerciseCatalogue selectedExerciseId={exerciseId} onSelect={(id) => { setExerciseId(id); setCatalogueOpen(false) }} onClose={() => setCatalogueOpen(false)} />}
  </section>
}
