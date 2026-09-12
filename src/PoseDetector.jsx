import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import './PoseDetector.css'

const MODEL_URL = `${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`
const WASM_URL = `${import.meta.env.BASE_URL}mediapipe/wasm`
const KEY_JOINTS = new Set([11, 12, 13, 14, 15, 16, 23, 24, 25, 26])

function drawPose(context, canvas, landmarks) {
  const { width, height } = canvas
  context.clearRect(0, 0, width, height)
  const visible = (point) => point && (point.visibility ?? 1) >= 0.5

  context.strokeStyle = '#35e0cb'
  context.lineWidth = Math.max(2, width / 320)
  for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
    const from = landmarks[start]
    const to = landmarks[end]
    if (!visible(from) || !visible(to)) continue
    context.beginPath()
    context.moveTo(from.x * width, from.y * height)
    context.lineTo(to.x * width, to.y * height)
    context.stroke()
  }

  landmarks.forEach((point, index) => {
    if (!visible(point)) return
    const keyJoint = KEY_JOINTS.has(index)
    context.beginPath()
    context.arc(point.x * width, point.y * height, keyJoint ? 6 : 3, 0, 2 * Math.PI)
    context.fillStyle = keyJoint ? '#ffdc61' : '#ffffff'
    context.fill()
    context.strokeStyle = '#17202b'
    context.lineWidth = 1.5
    context.stroke()
  })
}

function cameraErrorMessage(error) {
  switch (error.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera access was denied. Allow camera access in your browser’s site settings, then reload this page.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found. Connect a webcam, then reload this page.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera could not be started. Close other apps using it, then reload this page.'
    default:
      return 'Unable to start the camera. Check your camera and browser permissions, then reload this page.'
  }
}

/**
 * Emits the first person's 33 normalized, unmirrored landmarks (x, y, z,
 * visibility), or [] when no pose is available. Called every animation frame
 * while running; inference only runs when the camera provides a new frame.
 */
export default function PoseDetector({ onPoseUpdate }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const onPoseUpdateRef = useRef(onPoseUpdate)
  const [status, setStatus] = useState('Waiting for camera permission…')
  const [error, setError] = useState('')

  // A changing parent callback must not reopen the webcam or reload the model.
  useEffect(() => {
    onPoseUpdateRef.current = onPoseUpdate
  }, [onPoseUpdate])

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    let disposed = false
    let stopped = false
    let stream = null
    let detector = null
    let frameId = null
    let lastVideoTime = -1
    let landmarks = []

    function releaseResources() {
      if (frameId !== null) cancelAnimationFrame(frameId)
      frameId = null
      if (stream) {
        for (const track of stream.getTracks()) {
          track.removeEventListener('ended', onCameraEnded)
          track.stop()
        }
        if (video.srcObject === stream) {
          video.pause()
          video.srcObject = null
        }
        stream = null
      }
      if (detector) {
        detector.close()
        detector = null
      }
      context?.clearRect(0, 0, canvas.width, canvas.height)
      landmarks = []
    }

    function fail(message) {
      if (disposed || stopped) return
      stopped = true
      releaseResources()
      setError(message)
      setStatus('')
      onPoseUpdateRef.current?.([])
    }

    function onCameraEnded() {
      fail('The camera disconnected or access was revoked. Check your camera and reload this page.')
    }

    function renderFrame(timestamp) {
      if (disposed || stopped) return
      try {
        if (video.readyState >= 2 && !video.paused && !video.ended && video.videoWidth && video.videoHeight) {
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
          }
          if (video.currentTime !== lastVideoTime) {
            landmarks = detector.detectForVideo(video, timestamp).landmarks[0] ?? []
            lastVideoTime = video.currentTime
            drawPose(context, canvas, landmarks)
          }
        } else {
          landmarks = []
          lastVideoTime = -1
          context.clearRect(0, 0, canvas.width, canvas.height)
        }
      } catch {
        fail('Pose tracking stopped unexpectedly. Reload this page to restart the camera and detector.')
        return
      }

      frameId = requestAnimationFrame(renderFrame)
      onPoseUpdateRef.current?.(landmarks)
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        fail('Camera access is unavailable. Open this app on localhost or HTTPS in a browser that supports webcams.')
        return
      }
      if (!context) {
        fail('This browser cannot draw the pose overlay. Try a browser with canvas support.')
        return
      }

      let stage = 'camera'
      try {
        const camera = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        })
        // getUserMedia cannot be aborted; stop a stream that arrives after unmount.
        if (disposed || stopped) {
          camera.getTracks().forEach((track) => track.stop())
          return
        }
        stream = camera
        stream.getVideoTracks().forEach((track) => track.addEventListener('ended', onCameraEnded))
        video.srcObject = stream
        await video.play()
        if (disposed || stopped) return

        stage = 'model'
        setStatus('Loading pose detector…')
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
        if (disposed || stopped) return
        const createdDetector = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
          outputSegmentationMasks: false,
        })
        // Model initialization may also finish after React has cleaned up.
        if (disposed || stopped) {
          createdDetector.close()
          return
        }
        detector = createdDetector
        setStatus('Camera ready. Keep your whole body in view.')
        frameId = requestAnimationFrame(renderFrame)
      } catch (startError) {
        fail(stage === 'camera'
          ? cameraErrorMessage(startError)
          : 'Unable to load the pose detector. Reload this page to try again.')
      }
    }

    start()
    return () => {
      disposed = true
      releaseResources()
    }
  }, [])

  return (
    <section className="pose-detector" aria-label="Live pose detection">
      <div className="pose-detector__viewport">
        <video ref={videoRef} autoPlay muted playsInline aria-label="Live webcam feed" />
        <canvas ref={canvasRef} aria-hidden="true" />
      </div>
      {error ? <p className="pose-detector__error" role="alert">{error}</p> : <p role="status">{status}</p>}
      <p className="pose-detector__hint">Yellow markers highlight shoulders, elbows, wrists, hips, and knees.</p>
    </section>
  )
}
