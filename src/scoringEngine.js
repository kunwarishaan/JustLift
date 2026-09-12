import { getCalibrationProfile } from './calibrationProfiles.js'

// PoseDetector calls onPoseUpdate with ONE flat array of normalized landmarks,
// not the nested PoseLandmarker result. An empty array means tracking is lost.
const SIDES = [
  { name: 'left', indices: [11, 13, 15, 23, 25] },
  { name: 'right', indices: [12, 14, 16, 24, 26] },
]
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

/** Side-view angles: project into the image plane after correcting aspect.
 * MediaPipe z is inferred depth; the recorded demo profiles were calibrated
 * on this 2D projection. Uniform body size, resolution, and translation cancel.
 * Camera perspective does not cancel: keep the camera side-on for the demo.
 */
export function readPoseMeasurement(landmarks, frame = {}, sideName = 'left') {
  if (!Array.isArray(landmarks)) return null
  const side = SIDES.find((candidate) => candidate.name === sideName)
  if (!side) return null
  const raw = side.indices.map((index) => landmarks[index])
  if (!raw.every(isPoint)) return null
  const visibility = raw.map((p) => p.visibility === undefined ? 1 : p.visibility)
  if (!visibility.every(Number.isFinite)) return null
  const ratio = Number.isFinite(frame?.width) && Number.isFinite(frame?.height)
    && frame.width > 0 && frame.height > 0 ? frame.height / frame.width : 1
  const [shoulder, elbow, wrist, hip, knee] = raw.map((p) => ({ x: p.x, y: p.y * ratio, z: 0 }))
  const elbowAngle = calculateAngle(shoulder, elbow, wrist)
  const backAngle = calculateAngle(shoulder, hip, knee)
  const torsoLength = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
  if (elbowAngle === null || backAngle === null || torsoLength < Number.EPSILON
    || Math.abs(knee.x - shoulder.x) <= Number.EPSILON) return null
  const hipLineY = shoulder.y + (knee.y - shoulder.y) * (hip.x - shoulder.x) / (knee.x - shoulder.x)
  const signedBodyDeviation = (180 - backAngle) * Math.sign(hip.y - hipLineY)
  if (!Number.isFinite(signedBodyDeviation)) return null
  return {
    side: side.name,
    elbowAngle,
    bodyDeviation: 180 - backAngle,
    signedBodyDeviation,
    visibility: Math.min(...visibility),
    bodySlope: Math.abs(Math.atan2(shoulder.y - knee.y, Math.abs(shoulder.x - knee.x))) * 180 / Math.PI,
    wristBelow: (wrist.y - shoulder.y) / torsoLength,
  }
}

export function interpolateScore(value, knots) {
  if (value <= knots[0][0]) return knots[0][1]
  for (let i = 1; i < knots.length; i += 1) {
    const [x, y] = knots[i]
    const [previousX, previousY] = knots[i - 1]
    if (value <= x) return previousY + (y - previousY) * (value - previousX) / (x - previousX)
  }
  return knots.at(-1)[1]
}

export function gradeRep(elbowTravelDegrees, { maxSagDegrees, maxPikeDegrees }, profileId = 'justin') {
  const profile = getCalibrationProfile(profileId)
  if (![elbowTravelDegrees, maxSagDegrees, maxPikeDegrees].every((value) => Number.isFinite(value) && value >= 0)) {
    return { rangeScore: 0, alignmentScore: 0, sagScore: 0, pikeScore: 0, score: 0, tier: 'X' }
  }
  const rangeScore = interpolateScore(elbowTravelDegrees, profile.travelKnots)
  // Direction matters: sagging below the shoulder–knee line differs from the
  // small raised-hip baseline in these recordings. Absolute angle alone hid
  // that distinction, especially in Octavio's Okay and Perfect examples.
  const sagScore = interpolateScore(maxSagDegrees, profile.sagKnots)
  const pikeScore = interpolateScore(maxPikeDegrees, profile.pikeKnots)
  const alignmentScore = Math.min(sagScore, pikeScore)
  // Equal influence through a geometric mean. A near-zero body-line score
  // cannot be hidden by deep elbow travel (or vice versa).
  const combined = Math.sqrt(rangeScore * alignmentScore)
  // A nearly stationary arm cannot qualify solely from a straight body. These
  // travel floors sit below each person's shallowest recorded accepted cycle.
  const score = elbowTravelDegrees + EPSILON < profile.minAcceptedTravelDegrees
    ? Math.min(49, combined) : combined
  // Four recorded categories: X <50, Okay >=50, Good >=70, Perfect >=95.
  // The full 70–95 band is Good; only the calibrated top band is Perfect.
  // These are demo ratings, not clinical grades.
  const tier = score + EPSILON >= 95 ? 'Perfect'
    : score + EPSILON >= 70 ? 'Good' : score + EPSILON >= 50 ? 'Okay' : 'X'
  return { rangeScore, alignmentScore, sagScore, pikeScore, score, tier }
}

const POINTS = { X: 0, Okay: 1, Good: 2, Perfect: 4 }

/** One counter per turn, using a named person's calibration.
 * processFrame(flatLandmarks, {timestamp, width, height}) is pure and synchronous.
 * Timestamps are milliseconds from the video, not RAF calls. Without metadata,
 * samples are treated as distinct 30fps frames in a square coordinate space.
 *
 * A rep needs an observed top, a descent of >=12 degrees, and a stable return.
 * Detection is deliberately separate from grading: a shallow/bent-back cycle
 * can finish with X. X increments attemptCount only; accepted tiers increment
 * repCount. Starting halfway through a rep is ignored until a top is observed.
 * Brief tracking gaps are tolerated; long gaps, standing, and timed-out partial
 * attempts require a fresh top. Repeated timestamps never change state.
 */
export function createRepCounter({ profileId = 'justin' } = {}) {
  const profile = getCalibrationProfile(profileId)
  let repCount = 0
  let attemptCount = 0
  let history = Object.freeze([])
  let top = null
  let attempt = null
  let smooth = null
  let lockedSide = null
  let topSince = null
  let returnSince = null
  let lastTimestamp = null
  let lastValidTime = null
  let live = null
  let topSamples = []

  function clearMotion() {
    top = attempt = smooth = lockedSide = topSince = returnSince = null
    live = null
    topSamples = []
  }
  const pending = () => ({ repCompleted: false, attemptCompleted: false, repCount, attemptCount, live, completed: null, history })
  function usable(sample) {
    return sample && sample.visibility >= profile.visibility
  }

  return {
    processFrame(landmarks, frame = {}) {
      const timestamp = Number.isFinite(frame?.timestamp) ? frame.timestamp : (lastTimestamp ?? -1000 / 30) + 1000 / 30
      if (lastTimestamp !== null && timestamp <= lastTimestamp) return pending()
      const dt = lastTimestamp === null ? 1000 / 30 : timestamp - lastTimestamp
      lastTimestamp = timestamp
      if (lastValidTime !== null && timestamp - lastValidTime > profile.maxGapMs) clearMotion()
      let sample
      if (lockedSide) sample = readPoseMeasurement(landmarks, frame, lockedSide)
      else {
        const preferred = readPoseMeasurement(landmarks, frame, profile.preferredSide)
        const other = readPoseMeasurement(landmarks, frame, profile.preferredSide === 'left' ? 'right' : 'left')
        sample = usable(preferred) ? preferred : other
      }
      if (!usable(sample)) {
        live = null
        return pending()
      }
      // This gate identifies a plausible floor exercise, not its quality.
      // Sagging/piking remain measurable; standing/getting up cancels a cycle.
      if (sample.bodySlope > profile.maxBodySlope || sample.wristBelow < profile.minWristBelow) {
        clearMotion()
        lastValidTime = timestamp
        return pending()
      }
      lastValidTime = timestamp
      lockedSide = sample.side
      const alpha = 1 - Math.exp(-dt / profile.smoothingMs)
      smooth = smooth ? {
        ...sample,
        elbowAngle: smooth.elbowAngle + alpha * (sample.elbowAngle - smooth.elbowAngle),
        bodyDeviation: smooth.bodyDeviation + alpha * (sample.bodyDeviation - smooth.bodyDeviation),
        signedBodyDeviation: smooth.signedBodyDeviation + alpha * (sample.signedBodyDeviation - smooth.signedBodyDeviation),
      } : sample
      const angle = smooth.elbowAngle
      const deviation = smooth.bodyDeviation
      const idle = { minAngle: angle, maxAngle: angle, worstDeviation: deviation,
        maxSagDegrees: Math.max(0, smooth.signedBodyDeviation), maxPikeDegrees: Math.max(0, -smooth.signedBodyDeviation) }
      const measure = (extrema) => {
        const elbowTravelDegrees = extrema.maxAngle - extrema.minAngle
        return { side: sample.side, elbowAngle: angle, bodyDeviation: deviation,
          signedBodyDeviation: smooth.signedBodyDeviation,
          elbowTravelDegrees, worstBodyDeviation: extrema.worstDeviation,
          maxSagDegrees: extrema.maxSagDegrees, maxPikeDegrees: extrema.maxPikeDegrees,
          ...gradeRep(elbowTravelDegrees, extrema, profileId),
          phase: attempt ? 'moving' : top ? 'ready' : 'find-top',
        }
      }
      live = measure(idle)
      if (!top) {
        if (angle >= profile.armAngle) {
          topSince ??= timestamp
          if (timestamp - topSince + EPSILON >= profile.topHoldMs) {
            top = { ...smooth, timestamp, peakAngle: angle }
            topSamples = [{ angle, timestamp }]
          }
        } else topSince = null
        return pending()
      }
      if (!attempt) {
        topSamples.push({ angle, timestamp })
        topSamples = topSamples.filter((entry) => timestamp - entry.timestamp <= profile.topPeakWindowMs)
        if (angle > top.elbowAngle || angle >= profile.returnAngle) {
          top = { ...smooth, timestamp, peakAngle: angle }
        }
        top.peakAngle = Math.max(...topSamples.map((entry) => entry.angle))
        if (top.elbowAngle - angle + EPSILON < profile.descentDegrees) return pending()
        attempt = {
          // Idle time at a slightly bent top is not time spent doing the rep.
          startedAt: Math.max(top.timestamp, timestamp - 500),
          startAngle: top.elbowAngle,
          minAngle: angle,
          maxAngle: top.peakAngle,
          worstDeviation: Math.max(top.bodyDeviation, deviation),
          maxSagDegrees: Math.max(0, top.signedBodyDeviation, smooth.signedBodyDeviation),
          maxPikeDegrees: Math.max(0, -top.signedBodyDeviation, -smooth.signedBodyDeviation),
        }
      }
      attempt.minAngle = Math.min(attempt.minAngle, angle)
      attempt.maxAngle = Math.max(attempt.maxAngle, angle)
      attempt.worstDeviation = Math.max(attempt.worstDeviation, deviation)
      attempt.maxSagDegrees = Math.max(attempt.maxSagDegrees, smooth.signedBodyDeviation)
      attempt.maxPikeDegrees = Math.max(attempt.maxPikeDegrees, -smooth.signedBodyDeviation)
      live = measure(attempt)
      if (timestamp - attempt.startedAt > profile.maxDurationMs) {
        clearMotion()
        return pending()
      }
      const returnAngle = Math.min(profile.returnAngle, attempt.startAngle - profile.returnTolerance)
      if (angle >= returnAngle) returnSince ??= timestamp
      else returnSince = null
      if (returnSince === null || timestamp - returnSince + EPSILON < profile.topHoldMs) return pending()

      const durationMs = timestamp - attempt.startedAt
      const finished = attempt
      attempt = null
      returnSince = null
      top = { ...smooth, timestamp, peakAngle: angle }
      topSamples = [{ angle, timestamp }]
      if (durationMs + EPSILON < profile.minDurationMs) return pending()

      const { tier, rangeScore, alignmentScore, score } = gradeRep(live.elbowTravelDegrees, finished, profileId)
      attemptCount += 1
      const repCompleted = tier !== 'X'
      if (repCompleted) repCount += 1
      const completed = Object.freeze({
        attemptNumber: attemptCount, repNumber: repCount, accepted: repCompleted,
        tier, points: POINTS[tier], side: sample.side,
        minElbowAngle: finished.minAngle, maxElbowAngle: finished.maxAngle,
        elbowTravelDegrees: live.elbowTravelDegrees, worstBodyDeviation: finished.worstDeviation,
        maxSagDegrees: finished.maxSagDegrees, maxPikeDegrees: finished.maxPikeDegrees,
        rangeScore, alignmentScore, score, durationMs,
        startedAt: finished.startedAt, completedAt: timestamp,
      })
      history = Object.freeze([...history, completed])
      return { repCompleted, attemptCompleted: true, tier, repCount, attemptCount, live, completed, history }
    },
  }
}
