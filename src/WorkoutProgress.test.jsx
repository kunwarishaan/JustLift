// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkoutProgress from './WorkoutProgress.jsx'

vi.mock('./ExerciseDiagram.jsx', () => ({ default: ({ exerciseId }) => <span data-testid="exercise-diagram" data-exercise={exerciseId} /> }))
vi.mock('./ExerciseCatalogue.jsx', () => ({ default: ({ selectedExerciseId, onSelect, onClose }) => <div role="dialog" data-selected={selectedExerciseId}><button onClick={() => onSelect('bench-press')}>Bench Press</button><button onClick={onClose}>Close catalogue</button></div> }))

const workout = (id, values = {}) => ({ id, date: '2026-09-01T12:00:00.000Z', exerciseId: 'push-ups', repCount: 10, goal: 10, load: { amount: 20, unit: 'kg' }, score: 20, ...values })

describe('WorkoutProgress', () => {
  let container, root, observers
  const charts = () => [...container.querySelectorAll('.workout-chart')]
  const points = (chart = 0) => [...charts()[chart].querySelectorAll('.workout-chart__point')]
  const coordinates = (point) => point.getAttribute('transform').match(/[-\d.]+/g).map(Number)

  async function render(props = {}) {
    await act(async () => { root.render(<WorkoutProgress {...props} />) })
  }

  async function click(text) {
    const button = [...container.querySelectorAll('button')].find((element) => element.textContent.trim() === text)
    expect(button).toBeDefined()
    await act(async () => { button.click() })
  }

  async function hover(point) {
    await act(async () => { point.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
  }

  async function focus(point) {
    await act(async () => { point.dispatchEvent(new FocusEvent('focusin', { bubbles: true })) })
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    observers = []
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor() { observers.push(this) }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
    vi.unstubAllGlobals()
  })

  it('shows two honest empty states and begins plotting when records arrive', async () => {
    await render({ accountName: 'Justin' })
    expect(container.textContent).toContain('Justin / Workout history')
    expect(container.querySelectorAll('.workout-chart__empty')).toHaveLength(2)
    expect(container.textContent).toContain('No rep history yet.')
    expect(container.textContent).toContain('No weight history yet.')
    expect(points()).toHaveLength(0)
    expect(observers).toHaveLength(0)
    await render({ workouts: [workout('one')] })
    expect(points()).toHaveLength(1)
    expect(points(1)).toHaveLength(1)
    expect(observers).toHaveLength(2)
    expect(observers.every((observer) => observer.observe.mock.calls[0][0] instanceof HTMLElement)).toBe(true)
  })

  it('uses actual date spacing and completed reps rather than target reps', async () => {
    const records = [
      workout('last', { date: '2026-09-11T12:00:00.000Z', repCount: 10, goal: 30 }),
      workout('first', { repCount: 10, goal: 10 }),
      workout('middle', { date: '2026-09-02T12:00:00.000Z', repCount: 8, goal: 10 }),
    ]
    await render({ workouts: records })
    const [first, middle, last] = points().map(coordinates)
    expect((middle[0] - first[0]) / (last[0] - first[0])).toBeCloseTo(0.1, 8)
    expect(first[1]).toBe(last[1])
    expect(middle[1]).toBeGreaterThan(first[1])
    expect(points()[1].getAttribute('aria-label')).toContain('Failure: 8/10 reps')
    expect(records.map((entry) => entry.id)).toEqual(['last', 'first', 'middle'])
  })

  it('shows exact success/failure tooltip text on hover and keyboard focus in both graphs', async () => {
    await render({ workouts: [workout('success'), workout('failure', { date: '2026-09-02T12:00:00.000Z', repCount: 8 })] })
    await hover(points()[0])
    expect(charts()[0].querySelector('[role="tooltip"]').textContent).toContain('Success: 10/10 reps')
    expect(charts()[0].querySelector('[role="tooltip"] time').dateTime).toBe('2026-09-01T12:00:00.000Z')
    await focus(points()[1])
    expect(charts()[0].querySelector('[role="tooltip"]').textContent).toContain('Failure: 8/10 reps')
    await focus(points(1)[1])
    expect(charts()[1].querySelector('[role="tooltip"]').textContent).toContain('Failure: 8/10 reps')
    expect(charts()[1].querySelector('[role="tooltip"]').textContent).toContain('20 kg')
    expect(charts()[0].querySelectorAll('.workout-chart__success')).toHaveLength(1)
    expect(charts()[0].querySelectorAll('.workout-chart__failure')).toHaveLength(1)
    expect(points(1)[1].getAttribute('tabindex')).toBe('0')
    await act(async () => { points(1)[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(charts()[1].querySelector('[role="tooltip"]')).toBeNull()
  })

  it('keeps duplicate timestamps at their true date and exposes every coincident workout', async () => {
    await render({ workouts: [workout('a'), workout('b', { goal: 12 }), workout('c', { repCount: 8 })] })
    expect(points()).toHaveLength(2)
    expect(coordinates(points()[0])[0]).toBe(coordinates(points()[1])[0])
    await hover(points()[0])
    const tooltip = charts()[0].querySelector('[role="tooltip"]')
    expect(tooltip.textContent).toContain('2 workouts at this date and value')
    expect(tooltip.textContent).toContain('Success: 10/10 reps')
    expect(tooltip.textContent).toContain('Failure: 10/12 reps')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3)
    expect(charts()[0].textContent).toContain('Coincident workouts share a marker.')
  })

  it('normalizes mixed units and preserves explicit bodyweight at zero', async () => {
    await render({ workouts: [
      workout('bodyweight', { load: { amount: null, unit: 'kg' } }),
      workout('kg', { date: '2026-09-02T12:00:00.000Z', load: { amount: 1, unit: 'kg' } }),
      workout('lb', { date: '2026-09-03T12:00:00.000Z', load: { amount: 2.2046226218487757, unit: 'lb' } }),
      workout('zero', { date: '2026-09-04T12:00:00.000Z', load: { amount: 0, unit: 'lb' } }),
    ] })
    const locations = points(1).map(coordinates)
    expect(locations[1][1]).toBeCloseTo(locations[2][1], 8)
    expect(locations[0][1]).toBe(locations[3][1])
    expect(locations[0][1]).toBeGreaterThan(locations[1][1])
    await focus(points(1)[2])
    expect(charts()[1].querySelector('[role="tooltip"]').textContent).toContain('1 kg · recorded as 2.2 lb')
    await act(async () => { const select = container.querySelector('select'); select.value = 'lb'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(charts()[1].querySelector('h3').textContent).toBe('Weight (lb)')
    await focus(points(1)[1])
    expect(charts()[1].querySelector('[role="tooltip"]').textContent).toContain('2.2 lb · recorded as 1 kg')
    expect(container.textContent).toContain('bodyweight is plotted at zero')
  })

  it('filters by exercise through the catalogue without inventing history for other exercises', async () => {
    await render({ workouts: [workout('push'), workout('bench', { exerciseId: 'bench-press', repCount: 5, goal: 6 })] })
    expect(points()).toHaveLength(1)
    await click('Change exercise')
    expect(container.querySelector('[role="dialog"]').dataset.selected).toBe('push-ups')
    await click('Bench Press')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector('.workout-progress__exercise h3').textContent).toBe('Bench Press')
    expect(container.querySelector('[data-testid="exercise-diagram"]').dataset.exercise).toBe('bench-press')
    expect(points()).toHaveLength(1)
    expect(points()[0].getAttribute('aria-label')).toContain('Failure: 5/6 reps')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
  })

  it('does not turn missing weight or malformed records into bodyweight data', async () => {
    await render({ workouts: [workout('missing', { load: undefined }), workout('bad-date', { date: 'not a date' }), workout('bad-count', { repCount: -1 })] })
    expect(points()).toHaveLength(1)
    expect(points(1)).toHaveLength(0)
    expect(charts()[1].textContent).toContain('No weight history yet.')
    await focus(points()[0])
    expect(charts()[0].querySelector('[role="tooltip"]').textContent).toContain('Weight not recorded')
  })

  it('respects the initial exercise and delegates Back without writing or altering records', async () => {
    const onBack = vi.fn()
    const record = Object.freeze(workout('bench', { exerciseId: 'bench-press' }))
    await render({ workouts: Object.freeze([record]), initialExerciseId: 'bench-press', onBack })
    expect(container.querySelector('.workout-progress__exercise h3').textContent).toBe('Bench Press')
    expect(points()).toHaveLength(1)
    await click('Back')
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
