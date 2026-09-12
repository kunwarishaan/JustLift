import { useCallback, useEffect, useRef, useState } from 'react'
import { createRepCounter } from './scoringEngine.js'
import { createInitialGameState, gameReducer, getWinner } from './gameState.js'
import { createRepAudio } from './repAudio.js'

/** Reusable turn controller. GameScreen only renders this hook's state/actions. */
export default function useGame({ playerNames, onGameComplete } = {}) {
  const [game, setGame] = useState(() => createInitialGameState(playerNames))
  const gameRef = useRef(game)
  const sessionRef = useRef(null)
  const nextSessionId = useRef(0)
  const audioRef = useRef(null)
  const onGameCompleteRef = useRef(onGameComplete)

  useEffect(() => {
    onGameCompleteRef.current = onGameComplete
  }, [onGameComplete])

  const apply = useCallback((action) => {
    const previous = gameRef.current
    const next = gameReducer(previous, action)
    if (next !== previous) {
      // Update immediately: RAF callbacks and clicks may share a React batch.
      gameRef.current = next
      setGame(next)
    }
    return next !== previous
  }, [])

  const startTurn = useCallback(() => {
    if (gameRef.current.phase !== 'ready') return
    audioRef.current ??= createRepAudio()
    audioRef.current.unlock()
    const session = { id: ++nextSessionId.current, counter: createRepCounter() }
    sessionRef.current = session
    apply({ type: 'START_TURN', sessionId: session.id })
  }, [apply])

  const onPoseUpdate = useCallback((landmarks) => {
    const session = sessionRef.current
    // Capture the rendered session ID so an old camera's callback can never
    // score for the next player, or for a new game after Play Again.
    if (!session || session.id !== game.sessionId || gameRef.current.phase !== 'active') return
    const result = session.counter.processFrame(landmarks)
    if (!result.repCompleted) return
    if (apply({ type: 'REP_COMPLETED', sessionId: session.id, result })) {
      audioRef.current?.beep()
    }
  }, [game.sessionId, apply])

  const endTurn = useCallback(() => {
    if (gameRef.current.phase !== 'active') return
    sessionRef.current = null // Stop accepting frames before React unmounts the camera.
    audioRef.current?.close()
    if (apply({ type: 'END_TURN' }) && gameRef.current.phase === 'results') {
      // Emit once on the accepted transition, never from render or an effect.
      // Keeping persistence outside this hook leaves guest play independent.
      onGameCompleteRef.current?.(gameRef.current.players)
    }
  }, [apply])

  const playAgain = useCallback(() => {
    if (gameRef.current.phase !== 'results') return
    sessionRef.current = null
    audioRef.current?.close()
    // Session IDs intentionally keep increasing, even when scores are reset.
    apply({ type: 'PLAY_AGAIN' })
  }, [apply])

  useEffect(() => () => {
    sessionRef.current = null
    audioRef.current?.close()
    audioRef.current = null
  }, [])

  return {
    ...game,
    winner: game.phase === 'results' ? getWinner(game.players) : null,
    startTurn,
    endTurn,
    playAgain,
    onPoseUpdate,
  }
}
