// @vitest-environment jsdom
import React, { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExerciseCatalogue from './ExerciseCatalogue.jsx'
import { DEFAULT_EXERCISE_ID, EXERCISES, EXERCISE_GROUPS, getExercise } from './exerciseCatalogue.js'

describe('ExerciseCatalogue', () => {
  let container, root, opener
  const dialog = () => document.querySelector('[role="dialog"]')
  const cards = () => [...dialog().querySelectorAll('.exercise-card')]
  const search = () => dialog().querySelector('input[type="search"]')

  async function render(props = {}, strict = false) {
    await act(async () => {
      const content = <ExerciseCatalogue selectedExerciseId={DEFAULT_EXERCISE_ID} onClose={vi.fn()} onSelect={vi.fn()} {...props} />
      root.render(strict ? <StrictMode>{content}</StrictMode> : content)
    })
  }

  async function click(element) {
    await act(async () => { element.click() })
  }

  async function query(value) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search(), value)
      search().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function key(value, options = {}) {
    await act(async () => { document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options })) })
  }

  async function unmount() {
    if (!root) return
    const currentRoot = root
    root = null
    await act(async () => { currentRoot.unmount() })
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    opener = document.createElement('button')
    opener.textContent = 'Change exercise'
    document.body.appendChild(opener)
    opener.focus()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await unmount()
    container.remove()
    opener.remove()
    document.body.style.removeProperty('overflow')
    vi.unstubAllGlobals()
  })

  it('shows all 24 illustrated exercises, six muscle-group filters, and a text-marked selection', async () => {
    await render()
    expect(dialog().getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog().getAttribute('aria-labelledby')).textContent).toBe('Choose your exercise.')
    expect(cards()).toHaveLength(24)
    expect(dialog().querySelectorAll('.exercise-card__diagram [role="img"]')).toHaveLength(24)
    expect(dialog().querySelectorAll('.exercise-catalogue__filters button')).toHaveLength(7)
    const selected = cards().filter((card) => card.getAttribute('aria-pressed') === 'true')
    expect(selected).toHaveLength(1)
    expect(selected[0].getAttribute('aria-label')).toBe(`${getExercise(DEFAULT_EXERCISE_ID).name}, selected`)
    expect(selected[0].querySelector('.exercise-card__selection').textContent).toBe('Selected')
    expect(document.activeElement).toBe(search())
  })

  it('filters by muscle group and restores the full list', async () => {
    await render()
    for (const group of EXERCISE_GROUPS) {
      const filter = [...dialog().querySelectorAll('.exercise-catalogue__filters button')].find((button) => button.textContent.startsWith(`${group.name} `))
      await click(filter)
      expect(filter.getAttribute('aria-pressed')).toBe('true')
      expect(cards()).toHaveLength(group.exercises.length)
      expect(cards().map((card) => card.querySelector('.exercise-card__name').textContent)).toEqual(group.exercises.map((exercise) => exercise.name))
    }
    await click(dialog().querySelector('.exercise-catalogue__filters button'))
    expect(cards()).toHaveLength(24)
  })

  it('combines case-insensitive search with the selected group and recovers from no matches', async () => {
    await render()
    const group = EXERCISE_GROUPS[0]
    await click([...dialog().querySelectorAll('.exercise-catalogue__filters button')][1])
    await query(`  ${group.exercises[0].name.toUpperCase()}  `)
    expect(cards().length).toBeGreaterThan(0)
    expect(cards().every((card) => card.querySelector('.exercise-card__name').textContent.toLocaleLowerCase().includes(group.exercises[0].name.toLocaleLowerCase()))).toBe(true)
    await query('no matching exercise 12345')
    expect(cards()).toHaveLength(0)
    expect(dialog().textContent).toContain('No exercises found.')
    await click(dialog().querySelector('.exercise-catalogue__empty button'))
    expect(search().value).toBe('')
    expect(cards()).toHaveLength(24)
    expect(document.activeElement).toBe(search())
  })

  it('selects the exercise ID once without also closing through a second callback', async () => {
    const onSelect = vi.fn(), onClose = vi.fn()
    const exercise = EXERCISES.find((entry) => entry.id !== DEFAULT_EXERCISE_ID)
    await render({ onSelect, onClose })
    await click(cards().find((card) => card.getAttribute('aria-label') === exercise.name))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(exercise.id)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('dismisses with Escape, the close button, or the backdrop, without dismissing clicks inside', async () => {
    const onClose = vi.fn()
    await render({ onClose })
    await click(dialog().querySelector('h2'))
    expect(onClose).not.toHaveBeenCalled()
    await key('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
    await click(dialog().querySelector('.exercise-catalogue__close'))
    expect(onClose).toHaveBeenCalledTimes(2)
    await click(document.querySelector('.exercise-catalogue-overlay'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('traps keyboard focus, makes the background inert, and restores focus and scroll on unmount', async () => {
    document.body.style.setProperty('overflow', 'scroll', 'important')
    await render()
    expect(document.body.style.overflow).toBe('hidden')
    expect(container.hasAttribute('inert')).toBe(true)
    const first = dialog().querySelector('.exercise-catalogue__close'), last = dialog().querySelector('.exercise-catalogue__credit')
    last.focus()
    await key('Tab')
    expect(document.activeElement).toBe(first)
    await key('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(last)
    opener.focus()
    expect(dialog().contains(document.activeElement)).toBe(true)
    await unmount()
    expect(document.activeElement).toBe(opener)
    expect(container.hasAttribute('inert')).toBe(false)
    expect(document.body.style.overflow).toBe('scroll')
    expect(document.body.style.getPropertyPriority('overflow')).toBe('important')
  })

  it('preserves previously inert content and cleans up StrictMode sessions', async () => {
    container.setAttribute('inert', 'already-inert')
    const onClose = vi.fn()
    await render({ onClose }, true)
    expect(document.activeElement).toBe(search())
    await key('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
    await unmount()
    expect(container.getAttribute('inert')).toBe('already-inert')
    expect(document.body.style.overflow).toBe('')
    expect(document.activeElement).toBe(opener)
  })
})
