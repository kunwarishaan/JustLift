import { useState } from 'react'
import { DEFAULT_PLAYER_NAMES, MAX_NAME_LENGTH } from './gameState.js'
import './GameScreen.css'

export default function PlayerSetup({ initialNames, onContinue, onSkip, onShowStats }) {
  const [names, setNames] = useState(initialNames)

  return (
    <section className="game-screen" aria-label="Player names">
      <div className="game-screen__panel">
        <h2>Players (optional)</h2>
        <p>Add names for your game history, or skip to play as Player 1 and Player 2.</p>
        <p>Names and completed games are saved only in this browser.</p>
      </div>
      <form className="game-screen__form game-screen__panel game-screen__panel--strong" onSubmit={(event) => { event.preventDefault(); onContinue(names) }}>
        {DEFAULT_PLAYER_NAMES.map((placeholder, index) => (
          <div className="game-screen__name-field" key={index}>
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
          </div>
        ))}
        <div className="game-screen__actions">
          <button type="submit">Continue</button>
          <button type="button" className="game-screen__button--ghost" onClick={onSkip}>Skip names</button>
          <button type="button" className="game-screen__button--ghost" onClick={onShowStats}>Stats</button>
        </div>
      </form>
    </section>
  )
}
