import { useCallback, useState } from 'react'
import GameScreen from './GameScreen.jsx'
import PlayerSetup from './PlayerSetup.jsx'
import StatsView from './StatsView.jsx'
import { DEFAULT_PLAYER_NAMES, normalizePlayerNames, normalizePlayerGoals } from './gameState.js'
import { createCompletedGame, loadPlayerNames, loadPlayerGoals, saveCompletedGame, savePlayerNames, savePlayerGoals } from './gameStorage.js'
import { getExercise } from './exerciseCatalogue.js'
import { loadWorkoutSettings, normalizePlayerLoads, saveWorkoutSettings } from './workoutSettings.js'

/** Optional local names/history wrap the existing game; storage cannot gate play. */
export default function LocalGame() {
  const [preferences] = useState(loadPlayerNames)
  const [goalPreferences] = useState(loadPlayerGoals)
  const [workoutPreferences] = useState(loadWorkoutSettings)
  const [setupNames, setSetupNames] = useState(preferences.names)
  const [playerNames, setPlayerNames] = useState(null)
  const [playerGoals, setPlayerGoals] = useState(goalPreferences.goals)
  const [playerLoads, setPlayerLoads] = useState(workoutPreferences.loads)
  const [exerciseId, setExerciseId] = useState(workoutPreferences.exerciseId)
  const [view, setView] = useState('setup')
  const [storageNotice, setStorageNotice] = useState(preferences.error || goalPreferences.error || workoutPreferences.error)
  const [historyMessage, setHistoryMessage] = useState('')

  function beginGame(names, goals, loads, remember) {
    const namesError = remember ? savePlayerNames(names).error : ''
    const goalsError = savePlayerGoals(goals).error
    const nextLoads = normalizePlayerLoads(loads)
    const workoutError = saveWorkoutSettings({ exerciseId, loads: nextLoads }).error
    setStorageNotice(namesError || goalsError || workoutError)
    setPlayerNames(normalizePlayerNames(names))
    setSetupNames(names)
    setPlayerGoals(normalizePlayerGoals(goals))
    setPlayerLoads(nextLoads)
    setView('game')
    setHistoryMessage('')
  }

  function changeExercise(nextId) {
    const selectedId = getExercise(nextId).id
    setExerciseId(selectedId)
    setStorageNotice(saveWorkoutSettings({ exerciseId: selectedId, loads: playerLoads }).error)
  }

  function editPlayers() {
    setPlayerNames(null)
    setView('setup')
    setHistoryMessage('')
  }

  const handleGameComplete = useCallback((players) => {
    try {
      // Workout metadata belongs to the UI wrapper. It never enters the rep
      // counter or winner calculation, and older history stays readable.
      const record = { ...createCompletedGame(players), workout: { exerciseId, loads: playerLoads } }
      const result = saveCompletedGame(record)
      setHistoryMessage(result.ok ? 'Game saved in this browser.' : result.error)
    } catch {
      setHistoryMessage('This game could not be saved in this browser. Your final scores are still shown here.')
    }
  }, [exerciseId, playerLoads])

  return (
    <>
      <div hidden={view === 'stats'}>
        {storageNotice && <p className="game-screen" role="status">{storageNotice}</p>}
        {playerNames === null ? (
          <PlayerSetup
            initialNames={setupNames}
            initialGoals={playerGoals}
            initialLoads={playerLoads}
            onContinue={(names, goals, loads) => beginGame(names, goals, loads, true)}
            onSkip={(goals, loads) => beginGame(DEFAULT_PLAYER_NAMES, goals, loads, false)}
            onShowStats={() => setView('stats')}
          />
        ) : (
          <GameScreen
            playerNames={playerNames}
            playerGoals={playerGoals}
            playerLoads={playerLoads}
            exerciseId={exerciseId}
            onExerciseChange={changeExercise}
            onGameComplete={handleGameComplete}
            onShowStats={() => setView('stats')}
            onEditPlayers={editPlayers}
            historyMessage={historyMessage}
          />
        )}
      </div>
      {view === 'stats' && <StatsView onBack={() => setView(playerNames === null ? 'setup' : 'game')} />}
    </>
  )
}
