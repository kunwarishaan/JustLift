// @vitest-environment jsdom
import React, { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LocalGame from './LocalGame.jsx'
import { rep } from './test-utils/poseFixtures.js'

const mocks = vi.hoisted(() => ({ callbacks: [], audioInstances: [] }))

vi.mock('./PoseDetector.jsx', () => ({
  default: function MockPoseDetector({ onPoseUpdate }) {
    React.useEffect(() => { mocks.callbacks.push(onPoseUpdate) }, [onPoseUpdate])
    return <div data-testid="mock-camera">Camera</div>
  },
}))

vi.mock('./repAudio.js', () => ({
  createRepAudio: vi.fn(() => {
    const audio = { unlock: vi.fn(), beep: vi.fn(), close: vi.fn() }
    mocks.audioInstances.push(audio)
    return audio
  }),
}))

const HISTORY_PREFIX = 'just-lift:game:v1:'
const CURRENT_HISTORY_PREFIX = 'just-lift:game:v2:'
const NAMES_KEY = 'just-lift:player-names:v1'
const GOALS_KEY = 'just-lift:player-goals:v1'

function storedGames() {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith(HISTORY_PREFIX) || key.startsWith(CURRENT_HISTORY_PREFIX))
    .map((key) => ({ key, record: JSON.parse(localStorage.getItem(key)) }))
}

describe('LocalGame integration', () => {
  let container
  let root
  const currentCallback = () => mocks.callbacks.at(-1)
  const camera = () => container.querySelector('[data-testid="mock-camera"]')
  const gameElement = () => container.querySelector('[aria-label="Two-player exercise game"]')
  const statsElement = () => container.querySelector('[aria-label="Stats"]')
  const visible = (element) => !element.closest('[hidden], [aria-hidden="true"]')

  function button(name) {
    const found = [...container.querySelectorAll('button')]
      .find((element) => visible(element) && name.test(element.textContent.trim()))
    expect(found, `Expected visible button matching ${name}`).toBeDefined()
    return found
  }

  function nameInput(player) {
    const label = [...container.querySelectorAll('label')]
      .find((element) => element.textContent.includes(`Player ${player} name`))
    expect(label).toBeDefined()
    return label.control ?? label.querySelector('input')
  }

  function gameCells(player) {
    return gameElement().querySelectorAll('tbody tr')[player - 1].querySelectorAll('td')
  }

  async function render({ strict = false, goals = [1, 1] } = {}) {
    await act(async () => {
      root.render(strict ? <StrictMode><LocalGame /></StrictMode> : <LocalGame />)
    })
    // Existing winner cases play one-rep games explicitly now that a goal is
    // required. Tests of saved preferences can leave the restored values alone.
    if (goals) {
      await setGoal(1, goals[0])
      await setGoal(2, goals[1])
    }
  }

  async function click(name) {
    await act(async () => { button(name).click() })
  }

  async function setName(player, value) {
    await act(async () => {
      const input = nameInput(player)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function setGoal(player, value) {
    await act(async () => {
      const input = container.querySelector(`#player-goal-${player - 1}`)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function setWeight(player, amount, unit = 'kg') {
    await act(async () => {
      const input = container.querySelector(`[aria-label="Player ${player} weight"]`)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(amount))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      const select = container.querySelector(`[aria-label="Player ${player} weight unit"]`)
      select.value = unit
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  async function emit(callback, frames = rep('Perfect')) {
    await act(async () => { frames.forEach((landmarks) => callback(landmarks)) })
  }

  async function zeroRepRound() {
    await click(/^Start Turn$/i)
    await click(/^End Turn$/i)
    await click(/^Start Turn$/i)
    await click(/^End Turn$/i)
  }

  async function unmount() {
    if (!root) return
    const currentRoot = root
    root = null
    await act(async () => { currentRoot.unmount() })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.callbacks.length = 0
    mocks.audioInstances.length = 0
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await unmount()
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('makes names optional and does not request a camera until a guest starts a turn', async () => {
    await render()
    expect(nameInput(1).maxLength).toBe(40)
    expect(nameInput(2).maxLength).toBe(40)
    expect(nameInput(1).placeholder).toBe('Player 1')
    expect(nameInput(2).placeholder).toBe('Player 2')
    expect(camera()).toBeNull()
    await click(/^Skip names$/i)
    expect(gameElement().querySelector('h2').textContent).toBe("Player 1's turn")
    expect(camera()).toBeNull()
    expect(localStorage.getItem(NAMES_KEY)).toBeNull()
    expect(storedGames()).toEqual([])
    await click(/^Start Turn$/i)
    expect(camera()).not.toBeNull()
  })

  it('trims submitted names and uses a default for a blank player slot', async () => {
    await render()
    await setName(1, '  Ada  ')
    await setName(2, '   ')
    await click(/^Continue$/i)
    const names = [...gameElement().querySelectorAll('tbody th')].map((element) => element.textContent)
    expect(names).toEqual(['Ada (Player 1)', 'Player 2'])
    expect(JSON.parse(localStorage.getItem(NAMES_KEY))).toEqual(['Ada', ''])
    expect(storedGames()).toEqual([])
  })

  it('saves one complete named game only after both turns finish and shows its winner in Stats', async () => {
    await render()
    await setName(1, '  Ada ')
    await setName(2, ' Bo  ')
    await click(/^Continue$/i)
    await click(/^Start Turn$/i)
    await emit(currentCallback())
    expect(storedGames()).toEqual([])
    await click(/^End Turn$/i)
    expect(storedGames()).toEqual([])
    await click(/^Start Turn$/i)
    await emit(currentCallback(), rep('Good', 'octavio')) // Good = 2 points.
    expect(storedGames()).toEqual([])
    await act(async () => {
      const end = button(/^End Turn$/i)
      end.click()
      end.click()
    })

    const history = storedGames()
    expect(history).toHaveLength(1)
    const { key, record } = history[0]
    expect(record).toEqual({
      version: 2,
      id: expect.any(String),
      date: expect.any(String),
      players: [
        { name: 'Ada', score: 4, repCount: 1, attemptCount: 1, goal: 1, profileId: 'justin' },
        { name: 'Bo', score: 2, repCount: 1, attemptCount: 1, goal: 1, profileId: 'octavio' },
      ],
      winner: 0,
      outcome: 'win',
      workout: { exerciseId: 'push-ups', loads: [{ amount: null, unit: 'kg' }, { amount: null, unit: 'kg' }] },
    })
    expect(record.id).not.toBe('')
    expect(key).toBe(`${CURRENT_HISTORY_PREFIX}${record.id}`)
    expect(new Date(record.date).toISOString()).toBe(record.date)
    expect(gameElement().textContent).toMatch(/Ada \(Player 1\) wins/i)

    const results = gameElement()
    await click(/^Stats$/i)
    expect(gameElement()).toBe(results)
    expect(visible(results)).toBe(false)
    expect(statsElement().textContent).toContain('Ada: 4 points')
    expect(statsElement().textContent).toContain('Bo: 2 points')
    expect(statsElement().textContent).toContain('Ada (Player 1)')
    expect(storedGames()).toHaveLength(1)
    await click(/^Back$/i)
    expect(gameElement()).toBe(results)
    expect(visible(results)).toBe(true)
    expect(results.querySelector('h2').textContent).toBe('Results')
    expect(gameCells(1)[1].textContent).toBe('4')
    expect(gameCells(2)[1].textContent).toBe('2')
    expect(storedGames()).toHaveLength(1)
  })

  it('preserves names and creates one new game record per replay under StrictMode', async () => {
    await render({ strict: true })
    await setName(1, 'Ada')
    await setName(2, 'Bo')
    await click(/^Continue$/i)
    await click(/^Start Turn$/i)
    const oldCallback = currentCallback()
    await emit(oldCallback)
    await click(/^End Turn$/i)
    await click(/^Start Turn$/i)
    await click(/^End Turn$/i)
    expect(storedGames()).toHaveLength(1)
    const firstId = storedGames()[0].record.id

    await click(/^Play Again$/i)
    expect(gameElement().querySelector('h2').textContent).toBe("Ada (Player 1)'s turn")
    expect(camera()).toBeNull()
    expect(gameCells(1)[1].textContent).toBe('0')
    expect(gameCells(2)[1].textContent).toBe('0')
    await click(/^Start Turn$/i)
    await emit(oldCallback)
    expect(gameCells(1)[0].textContent).toBe('0')
    await emit(currentCallback())
    expect(gameCells(1)[0].textContent).toBe('1')
    await click(/^End Turn$/i)
    await click(/^Start Turn$/i)
    await click(/^End Turn$/i)

    const history = storedGames()
    expect(history).toHaveLength(2)
    expect(new Set(history.map(({ record }) => record.id)).size).toBe(2)
    expect(history.some(({ record }) => record.id === firstId)).toBe(true)
    for (const { record } of history) {
      expect(record.players).toEqual([
        { name: 'Ada', score: 4, repCount: 1, attemptCount: 1, goal: 1, profileId: 'justin' },
        { name: 'Bo', score: 0, repCount: 0, attemptCount: 0, goal: 1, profileId: 'octavio' },
      ])
    }
    await click(/^Stats$/i)
    await click(/^Back$/i)
    expect(storedGames()).toHaveLength(2)
  })

  it('restores saved names on a fresh mount, while Skip names uses guests without replacing preferences', async () => {
    await render()
    await setName(1, 'Ada')
    await setName(2, 'Bo')
    await click(/^Continue$/i)
    const preferences = localStorage.getItem(NAMES_KEY)
    await unmount()
    root = createRoot(container)
    await render()
    expect(nameInput(1).value).toBe('Ada')
    expect(nameInput(2).value).toBe('Bo')

    await click(/^Skip names$/i)
    const names = [...gameElement().querySelectorAll('tbody th')].map((element) => element.textContent)
    expect(names).toEqual(['Player 1', 'Player 2'])
    expect(localStorage.getItem(NAMES_KEY)).toBe(preferences)
    await zeroRepRound()
    expect(storedGames()[0].record).toMatchObject({
      players: [{ name: 'Player 1', score: 0 }, { name: 'Player 2', score: 0 }],
      winner: null,
      outcome: 'no-winner',
    })
    await click(/^Stats$/i)
    expect(statsElement().textContent).toMatch(/no winner.*both goals missed/i)
  })

  it('keeps selected goals when names are skipped and restores them on a fresh visit', async () => {
    await render({ goals: [8, 12] })
    await click(/^Skip names$/i)
    expect(JSON.parse(localStorage.getItem(GOALS_KEY))).toEqual([8, 12])
    expect([...gameElement().querySelectorAll('progress')].map((bar) => bar.max)).toEqual([8, 12])
    await unmount()
    root = createRoot(container)
    await render({ goals: null })
    expect(container.querySelector('#player-goal-0').value).toBe('8')
    expect(container.querySelector('#player-goal-1').value).toBe('12')
    expect(container.textContent).toContain('Justin calibration')
    expect(container.textContent).toContain('Octavio calibration')
  })

  it('edits the next game goals without reloading and locks them between player turns', async () => {
    await render({ goals: [2, 3] })
    await setName(1, 'Justin')
    await setName(2, 'Octavio')
    await click(/^Continue$/i)
    await click(/^Change goals$/i)
    expect(nameInput(1).value).toBe('Justin')
    expect(nameInput(2).value).toBe('Octavio')
    expect(container.querySelector('#player-goal-0').value).toBe('2')
    expect(container.querySelector('#player-goal-1').value).toBe('3')
    await setGoal(1, 5)
    await setGoal(2, 8)
    await click(/^Continue$/i)
    expect([...gameElement().querySelectorAll('progress')].map((bar) => bar.max)).toEqual([5, 8])
    await click(/^Start Turn$/i)
    await emit(currentCallback())
    await click(/^End Turn$/i)
    expect([...container.querySelectorAll('button')].some((element) => element.textContent === 'Change goals')).toBe(false)
    await click(/^Start Turn$/i)
    await click(/^End Turn$/i)
    expect(storedGames()).toHaveLength(1)
    await click(/^Change goals$/i)
    expect(nameInput(1).value).toBe('Justin')
    expect(container.querySelector('#player-goal-0').value).toBe('5')
    await setGoal(1, 1)
    await setGoal(2, 1)
    await click(/^Continue$/i)
    expect(gameCells(1)[0].textContent).toBe('0')
    expect([...gameElement().querySelectorAll('progress')].map((bar) => bar.max)).toEqual([1, 1])
    expect(storedGames()).toHaveLength(1)
    expect(storedGames()[0].record.players.map((entry) => entry.goal)).toEqual([5, 8])
  })

  it('allows duplicate player names and keeps the winning player slot unambiguous', async () => {
    await render()
    await setName(1, 'Sam')
    await setName(2, 'Sam')
    await click(/^Continue$/i)
    await click(/^Start Turn$/i)
    await click(/^End Turn$/i)
    await click(/^Start Turn$/i)
    await emit(currentCallback())
    await click(/^End Turn$/i)

    expect(storedGames()[0].record).toMatchObject({
      players: [{ name: 'Sam', score: 0 }, { name: 'Sam', score: 4 }],
      winner: 1,
    })
    await click(/^Stats$/i)
    expect(statsElement().textContent).toContain('Sam (Player 2)')
  })

  it('shows empty history and reads saved games newest-first when Stats opens', async () => {
    await render()
    await click(/^Stats$/i)
    expect(statsElement().textContent).toMatch(/no .*games|no .*history|no .*results/i)
    await click(/^Back$/i)

    const older = {
      version: 1,
      id: '00000000-0000-4000-8000-000000000001',
      date: '2026-01-01T10:00:00.000Z',
      players: [{ name: 'Older A', score: 1 }, { name: 'Older B', score: 4 }],
      winner: 1,
    }
    const newer = {
      version: 1,
      id: '00000000-0000-4000-8000-000000000002',
      date: '2026-09-12T10:00:00.000Z',
      players: [{ name: 'Newer A', score: 3 }, { name: 'Newer B', score: 3 }],
      winner: null,
    }
    localStorage.setItem(`${HISTORY_PREFIX}${older.id}`, JSON.stringify(older))
    localStorage.setItem(`${HISTORY_PREFIX}${newer.id}`, JSON.stringify(newer))
    localStorage.setItem(`${HISTORY_PREFIX}broken`, '{invalid JSON')
    await click(/^Stats$/i)
    const text = statsElement().textContent
    expect(text).toContain('Older A')
    expect(text).toContain('Newer A')
    expect(text.indexOf('Newer A')).toBeLessThan(text.indexOf('Older A'))
    expect(text).toMatch(/Older B.*Player 2/s)
    expect(text).toMatch(/tie/i)
    expect(text).toContain('1 saved game could not be read')
    expect([...container.querySelectorAll('time')].map((element) => element.dateTime)).toEqual([newer.date, older.date])
  })

  it('still completes a game and offers replay when localStorage is blocked', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })
    await render()
    await click(/^Skip names$/i)
    await zeroRepRound()
    expect(gameElement().querySelector('h2').textContent).toBe('Results')
    expect(gameElement().textContent).toMatch(/no winner this round/i)
    button(/^Play Again$/i)
    expect(gameElement().textContent).toMatch(/could not be saved/i)

    await click(/^Stats$/i)
    expect(statsElement().textContent).toMatch(/history is unavailable/i)
    await click(/^Back$/i)
    await click(/^Play Again$/i)
    expect(gameElement().querySelector('h2').textContent).toBe("Player 1's turn")
    await click(/^Start Turn$/i)
    expect(camera()).not.toBeNull()
  })

  it('keeps optional weights with skipped names and restores them on the next visit', async () => {
    await render({ goals: [8, 12] })
    await setWeight(1, 12.5)
    await setWeight(2, 30, 'lb')
    await click(/^Skip names$/i)
    expect([...container.querySelectorAll('.score-player__load')].map((element) => element.textContent)).toEqual(['12.5 kg', '30 lb'])
    await unmount()
    root = createRoot(container)
    await render({ goals: null })
    expect(container.querySelector('[aria-label="Player 1 weight"]').value).toBe('12.5')
    expect(container.querySelector('[aria-label="Player 2 weight"]').value).toBe('30')
    expect(container.querySelector('[aria-label="Player 2 weight unit"]').value).toBe('lb')
    expect(container.querySelector('#player-goal-1').value).toBe('12')
  })

  it('selects a shared exercise, locks it across both turns, and persists the mode with the game', async () => {
    await render()
    await click(/^Continue$/i)
    await click(/^Change exercise/i)
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    const bench = [...dialog.querySelectorAll('button')].find((element) => element.textContent.includes('Bench Press'))
    await act(async () => { bench.click() })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector('.exercise-mode h4').textContent).toBe('Bench Press')
    expect(camera()).toBeNull()
    await click(/^Start Turn$/i)
    expect(container.querySelector('.turn-exercise').textContent).toContain('Bench Press')
    expect([...container.querySelectorAll('button')].some((element) => /Change exercise/.test(element.textContent))).toBe(false)
    await click(/^End Turn$/i)
    expect(container.querySelector('.exercise-mode h4').textContent).toBe('Bench Press')
    expect([...container.querySelectorAll('button')].some((element) => /Change exercise/.test(element.textContent))).toBe(false)
    await click(/^Start Turn$/i)
    await click(/^End Turn$/i)
    expect(storedGames()[0].record.workout.exerciseId).toBe('bench-press')
    await click(/^Stats$/i)
    expect(statsElement().querySelector('.match-history__exercise').textContent).toBe('Bench Press')
    await click(/^Back$/i)
    await click(/^Play Again$/i)
    expect(container.querySelector('.exercise-mode h4').textContent).toBe('Bench Press')
    await click(/^Change exercise/i)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await unmount()
    root = createRoot(container)
    await render()
    await click(/^Continue$/i)
    expect(container.querySelector('.exercise-mode h4').textContent).toBe('Bench Press')
  })

  it('records different weights without changing rep counts, goal credit, or tier points', async () => {
    await render()
    await setWeight(1, 5)
    await setWeight(2, 50, 'lb')
    await click(/^Continue$/i)
    await click(/^Start Turn$/i)
    await emit(currentCallback(), rep('Perfect'))
    await click(/^End Turn$/i)
    await click(/^Start Turn$/i)
    await emit(currentCallback(), rep('Okay', 'octavio'))
    await click(/^End Turn$/i)
    const record = storedGames()[0].record
    expect(record.players.map(({ score, repCount }) => ({ score, repCount }))).toEqual([{ score: 4, repCount: 1 }, { score: 1, repCount: 1 }])
    expect(record.winner).toBe(0)
    expect(record.workout).toEqual({ exerciseId: 'push-ups', loads: [{ amount: 5, unit: 'kg' }, { amount: 50, unit: 'lb' }] })
    await click(/^Stats$/i)
    expect([...statsElement().querySelectorAll('.match-history__load')].map((element) => element.textContent)).toEqual(['5 kg', '50 lb'])
  })
})
