import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRepAudio } from './repAudio.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function mockContext(state = 'running') {
  const oscillators = []
  const gains = []
  const context = {
    state,
    currentTime: 12.5,
    destination: {},
    oscillators,
    gains,
    resume: vi.fn(),
    close: vi.fn(),
    createOscillator: vi.fn(() => {
      const oscillator = {
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      }
      oscillators.push(oscillator)
      return oscillator
    }),
    createGain: vi.fn(() => {
      const gain = {
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
      gains.push(gain)
      return gain
    }),
  }
  context.resume.mockImplementation(() => {
    context.state = 'running'
    return Promise.resolve()
  })
  context.close.mockImplementation(() => {
    context.state = 'closed'
    return Promise.resolve()
  })
  return context
}

function installContexts(...contexts) {
  const remaining = [...contexts]
  const AudioContext = vi.fn(function AudioContext() {
    if (!remaining.length) throw new Error('Unexpected additional audio context')
    return remaining.shift()
  })
  vi.stubGlobal('AudioContext', AudioContext)
  return AudioContext
}

beforeEach(() => {
  vi.stubGlobal('AudioContext', undefined)
  vi.stubGlobal('webkitAudioContext', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createRepAudio', () => {
  it('creates no context until unlock and reuses a running context', () => {
    const context = mockContext()
    const AudioContext = installContexts(context)
    const audio = createRepAudio()

    audio.beep()
    expect(AudioContext).not.toHaveBeenCalled()
    audio.unlock()
    audio.unlock()
    expect(AudioContext).toHaveBeenCalledTimes(1)
    expect(context.resume).not.toHaveBeenCalled()
    expect(context.createOscillator).not.toHaveBeenCalled()
    audio.close()
  })

  it('resumes a suspended context on unlock without queueing missed beeps', async () => {
    const context = mockContext('suspended')
    const pendingResume = deferred()
    context.resume.mockReturnValue(pendingResume.promise)
    installContexts(context)
    const audio = createRepAudio()

    audio.unlock()
    expect(context.resume).toHaveBeenCalledTimes(1)
    audio.beep()
    expect(context.createOscillator).not.toHaveBeenCalled()
    context.state = 'running'
    pendingResume.resolve()
    await pendingResume.promise
    expect(context.createOscillator).not.toHaveBeenCalled()

    audio.beep()
    expect(context.createOscillator).toHaveBeenCalledTimes(1)
    audio.close()
  })

  it('routes one finite beep through a gain envelope and disconnects it on ended', () => {
    const context = mockContext()
    installContexts(context)
    const audio = createRepAudio()
    audio.unlock()
    audio.beep()

    expect(context.createOscillator).toHaveBeenCalledTimes(1)
    expect(context.createGain).toHaveBeenCalledTimes(1)
    const oscillator = context.oscillators[0]
    const gain = context.gains[0]
    expect(oscillator.connect).toHaveBeenCalledWith(gain)
    expect(gain.connect).toHaveBeenCalledWith(context.destination)
    expect(oscillator.start).toHaveBeenCalledWith(context.currentTime)

    const [frequency, frequencyTime] = oscillator.frequency.setValueAtTime.mock.calls[0]
    expect(frequency).toBeGreaterThan(0)
    expect(frequencyTime).toBe(context.currentTime)
    const [initialLevel, initialTime] = gain.gain.setValueAtTime.mock.calls[0]
    const [peakLevel, peakTime] = gain.gain.linearRampToValueAtTime.mock.calls[0]
    const [finalLevel, finalTime] = gain.gain.exponentialRampToValueAtTime.mock.calls[0]
    const [stopTime] = oscillator.stop.mock.calls[0]
    expect(initialTime).toBe(context.currentTime)
    expect(initialLevel).toBeGreaterThan(0)
    expect(peakLevel).toBeGreaterThan(initialLevel)
    expect(peakLevel).toBeLessThanOrEqual(1)
    expect(peakTime).toBeGreaterThan(initialTime)
    expect(finalLevel).toBeGreaterThan(0)
    expect(finalLevel).toBeLessThan(peakLevel)
    expect(finalTime).toBeGreaterThan(peakTime)
    expect(stopTime).toBeGreaterThanOrEqual(finalTime)
    expect(stopTime - context.currentTime).toBeLessThan(1)

    expect(oscillator.onended).toBeTypeOf('function')
    oscillator.onended()
    expect(oscillator.disconnect).toHaveBeenCalledTimes(1)
    expect(gain.disconnect).toHaveBeenCalledTimes(1)
    expect(oscillator.onended).toBeNull()
    audio.close()
    // A naturally ended voice is no longer retained for later cleanup.
    expect(oscillator.stop).toHaveBeenCalledTimes(1)
    expect(oscillator.disconnect).toHaveBeenCalledTimes(1)
  })

  it('stops and disconnects all active voices, closes once, and tolerates repeated cleanup', () => {
    const context = mockContext()
    installContexts(context)
    const audio = createRepAudio()
    audio.unlock()
    audio.beep()
    audio.beep()
    expect(context.oscillators).toHaveLength(2)

    audio.close()
    audio.close()
    audio.beep()
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(context.createOscillator).toHaveBeenCalledTimes(2)
    for (const oscillator of context.oscillators) {
      expect(oscillator.stop).toHaveBeenCalledTimes(2)
      expect(oscillator.stop).toHaveBeenLastCalledWith()
      expect(oscillator.disconnect).toHaveBeenCalledTimes(1)
      expect(oscillator.onended).toBeNull()
    }
    for (const gain of context.gains) expect(gain.disconnect).toHaveBeenCalledTimes(1)
  })

  it.each(['suspended', 'interrupted', 'closed'])('skips beeps when audio becomes %s', (state) => {
    const context = mockContext()
    installContexts(context)
    const audio = createRepAudio()
    audio.unlock()
    context.state = state
    expect(() => audio.beep()).not.toThrow()
    expect(context.createOscillator).not.toHaveBeenCalled()
    expect(context.resume).not.toHaveBeenCalled()
    audio.close()
  })

  it('remains usable as a silent no-op when Web Audio is unavailable or construction fails', () => {
    const audio = createRepAudio()
    expect(() => {
      audio.unlock()
      audio.beep()
      audio.close()
      audio.close()
    }).not.toThrow()

    const failingContext = vi.fn(function AudioContext() {
      throw new Error('Audio device unavailable')
    })
    vi.stubGlobal('AudioContext', failingContext)
    expect(() => {
      audio.unlock()
      audio.beep()
      audio.close()
    }).not.toThrow()
    expect(failingContext).toHaveBeenCalledTimes(1)
  })

  it('handles rejected resume and close promises without delayed beeps', async () => {
    const context = mockContext('suspended')
    const pendingResume = deferred()
    const pendingClose = deferred()
    context.resume.mockReturnValue(pendingResume.promise)
    context.close.mockReturnValue(pendingClose.promise)
    installContexts(context)
    const audio = createRepAudio()

    expect(() => audio.unlock()).not.toThrow()
    audio.beep()
    pendingResume.reject(new Error('Playback blocked'))
    await Promise.resolve()
    expect(context.createOscillator).not.toHaveBeenCalled()
    expect(() => audio.close()).not.toThrow()
    pendingClose.reject(new Error('Audio device disconnected'))
    await Promise.resolve()
    expect(() => audio.beep()).not.toThrow()
    expect(context.createOscillator).not.toHaveBeenCalled()
  })

  it('keeps a fresh context independent of old resume and close completions', async () => {
    const oldContext = mockContext('suspended')
    const newContext = mockContext()
    const pendingResume = deferred()
    const pendingClose = deferred()
    oldContext.resume.mockReturnValue(pendingResume.promise)
    oldContext.close.mockReturnValue(pendingClose.promise)
    const AudioContext = installContexts(oldContext, newContext)
    const audio = createRepAudio()

    audio.unlock()
    audio.beep()
    audio.close()
    audio.unlock()
    audio.beep()
    expect(AudioContext).toHaveBeenCalledTimes(2)
    expect(newContext.createOscillator).toHaveBeenCalledTimes(1)

    pendingResume.resolve()
    pendingClose.resolve()
    await Promise.all([pendingResume.promise, pendingClose.promise])
    expect(oldContext.createOscillator).not.toHaveBeenCalled()
    expect(newContext.createOscillator).toHaveBeenCalledTimes(1)
    expect(newContext.close).not.toHaveBeenCalled()
    audio.beep()
    expect(newContext.createOscillator).toHaveBeenCalledTimes(2)
    audio.close()
    expect(oldContext.close).toHaveBeenCalledTimes(1)
    expect(newContext.close).toHaveBeenCalledTimes(1)
  })

  it('cleans up a partially started beep without retaining a failed voice', () => {
    const context = mockContext()
    const defaultCreateOscillator = context.createOscillator.getMockImplementation()
    context.createOscillator.mockImplementation(() => {
      const oscillator = defaultCreateOscillator()
      oscillator.start.mockImplementation(() => { throw new Error('Start failed') })
      oscillator.stop.mockImplementation(() => { throw new Error('Never started') })
      return oscillator
    })
    installContexts(context)
    const audio = createRepAudio()
    audio.unlock()

    expect(() => audio.beep()).not.toThrow()
    const oscillator = context.oscillators[0]
    const gain = context.gains[0]
    expect(oscillator.disconnect).toHaveBeenCalledTimes(1)
    expect(gain.disconnect).toHaveBeenCalledTimes(1)
    expect(oscillator.onended).toBeNull()
    audio.close()
    expect(oscillator.stop).toHaveBeenCalledTimes(1)
    expect(oscillator.disconnect).toHaveBeenCalledTimes(1)
  })
})
