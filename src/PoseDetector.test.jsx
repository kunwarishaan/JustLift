// @vitest-environment jsdom
import React, { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PoseDetector from './PoseDetector.jsx'

const mediaPipe = vi.hoisted(() => ({
  forVisionTasks: vi.fn(),
  createFromOptions: vi.fn(),
}))

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: mediaPipe.forVisionTasks },
  PoseLandmarker: {
    createFromOptions: mediaPipe.createFromOptions,
    POSE_CONNECTIONS: [{ start: 11, end: 13 }, { start: 13, end: 15 }],
  },
}))

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function makeStream() {
  const tracks = Array.from({ length: 2 }, () => ({
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  return {
    getTracks: vi.fn(() => tracks),
    getVideoTracks: vi.fn(() => tracks),
    tracks,
  }
}

function makeDetector() {
  return {
    detectForVideo: vi.fn(() => ({ landmarks: [] })),
    close: vi.fn(),
  }
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

describe('PoseDetector', () => {
  let container
  let root
  let stream
  let detector
  let getUserMedia
  let animationFrames
  let cancelAnimationFrame
  let videoTime
  let context

  async function render(props = {}, { strict = false } = {}) {
    await act(async () => {
      const element = <PoseDetector {...props} />
      root.render(strict ? <StrictMode>{element}</StrictMode> : element)
      await settle()
    })
  }

  async function frame(timestamp = 1000) {
    await act(async () => {
      const callbacks = [...animationFrames.values()]
      animationFrames.clear()
      callbacks.forEach((callback) => callback(timestamp))
      await settle()
    })
  }

  async function unmount() {
    if (!root) return
    const currentRoot = root
    root = null
    await act(async () => {
      currentRoot.unmount()
      await settle()
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    stream = makeStream()
    detector = makeDetector()
    getUserMedia = vi.fn().mockResolvedValue(stream)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    mediaPipe.forVisionTasks.mockResolvedValue({})
    mediaPipe.createFromOptions.mockResolvedValue(detector)

    animationFrames = new Map()
    let nextAnimationFrame = 1
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
      const id = nextAnimationFrame++
      animationFrames.set(id, callback)
      return id
    }))
    cancelAnimationFrame = vi.fn((id) => animationFrames.delete(id))
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)

    videoTime = 1
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4)
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false)
    vi.spyOn(HTMLMediaElement.prototype, 'ended', 'get').mockReturnValue(false)
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockImplementation(() => videoTime)
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(480)
    context = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      drawImage: vi.fn(),
      setTransform: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
      context.canvas = this
      return context
    })
  })

  afterEach(async () => {
    await unmount()
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('streams a video, sizes the overlay, and publishes fresh or cached landmarks each animation frame', async () => {
    const landmarks = Array.from({ length: 33 }, (_, index) => ({
      x: index / 33,
      y: 0.5,
      z: -0.1,
      visibility: 0.95,
    }))
    detector.detectForVideo.mockReturnValueOnce({ landmarks: [landmarks] })
    const onPoseUpdate = vi.fn()
    await render({ onPoseUpdate })
    const video = container.querySelector('video')
    const canvas = container.querySelector('canvas')

    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ audio: false })
    expect(getUserMedia.mock.calls[0][0].video).toBeTruthy()
    expect(video.srcObject).toBe(stream)
    expect(video.play).toHaveBeenCalled()
    expect(mediaPipe.createFromOptions.mock.calls[0][1]).toMatchObject({ runningMode: 'VIDEO' })

    await frame(1000)
    expect(detector.detectForVideo).toHaveBeenCalledOnce()
    expect(detector.detectForVideo).toHaveBeenCalledWith(video, expect.any(Number))
    expect(onPoseUpdate).toHaveBeenLastCalledWith(landmarks, { timestamp: 1000, width: 640, height: 480 })
    expect(canvas.width).toBe(640)
    expect(canvas.height).toBe(480)
    expect(context.clearRect).toHaveBeenCalled()
    expect(context.arc).toHaveBeenCalledTimes(33)
    expect(context.arc).toHaveBeenCalledWith(
      landmarks[11].x * 640, landmarks[11].y * 480,
      expect.any(Number), 0, 2 * Math.PI,
    )

    const callsAfterFirstFrame = onPoseUpdate.mock.calls.length
    await frame(1016)
    expect(detector.detectForVideo).toHaveBeenCalledOnce()
    expect(onPoseUpdate).toHaveBeenCalledTimes(callsAfterFirstFrame + 1)
    // Another display refresh of the same captured frame must retain its
    // timestamp. The scorer uses this to avoid treating cached poses as motion.
    expect(onPoseUpdate).toHaveBeenLastCalledWith(landmarks, { timestamp: 1000, width: 640, height: 480 })
    expect(onPoseUpdate.mock.calls.at(-1)[1]).toBe(onPoseUpdate.mock.calls.at(-2)[1])

    videoTime = 2
    await frame(1032)
    expect(detector.detectForVideo).toHaveBeenCalledTimes(2)
    expect(onPoseUpdate).toHaveBeenLastCalledWith([], { timestamp: 2000, width: 640, height: 480 })
  })

  it('uses a replacement callback without reopening the camera or recreating the detector', async () => {
    const firstCallback = vi.fn()
    const replacementCallback = vi.fn()
    await render({ onPoseUpdate: firstCallback })
    await frame()
    const firstCallCount = firstCallback.mock.calls.length

    await render({ onPoseUpdate: replacementCallback })
    await frame(1016)

    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(mediaPipe.createFromOptions).toHaveBeenCalledOnce()
    expect(detector.close).not.toHaveBeenCalled()
    expect(firstCallback).toHaveBeenCalledTimes(firstCallCount)
    expect(replacementCallback).toHaveBeenLastCalledWith([], { timestamp: 1000, width: 640, height: 480 })
  })

  it('shows a visible permission error when webcam access is denied', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'))
    await render()

    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert.textContent).toMatch(/camera|webcam|permission/i)
    expect(detector.detectForVideo).not.toHaveBeenCalled()
    expect(animationFrames.size).toBe(0)
  })

  it('cancels animation, closes the detector, and stops every camera track on unmount', async () => {
    const onPoseUpdate = vi.fn()
    await render({ onPoseUpdate })
    await frame()
    const callCount = onPoseUpdate.mock.calls.length
    await unmount()

    expect(cancelAnimationFrame).toHaveBeenCalled()
    expect(animationFrames.size).toBe(0)
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledOnce()
    expect(detector.close).toHaveBeenCalledOnce()
    await frame(1016)
    expect(onPoseUpdate).toHaveBeenCalledTimes(callCount)
  })

  it('stops a camera stream that arrives after unmount', async () => {
    const pendingStream = deferred()
    getUserMedia.mockReturnValueOnce(pendingStream.promise)
    const onPoseUpdate = vi.fn()
    await render({ onPoseUpdate })
    await unmount()
    await act(async () => {
      pendingStream.resolve(stream)
      await settle()
    })

    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledOnce()
    expect(animationFrames.size).toBe(0)
    expect(onPoseUpdate).not.toHaveBeenCalled()
  })

  it('closes a detector that finishes loading after unmount', async () => {
    const pendingDetector = deferred()
    mediaPipe.createFromOptions.mockReturnValueOnce(pendingDetector.promise)
    await render()
    expect(mediaPipe.createFromOptions).toHaveBeenCalledOnce()
    await unmount()
    await act(async () => {
      pendingDetector.resolve(detector)
      await settle()
    })

    expect(detector.close).toHaveBeenCalledOnce()
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledOnce()
    expect(animationFrames.size).toBe(0)
  })

  it('releases resources and reports a detector failure during streaming', async () => {
    detector.detectForVideo.mockImplementationOnce(() => {
      throw new Error('WebGL context lost')
    })
    await render()
    await frame()

    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert.textContent.trim()).not.toBe('')
    expect(animationFrames.size).toBe(0)
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledOnce()
    expect(detector.close).toHaveBeenCalledOnce()
    await unmount()
    expect(detector.close).toHaveBeenCalledOnce()
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledOnce()
  })

  it('keeps the current StrictMode session running when an obsolete camera request completes', async () => {
    const obsoleteStream = makeStream()
    const pendingObsoleteStream = deferred()
    getUserMedia.mockReturnValueOnce(pendingObsoleteStream.promise)
    const onPoseUpdate = vi.fn()
    await render({ onPoseUpdate }, { strict: true })
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(mediaPipe.createFromOptions).toHaveBeenCalledOnce()
    await frame()

    await act(async () => {
      pendingObsoleteStream.resolve(obsoleteStream)
      await settle()
    })

    for (const track of obsoleteStream.tracks) expect(track.stop).toHaveBeenCalledOnce()
    for (const track of stream.tracks) expect(track.stop).not.toHaveBeenCalled()
    expect(detector.close).not.toHaveBeenCalled()
    expect(container.querySelector('video').srcObject).toBe(stream)
    videoTime = 2
    await frame(1016)
    expect(detector.detectForVideo).toHaveBeenCalledTimes(2)
    expect(onPoseUpdate).toHaveBeenLastCalledWith([], { timestamp: 2000, width: 640, height: 480 })

    await unmount()
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledOnce()
    expect(detector.close).toHaveBeenCalledOnce()
  })
})
