// PoseDetector calls onPoseUpdate with ONE flat array of normalized landmarks,
// not the nested PoseLandmarker result. An empty array means tracking is lost.
const SIDES = [
  { name: 'left', indices: [11, 13, 15, 23, 25] },
  { name: 'right', indices: [12, 14, 16, 24, 26] },
]
const DOWN_ANGLE = 90
const UP_ANGLE = 160
const MIN_VISIBILITY = 0.5
const EPSILON = 1e-7 // Floating-point tolerance, not motion smoothing.

function isPoint(point) {
  return point != null
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && Number.isFinite(point.z)
}

/**
 * Angle ABC in degrees, using all three supplied coordinates. Returns null for
 * missing/nonfinite points or zero-length vectors. Does not mutate its inputs.
 *
 * Angles are in the supplied coordinate space. PoseDetector emits normalized
 * image coordinates, not metric world coordinates: x/y have different scales
 * on nonsquare video, and z is estimated depth. These are game heuristics. For
 * aspect-corrected angles, callers can scale y by videoHeight / videoWidth
 * before processing (x and z are already expressed relative to image width).
 */
export function calculateAngle(a, b, c) {
  if (![a, b, c].every(isPoint)) return null

  const first = [a.x - b.x, a.y - b.y, a.z - b.z]
  const second = [c.x - b.x, c.y - b.y, c.z - b.z]
  const firstLength = Math.hypot(...first)
  const secondLength = Math.hypot(...second)
  if (!Number.isFinite(firstLength) || !Number.isFinite(secondLength)
    || firstLength <= Number.EPSILON || secondLength <= Number.EPSILON) return null

  // Normalize before multiplying to avoid overflow. atan2 is stable near
  // collinear vectors, where acos can magnify rounding into a form penalty.
  const u = first.map((value) => value / firstLength)
  const v = second.map((value) => value / secondLength)
  const dot = u.reduce((sum, value, index) => sum + value * v[index], 0)
  const crossLength = Math.hypot(
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  )
  return Math.atan2(crossLength, dot) * 180 / Math.PI
}

function readSide(landmarks, side) {
  const points = side.indices.map((index) => landmarks[index])
  if (!points.every(isPoint)) return null
  const visibility = points.map((point) => point.visibility === undefined ? 1 : point.visibility)
  if (!visibility.every(Number.isFinite) || Math.min(...visibility) < MIN_VISIBILITY) return null

  const [shoulder, elbow, wrist, hip, knee] = points
  const elbowAngle = calculateAngle(shoulder, elbow, wrist)
  const backAngle = calculateAngle(shoulder, hip, knee)
  if (elbowAngle === null || backAngle === null) return null
  return { side, elbowAngle, deviation: 180 - backAngle, visibility: Math.min(...visibility) }
}

function selectSide(landmarks) {
  const left = readSide(landmarks, SIDES[0])
  const right = readSide(landmarks, SIDES[1])
  // Prefer the side with the strongest least-visible joint; ties use the left.
  if (!left) return right
  if (!right) return left
  return right.visibility > left.visibility ? right : left
}

const clamp01 = (value) => Math.max(0, Math.min(1, value))

function scoreTier(attempt) {
  // Game scoring policy (0–100), equally weighted:
  //   Range: 90 degrees of observed elbow travel earns 100; less is linear.
  //   Alignment: straight earns 100; worst deviation >=45 degrees earns 0.
  // Extrema over the whole attempt include descent, bottom, and ascent. Using
  // extrema prevents repeated RAF callbacks or long holds from biasing a mean.
  const rangeScore = 100 * clamp01((attempt.maxAngle - attempt.minAngle) / 90)
  const alignmentScore = 100 * clamp01(1 - attempt.worstDeviation / 45)
  const combined = (rangeScore + alignmentScore) / 2

  // Inclusive lower thresholds: Perfect >=95, Super >=85, Good >=70,
  // Okay >=50, X <50. These are adjustable game ratings, not clinical grades.
  if (combined + EPSILON >= 95) return 'Perfect'
  if (combined + EPSILON >= 85) return 'Super'
  if (combined + EPSILON >= 70) return 'Good'
  if (combined + EPSILON >= 50) return 'Okay'
  return 'X'
}

/**
 * Create one independent counter per player/round. No React, DOM, timers, or IO.
 * processFrame accepts the exact flat array from PoseDetector.onPoseUpdate.
 *
 * A descent starts below 160 degrees, becomes "down" at <=90, and completes
 * only on returning to >=160. Starting at the bottom is allowed. An ascent
 * that never reached <=90 is discarded. Stationary frames never add reps.
 *
 * One side stays locked while visible, including between reps. Missing,
 * malformed, degenerate, or low-visibility data cancels the unfinished attempt,
 * preserving repCount;
 * it cannot bridge a tracking gap or splice different arms into one rep.
 * Returns { repCompleted, repCount }, plus tier only on a completion frame.
 */
export function createRepCounter() {
  let repCount = 0
  let attempt = null
  let previousTop = null

  return {
    processFrame(landmarks) {
      // Keep side continuity at the top, too: replaying a completion frame must
      // not begin a second rep from an opposite arm that happens to be bent.
      const side = attempt?.side ?? previousTop?.side
      const sample = Array.isArray(landmarks)
        ? (side ? readSide(landmarks, side) : selectSide(landmarks))
        : null

      if (!sample) {
        attempt = null
        previousTop = null
        return { repCompleted: false, repCount }
      }

      const { elbowAngle, deviation } = sample
      if (!attempt) {
        if (elbowAngle >= UP_ANGLE - EPSILON) {
          // Keep only the latest top frame; idle history belongs to no rep.
          previousTop = sample
          return { repCompleted: false, repCount }
        }
        const top = previousTop?.side === sample.side ? previousTop : sample
        attempt = {
          side: sample.side,
          phase: 'up',
          minAngle: Math.min(top.elbowAngle, elbowAngle),
          maxAngle: Math.max(top.elbowAngle, elbowAngle),
          worstDeviation: Math.max(top.deviation, deviation),
        }
        previousTop = null
      }

      attempt.minAngle = Math.min(attempt.minAngle, elbowAngle)
      attempt.maxAngle = Math.max(attempt.maxAngle, elbowAngle)
      attempt.worstDeviation = Math.max(attempt.worstDeviation, deviation)
      if (elbowAngle <= DOWN_ANGLE + EPSILON) attempt.phase = 'down'

      if (elbowAngle >= UP_ANGLE - EPSILON) {
        const tier = attempt.phase === 'down' ? scoreTier(attempt) : null
        attempt = null
        previousTop = sample
        if (tier !== null) {
          repCount += 1
          return { repCompleted: true, tier, repCount }
        }
      }
      return { repCompleted: false, repCount }
    },
  }
}
