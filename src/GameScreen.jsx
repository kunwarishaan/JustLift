import { useEffect, useId, useRef, useState } from 'react'
import PoseDetector from './PoseDetector.jsx'
import useGame from './useGame.js'
import useTurnPresentation from './useTurnPresentation.js'
import { TIER_POINTS } from './gameState.js'
import ExerciseCatalogue from './ExerciseCatalogue.jsx'
import ExerciseDiagram from './ExerciseDiagram.jsx'
import { DEFAULT_EXERCISE_ID, getExercise } from './exerciseCatalogue.js'
import { formatPlayerLoad, normalizePlayerLoads } from './workoutSettings.js'
import './GameScreen.css'

const playerLabel = (player, index) => player.name === `Player ${index + 1}`
  ? player.name : `${player.name} (Player ${index + 1})`
const rounded = (number) => number == null ? '···' : Math.round(number)
// Keep displayed integer scores inside their actual tier threshold band.
const formScore = (number) => Math.floor(number + 1e-7)
const twoDigits = (number) => String(number).padStart(2, '0')
const tierClass = (tier) => `tier-${tier?.toLowerCase() ?? 'none'}`
const attemptLabel = (rep) => rep.tier === 'X' ? `Attempt ${rep.attemptNumber}: X, not counted` : `Rep ${rep.repNumber}: ${rep.tier}`

function GoalProgress({ player, index }) {
  const complete = player.repCount >= player.goal
  return (
    <div className={`goal-progress ${complete ? 'goal-progress--complete' : ''}`}>
      <div className="goal-progress__heading"><span>{complete ? 'Goal met' : player.finished ? 'Goal missed' : 'Rep goal'}</span><strong>{player.repCount} / {player.goal}</strong></div>
      <progress max={player.goal} value={Math.min(player.repCount, player.goal)} aria-label={`${playerLabel(player, index)} goal`} aria-valuetext={`${player.repCount} of ${player.goal} reps; ${complete ? 'goal met' : player.finished ? 'goal missed' : `${player.goal - player.repCount} to go`}`} />
    </div>
  )
}

function Scoreboard({ game, loads }) {
  return (
    <table className="game-screen__scores">
      <caption className="sr-only">{game.phase === 'results' ? 'Final scores' : 'Scores'}</caption>
      <thead className="sr-only"><tr><th scope="col">Player</th><th scope="col">Reps</th><th scope="col">Points</th><th scope="col">Turn</th><th scope="col">Goal</th></tr></thead>
      <tbody>
        {game.players.map((entry, index) => (
          <tr key={index} className={index === (game.phase === 'results' ? game.winner : game.currentPlayer) ? 'score-player score-player--current' : 'score-player'}>
            <th scope="row" title={playerLabel(entry, index)}>{playerLabel(entry, index)}</th>
            <td className="score-player__reps" data-label="reps">{entry.repCount}</td>
            <td className="score-player__points" data-label="points">{entry.score}</td>
            <td className="score-player__state">{entry.finished ? 'Locked' : game.phase === 'active' && index === game.currentPlayer ? 'Playing' : 'Waiting'}</td>
            <td className="score-player__goal"><GoalProgress player={entry} index={index} /><span className="score-player__load">{formatPlayerLoad(loads[index])}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TierLegend() {
  return (
    <div className="tier-legend" aria-label="Points per rep and goal credit">
      <span className="eyebrow">Form earns points</span>
      <ul>{Object.entries(TIER_POINTS).map(([tier, points]) => (
        <li key={tier}>
          <span className={`tier-legend__mark ${tierClass(tier)}`} aria-hidden="true" />
          <strong>{tier}</strong><span>{points} {points === 1 ? 'pt' : 'pts'}</span>
          <span className="tier-legend__threshold">{tier === 'X' ? 'Not counted' : '+1 goal rep'}</span>
        </li>
      ))}</ul>
    </div>
  )
}

function ExerciseMode({ exercise, onOpenCatalogue }) {
  const backgroundFilterId = useId()
  return (
    <section className="exercise-mode" aria-label="Selected exercise" style={{ '--exercise-preview-filter': `url(#${backgroundFilterId})` }}>
      <svg className="exercise-mode__filter" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <filter id={backgroundFilterId} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
            {/* Fade near-white pixels to transparency without changing the figure's RGB colors. */}
            <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -10 -10 -10 0 29.7" />
            {/* Preserve transparency around the contained image as well. */}
            <feComposite operator="in" in2="SourceGraphic" />
          </filter>
        </defs>
      </svg>
      <div className="exercise-mode__top"><span className="eyebrow">Exercise / {exercise.groupName}</span><span className="exercise-mode__index">01 SET</span></div>
      <div className="exercise-mode__preview">
        <div><h4 className="wide-type">{exercise.name}</h4><p>One movement.<br />Two players. Your pace.</p></div>
        <ExerciseDiagram exerciseId={exercise.id} />
      </div>
      <div className="exercise-mode__bottom">
        {onOpenCatalogue ? <button type="button" className="button exercise-mode__choose" onClick={onOpenCatalogue} aria-haspopup="dialog">Change exercise <span aria-hidden="true">↗</span></button> : <span className="eyebrow">Same exercise. Your turn.</span>}
        <span>24 exercises<br />6 muscle groups</span>
      </div>
    </section>
  )
}

function ReadyTurn({ startTurn, onShowStats, onEditPlayers, player, calibration, exercise, load, onOpenCatalogue }) {
  return (
    <>
      <div className="ready-layout">
        <div className="ready-copy">
          <p className="eyebrow">{calibration} calibration</p>
          <h3 className="wide-type ready-title">MAKE EVERY<br /><span>REP COUNT.</span></h3>
          <p className="ready-description">Your target: <strong>{player.goal} {player.goal === 1 ? 'rep' : 'reps'} · {formatPlayerLoad(load)}</strong>, rated Okay or better.<br />Fill your bar to qualify. Better form earns more points.</p>
          <div className="ready-actions">
            <button className="button button--primary start-button" type="button" onClick={startTurn}>Start Turn</button>
            {onEditPlayers && <button className="button button--quiet" type="button" onClick={onEditPlayers}>Change goals</button>}
            {onShowStats && <button className="button button--quiet" type="button" onClick={onShowStats}>Stats</button>}
          </div>
          <p className="privacy-note">Your camera starts when you do. Nothing is recorded or uploaded.</p>
        </div>
        <ExerciseMode exercise={exercise} onOpenCatalogue={onOpenCatalogue} />
      </div>
      <div className="form-rules" aria-label="Three form rules">
        <div><span className="eyebrow">01 / Set your frame</span><p>Keep your whole body in camera view</p></div>
        <div><span className="eyebrow">02 / Find your rhythm</span><p>{exercise.id === DEFAULT_EXERCISE_ID ? 'Hold straight arms briefly, then lower' : 'Move with control, one rep at a time'}</p></div>
        <div><span className="eyebrow">03 / Make it count</span><p>Okay or better brings you closer to your goal</p></div>
      </div>
    </>
  )
}

function CadenceLane({ history }) {
  const list = useRef(null)
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight
  }, [history.length])
  return (
    <aside className="cadence-lane" aria-label="Cadence, attempt history">
      <div className="cadence-lane__title"><h3 className="eyebrow">Cadence</h3><span className="eyebrow">{twoDigits(history.length)}</span></div>
      <p className="cadence-lane__axis">Form score / 100</p>
      {history.length ? <ol ref={list} className="cadence-list" tabIndex="0" aria-label="Scored attempts, scroll for earlier attempts">
        {history.map((rep) => <li key={rep.attemptNumber ?? rep.repNumber} className={tierClass(rep.tier)} aria-label={`${attemptLabel(rep)}, ${formScore(rep.score)} out of 100, ${rep.points} points`}>
          <span className="cadence-list__index">{rep.tier === 'X' ? '×' : twoDigits(rep.repNumber)}</span>
          <span className="cadence-list__track" aria-hidden="true"><span style={{ width: `${rep.score}%` }} /></span>
          <span className="cadence-list__tier">{rep.tier}</span>
        </li>)}
      </ol> : <div className="cadence-empty"><div aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <span key={index} />)}</div><p>Your reps<br />build this lane.</p></div>}
    </aside>
  )
}

function DepthArc({ angle, targetAngle = 90 }) {
  // A semicircle with a short band below this player's calibrated depth target.
  // Values outside the visible range stop at the edge; the number stays exact.
  const minimum = targetAngle - 15
  const span = 180 - minimum
  const fraction = angle == null ? null : (Math.max(minimum, Math.min(180, angle)) - minimum) / span
  const point = (value, radius = 112) => ({ x: 140 - radius * Math.cos(value * Math.PI), y: 140 - radius * Math.sin(value * Math.PI) })
  const needle = fraction == null ? null : point(fraction, 104)
  const target = point(15 / span)
  return (
    <div className="depth-arc" aria-label={`Live elbow angle: ${angle == null ? 'waiting for tracking' : `${Math.round(angle)} degrees`}`}>
      <div className="eyebrow">Depth / elbow angle</div>
      <svg viewBox="0 0 280 176" aria-hidden="true">
        <path className="depth-arc__track" d="M28 140 A112 112 0 0 1 252 140" />
        <path className="depth-arc__target" d={`M28 140 A112 112 0 0 1 ${target.x} ${target.y}`} />
        {[15 / span, 0.5, 0.75, 1].map((position) => {
          const a = point(position, 103), b = point(position, 121)
          return <path key={position} className="depth-arc__tick" d={`M${a.x} ${a.y} L${b.x} ${b.y}`} />
        })}
        {needle && <path className="depth-arc__needle" d={`M140 140 L${needle.x} ${needle.y}`} />}
        <text x="30" y="167">≤{targetAngle}°</text><text x="222" y="167">180°</text>
      </svg>
      <div className="depth-arc__value wide-type">{rounded(angle)}<span>{angle == null ? '' : '°'}</span></div>
    </div>
  )
}

function FormMeters({ live, calibration }) {
  return (
    <aside className="form-readouts" aria-label="Live form readouts">
      <DepthArc angle={live?.elbowAngle} targetAngle={calibration?.targetAngle} />
      <div className="form-meter">
        <div className="form-meter__heading"><label htmlFor="elbow-travel">Elbow travel</label><strong>{rounded(live?.rangeScore)}<span> / 100</span></strong></div>
        <meter id="elbow-travel" min="0" max="100" value={live?.rangeScore ?? 0} aria-valuetext={live ? `${Math.round(live.rangeScore)} out of 100` : 'Waiting for tracking'} />
        <p>Your range through this movement.</p>
      </div>
      <div className="form-meter">
        <div className="form-meter__heading"><label htmlFor="body-line">Body line</label><strong>{rounded(live?.bodyDeviation)}<span>° off</span></strong></div>
        <meter id="body-line" min="0" max="100" value={live?.alignmentScore ?? 0} aria-valuetext={live ? `${Math.round(live.bodyDeviation)} degrees off straight, worst this rep ${Math.round(live.worstBodyDeviation)} degrees` : 'Waiting for tracking'} />
        <p>Worst this movement: {live ? `${Math.round(live.worstBodyDeviation)}° off straight` : 'waiting'}.</p>
      </div>
      <p className="readout-state">{live?.phase === 'find-top' ? 'Hold straight arms briefly to start' : live ? 'Reading your visible side' : 'Keep your whole body in view'}</p>
    </aside>
  )
}

function RepBreakdown({ player, index, history }) {
  return (
    <section className="rep-breakdown" aria-label={`${playerLabel(player, index)} rep breakdown`}>
      <div className="rep-breakdown__title"><h3 title={player.name}>{player.name}</h3><span className="eyebrow">Player {index + 1}</span></div>
      <div className="rep-breakdown__head" aria-hidden="true"><span>Rep</span><span>Tier</span><span>Form / 100</span><span>Points</span></div>
      {history.length ? <ol className="rep-breakdown__list" tabIndex="0" aria-label={`${player.name}, every scored attempt`}>
        {history.map((rep) => <li key={rep.attemptNumber ?? rep.repNumber} className={tierClass(rep.tier)} aria-label={`${attemptLabel(rep)}, form score ${formScore(rep.score)} out of 100, ${rep.points} points. Elbow travel ${Math.round(rep.rangeScore)} out of 100, body line ${Math.round(rep.worstBodyDeviation)} degrees off straight.`}>
          <span>{rep.tier === 'X' ? '×' : twoDigits(rep.repNumber)}</span><strong>{rep.tier}</strong><span>{formScore(rep.score)}</span><span>+{rep.points}</span>
          <span className="rep-breakdown__detail">Travel {Math.round(rep.rangeScore)}/100 · Body line {Math.round(rep.worstBodyDeviation)}° off</span>
        </li>)}
      </ol> : <p className="rep-breakdown__empty">No completed reps this turn.</p>}
    </section>
  )
}

export default function GameScreen({ playerNames, playerGoals, playerLoads, exerciseId, onExerciseChange, onGameComplete, onShowStats, onEditPlayers, historyMessage }) {
  const [localExerciseId, setLocalExerciseId] = useState(DEFAULT_EXERCISE_ID)
  const [catalogueOpen, setCatalogueOpen] = useState(false)
  const game = useGame({ playerNames, playerGoals, onGameComplete })
  const display = useTurnPresentation(game)
  const player = game.players[game.currentPlayer]
  const isActive = game.phase === 'active'
  const isResults = game.phase === 'results'
  const history = display.histories[game.currentPlayer]
  const latest = history.at(-1)
  const accentPlayer = isResults ? game.winner : game.currentPlayer
  const feedbackKey = `${game.sessionId}:${player.attemptCount}`
  const noWinner = game.outcome?.kind === 'no-winner'
  const exercise = getExercise(exerciseId ?? localExerciseId)
  const loads = normalizePlayerLoads(playerLoads)
  const canChangeExercise = game.phase === 'ready' && game.currentPlayer === 0

  function selectExercise(nextId) {
    if (!canChangeExercise) return
    const selected = getExercise(nextId).id
    setLocalExerciseId(selected)
    onExerciseChange?.(selected)
    setCatalogueOpen(false)
  }

  return (
    <section className={`game-screen game-screen--${game.phase} player-theme-${accentPlayer === null ? 'tie' : accentPlayer + 1}`} aria-label="Two-player exercise game">
      {isActive && <div className="camera-background"><PoseDetector key={game.sessionId} onPoseUpdate={display.onPoseUpdate} /></div>}
      {isActive && player.lastTier && <svg key={feedbackKey} className="frame-sweep" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true"><rect x="1" y="1" width="998" height="598" pathLength="100" /></svg>}
      <header className="turn-header">
        <div className="turn-heading">
          <span className="turn-marker" aria-hidden="true" />
          <div><p className="eyebrow">{isResults ? 'Both turns complete' : `Turn ${twoDigits(game.currentPlayer + 1)} / 02 · ${isActive ? 'Lifting' : 'Ready when you are'}`}</p>
          <h2 className={!isResults && player.name.length > 20 ? 'turn-name--long' : undefined} title={isResults ? 'Results' : `${playerLabel(player, game.currentPlayer)}'s turn`}>{isResults ? 'Results' : `${playerLabel(player, game.currentPlayer)}'s turn`}</h2>
          {(isActive || isResults) && <p className="turn-exercise">{exercise.name}{isActive && <> · {formatPlayerLoad(loads[game.currentPlayer])}</>}</p>}</div>
        </div>
        {!isResults && <p className="eyebrow turn-next">{game.currentPlayer === 0 ? <><span className="turn-next__name" title={game.players[1].name}>{game.players[1].name}</span><span>is up next</span></> : <>Final turn<br />Make it yours</>}</p>}
        {isResults && <p className="eyebrow">One game.<br />Every rep earned.</p>}
      </header>

      {game.phase === 'ready' && <ReadyTurn startTurn={display.startTurn} onShowStats={onShowStats} onEditPlayers={game.currentPlayer === 0 ? onEditPlayers : undefined} player={player} calibration={game.calibration?.label ?? (game.currentPlayer === 0 ? 'Justin' : 'Octavio')} exercise={exercise} load={loads[game.currentPlayer]} onOpenCatalogue={canChangeExercise ? () => setCatalogueOpen(true) : undefined} />}

      {isActive && <div className="arena-grid">
        <CadenceLane history={history} />
        <div className="game-screen__feedback" role="status" aria-live="polite" aria-atomic="true">
          <span className="live-rep-count wide-type"><span className="sr-only">Reps: </span>{player.repCount}</span>
          <span className="eyebrow live-rep-label">Reps this turn · goal {player.goal}</span>
          <div className="latest-rep">
            <span className="sr-only">Latest attempt: </span>
            <strong key={feedbackKey} className={`rep-feedback wide-type ${tierClass(player.lastTier)} ${player.lastTier ? 'rep-feedback--pulse' : ''}`}>{player.lastTier ?? 'Your first rep'}</strong>
            <p className="latest-rep__numbers">{latest ? <><strong>{formScore(latest.score)}</strong> / 100 <span>·</span> +{TIER_POINTS[player.lastTier]} points <span>·</span> {player.score} total</> : 'Go low. Reach long. Stay straight.'}</p>
            {player.lastTier === 'X' && <p className="latest-rep__rejected">Not counted. Reset your form and try again.</p>}
            {latest && <p className="latest-rep__detail">Last {player.lastTier === 'X' ? 'attempt' : 'rep'}: travel {Math.round(latest.rangeScore)}/100 · body {Math.round(latest.worstBodyDeviation)}° off</p>}
          </div>
        </div>
        <FormMeters live={display.live} calibration={game.calibration} />
      </div>}

      {isResults && <div className="results-content">
        <div className="result-banner">
          <p className="eyebrow">The floor has spoken</p>
          <p className={`game-screen__result wide-type ${game.winner !== null && game.players[game.winner].name.length > 20 ? 'game-screen__result--long' : ''}`} role="status">{noWinner ? 'No winner this round.' : game.winner === null ? "It's a tie!" : `${playerLabel(game.players[game.winner], game.winner)} wins!`}</p>
          <p>{noWinner ? 'Both players missed their rep goal. Reset and go again.' : game.winner === null ? 'Both goals met. Same points. A shared finish.' : game.players.every((entry) => entry.repCount >= entry.goal) ? `Both goals met. ${game.players[game.winner].score} points takes the game.` : 'One goal met. Completing your bar comes first.'}</p>
        </div>
      </div>}

      <div className="game-bottom">
        <Scoreboard game={game} loads={loads} />
        {isActive && <div className="turn-controls"><span className="eyebrow">Finished your set?</span><button type="button" className="button end-turn" onClick={display.endTurn}>End Turn</button></div>}
        {game.phase === 'ready' && <p className="score-note">Reach your goal to qualify.<br />If both qualify, highest points wins.</p>}
        {isResults && <div className="game-screen__actions"><button type="button" className="button button--primary" onClick={display.playAgain}>Play Again</button>{onEditPlayers && <button type="button" className="button button--quiet" onClick={onEditPlayers}>Change goals</button>}{onShowStats && <button type="button" className="button" onClick={onShowStats}>Stats</button>}</div>}
      </div>

      {isResults && <>
        <div className="result-breakdowns">{game.players.map((entry, index) => <RepBreakdown key={index} player={entry} index={index} history={display.histories[index]} />)}</div>
        {historyMessage && <p className="storage-confirmation" role="status">{historyMessage}</p>}
      </>}
      {game.phase === 'ready' && <TierLegend />}
      {catalogueOpen && canChangeExercise && <ExerciseCatalogue selectedExerciseId={exercise.id} onSelect={selectExercise} onClose={() => setCatalogueOpen(false)} />}
    </section>
  )
}
