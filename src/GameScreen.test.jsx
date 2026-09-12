// @vitest-environment jsdom
import React, { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GameScreen from './GameScreen.jsx'
import { pose, rep } from './test-utils/poseFixtures.js'

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

  async function render({ strict = false, goals = [1, 1] } = {}) {
    await act(async () => {
      root.render(strict ? <StrictMode><GameScreen playerGoals={goals} /></StrictMode> : <GameScreen playerGoals={goals} />)
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
    expect(reps().textContent).toMatch(/\b2\b/)
    expect(score().textContent).toMatch(/\b6\b/)
    expect(beepCount()).toBe(2)
    await click(/end turn/i)

    await click(/start turn/i)
    expect(reps().textContent).toMatch(/\b0\b/)
    expect(score().textContent).toMatch(/\b0\b/)
    await emit(currentCallback(), [...rep('Perfect', 'octavio'), ...rep('Okay', 'octavio')])
    expect(reps().textContent).toMatch(/\b2\b/)
    expect(score().textContent).toMatch(/\b5\b/)
    await click(/end turn/i)

    expect(camera()).toBeNull()
    expect(finalScore(1).textContent).toMatch(/\b6\b/)
    expect(finalScore(2).textContent).toMatch(/\b5\b/)
    expect(playerRow(1).querySelectorAll('td')[2].textContent).toBe('Locked')
    expect(playerRow(2).querySelectorAll('td')[2].textContent).toBe('Locked')
    expect(container.textContent).toMatch(/player 1 (wins|won)/i)
    expect(beepCount()).toBe(4)
    button(/play again/i)
  })

  it('reports no winner when both goals are missed and resets on Play Again', async () => {
    await render()
    await click(/start turn/i)
    await click(/end turn/i)
    await click(/start turn/i)
    await click(/end turn/i)

    expect(finalScore(1).textContent).toMatch(/\b0\b/)
    expect(finalScore(2).textContent).toMatch(/\b0\b/)
    expect(container.textContent).toMatch(/no winner this round/i)
    expect(beepCount()).toBe(0)

    await click(/play again/i)
    expect(camera()).toBeNull()
    expect(container.textContent).toMatch(/player 1/i)
    await click(/start turn/i)
    expect(reps().textContent).toMatch(/\b0\b/)
    expect(score().textContent).toMatch(/\b0\b/)
    expect(pulse()).toBeNull()
  })

  it('fills goals with Okay reps and gives a completed goal priority over more points', async () => {
    await render({ goals: [2, 2] })
    await click(/start turn/i)
    await emit(currentCallback(), [...rep('Okay'), ...rep('Okay')])
    expect(playerRow(1).querySelector('progress').value).toBe(2)
    expect(playerRow(1).querySelector('progress').max).toBe(2)
    expect(score().textContent).toBe('2')
    await click(/end turn/i)
    await click(/start turn/i)
    await emit(currentCallback(), rep('Perfect'))
    expect(playerRow(2).querySelector('progress').value).toBe(1)
    expect(score().textContent).toBe('4')
    await click(/end turn/i)
    expect(container.querySelector('.game-screen__result').textContent).toBe('Player 1 wins!')
    expect(container.querySelector('.result-banner').textContent).toContain('Completing your bar comes first')
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
    await emit(currentCallback(), rep('Perfect'))
    await click(/end turn/i)
    expect(finalScore(1).textContent).toBe('0')
    expect(finalScore(2).textContent).toBe('4')
    expect(container.querySelector('[role="status"]').textContent).toMatch(/Player 2 wins/)
  })

  it('shows X feedback without a counted rep or beep and ignores repeated completion frames', async () => {
    await render()
    await click(/start turn/i)
    const callback = currentCallback()
    await emit(callback, rep('X').slice(0, 25))
    expect(beepCount()).toBe(0)
    expect(reps().textContent).toMatch(/\b0\b/)

    await emit(callback, rep('X').slice(25))
    expect(beepCount()).toBe(0)
    expect(reps().textContent).toMatch(/\b0\b/)
    expect(score().textContent).toMatch(/\b0\b/)
    expect(pulse().textContent).toMatch(/\bX\b/)

    await emit(callback, [pose(160, 60), pose(160, 60), pose(180)])
    expect(beepCount()).toBe(0)
    expect(reps().textContent).toMatch(/\b0\b/)
  })

  it('keeps every completion when multiple full reps arrive in one React batch', async () => {
    await render()
    await click(/start turn/i)
    await emit(currentCallback(), [...rep('Perfect'), ...rep('Perfect'), ...rep('Perfect')])
    expect(reps().textContent).toMatch(/\b3\b/)
    expect(score().textContent).toMatch(/\b12\b/)
    expect(beepCount()).toBe(3)
    expect(pulse().textContent).toMatch(/perfect/i)
  })

  it('recreates the tier pulse for each completion but leaves it stable on non-rep frames', async () => {
    await render()
    await click(/start turn/i)
    const callback = currentCallback()
    await emit(callback, rep('Perfect'))
    const firstPulse = pulse()
    expect(firstPulse).not.toBeNull()
    expect(firstPulse.textContent).toMatch(/perfect/i)
    await emit(callback, [pose(180), pose(180)])
    expect(pulse()).toBe(firstPulse)

    await emit(callback, rep('Perfect'))
    const secondPulse = pulse()
    expect(secondPulse).not.toBe(firstPulse)
    expect(secondPulse.textContent).toMatch(/perfect/i)
    await click(/end turn/i)
    await click(/start turn/i)
    await emit(currentCallback(), rep('Perfect'))
    expect(pulse()).not.toBe(secondPulse)
    expect(pulse().textContent).toMatch(/perfect/i)
    expect(beepCount()).toBe(3)
  })

  it('ignores obsolete camera callbacks after End Turn, the next turn, and Play Again', async () => {
    await render()
    await click(/start turn/i)
    const firstSession = currentCallback()
    await emit(firstSession, rep('Perfect'))
    // Frames delivered in the same batch as End Turn must already be ignored.
    await act(async () => {
      button(/end turn/i).click()
      for (const landmarks of rep('Perfect')) firstSession(landmarks)
    })
    await emit(firstSession, rep('Perfect'))
    expect(camera()).toBeNull()
    expect(finalScore(1).textContent).toMatch(/\b4\b/)
    expect(beepCount()).toBe(1)

    await click(/start turn/i)
    const secondSession = currentCallback()
    await emit(firstSession, rep('Perfect'))
    expect(reps().textContent).toMatch(/\b0\b/)
    expect(score().textContent).toMatch(/\b0\b/)
    expect(beepCount()).toBe(1)
    await emit(secondSession, rep('Perfect'))
    await click(/end turn/i)
    expect(finalScore(1).textContent).toMatch(/\b4\b/)
    expect(finalScore(2).textContent).toMatch(/\b4\b/)
    expect(container.textContent).toMatch(/tie|draw/i)

    await click(/play again/i)
    await click(/start turn/i)
    const thirdSession = currentCallback()
    await emit(firstSession, rep('Perfect'))
    await emit(secondSession, rep('Perfect'))
    expect(reps().textContent).toMatch(/\b0\b/)
    expect(score().textContent).toMatch(/\b0\b/)
    expect(beepCount()).toBe(2)
    await emit(thirdSession, rep('X'))
    expect(reps().textContent).toMatch(/\b0\b/)
    expect(score().textContent).toMatch(/\b0\b/)
    expect(beepCount()).toBe(2)
  })

  it('scores and beeps once in StrictMode, then cleans up camera/audio on unmount', async () => {
    await render({ strict: true })
    expect(mocks.poseMount).not.toHaveBeenCalled()
    await click(/start turn/i)
    const callback = currentCallback()
    await emit(callback, rep('Perfect'))
    expect(reps().textContent).toMatch(/\b1\b/)
    expect(score().textContent).toMatch(/\b4\b/)
    expect(beepCount()).toBe(1)

    await unmount()
    expect(mocks.poseUnmount.mock.calls.length).toBe(mocks.poseMount.mock.calls.length)
    expect(mocks.audioInstances.length).toBeGreaterThan(0)
    for (const audio of mocks.audioInstances) expect(audio.close).toHaveBeenCalled()
    await emit(callback, rep('Perfect'))
    expect(beepCount()).toBe(1)
  })
})
