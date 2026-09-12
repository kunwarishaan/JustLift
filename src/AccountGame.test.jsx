// @vitest-environment jsdom
import React, { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountGame from './AccountGame.jsx'
import { rep } from './test-utils/poseFixtures.js'

const camera = vi.hoisted(() => ({ callback: null }))
vi.mock('./PoseDetector.jsx', () => ({ default: function MockCamera({ onPoseUpdate }) {
  camera.callback = onPoseUpdate
  return <div data-camera="active" />
} }))
vi.mock('./repAudio.js', () => ({ createRepAudio: () => ({ unlock() {}, beep() {}, close() {} }) }))
vi.mock('./ExerciseDiagram.jsx', () => ({ default: ({ exerciseId }) => <span role="img" aria-label={exerciseId} /> }))

const people = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Ada', email: 'ada@example.test' },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Bo', email: 'bo@example.test' },
]
function workout({ id = '00000000-0000-4000-9000-000000000001', exerciseId = 'push-ups', date = '2026-09-10T10:00:00Z', repCount = 8, goal = 10, amount = null, unit = 'kg' } = {}) {
  return { id, exerciseId, date, repCount, goal, load: { amount, unit }, score: repCount * 2 }
}
function mockService({ history = [[], []], signedIn = false } = {}) {
  const accounts = signedIn ? [...people] : [null, null]
  const subscribers = [new Set(), new Set()]
  function emit(slot, account) { accounts[slot] = account; subscribers[slot].forEach(callback => callback(account)) }
  return {
    configured: true,
    getAccount: slot => accounts[slot],
    subscribe(slot, callback) { subscribers[slot].add(callback); callback(accounts[slot]); return () => subscribers[slot].delete(callback) },
    signIn: vi.fn(async slot => { emit(slot, people[slot]); return { account: people[slot], error: '' } }),
    signUp: vi.fn(async () => ({ account: null, needsConfirmation: true, error: '' })),
    signOut: vi.fn(async slot => { emit(slot, null); return { ok: true, error: '' } }),
    listWorkouts: vi.fn(async slot => ({ workouts: history[slot], error: '' })),
    saveWorkout: vi.fn(async () => ({ ok: true, error: '' })),
  }
}

describe('account workout flow', () => {
  let root, container
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  async function render(service, strict = false) {
    await act(async () => root.render(strict ? <StrictMode><AccountGame service={service} /></StrictMode> : <AccountGame service={service} />))
  }
  function buttons() { return [...document.querySelectorAll('button')].filter(button => !button.closest('[hidden]')) }
  async function click(text) {
    const button = buttons().find(button => (button.getAttribute('aria-label') || button.textContent).trim() === text)
    expect(button, text).toBeTruthy()
    await act(async () => button.click())
  }
  async function input(selector, value) {
    await act(async () => {
      const element = container.querySelector(selector)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  async function signIn() {
    await input('[name=email]', 'person@example.test')
    await input('[name=password]', 'test-password')
    await click('Sign in')
  }
  const goal = slot => container.querySelector(`[aria-label="Player ${slot} rep goal"]`)
  const weight = slot => container.querySelector(`[aria-label="Player ${slot} weight"]`)
  async function goals() { await input('[aria-label="Player 1 rep goal"]', '2'); await input('[aria-label="Player 2 rep goal"]', '3') }

  it('opens at sign-in, supports confirmation-required signup, and requires two accounts without opening the camera', async () => {
    const service = mockService()
    await render(service)
    expect(container.querySelector('[aria-label="Player 1 account"]')).toBeTruthy()
    await click('Create account')
    await input('[name=name]', 'Ada')
    await input('[name=email]', 'ada@example.test')
    await input('[name=password]', 'test-password')
    await click('Create account')
    expect(service.signUp).toHaveBeenCalledWith(0, { name: 'Ada', email: 'ada@example.test', password: 'test-password' })
    expect(container.textContent).toContain('Check your email')
    expect(container.querySelector('[name=password]').value).toBe('')
    await signIn()
    expect(container.querySelector('[aria-label="Player 2 account"]')).toBeTruthy()
    await signIn()
    expect(goal(1).value).toBe('')
    expect(goal(2).value).toBe('')
    expect(weight(1).value).toBe('')
    expect(container.querySelector('[data-camera]')).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  it('prefills actual reps and weight from only that account’s latest selected exercise, and leaves unseen exercises blank', async () => {
    const service = mockService({ signedIn: true, history: [[
      workout({ date: '2026-09-01T10:00:00Z', repCount: 12, amount: 20 }),
      workout({ id: '00000000-0000-4000-9000-000000000002', repCount: 8, goal: 10, amount: 30, unit: 'lb' }),
      workout({ id: '00000000-0000-4000-9000-000000000003', exerciseId: 'bench-press', repCount: 6, amount: 45 }),
    ], [workout({ repCount: 4 })]] })
    await render(service, true)
    expect(goal(1).value).toBe('8')
    expect(weight(1).value).toBe('30')
    expect(container.querySelector('[aria-label="Player 1 weight unit"]').value).toBe('lb')
    expect(goal(2).value).toBe('4')
    expect(weight(2).value).toBe('')
    await click('Change exercise ↗')
    await click('Bench Press')
    expect(goal(1).value).toBe('6')
    expect(weight(1).value).toBe('45')
    expect(goal(2).value).toBe('')
    expect(weight(2).value).toBe('')
    await click('Change exercise ↗')
    await click('Squats')
    expect(goal(1).value).toBe('')
    expect(weight(1).value).toBe('')
  })

  it('saves each ended turn with its own actual result, goal, exercise and load, without waiting for the other player', async () => {
    const service = mockService({ signedIn: true })
    await render(service)
    await goals()
    await input('[aria-label="Player 2 weight"]', '25')
    await click('Continue')
    await click('Start Turn')
    expect(buttons().find(button => button.textContent === 'Progress').disabled).toBe(true)
    await act(async () => { [...rep('X'), ...rep('Perfect')].forEach(frame => camera.callback(frame)) })
    await click('End Turn')
    expect(service.saveWorkout).toHaveBeenCalledTimes(1)
    expect(service.saveWorkout.mock.calls[0]).toEqual([0, expect.objectContaining({ exerciseId: 'push-ups', repCount: 1, goal: 2, score: 4, load: { amount: null, unit: 'kg' } })])
    await click('Start Turn')
    await click('End Turn')
    expect(service.saveWorkout).toHaveBeenCalledTimes(2)
    expect(service.saveWorkout.mock.calls[1]).toEqual([1, expect.objectContaining({ repCount: 0, goal: 3, load: { amount: 25, unit: 'kg' } })])
    await click('Play Again')
    expect(goal(1).value).toBe('1')
    expect(goal(2).value).toBe('0')
    expect(goal(2).checkValidity()).toBe(false)
    expect(weight(2).value).toBe('25')
  })

  it('retries the exact workout after a network failure and keeps it out of saved history until confirmed', async () => {
    const service = mockService({ signedIn: true })
    service.saveWorkout.mockResolvedValueOnce({ ok: false, error: 'Network unavailable.' })
    await render(service)
    await goals(); await click('Continue'); await click('Start Turn'); await click('End Turn')
    expect(container.textContent).toContain('Network unavailable.')
    expect(container.textContent).not.toContain('saved to your account.')
    const first = service.saveWorkout.mock.calls[0]
    await click('Retry save')
    expect(service.saveWorkout.mock.calls[1]).toEqual(first)
    expect(container.textContent).toContain('Push-ups saved to your account.')
  })

  it('waits for pending saves before autofilling the next round from completed results', async () => {
    const service = mockService({ signedIn: true })
    let finishSave
    service.saveWorkout.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve }))
    await render(service)
    await goals(); await click('Continue'); await click('Start Turn')
    await act(async () => rep('Good').forEach(frame => camera.callback(frame)))
    await click('End Turn'); await click('Start Turn'); await click('End Turn'); await click('Play Again')
    expect(goal(1)).toBeNull()
    expect(container.textContent).toContain('Saving your last workout before filling your next goals')
    await act(async () => finishSave({ ok: true, error: '' }))
    expect(goal(1).value).toBe('1')
    expect(goal(2).value).toBe('0')
  })

  it('keeps progress histories separate and clears private data after sign-out', async () => {
    const service = mockService({ signedIn: true, history: [[workout({ repCount: 8 })], [workout({ repCount: 12 })]] })
    await render(service)
    await click('Progress')
    expect(container.querySelector('.workout-progress').textContent).toContain('Ada')
    await act(async () => {
      const select = container.querySelector('[aria-label="Progress account"]')
      select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.querySelector('.workout-progress').textContent).toContain('Bo')
    await click('Sign out Player 2')
    expect(container.querySelector('[aria-label="Player 2 account"]')).toBeTruthy()
    expect(container.querySelector('.workout-progress')).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  it('shows an honest disconnected sign-in instead of creating local fake accounts', async () => {
    const service = mockService(); service.configured = false
    await render(service)
    expect(container.textContent).toContain('Account service is not connected yet.')
    expect(container.querySelector('fieldset').disabled).toBe(true)
    expect(service.signIn).not.toHaveBeenCalled()
  })
})
