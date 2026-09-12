import { useId } from 'react'
import ExerciseDiagram from './ExerciseDiagram.jsx'
import './ExercisePreview.css'

/** Background-free selected artwork; catalogue thumbnails use ExerciseDiagram directly. */
export default function ExercisePreview({ exerciseId, className = '' }) {
  const filterId = useId()
  return <div className={`exercise-preview ${className}`} style={{ '--exercise-preview-filter': `url(#${filterId})` }}>
    <svg className="exercise-preview__filter" width="0" height="0" aria-hidden="true" focusable="false">
      <defs><filter id={filterId} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
        {/* Fade near-white pixels without changing the figure's RGB colors. */}
        <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -10 -10 -10 0 29.7" />
        <feComposite operator="in" in2="SourceGraphic" />
      </filter></defs>
    </svg>
    <ExerciseDiagram exerciseId={exerciseId} />
  </div>
}
