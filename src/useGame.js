import { useCallback, useEffect, useRef, useState } from 'react'
import { createRepCounter } from './scoringEngine.js'
import { createInitialGameState, gameReducer, getOutcome } from './gameState.js'
import { getCalibrationProfile } from './calibrationProfiles.js'
import { createRepAudio } from './repAudio.js'

/** Reusable turn controller. GameScreen only renders this hook's state/actions. */
export default function useGame({ playerNames, playerGoals, onGameComplete } = {}) {
  const [game, setGame] = useState(() => createInitialGameState(playerNames, playerGoals))
  const [live, setLive] = useState(null)
  const [histories, setHistories] = useState([[], []])
  const lastPaint = useRef(-Infinity)
  const hadTracking = useRef(false)
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
    const player = gameRef.current.players[gameRef.current.currentPlayer]
    const session = { id: ++nextSessionId.current, counter: createRepCounter({ profileId: player.profileId }) }
    sessionRef.current = session
    lastPaint.current = -Infinity
    hadTracking.current = false
    setLive(null)
    apply({ type: 'START_TURN', sessionId: session.id })
  }, [apply])

  const onPoseUpdate = useCallback((landmarks, frame) => {
    const session = sessionRef.current
    // Capture the rendered session ID so an old camera's callback can never
    // score for the next player, or for a new game after Play Again.
    if (!session || session.id !== game.sessionId || gameRef.current.phase !== 'active') return
    const result = session.counter.processFrame(landmarks, frame)
    if (result.attemptCompleted && apply({ type: 'REP_COMPLETED', sessionId: session.id, result })) {
      const playerIndex = gameRef.current.currentPlayer
      setHistories((previous) => previous.map((history, index) =>
        index === playerIndex ? result.history : history))
      if (result.repCompleted) audioRef.current?.beep()
    }
    // Paint at 10 Hz; inference and counting still process every camera frame.
    // Both meters and awarded tiers come from this one authoritative counter.
    const now = performance.now()
    const trackingChanged = Boolean(result.live) !== hadTracking.current
    if (result.attemptCompleted || trackingChanged || now - lastPaint.current >= 100) {
      lastPaint.current = now
      hadTracking.current = Boolean(result.live)
      setLive(result.live)
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
    setLive(null)
    setHistories([[], []])
    apply({ type: 'PLAY_AGAIN' })
  }, [apply])

  useEffect(() => () => {
    sessionRef.current = null
    audioRef.current?.close()
    audioRef.current = null
  }, [])

  const outcome = game.phase === 'results' ? getOutcome(game.players) : null
  return {
    ...game,
    winner: outcome?.winner ?? null,
    outcome,
    calibration: getCalibrationProfile(game.players[game.currentPlayer].profileId),
    live,
    histories,
    startTurn,
    endTurn,
    playAgain,
    onPoseUpdate,
  }
}
