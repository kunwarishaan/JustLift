// @vitest-environment jsdom
import React, { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GameScreen from './GameScreen.jsx'

const mocks = vi.hoisted(() => ({
  poseCallbacks: [],
  poseMount: vi.fn(),
  poseUnmount: vi.fn(),
  audioInstances: [],
}))

vi.mock('./PoseDetector.jsx', () => ({
  default: function MockPoseDetector({ onPoseUpdate }) {
    React.useEffect(() => {
      mocks.poseCallbacks.push(onPoseUpdate)
    }, [onPoseUpdate])
    React.useEffect(() => {
      mocks.poseMount()
      return () => mocks.poseUnmount()
    }, [])
    return <div data-testid="mock-pose-detector">Live camera</div>
  },
}))

vi.mock('./repAudio.js', () => ({
  createRepAudio: vi.fn(() => {
    const resource = {
      unlock: vi.fn().mockResolvedValue(),
      beep: vi.fn(),
      close: vi.fn(),
    }
    mocks.audioInstances.push(resource)
    return resource
  }),
}))

// Actual 3D geometry drives the real scoring engine; no scoring mocks.
function pose(elbowDegrees, deviation = 0) {
  const radians = (degrees) => degrees * Math.PI / 180
  const elbow = radians(elbowDegrees)
  const back = radians(180 - deviation)
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }))
  landmarks[11] = { x: 0.1, y: 0.1, z: 0, visibility: 1 }
  landmarks[13] = { x: 0.25, y: 0.1, z: 0, visibility: 1 }
  landmarks[15] = { x: 0.25 - 0.15 * Math.cos(elbow), y: 0.1 + 0.15 * Math.sin(elbow), z: 0, visibility: 1 }
  landmarks[23] = { x: 0.1, y: 0.4, z: 0, visibility: 1 }
  landmarks[25] = { x: 0.1 + 0.15 * Math.sin(back), y: 0.4 - 0.15 * Math.cos(back), z: 0, visibility: 1 }
  return landmarks
}

function rep(tier = 'Perfect') {
  if (tier === 'X') return [pose(90, 60), pose(160, 60)]
  const deviation = { Okay: 45, Good: 18, Super: 9, Perfect: 0 }[tier]
  // A fresh good top sample replaces the previous rep's top/alignment stats.
  return [pose(180), pose(70), pose(100, deviation), pose(180)]
}

describe('GameScreen integration', () => {
  let container
  let root

  const camera = () => container.querySelector('[data-testid="mock-pose-detector"]')
  const currentCallback = () => mocks.poseCallbacks.at(-1)
  const beepCount = () => mocks.audioInstances.reduce((count, audio) => count + audio.beep.mock.calls.length, 0)

  function button(name) {
    const found = [...container.querySelectorAll('button')].find((element) => name.test(element.textContent))
    expect(found, `Expected button matching ${name}`).toBeDefined()
    return found
  }

  const playerRow = (player) => [...container.querySelectorAll('tbody tr')]
    .find((row) => row.querySelector('th').textContent === `Player ${player}`)
  const activeCells = () => [...container.querySelectorAll('tbody tr')]
    .find((row) => row.querySelectorAll('td')[2].textContent === 'Playing')
    .querySelectorAll('td')
  const reps = () => activeCells()[0]
  const score = () => activeCells()[1]
  const pulse = () => container.querySelector('.rep-feedback--pulse')
  const finalScore = (player) => playerRow(player).querySelectorAll('td')[1]

  async function render({ strict = false } = {}) {
    await act(async () => {
      root.render(strict ? <StrictMode><GameScreen /></StrictMode> : <GameScreen />)
    })
  }

  async function click(name) {
    await act(async () => { button(name).click() })
  }

  async function emit(callback, frames) {
    await act(async () => {
      for (const landmarks of frames) callback(landmarks)
    })
  }

  async function unmount() {
    if (!root) return
    const currentRoot = root
    root = null
    await act(async () => { currentRoot.unmount() })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.poseCallbacks.length = 0
    mocks.audioInstances.length = 0
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await unmount()
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('waits for Start Turn before mounting the camera and releases it between turns', async () => {
    await render()
    expect(container.textContent).toMatch(/player 1/i)
    expect(camera()).toBeNull()
    expect(mocks.poseMount).not.toHaveBeenCalled()
    expect(beepCount()).toBe(0)

    await click(/start turn/i)
    expect(camera()).not.toBeNull()
    expect(mocks.poseMount).toHaveBeenCalledOnce()
    expect(mocks.audioInstances.some((audio) => audio.unlock.mock.calls.length > 0)).toBe(true)
    expect(reps().textContent).toMatch(/\b0\b/)
    expect(score().textContent).toMatch(/\b0\b/)

    await click(/end turn/i)
    expect(camera()).toBeNull()
    expect(mocks.poseUnmount).toHaveBeenCalledOnce()
    expect(container.textContent).toMatch(/player 2/i)
    button(/start turn/i)
  })

  it('sums completed rep points for each player and reports the winner', async () => {
    await render()
    await click(/start turn/i)
    const playerOne = currentCallback()
    await emit(playerOne, [...rep('X'), ...rep('Perfect'), ...rep('Good')])
    expect(reps().textContent).toMatch(/\b3\b/)
    expect(score().textContent).toMatch(/\b6\b/)
    expect(beepCount()).toBe(3)
    await click(/end turn/i)

    await click(/start turn/i)
    expect(reps().textContent).toMatch(/\b0\b/)
    expect(score().textContent).toMatch(/\b0\b/)
    await emit(currentCallback(), [...rep('Perfect'), ...rep('Okay')])
    expect(reps().textContent).toMatch(/\b2\b/)
    expect(score().textContent).toMatch(/\b5\b/)
    await click(/end turn/i)

    expect(camera()).toBeNull()
    expect(finalScore(1).textContent).toMatch(/\b6\b/)
    expect(finalScore(2).textContent).toMatch(/\b5\b/)
    expect(playerRow(1).querySelectorAll('td')[2].textContent).toBe('Locked')
    expect(playerRow(2).querySelectorAll('td')[2].textContent).toBe('Locked')
    expect(container.textContent).toMatch(/player 1 (wins|won)/i)
    expect(beepCount()).toBe(5)
    button(/play again/i)
  })

  it('reports a tie for two zero-rep turns and resets on Play Again', async () => {
    await render()
    await click(/start turn/i)
    await click(/end turn/i)
    await click(/start turn/i)
    await click(/end turn/i)

    expect(finalScore(1).textContent).toMatch(/\b0\b/)
    expect(finalScore(2).textContent).toMatch(/\b0\b/)
    expect(container.textContent).toMatch(/tie|draw/i)
    expect(beepCount()).toBe(0)

    await click(/play again/i)
    expect(camera()).toBeNull()
    expect(container.textContent).toMatch(/player 1/i)
    await click(/start turn/i)
    expect(reps().textContent).toMatch(/\b0\b/)
    expect(score().textContent).toMatch(/\b0\b/)
    expect(pulse()).toBeNull()
  })

  it('discards an unfinished first turn and can award the win to Player 2', async () => {
    await render()
    await click(/start turn/i)
    await emit(currentCallback(), [pose(90)])
    await click(/end turn/i)
    await click(/start turn/i)
    await emit(currentCallback(), [pose(180)])
    expect(reps().textContent).toBe('0')
    expect(beepCount()).toBe(0)
    await emit(currentCallback(), rep())
    await click(/end turn/i)
    expect(finalScore(1).textContent).toBe('0')
    expect(finalScore(2).textContent).toBe('4')
    expect(container.querySelector('[role="status"]').textContent).toMatch(/Player 2 wins/)
  })

  it('beeps for X reps, but never for intermediate or repeated completion frames', async () => {
    await render()
    await click(/start turn/i)
    const callback = currentCallback()
    await emit(callback, [pose(90, 60), pose(120, 60)])
    expect(beepCount()).toBe(0)
    expect(reps().textContent).toMatch(/\b0\b/)

    await emit(callback, [pose(160, 60)])
    expect(beepCount()).toBe(1)
    expect(reps().textContent).toMatch(/\b1\b/)
    expect(score().textContent).toMatch(/\b0\b/)
    expect(pulse().textContent).toMatch(/\bX\b/)

    await emit(callback, [pose(160, 60), pose(160, 60), pose(180)])
    expect(beepCount()).toBe(1)
    expect(reps().textContent).toMatch(/\b1\b/)
  })

  it('keeps every completion when multiple full reps arrive in one React batch', async () => {
    await render()
    await click(/start turn/i)
    await emit(currentCallback(), [...rep(), ...rep(), ...rep()])
    expect(reps().textContent).toMatch(/\b3\b/)
    expect(score().textContent).toMatch(/\b12\b/)
    expect(beepCount()).toBe(3)
    expect(pulse().textContent).toMatch(/perfect/i)
  })

  it('recreates the tier pulse for each completion but leaves it stable on non-rep frames', async () => {
    await render()
    await click(/start turn/i)
    const callback = currentCallback()
    await emit(callback, rep())
    const firstPulse = pulse()
    expect(firstPulse).not.toBeNull()
    expect(firstPulse.textContent).toMatch(/perfect/i)
    await emit(callback, [pose(180), pose(180)])
    expect(pulse()).toBe(firstPulse)

    await emit(callback, rep())
    const secondPulse = pulse()
    expect(secondPulse).not.toBe(firstPulse)
    expect(secondPulse.textContent).toMatch(/perfect/i)
    await click(/end turn/i)
    await click(/start turn/i)
    await emit(currentCallback(), rep())
    expect(pulse()).not.toBe(secondPulse)
    expect(pulse().textContent).toMatch(/perfect/i)
    expect(beepCount()).toBe(3)
  })

  it('ignores obsolete camera callbacks after End Turn, the next turn, and Play Again', async () => {
    await render()
    await click(/start turn/i)
    const firstSession = currentCallback()
    await emit(firstSession, rep())
    // Frames delivered in the same batch as End Turn must already be ignored.
    await act(async () => {
      button(/end turn/i).click()
      for (const landmarks of rep()) firstSession(landmarks)
    })
    await emit(firstSession, rep())
    expect(camera()).toBeNull()
    expect(finalScore(1).textContent).toMatch(/\b4\b/)
    expect(beepCount()).toBe(1)

    await click(/start turn/i)
    const secondSession = currentCallback()
    await emit(firstSession, rep())
    expect(reps().textContent).toMatch(/\b0\b/)
    expect(score().textContent).toMatch(/\b0\b/)
    expect(beepCount()).toBe(1)
    await emit(secondSession, rep())
    await click(/end turn/i)
    expect(finalScore(1).textContent).toMatch(/\b4\b/)
    expect(finalScore(2).textContent).toMatch(/\b4\b/)
    expect(container.textContent).toMatch(/tie|draw/i)

    await click(/play again/i)
    await click(/start turn/i)
    const thirdSession = currentCallback()
    await emit(firstSession, rep())
    await emit(secondSession, rep())
    expect(reps().textContent).toMatch(/\b0\b/)
    expect(score().textContent).toMatch(/\b0\b/)
    expect(beepCount()).toBe(2)
    await emit(thirdSession, rep('X'))
    expect(reps().textContent).toMatch(/\b1\b/)
    expect(score().textContent).toMatch(/\b0\b/)
    expect(beepCount()).toBe(3)
  })

  it('scores and beeps once in StrictMode, then cleans up camera/audio on unmount', async () => {
    await render({ strict: true })
    expect(mocks.poseMount).not.toHaveBeenCalled()
    await click(/start turn/i)
    const callback = currentCallback()
    await emit(callback, rep())
    expect(reps().textContent).toMatch(/\b1\b/)
    expect(score().textContent).toMatch(/\b4\b/)
    expect(beepCount()).toBe(1)

    await unmount()
    expect(mocks.poseUnmount.mock.calls.length).toBe(mocks.poseMount.mock.calls.length)
    expect(mocks.audioInstances.length).toBeGreaterThan(0)
    for (const audio of mocks.audioInstances) expect(audio.close).toHaveBeenCalled()
    await emit(callback, rep())
    expect(beepCount()).toBe(1)
  })
})
