import { useState } from 'react'
import { DEFAULT_PLAYER_NAMES, DEFAULT_PLAYER_GOALS, MAX_NAME_LENGTH, MAX_REP_GOAL } from './gameState.js'
import { DEFAULT_PLAYER_LOADS, normalizePlayerLoads } from './workoutSettings.js'
import './CompanionScreens.css'

export default function PlayerSetup({ initialNames = ['', ''], initialGoals = DEFAULT_PLAYER_GOALS, initialLoads = DEFAULT_PLAYER_LOADS, onContinue, onSkip, onShowStats }) {
  const [names, setNames] = useState(initialNames)
  const [goals, setGoals] = useState(initialGoals)
  const [loads, setLoads] = useState(() => normalizePlayerLoads(initialLoads))

  function changeLoad(index, change) {
    setLoads((previous) => previous.map((load, slot) => slot === index ? { ...load, ...change } : load))
  }

  function submitSetup(event) {
    event.preventDefault()
    const targets = goals.map(Number)
    const weights = normalizePlayerLoads(loads.map((load) => ({
      amount: load.amount === '' || load.amount === null ? null : Number(load.amount),
      unit: load.unit,
    })))
    if (event.nativeEvent.submitter?.value === 'skip') onSkip(targets, weights)
    else onContinue(names, targets, weights)
  }

  return (
    <section className="companion-screen player-setup" aria-label="Player names">
      <div className="player-setup__intro">
        <p className="eyebrow player-setup__eyebrow">A local exercise challenge</p>
        <h2 className="wide-type player-setup__title">
          <span>Your floor.</span>
          <span>Your game.</span>
        </h2>
        <p className="player-setup__description">
          Take turns. Make every rep count.<br />
          Bring a friend and find your form.
        </p>

        <dl className="player-setup__readouts">
          <div><dt>Players</dt><dd>02</dd></div>
          <div><dt>Camera</dt><dd>01</dd></div>
          <div><dt>No time limit</dt><dd className="player-setup__pace">Your pace</dd></div>
        </dl>

        <div className="player-setup__privacy">
          <p>Camera starts when you start your turn.<br />Nothing is recorded or uploaded.</p>
          <button className="button button--quiet" type="button" onClick={onShowStats}>Stats</button>
        </div>
      </div>

      <form className="player-setup__form" onSubmit={submitSetup}>
        <div className="player-setup__form-heading">
          <h3 className="eyebrow">The lineup</h3>
          <span className="player-setup__optional">Names and weight are optional</span>
        </div>
        <div className="player-setup__fields">
          {DEFAULT_PLAYER_NAMES.map((placeholder, index) => (
            <div className={`player-setup__field player-setup__field--${index + 1}`} key={index}>
              <span className="player-setup__slot" aria-hidden="true">0{index + 1}</span>
              <label htmlFor={`player-name-${index}`}>{placeholder} name</label>
              <input
                id={`player-name-${index}`}
                name={`player-name-${index}`}
                type="text"
                value={names[index]}
                placeholder={placeholder}
                maxLength={MAX_NAME_LENGTH}
                autoComplete="off"
                onChange={(event) => setNames(names.map((name, slot) => slot === index ? event.target.value : name))}
              />
              <div className="player-setup__targets">
                <div className="player-setup__goal">
                  <label htmlFor={`player-goal-${index}`}>Rep goal</label>
                  <input
                    id={`player-goal-${index}`}
                    name={`player-goal-${index}`}
                    type="number"
                    min="1"
                    max={MAX_REP_GOAL}
                    step="1"
                    required
                    value={goals[index]}
                    aria-label={`${placeholder} rep goal`}
                    onChange={(event) => setGoals(goals.map((goal, slot) => slot === index ? event.target.value : goal))}
                  />
                </div>
                <div className="player-setup__load">
                  <label htmlFor={`player-weight-${index}`}>Weight</label>
                  <input
                    id={`player-weight-${index}`}
                    name={`player-weight-${index}`}
                    type="number"
                    min="0"
                    max="2000"
                    step="any"
                    inputMode="decimal"
                    value={loads[index].amount ?? ''}
                    placeholder="None"
                    aria-label={`${placeholder} weight`}
                    onChange={(event) => changeLoad(index, { amount: event.target.value })}
                  />
                </div>
                <div className="player-setup__unit">
                  <label htmlFor={`player-weight-unit-${index}`}>Unit</label>
                  <select
                    id={`player-weight-unit-${index}`}
                    name={`player-weight-unit-${index}`}
                    value={loads[index].unit}
                    aria-label={`${placeholder} weight unit`}
                    onChange={(event) => changeLoad(index, { unit: event.target.value })}
                  >
                    <option value="kg">kg</option>
                    <option value="lb">lb</option>
                  </select>
                </div>
              </div>
              <p className="player-setup__calibration">{index === 0 ? 'Justin' : 'Octavio'} calibration · fixed to this player slot</p>
            </div>
          ))}
        </div>
        <div className="player-setup__actions">
          <button className="button button--primary" type="submit">Continue</button>
          <button className="button button--quiet" type="submit" name="setup-action" value="skip">Skip names</button>
        </div>
        <p className="player-setup__storage-note">
          Okay or better fills your bar. X does not count.<br />
          Reach your goal to qualify; then points decide the winner.
        </p>
      </form>
    </section>
  )
}
