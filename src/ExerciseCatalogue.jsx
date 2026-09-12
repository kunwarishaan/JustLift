import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EXERCISE_GROUPS, EXERCISES, getExercise } from './exerciseCatalogue.js'
import ExerciseDiagram from './ExerciseDiagram.jsx'
import './ExerciseCatalogue.css'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function ExerciseCatalogue({ selectedExerciseId, onSelect, onClose }) {
  const [groupId, setGroupId] = useState('all')
  const [query, setQuery] = useState('')
  const overlay = useRef(null)
  const dialog = useRef(null)
  const search = useRef(null)
  const closeRef = useRef(onClose)
  const titleId = useId()
  const descriptionId = useId()
  const selected = getExercise(selectedExerciseId)
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return EXERCISES.filter((exercise) => (
      (groupId === 'all' || exercise.groupId === groupId)
      && `${exercise.name} ${exercise.groupName}`.toLocaleLowerCase().includes(term)
    ))
  }, [groupId, query])

  useEffect(() => { closeRef.current = onClose }, [onClose])

  useLayoutEffect(() => {
    const previousFocus = document.activeElement
    const bodyStyle = document.body.style
    const previousOverflow = bodyStyle.getPropertyValue('overflow')
    const previousOverflowPriority = bodyStyle.getPropertyPriority('overflow')
    // The portal stays interactive while the rest of the page is unavailable
    // to pointer, keyboard, and assistive-technology navigation.
    const background = [...document.body.children]
      .filter((element) => element !== overlay.current)
      .map((element) => ({ element, inert: element.getAttribute('inert') }))
    background.forEach(({ element }) => element.setAttribute('inert', ''))
    bodyStyle.setProperty('overflow', 'hidden')

    const focusable = () => [...dialog.current.querySelectorAll(FOCUSABLE)]
      .filter((element) => element.tabIndex >= 0 && !element.closest('[hidden], [inert]'))
    const focusStart = () => (search.current ?? dialog.current)?.focus({ preventScroll: true })

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current?.()
      }
      if (event.key !== 'Tab') return
      const elements = focusable()
      const first = elements[0], last = elements.at(-1)
      if (!first) {
        event.preventDefault()
        dialog.current.focus()
      } else if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    function keepFocusInside(event) {
      if (!dialog.current.contains(event.target)) focusStart()
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', keepFocusInside)
    focusStart()
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', keepFocusInside)
      background.forEach(({ element, inert }) => {
        if (inert === null) element.removeAttribute('inert')
        else element.setAttribute('inert', inert)
      })
      if (previousOverflow) bodyStyle.setProperty('overflow', previousOverflow, previousOverflowPriority)
      else bodyStyle.removeProperty('overflow')
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div ref={overlay} className="exercise-catalogue-overlay" onClick={(event) => {
      if (event.target === event.currentTarget) closeRef.current?.()
    }}>
      <section ref={dialog} className="exercise-catalogue" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <header className="exercise-catalogue__header">
          <div>
            <p className="eyebrow">The movement library</p>
            <h2 id={titleId} className="wide-type">Choose your exercise.</h2>
            <p id={descriptionId}>{EXERCISES.length} exercises. {EXERCISE_GROUPS.length} muscle groups. Find your next move.</p>
          </div>
          <button className="exercise-catalogue__close" type="button" onClick={onClose} aria-label="Close exercise catalogue">
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <div className="exercise-catalogue__tools">
          <div className="exercise-catalogue__filters" role="group" aria-label="Filter by muscle group">
            <button type="button" aria-pressed={groupId === 'all'} onClick={() => setGroupId('all')}>All exercises <span>{EXERCISES.length}</span></button>
            {EXERCISE_GROUPS.map((group) => <button key={group.id} type="button" aria-pressed={groupId === group.id} onClick={() => setGroupId(group.id)}>{group.name} <span>{group.exercises.length}</span></button>)}
          </div>
          <div className="exercise-catalogue__search-row">
            <label className="exercise-catalogue__search">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
              <span className="sr-only">Search exercises</span>
              <input ref={search} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search exercises" autoComplete="off" />
            </label>
            <p className="exercise-catalogue__count" role="status" aria-live="polite">{filtered.length} {filtered.length === 1 ? 'exercise' : 'exercises'}</p>
          </div>
        </div>

        <div className="exercise-catalogue__scroll">
          {filtered.length ? <ul className="exercise-catalogue__cards" aria-label="Available exercises">
            {filtered.map((exercise) => {
              const isSelected = exercise.id === selected.id
              return <li key={exercise.id}>
                <button className={`exercise-card${isSelected ? ' exercise-card--selected' : ''}`} type="button" aria-pressed={isSelected} aria-label={`${exercise.name}${isSelected ? ', selected' : ''}`} onClick={() => onSelect(exercise.id)}>
                  <span className="exercise-card__diagram" aria-hidden="true"><ExerciseDiagram exerciseId={exercise.id} /></span>
                  <span className="exercise-card__body">
                    <span className="exercise-card__group">{exercise.groupName}</span>
                    <span className="exercise-card__name">{exercise.name}</span>
                    <span className="exercise-card__selection">{isSelected ? <><svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><path d="m3 9 4 4 8-8" /></svg>Selected</> : <>Choose exercise <span aria-hidden="true">↗</span></>}</span>
                  </span>
                </button>
              </li>
            })}
          </ul> : <div className="exercise-catalogue__empty">
            <h3>No exercises found.</h3>
            <p>Try another name or muscle group.</p>
            <button className="button" type="button" onClick={() => { setQuery(''); setGroupId('all'); search.current.focus() }}>Show all exercises</button>
          </div>}
        </div>

        <footer className="exercise-catalogue__footer"><p><span>Current selection</span><strong>{selected.name}</strong></p><a className="exercise-catalogue__credit" href="https://oss.exercisedb.dev/" target="_blank" rel="noreferrer">Illustrations by ExerciseDB ↗</a></footer>
      </section>
    </div>,
    document.body,
  )
}
