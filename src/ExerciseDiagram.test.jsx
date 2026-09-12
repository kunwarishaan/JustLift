// @vitest-environment jsdom
import React, { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExerciseDiagram from './ExerciseDiagram.jsx'
import { getExerciseIllustration } from './exerciseIllustrations.js'

describe('static exercise anatomy illustrations', () => {
  let root, container, images, context, getContext

  async function render(exerciseId = 'push-ups', strict = false) {
    await act(async () => {
      const illustration = <ExerciseDiagram exerciseId={exerciseId} className="test-preview" />
      root.render(strict ? <StrictMode>{illustration}</StrictMode> : illustration)
    })
  }

  async function dispatch(callback) {
    await act(async () => { callback?.() })
  }

  async function unmount() {
    if (!root) return
    const currentRoot = root
    root = null
    await act(async () => { currentRoot.unmount() })
  }

  const wrapper = () => container.querySelector('.exercise-illustration')
  const canvas = () => container.querySelector('canvas')

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    images = []
    vi.stubGlobal('Image', class {
      naturalWidth = 480
      naturalHeight = 360
      onload = null
      onerror = null
      constructor() { images.push(this) }
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    context = { drawImage: vi.fn() }
    getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
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

  it('loads an ordinary remote image and draws the entire image once at its intrinsic dimensions', async () => {
    await render()
    const reference = getExerciseIllustration('push-ups')
    expect(images).toHaveLength(1)
    expect(images[0].src).toBe(reference.src)
    expect(images[0].crossOrigin).toBeUndefined()
    expect(wrapper().getAttribute('aria-label')).toBe(reference.alt)
    expect(wrapper().classList.contains('test-preview')).toBe(true)
    expect(wrapper().textContent).toBe('Loading illustration…')
    expect(canvas().hidden).toBe(true)
    await dispatch(images[0].onload)
    expect(getContext).toHaveBeenCalledWith('2d')
    expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(images[0], 0, 0)
    expect([canvas().width, canvas().height]).toEqual([480, 360])
    expect(canvas().getAttribute('aria-hidden')).toBe('true')
    expect(canvas().hidden).toBe(false)
    expect(wrapper().getAttribute('data-illustration-state')).toBe('ready')
    expect(wrapper().getAttribute('aria-busy')).toBe('false')
    expect(container.querySelector('img')).toBeNull()
    await dispatch(images[0].onload)
    expect(context.drawImage).toHaveBeenCalledTimes(1)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('shows a visible and accessible unavailable state when the remote image fails', async () => {
    await render()
    await dispatch(images[0].onerror)
    expect(wrapper().textContent).toBe('Illustration unavailable')
    expect(wrapper().getAttribute('aria-label')).toContain('Illustration unavailable')
    expect(wrapper().getAttribute('data-illustration-state')).toBe('error')
    expect(canvas().hidden).toBe(true)
    expect(context.drawImage).not.toHaveBeenCalled()
    expect(container.querySelector('svg')).toBeNull()
  })

  it.each(['empty image', 'no canvas context', 'draw failure'])('handles %s without an unhandled exception', async (failure) => {
    await render()
    if (failure === 'empty image') images[0].naturalWidth = 0
    if (failure === 'no canvas context') getContext.mockReturnValueOnce(null)
    if (failure === 'draw failure') context.drawImage.mockImplementationOnce(() => { throw new Error('Drawing unavailable') })
    await dispatch(images[0].onload)
    expect(wrapper().getAttribute('data-illustration-state')).toBe('error')
    expect(wrapper().textContent).toBe('Illustration unavailable')
    expect(canvas().hidden).toBe(true)
  })

  it('ignores a late previous request when the chosen exercise changes', async () => {
    await render('push-ups')
    const obsoleteLoad = images[0].onload
    const obsoleteError = images[0].onerror
    await render('bench-press')
    expect(images).toHaveLength(2)
    expect(images[0].onload).toBeNull()
    expect(images[0].onerror).toBeNull()
    await dispatch(obsoleteLoad)
    await dispatch(obsoleteError)
    expect(context.drawImage).not.toHaveBeenCalled()
    expect(wrapper().getAttribute('data-illustration-state')).toBe('loading')
    await dispatch(images[1].onload)
    expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(images[1], 0, 0)
    expect(wrapper().getAttribute('aria-label')).toBe(getExerciseIllustration('bench-press').alt)
  })

  it('hides a finished image while loading the next selection and can recover from an error', async () => {
    await render('push-ups')
    await dispatch(images[0].onload)
    await render('bench-press')
    expect(canvas().hidden).toBe(true)
    expect(wrapper().getAttribute('data-illustration-state')).toBe('loading')
    await dispatch(images[1].onerror)
    await render('push-ups')
    expect(wrapper().getAttribute('data-illustration-state')).toBe('loading')
    await dispatch(images[2].onload)
    expect(canvas().hidden).toBe(false)
    expect(context.drawImage).toHaveBeenCalledTimes(2)
  })

  it('ignores pending image callbacks after unmount', async () => {
    await render()
    const pendingLoad = images[0].onload
    const pendingError = images[0].onerror
    await unmount()
    expect(images[0].onload).toBeNull()
    expect(images[0].onerror).toBeNull()
    await dispatch(pendingLoad)
    await dispatch(pendingError)
    expect(context.drawImage).not.toHaveBeenCalled()
  })

  it('releases the obsolete StrictMode request and paints only the active session', async () => {
    await render('push-ups', true)
    expect(images).toHaveLength(2)
    expect(images[0].onload).toBeNull()
    expect(images[0].onerror).toBeNull()
    await dispatch(images[1].onload)
    expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(images[1], 0, 0)
    await unmount()
    expect(images[1].onload).toBeNull()
    expect(images[1].onerror).toBeNull()
  })
})
