import { useEffect, useRef, useState } from 'react'
import { getExerciseIllustration } from './exerciseIllustrations.js'

/** Capture one frame of the remote anatomy illustration, then keep it still.
 * The image deliberately has no crossOrigin setting: display-only canvas
 * drawing works without a CORS header. Never read back or export this canvas.
 */
export default function ExerciseDiagram({ exerciseId, className }) {
  const { src, alt } = getExerciseIllustration(exerciseId)
  const canvasRef = useRef(null)
  const [loadState, setLoadState] = useState({ src, status: 'loading' })
  // Hide the preceding exercise immediately, before the new effect runs.
  const status = loadState.src === src ? loadState.status : 'loading'

  useEffect(() => {
    if (!src) {
      setLoadState({ src, status: 'error' })
      return undefined
    }
    let disposed = false
    let painted = false
    const canvas = canvasRef.current
    const image = new Image()
    setLoadState({ src, status: 'loading' })

    const unavailable = () => {
      if (!disposed && !painted) setLoadState({ src, status: 'error' })
    }
    image.onload = () => {
      if (disposed || painted || canvasRef.current !== canvas) return
      const width = image.naturalWidth
      const height = image.naturalHeight
      if (!width || !height) { unavailable(); return }
      try {
        const context = canvas.getContext('2d')
        if (!context) { unavailable(); return }
        canvas.width = width
        canvas.height = height
        // Intrinsic dimensions retain the complete figure and equipment. CSS
        // contains this bitmap within the preview without stretching/cropping.
        context.drawImage(image, 0, 0)
        painted = true
        setLoadState({ src, status: 'ready' })
      } catch {
        unavailable()
      }
    }
    image.onerror = unavailable
    image.src = src

    return () => {
      disposed = true
      image.onload = null
      image.onerror = null
    }
  }, [src])

  return <span
    className={`exercise-illustration${className ? ` ${className}` : ''}`}
    role="img"
    aria-label={status === 'error' ? `${alt} Illustration unavailable.` : alt}
    aria-busy={status === 'loading'}
    data-illustration-state={status}
  >
    <canvas ref={canvasRef} className="exercise-illustration__canvas" aria-hidden="true" hidden={status !== 'ready'} />
    {status !== 'ready' && <span className="exercise-illustration__message">{status === 'error' ? 'Illustration unavailable' : 'Loading illustration…'}</span>}
  </span>
}
