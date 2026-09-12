import { useCallback, useState } from 'react'
import GameScreen from './GameScreen.jsx'
import PlayerSetup from './PlayerSetup.jsx'
import StatsView from './StatsView.jsx'
import { DEFAULT_PLAYER_NAMES, normalizePlayerNames } from './gameState.js'
import { createCompletedGame, loadPlayerNames, saveCompletedGame, savePlayerNames } from './gameStorage.js'

/** Optional local names/history wrap the existing game; storage cannot gate play. */
export default function LocalGame() {
  const [preferences] = useState(loadPlayerNames)
  const [playerNames, setPlayerNames] = useState(null)
  const [view, setView] = useState('setup')
  const [storageNotice, setStorageNotice] = useState(preferences.error)
  const [historyMessage, setHistoryMessage] = useState('')

  function beginGame(names, remember) {
    setStorageNotice(remember ? savePlayerNames(names).error : '')
    setPlayerNames(normalizePlayerNames(names))
    setView('game')
  }

  const handleGameComplete = useCallback((players) => {
    try {
      const record = createCompletedGame(players)
      const result = saveCompletedGame(record)
      setHistoryMessage(result.ok ? 'Game saved in this browser.' : result.error)
    } catch {
      setHistoryMessage('This game could not be saved in this browser. Your final scores are still shown here.')
    }
  }, [])

  return (
    <>
      <div hidden={view === 'stats'}>
        {storageNotice && <p className="game-screen" role="status">{storageNotice}</p>}
        {playerNames === null ? (
          <PlayerSetup
            initialNames={preferences.names}
            onContinue={(names) => beginGame(names, true)}
            onSkip={() => beginGame(DEFAULT_PLAYER_NAMES, false)}
            onShowStats={() => setView('stats')}
          />
        ) : (
          <GameScreen
            playerNames={playerNames}
            onGameComplete={handleGameComplete}
            onShowStats={() => setView('stats')}
            historyMessage={historyMessage}
          />
        )}
      </div>
      {view === 'stats' && <StatsView onBack={() => setView(playerNames === null ? 'setup' : 'game')} />}
    </>
  )
}
