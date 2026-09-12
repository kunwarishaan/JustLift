import { useState } from 'react'
import { loadGames } from './gameStorage.js'
import { getExercise } from './exerciseCatalogue.js'
import { formatPlayerLoad, normalizePlayerLoads } from './workoutSettings.js'
import './CompanionScreens.css'

export default function StatsView({ onBack }) {
  // Mount fresh on every visit so this view reads persisted data, not a cache
  // of the game currently in memory. Reading never mutates stored history.
  const [{ games, error }] = useState(loadGames)

  return (
    <section className="companion-screen match-history" aria-label="Stats">
      <header className="match-history__header">
        <div>
          <p className="eyebrow">Stats / Local history</p>
          <h2 className="wide-type match-history__title">The record.</h2>
          <p className="match-history__description">Past games saved in this browser, newest first.</p>
        </div>
        <dl className="match-history__count">
          <dt>Saved games</dt>
          <dd>{String(games.length).padStart(2, '0')}</dd>
        </dl>
      </header>

      {error && <p className="companion-screen__notice" role="status">{error}</p>}

      {games.length === 0 ? (!error && (
        <div className="match-history__empty">
          <span className="match-history__empty-number" aria-hidden="true">00</span>
          <div>
            <h3 className="wide-type">No saved games yet.</h3>
            <p>Finish both turns to put your first game on the board.</p>
            <p>Then come back and see how you stack up.</p>
          </div>
        </div>
      )) : (
        <div className="match-history__scroll" tabIndex={0} aria-label="Saved game results">
          <table className="match-history__table">
            <caption className="sr-only">Past games</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Player 1</th><th scope="col">Player 2</th><th scope="col">Winner</th></tr></thead>
            <tbody>
              {games.map((game) => (
                <tr key={game.id}>
                  <td className="match-history__date"><time dateTime={game.date}>{new Date(game.date).toLocaleString()}</time>{game.workout && <span className="match-history__exercise">{getExercise(game.workout.exerciseId).name}</span>}</td>
                  {game.players.map((player, index) => (
                    <td key={index}>
                      <span className="match-history__player">{player.name}:</span>{' '}
                      <strong className="match-history__points">{player.score}</strong>{' '}
                      <span className="match-history__unit">points</span>
                      {Number.isInteger(player.goal) && <span className="match-history__goal">{player.repCount} / {player.goal} reps · {player.repCount >= player.goal ? 'Goal met' : 'Goal missed'}</span>}
                      {game.workout && <span className="match-history__load">{formatPlayerLoad(normalizePlayerLoads(game.workout.loads)[index])}</span>}
                    </td>
                  ))}
                  <td className="match-history__winner">{game.outcome === 'no-winner' ? 'No winner · both goals missed' : game.winner === null ? 'Tie' : `${game.players[game.winner].name} (Player ${game.winner + 1})`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="match-history__footer">
        <button className="button button--quiet" type="button" onClick={onBack}>Back</button>
        <p>Your games. This browser. No account needed.</p>
      </footer>
    </section>
  )
}
