// @vitest-environment jsdom
import React, { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GameScreen from './GameScreen.jsx'
import { pose, rep } from './test-utils/poseFixtures.js'

const mocks = vi.hoisted(() => ({ callbacks: [], audio: [] }))

vi.mock('./PoseDetector.jsx', () => ({
  default: function MockPoseDetector({ onPoseUpdate }) {
    React.useEffect(() => { mocks.callbacks.push(onPoseUpdate) }, [onPoseUpdate])
    return <div data-testid="presentation-camera">Live camera</div>
  },
}))

vi.mock('./repAudio.js', () => ({
  createRepAudio: () => {
    const audio = { unlock: vi.fn(), beep: vi.fn(), close: vi.fn() }
    mocks.audio.push(audio)
    return audio
  },
}))

describe('turn presentation integration', () => {
  let container
  let root
  let clock

  const currentCallback = () => mocks.callbacks.at(-1)
  const laneReps = () => [...container.querySelectorAll('.cadence-list > li')]
  const latestNumbers = () => container.querySelector('.latest-rep__numbers')
  const beepCount = () => mocks.audio.reduce((sum, audio) => sum + audio.beep.mock.calls.length, 0)
  const scoreboardRow = (player) => container.querySelectorAll('.game-screen__scores tbody tr')[player - 1]
  const breakdown = (player) => container.querySelector(`[aria-label="Player ${player} rep breakdown"]`)
  const breakdownReps = (player) => [...breakdown(player).querySelectorAll('.rep-breakdown__list > li')]

  function button(label) {
    const found = [...container.querySelectorAll('button')].find((element) => label.test(element.textContent))
    expect(found, `Expected button matching ${label}`).toBeDefined()
    return found
  }

  async function render({ strict = false, onGameComplete } = {}) {
    await act(async () => {
      const screen = <GameScreen playerGoals={[1, 1]} onGameComplete={onGameComplete} />
      root.render(strict ? <StrictMode>{screen}</StrictMode> : screen)
    })
  }

  async function click(label) {
    await act(async () => { button(label).click() })
  }

  async function emit(callback, frames) {
    await act(async () => {
      for (const landmarks of frames) {
        clock += 120
        callback(landmarks)
      }
    })
  }

  beforeEach(() => {
    mocks.callbacks.length = 0
    mocks.audio.length = 0
    clock = 0
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('retains every batched completion in the live history with numeric scores and one beep per rep', async () => {
    await render()
    await click(/start turn/i)
    const callback = currentCallback()
    await emit(callback, [...rep('Perfect'), ...rep('Good'), ...rep('Good')])

    expect(laneReps()).toHaveLength(3)
    expect(laneReps().map((entry) => entry.getAttribute('aria-label'))).toEqual([
      'Rep 1: Perfect, 100 out of 100, 4 points',
      'Rep 2: Good, 79 out of 100, 2 points',
      'Rep 3: Good, 79 out of 100, 2 points',
    ])
    expect(latestNumbers().textContent).toMatch(/79\s*\/\s*100.*\+2 points.*8 total/)
    expect(scoreboardRow(1).querySelector('.score-player__reps').textContent).toBe('3')
    expect(scoreboardRow(1).querySelector('.score-player__points').textContent).toBe('8')
    expect(beepCount()).toBe(3)

    await emit(callback, [pose(180), pose(180), pose(180)])
    expect(laneReps()).toHaveLength(3)
    expect(beepCount()).toBe(3)
    expect(latestNumbers().textContent).toMatch(/79\s*\/\s*100/)
  })

  it('retains both players full result breakdowns and explains their individual rep scores', async () => {
    const onGameComplete = vi.fn()
    await render({ onGameComplete })
    await click(/start turn/i)
    await emit(currentCallback(), [...rep('Good'), ...rep('Perfect')])
    await click(/end turn/i)
    expect(scoreboardRow(1).querySelector('.score-player__state').textContent).toBe('Locked')

    await click(/start turn/i)
    expect(laneReps()).toHaveLength(0)
    await emit(currentCallback(), [...rep('Good', 'octavio'), ...rep('Good', 'octavio')])
    expect(laneReps()).toHaveLength(2)
    await click(/end turn/i)

    expect(container.querySelector('.game-screen__result').textContent).toMatch(/Player 1 wins/)
    expect(breakdownReps(1)).toHaveLength(2)
    expect(breakdownReps(2)).toHaveLength(2)
    expect(breakdownReps(1).map((entry) => entry.querySelector('strong').textContent)).toEqual(['Good', 'Perfect'])
    expect(breakdownReps(2).map((entry) => entry.querySelector('strong').textContent)).toEqual(['Good', 'Good'])
    const good = breakdownReps(1)[0]
    const goodColumns = [...good.children].map((element) => element.textContent)
    expect(goodColumns.slice(0, 4)).toEqual(['01', 'Good', '79', '+2'])
    expect(good.querySelector('.rep-breakdown__detail').textContent).toMatch(/Travel 63\/100.*Body line 10° off/)
    expect(scoreboardRow(1).querySelector('.score-player__points').textContent).toBe('6')
    expect(scoreboardRow(2).querySelector('.score-player__points').textContent).toBe('4')
    expect(onGameComplete).toHaveBeenCalledTimes(1)
    expect(onGameComplete.mock.calls[0][0].map((player) => player.score)).toEqual([6, 4])
  })

  it('shows both live scoring halves and clears lost tracking immediately without erasing a finished rep', async () => {
    await render()
    await click(/start turn/i)
    const callback = currentCallback()
    const movement = rep('Okay')
    await emit(callback, movement.slice(0, 39))

    const travel = () => container.querySelector('#elbow-travel')
    const body = () => container.querySelector('#body-line')
    expect(Number(travel().getAttribute('value'))).toBe(100)
    expect(Number(body().getAttribute('value'))).toBeGreaterThan(40)
    expect(Number(body().getAttribute('value'))).toBeLessThan(50)
    expect(container.querySelector('.depth-arc').getAttribute('aria-label')).toMatch(/Live elbow angle: 4[5-9] degrees/)
    expect(body().getAttribute('aria-valuetext')).toMatch(/26 degrees off straight, worst this rep 26 degrees/)

    await emit(callback, movement.slice(39))
    expect(laneReps()).toHaveLength(1)
    expect(container.querySelector('.rep-feedback').textContent).toBe('Okay')
    expect(latestNumbers().textContent).toMatch(/65\s*\/\s*100/)

    // No clock advance: loss of tracking must bypass the readout paint throttle.
    await act(async () => { callback([]) })
    expect(travel().getAttribute('aria-valuetext')).toBe('Waiting for tracking')
    expect(body().getAttribute('aria-valuetext')).toBe('Waiting for tracking')
    expect(container.querySelector('.depth-arc').getAttribute('aria-label')).toBe('Live elbow angle: waiting for tracking')
    expect(laneReps()).toHaveLength(1)
    expect(latestNumbers().textContent).toMatch(/65\s*\/\s*100/)
    expect(scoreboardRow(1).querySelector('.score-player__reps').textContent).toBe('1')
  })

  it('ignores stale presentation callbacks after ending turns and clears both histories on replay in StrictMode', async () => {
    await render({ strict: true })
    await click(/start turn/i)
    const firstSession = currentCallback()
    await emit(firstSession, rep('Good'))
    await act(async () => {
      button(/end turn/i).click()
      for (const landmarks of rep('Perfect')) firstSession(landmarks)
    })
    await click(/start turn/i)
    const secondSession = currentCallback()
    await emit(firstSession, rep('Perfect'))
    expect(laneReps()).toHaveLength(0)
    await emit(secondSession, rep('Good', 'octavio'))
    await click(/end turn/i)
    expect(breakdownReps(1)).toHaveLength(1)
    expect(breakdownReps(1)[0].querySelector('strong').textContent).toBe('Good')
    expect(breakdownReps(2)).toHaveLength(1)

    await click(/play again/i)
    await click(/start turn/i)
    const replaySession = currentCallback()
    await emit(firstSession, rep('Perfect'))
    await emit(secondSession, rep('Perfect'))
    expect(laneReps()).toHaveLength(0)
    expect(container.querySelector('.rep-feedback').textContent).toBe('Your first rep')
    await emit(replaySession, rep('Good'))
    expect(laneReps()).toHaveLength(1)
    expect(laneReps()[0].getAttribute('aria-label')).toBe('Rep 1: Good, 79 out of 100, 2 points')
    await click(/end turn/i)
    await click(/start turn/i)
    await click(/end turn/i)
    expect(breakdownReps(1)).toHaveLength(1)
    expect(breakdownReps(2)).toHaveLength(0)
    expect(breakdown(2).textContent).toMatch(/No completed reps this turn/)
    expect(beepCount()).toBe(3)
  })

  it('never presents an incomplete movement or an idle preview as a completed scored rep', async () => {
    await render()
    await click(/start turn/i)
    await emit(currentCallback(), rep('Good').slice(0, 39))
    expect(laneReps()).toHaveLength(0)
    expect(container.querySelector('.rep-feedback').textContent).toBe('Your first rep')
    expect(latestNumbers().textContent).not.toMatch(/\/\s*100/)
    expect(beepCount()).toBe(0)
    await click(/end turn/i)
    await click(/start turn/i)
    await click(/end turn/i)
    expect(breakdownReps(1)).toHaveLength(0)
    expect(breakdownReps(2)).toHaveLength(0)
    expect(container.querySelectorAll('.rep-breakdown__empty')).toHaveLength(2)
  })
})
