import PoseDetector from './PoseDetector.jsx'
import useGame from './useGame.js'
import { TIER_POINTS } from './gameState.js'
import './GameScreen.css'

const playerLabel = (player, index) => player.name === `Player ${index + 1}`
  ? player.name : `${player.name} (Player ${index + 1})`

export default function GameScreen({ playerNames, onGameComplete, onShowStats, historyMessage }) {
  const game = useGame({ playerNames, onGameComplete })
  const player = game.players[game.currentPlayer]
  const isActive = game.phase === 'active'
  const isResults = game.phase === 'results'

  return (
    <section className="game-screen" aria-label="Two-player push-up game">
      <h2>{isResults ? 'Results' : `${playerLabel(player, game.currentPlayer)}'s turn`}</h2>

      {isResults ? (
        <p className="game-screen__result" role="status">
          {game.winner === null ? "It's a tie!" : `${playerLabel(game.players[game.winner], game.winner)} wins!`}
        </p>
      ) : (
        <p>{isActive ? 'Do your push-ups, then end your turn.' : 'Get into position, then start your turn.'}</p>
      )}

      <table className="game-screen__scores">
        <caption>{isResults ? 'Final scores' : 'Scores'}</caption>
        <thead><tr><th scope="col">Player</th><th scope="col">Reps</th><th scope="col">Points</th><th scope="col">Turn</th></tr></thead>
        <tbody>
          {game.players.map((entry, index) => (
            <tr key={index}>
              <th scope="row">{playerLabel(entry, index)}</th>
              <td>{entry.repCount}</td>
              <td>{entry.score}</td>
              <td>{entry.finished ? 'Locked' : isActive && index === game.currentPlayer ? 'Playing' : 'Waiting'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {game.phase === 'ready' && <button type="button" onClick={game.startTurn}>Start Turn</button>}

      {isActive && (
        <>
          <div className="game-screen__feedback" role="status" aria-live="polite" aria-atomic="true">
            <span>Reps: <strong>{player.repCount}</strong></span>
            <span>
              Latest rep:{' '}
              <strong
                key={`${game.sessionId}:${player.repCount}`}
                className={player.lastTier ? 'rep-feedback rep-feedback--pulse' : 'rep-feedback'}
              >
                {player.lastTier ?? 'No reps yet'}
              </strong>
            </span>
          </div>
          <PoseDetector key={game.sessionId} onPoseUpdate={game.onPoseUpdate} />
          <button type="button" onClick={game.endTurn}>End Turn</button>
        </>
      )}

      {isResults && (
        <>
          {historyMessage && <p role="status">{historyMessage}</p>}
          <div className="game-screen__actions">
            <button type="button" onClick={game.playAgain}>Play Again</button>
            {onShowStats && <button type="button" onClick={onShowStats}>Stats</button>}
          </div>
        </>
      )}

      <p className="game-screen__legend">
        Points per rep: {Object.entries(TIER_POINTS).map(([tier, points]) => `${tier} ${points}`).join(' · ')}.
      </p>
    </section>
  )
}
