import { useState } from 'react'
import { loadGames } from './gameStorage.js'

export default function StatsView({ onBack }) {
  // Mount fresh on every visit so this view reads persisted data, not a cache
  // of the game currently in memory. Reading never mutates stored history.
  const [{ games, error }] = useState(loadGames)

  return (
    <section className="game-screen" aria-label="Stats">
      <h2>Stats</h2>
      <p>Past games saved in this browser, newest first.</p>
      {error && <p role="status">{error}</p>}
      {games.length === 0 ? (!error && <p>No saved games yet.</p>) : (
        <div className="game-screen__table-scroll">
          <table className="game-screen__scores">
            <caption>Past games</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Player 1</th><th scope="col">Player 2</th><th scope="col">Winner</th></tr></thead>
            <tbody>
              {games.map((game) => (
                <tr key={game.id}>
                  <td><time dateTime={game.date}>{new Date(game.date).toLocaleString()}</time></td>
                  {game.players.map((player, index) => (
                    <td key={index}>{player.name}: {player.score} points</td>
                  ))}
                  <td>{game.winner === null ? 'Tie' : `${game.players[game.winner].name} (Player ${game.winner + 1})`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" onClick={onBack}>Back</button>
    </section>
  )
}
