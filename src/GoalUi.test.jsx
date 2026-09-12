// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GameScreen from './GameScreen.jsx'
import PlayerSetup from './PlayerSetup.jsx'
import StatsView from './StatsView.jsx'

const mocks = vi.hoisted(() => ({ game: null, useGame: vi.fn(), histories: [[], []], games: [] }))

vi.mock('./useGame.js', () => ({ default: (options) => { mocks.useGame(options); return mocks.game } }))
vi.mock('./useTurnPresentation.js', () => ({
  default: () => ({ live: null, histories: mocks.histories, onPoseUpdate: vi.fn(), startTurn: vi.fn(), endTurn: vi.fn(), playAgain: vi.fn() }),
}))
vi.mock('./PoseDetector.jsx', () => ({ default: () => <div>Camera</div> }))
vi.mock('./gameStorage.js', () => ({ loadGames: () => ({ games: mocks.games, error: '' }) }))

function player(index, values = {}) {
  return { name: `Player ${index + 1}`, goal: 10, repCount: 0, attemptCount: 0, score: 0, lastTier: null, finished: false, ...values }
}

describe('personal goal presentation', () => {
  let container
  let root

  async function render(component) {
    await act(async () => { root.render(component) })
  }

  async function input(selector, value) {
    await act(async () => {
      const element = container.querySelector(selector)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function click(text) {
    const button = [...container.querySelectorAll('button')].find((element) => element.textContent === text)
    await act(async () => { button.click() })
  }

  beforeEach(() => {
    mocks.useGame.mockClear()
    mocks.game = { phase: 'active', currentPlayer: 0, sessionId: 1, players: [player(0), player(1)], winner: null, outcome: { kind: 'no-winner', winner: null }, calibration: { label: 'Justin' } }
    mocks.histories = [[], []]
    mocks.games = []
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
    vi.unstubAllGlobals()
  })

  it('submits separate goals alongside optional names and identifies the fixed calibration slots', async () => {
    const onContinue = vi.fn()
    await render(<PlayerSetup onContinue={onContinue} onSkip={vi.fn()} />)
    expect(container.textContent).toContain('Justin calibration')
    expect(container.textContent).toContain('Octavio calibration')
    await input('#player-name-0', 'Justin')
    await input('#player-goal-0', '8')
    await input('#player-goal-1', '12')
    await click('Continue')
    expect(onContinue).toHaveBeenCalledWith(['Justin', ''], [8, 12], [{ amount: null, unit: 'kg' }, { amount: null, unit: 'kg' }])
  })

  it('keeps selected rep goals when players skip names', async () => {
    const onSkip = vi.fn(), onContinue = vi.fn()
    await render(<PlayerSetup initialGoals={[4, 6]} onContinue={onContinue} onSkip={onSkip} />)
    await input('#player-goal-1', '9')
    await click('Skip names')
    expect(onSkip).toHaveBeenCalledWith([4, 9], [{ amount: null, unit: 'kg' }, { amount: null, unit: 'kg' }])
    expect(onContinue).not.toHaveBeenCalled()
  })

  it('requires a positive whole-number goal for either way of starting', async () => {
    const onSkip = vi.fn(), onContinue = vi.fn()
    await render(<PlayerSetup onContinue={onContinue} onSkip={onSkip} />)
    for (const invalid of ['', '0', '-1', '1.5', '1000']) {
      await input('#player-goal-0', invalid)
      expect(container.querySelector('#player-goal-0').checkValidity()).toBe(false)
      await click('Continue')
      await click('Skip names')
    }
    expect(onContinue).not.toHaveBeenCalled()
    expect(onSkip).not.toHaveBeenCalled()
  })

  it('accepts a blank or decimal weight and rejects negative or excessive loads', async () => {
    const onContinue = vi.fn(), onSkip = vi.fn()
    await render(<PlayerSetup onContinue={onContinue} onSkip={onSkip} />)
    for (const invalid of ['-1', '2001']) {
      await input('#player-weight-0', invalid)
      expect(container.querySelector('#player-weight-0').checkValidity()).toBe(false)
      await click('Continue')
      await click('Skip names')
    }
    expect(onContinue).not.toHaveBeenCalled()
    expect(onSkip).not.toHaveBeenCalled()
    await input('#player-weight-0', '12.75')
    await click('Continue')
    expect(onContinue).toHaveBeenCalledWith(['', ''], [10, 10], [{ amount: 12.75, unit: 'kg' }, { amount: null, unit: 'kg' }])
    await input('#player-weight-0', '')
    await click('Skip names')
    expect(onSkip).toHaveBeenCalledWith([10, 10], [{ amount: null, unit: 'kg' }, { amount: null, unit: 'kg' }])
  })

  it('passes both goals to game logic and shows progress independently from points', async () => {
    mocks.game.players = [player(0, { goal: 3, repCount: 2, score: 8 }), player(1, { goal: 5, repCount: 1, score: 1 })]
    await render(<GameScreen playerNames={['Justin', 'Octavio']} playerGoals={[3, 5]} />)
    expect(mocks.useGame).toHaveBeenLastCalledWith(expect.objectContaining({ playerGoals: [3, 5] }))
    const bars = [...container.querySelectorAll('.goal-progress progress')]
    expect(bars.map((bar) => [bar.value, bar.max])).toEqual([[2, 3], [1, 5]])
    expect(bars[0].getAttribute('aria-valuetext')).toContain('1 to go')
  })

  it('lists only the four recorded categories and their point values', async () => {
    mocks.game.phase = 'ready'
    await render(<GameScreen />)
    const rows = [...container.querySelectorAll('.tier-legend li')]
    expect(rows.map((row) => row.querySelector('strong').textContent)).toEqual(['X', 'Okay', 'Good', 'Perfect'])
    expect(rows.map((row) => row.children[2].textContent)).toEqual(['0 pts', '1 pt', '2 pts', '4 pts'])
  })

  it('shows a fresh X cue for each rejected attempt while the rep count and bar stay unchanged', async () => {
    mocks.game.players[0] = player(0, { lastTier: 'X', attemptCount: 1 })
    const screen = () => <GameScreen />
    await render(screen())
    const firstPulse = container.querySelector('.rep-feedback')
    expect(firstPulse.textContent).toBe('X')
    expect(container.querySelector('.latest-rep__rejected').textContent).toContain('Not counted')
    expect(container.querySelector('.score-player__reps').textContent).toBe('0')
    expect(container.querySelector('progress').value).toBe(0)
    await render(screen())
    expect(container.querySelector('.rep-feedback')).toBe(firstPulse)
    mocks.game.players[0] = { ...mocks.game.players[0], attemptCount: 2 }
    await render(screen())
    expect(container.querySelector('.rep-feedback')).not.toBe(firstPulse)
    expect(container.querySelector('progress').value).toBe(0)
  })

  it('caps a full bar while retaining extra counted reps and their score', async () => {
    mocks.game.players[0] = player(0, { goal: 2, repCount: 3, score: 10 })
    await render(<GameScreen />)
    expect(container.querySelector('progress').value).toBe(2)
    expect(container.querySelector('progress').max).toBe(2)
    expect(container.querySelector('.goal-progress__heading').textContent).toBe('Goal met3 / 2')
    expect(container.querySelector('.score-player__points').textContent).toBe('10')
  })

  it('distinguishes two missed goals from a qualified tie in results', async () => {
    mocks.game.phase = 'results'
    mocks.game.players = [player(0, { finished: true }), player(1, { finished: true })]
    await render(<GameScreen />)
    expect(container.querySelector('.game-screen__result').textContent).toBe('No winner this round.')
    expect(container.querySelector('.result-banner').textContent).toContain('Both players missed their rep goal')
    expect([...container.querySelectorAll('.goal-progress__heading > span')].map((element) => element.textContent)).toEqual(['Goal missed', 'Goal missed'])
    mocks.game.outcome = { kind: 'tie', winner: null }
    mocks.game.players = [player(0, { goal: 1, repCount: 1, finished: true }), player(1, { goal: 1, repCount: 1, finished: true })]
    await render(<GameScreen />)
    expect(container.querySelector('.game-screen__result').textContent).toBe("It's a tie!")
    expect(container.querySelector('.result-banner').textContent).toContain('Both goals met')
  })

  it('shows a qualifying win even if the other player has more points', async () => {
    mocks.game.phase = 'results'
    mocks.game.winner = 0
    mocks.game.outcome = { kind: 'win', winner: 0 }
    mocks.game.players = [player(0, { goal: 1, repCount: 1, score: 1, finished: true }), player(1, { goal: 10, repCount: 9, score: 36, finished: true })]
    await render(<GameScreen />)
    expect(container.querySelector('.game-screen__result').textContent).toBe('Player 1 wins!')
    expect(container.querySelector('.result-banner').textContent).toContain('Completing your bar comes first')
  })

  it('offers goal changes while ready and after results, but not during a live turn', async () => {
    const onEditPlayers = vi.fn()
    mocks.game.phase = 'ready'
    await render(<GameScreen onEditPlayers={onEditPlayers} />)
    await click('Change goals')
    expect(onEditPlayers).toHaveBeenCalledTimes(1)
    mocks.game.phase = 'active'
    await render(<GameScreen onEditPlayers={onEditPlayers} />)
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Change goals')).toBe(false)
    mocks.game.phase = 'results'
    await render(<GameScreen onEditPlayers={onEditPlayers} />)
    await click('Change goals')
    expect(onEditPlayers).toHaveBeenCalledTimes(2)
  })

  it('displays saved goal outcomes while preserving legacy point-only history', async () => {
    mocks.games = [
      { id: 'new', date: '2026-09-12T12:00:00.000Z', outcome: 'no-winner', winner: null, players: [player(0, { goal: 5, repCount: 2, score: 8 }), player(1, { goal: 6, repCount: 4, score: 4 })] },
      { id: 'old', date: '2026-09-11T12:00:00.000Z', winner: null, players: [{ name: 'Legacy A', score: 4 }, { name: 'Legacy B', score: 4 }] },
    ]
    await render(<StatsView />)
    const rows = [...container.querySelectorAll('tbody tr')]
    expect(rows[0].textContent).toContain('No winner · both goals missed')
    expect(rows[0].textContent).toContain('2 / 5 reps · Goal missed')
    expect(rows[1].textContent).toContain('Tie')
    expect(rows[1].querySelector('.match-history__goal')).toBeNull()
  })
})
