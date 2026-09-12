import { describe, expect, it } from 'vitest'
import { calculateAngle, createRepCounter, gradeRep, readPoseMeasurement } from './scoringEngine.js'
import { FRAME_MS, SIDE_JOINTS, frameMetadata, pose, rep, repFrames } from './test-utils/poseFixtures.js'

const point = (x, y, z = 0) => ({ x, y, z })
const hold = (angle, count, bend = -10, side = 'left') => Array.from({ length: count }, () => pose(angle, bend, side))
const run = (counter, frames) => frames.map((landmarks) => counter.processFrame(landmarks))
const completions = (outputs) => outputs.filter((output) => output.attemptCompleted)
const bothSides = (left, right, leftVisibility = 1, rightVisibility = 1) => {
  const landmarks = left.map((landmark) => ({ ...landmark }))
  for (const index of SIDE_JOINTS.left) landmarks[index].visibility = leftVisibility
  for (const index of SIDE_JOINTS.right) landmarks[index] = { ...right[index], visibility: rightVisibility }
  return landmarks
}

describe('calculateAngle', () => {
  it.each([
    [point(1, 0), point(0, 0), point(0, 1), 90],
    [point(1, 0), point(0, 0), point(-1, 0), 180],
    [point(1, 0), point(0, 0), point(2, 0), 0],
    [point(1, 0, 1), point(0, 0, 0), point(1, 0, -1), 90],
    [point(1, 0, 0), point(0, 0, 0), point(1, 1, 1), Math.acos(1 / Math.sqrt(3)) * 180 / Math.PI],
  ])('uses all three dimensions to compute an angle in degrees', (a, b, c, expected) => {
    expect(calculateAngle(a, b, c)).toBeCloseTo(expected, 9)
  })

  it('is unchanged by uniform scaling and translation', () => {
    const a = point(1, 2, 3)
    const b = point(2, 1, 4)
    const c = point(4, 5, 6)
    const transform = ({ x, y, z }) => point(x * 7 + 13, y * 7 - 21, z * 7 + 9)
    expect(calculateAngle(transform(a), transform(b), transform(c))).toBeCloseTo(calculateAngle(a, b, c), 9)
  })

  it('keeps collinear diagonal vectors exactly straight without a rounding penalty', () => {
    expect(calculateAngle(point(1, 1), point(0, 0), point(-1, -1))).toBe(180)
    expect(calculateAngle(point(1, 1, 1), point(0, 0, 0), point(-1, -1, -1))).toBe(180)
  })

  it.each([
    null,
    undefined,
    {},
    { x: 0, y: 1 },
    { x: NaN, y: 1, z: 0 },
    { x: 0, y: Infinity, z: 0 },
    { x: 0, y: 1, z: -Infinity },
    { x: '0', y: 1, z: 0 },
  ])('returns null for malformed points in any position', (invalid) => {
    expect(calculateAngle(invalid, point(0, 0), point(0, 1))).toBeNull()
    expect(calculateAngle(point(1, 0), invalid, point(0, 1))).toBeNull()
    expect(calculateAngle(point(1, 0), point(0, 0), invalid)).toBeNull()
  })

  it('returns null when either joint vector has zero length', () => {
    expect(calculateAngle(point(1, 2, 3), point(1, 2, 3), point(0, 1, 2))).toBeNull()
    expect(calculateAngle(point(1, 2, 3), point(0, 1, 2), point(0, 1, 2))).toBeNull()
  })
})

describe('createRepCounter', () => {
  it.each([85, 90, 94.999, 95])('maps score %s to the four recorded categories for both profiles', (score) => {
    // Full travel and an independently calculated pike angle produce this
    // score within the 20–35 degree linear alignment segment.
    const maxPikeDegrees = 20 + (100 - score ** 2 / 100) * 15 / 51
    for (const profileId of ['justin', 'octavio']) {
      const result = gradeRep(120, { maxSagDegrees: 0, maxPikeDegrees }, profileId)
      expect(result.score).toBeCloseTo(score, 8)
      expect(result.tier).toBe(score >= 95 ? 'Perfect' : 'Good')
    }
  })

  it.each(['justin', 'octavio'])('grades complete motion for every tier with the %s profile', (profileId) => {
    const counter = createRepCounter({ profileId })
    const tiers = ['Perfect', 'Good', 'Okay', 'X']
    const outputs = run(counter, tiers.flatMap((tier) => rep(tier, profileId)))
    const finished = completions(outputs)
    expect(finished.map((output) => output.tier)).toEqual(tiers)
    expect(finished.map((output) => output.repCompleted)).toEqual([true, true, true, false])
    expect(finished.map((output) => output.completed.points)).toEqual([4, 2, 1, 0])
    expect(finished.map((output) => output.completed.attemptNumber)).toEqual([1, 2, 3, 4])
    expect(outputs.at(-1)).toMatchObject({ repCount: 3, attemptCount: 4 })
    expect(outputs.at(-1).history).toHaveLength(4)
    for (const { completed } of finished) {
      expect(completed.durationMs).toBeGreaterThanOrEqual(450)
      expect(completed.elbowTravelDegrees).toBeCloseTo(completed.maxElbowAngle - completed.minElbowAngle, 9)
      expect(completed.side).toBe(profileId === 'justin' ? 'left' : 'right')
    }
  })

  it('records an X attempt without increasing accepted reps, then accepts the next good rep', () => {
    const counter = createRepCounter()
    const rejected = completions(run(counter, rep('X')))[0]
    expect(rejected).toMatchObject({ repCompleted: false, attemptCompleted: true, repCount: 0, attemptCount: 1 })
    expect(rejected.completed).toMatchObject({ accepted: false, tier: 'X', points: 0, repNumber: 0 })
    const accepted = completions(run(counter, rep('Perfect')))[0]
    expect(accepted).toMatchObject({ repCompleted: true, repCount: 1, attemptCount: 2 })
    expect(accepted.completed).toMatchObject({ tier: 'Perfect', points: 4, repNumber: 1, attemptNumber: 2 })
    expect(accepted.completed.maxSagDegrees).toBeLessThan(1)
    expect(accepted.history[0]).toBe(rejected.completed)
    expect(Object.isFrozen(accepted.history)).toBe(true)
    expect(Object.isFrozen(accepted.completed)).toBe(true)
  })

  it.each(['justin', 'octavio'])('accepts a shallow Good cycle without a 90 degree crossing (%s)', (profileId) => {
    const counter = createRepCounter({ profileId })
    const side = profileId === 'justin' ? 'left' : 'right'
    const finished = completions(run(counter, repFrames({ minElbow: 100, side })))
    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ tier: 'Good', repCompleted: true, repCount: 1 })
    expect(finished[0].completed.minElbowAngle).toBeGreaterThan(90)
  })

  it.each([
    ['justin', 'left', 138],
    ['octavio', 'right', 132],
  ])('keeps a small near-top cycle at X despite healthy alignment (%s)', (profileId, side, minElbow) => {
    const outputs = run(createRepCounter({ profileId }), repFrames({ minElbow, side }))
    const finished = completions(outputs)
    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ tier: 'X', repCompleted: false, attemptCount: 1, repCount: 0 })
    expect(finished[0].completed).toMatchObject({ accepted: false, points: 0, alignmentScore: 100 })
    expect(finished[0].completed.elbowTravelDegrees).toBeLessThan(40)
    expect(finished[0].completed.score).toBeLessThan(50)
  })

  it('requires an observed held top before the first descent', () => {
    const counter = createRepCounter()
    const partial = run(counter, rep('Perfect').slice(36))
    expect(partial.at(-1)).toMatchObject({ repCount: 0, attemptCount: 0, history: [] })
    expect(completions(run(counter, rep('Perfect')))).toHaveLength(1)
  })

  it('does not count a stationary bottom, stationary top, or small top-angle jitter', () => {
    const counter = createRepCounter()
    const stationary = [...hold(45, 90), ...hold(170, 90)]
    const jitter = Array.from({ length: 300 }, (_, index) => pose(170 + 3 * Math.sin(index)))
    const outputs = run(counter, [...stationary, ...jitter])
    expect(outputs.at(-1)).toMatchObject({ repCount: 0, attemptCount: 0, history: [] })
  })

  it('rejects an implausibly brief motion instead of counting a quick angle spike', () => {
    const outputs = run(createRepCounter(), [...hold(170, 12), ...hold(45, 3), ...hold(170, 20)])
    expect(outputs.at(-1)).toMatchObject({ repCount: 0, attemptCount: 0, history: [] })
  })

  it('ignores repeated and backward video timestamps without changing diagnostics or history', () => {
    const counter = createRepCounter()
    const reference = createRepCounter()
    rep('Perfect').forEach((landmarks, index) => {
      const frame = frameMetadata(index)
      const actual = counter.processFrame(landmarks, frame)
      expect(actual).toEqual(reference.processFrame(landmarks, frame))
      for (const timestamp of [frame.timestamp, frame.timestamp - FRAME_MS]) {
        const ignored = counter.processFrame(pose(45, 65), { ...frame, timestamp })
        expect(ignored).toMatchObject({ repCompleted: false, attemptCompleted: false, completed: null })
        expect(ignored.repCount).toBe(actual.repCount)
        expect(ignored.attemptCount).toBe(actual.attemptCount)
        expect(ignored.live).toBe(actual.live)
        expect(ignored.history).toBe(actual.history)
      }
    })
    expect(counter.processFrame([], frameMetadata(76)).repCount).toBe(1)
  })

  it('preserves a partial attempt across a brief tracking gap', () => {
    const frames = rep('Perfect')
    const counter = createRepCounter()
    run(counter, frames.slice(0, 38))
    const missing = run(counter, [[], [], []])
    expect(missing.every((output) => output.live === null)).toBe(true)
    const outputs = run(counter, frames.slice(38))
    expect(completions(outputs)).toHaveLength(1)
    expect(outputs.at(-1)).toMatchObject({ repCount: 1, attemptCount: 1 })
  })

  it('cancels a partial attempt after more than 250ms without tracking and requires a new top', () => {
    const frames = rep('Perfect')
    const counter = createRepCounter()
    run(counter, frames.slice(0, 38))
    run(counter, Array.from({ length: 8 }, () => []))
    expect(run(counter, frames.slice(38)).at(-1)).toMatchObject({ repCount: 0, attemptCount: 0 })
    expect(run(counter, frames).at(-1)).toMatchObject({ repCount: 1, attemptCount: 1 })
  })

  it.each(['missing', 'non-finite', 'low-visibility', 'degenerate'])('treats %s joints as tracking loss without erasing completed reps', (kind) => {
    const counter = createRepCounter()
    const saved = run(counter, rep('Good')).at(-1).history
    const invalid = pose(45)
    if (kind === 'missing') invalid[15] = null
    if (kind === 'non-finite') invalid[15].z = NaN
    if (kind === 'low-visibility') invalid[15].visibility = 0.49
    if (kind === 'degenerate') invalid[15] = { ...invalid[13] }
    const outputs = run(counter, Array.from({ length: 10 }, () => invalid))
    expect(outputs.at(-1)).toMatchObject({ live: null, completed: null, repCount: 1, attemptCount: 1 })
    expect(outputs.at(-1).history).toBe(saved)
    expect(run(counter, rep('Perfect')).at(-1)).toMatchObject({ repCount: 2, attemptCount: 2 })
  })

  it('rejects a coincident shoulder and knee without poisoning later alignment measurements', () => {
    const counter = createRepCounter()
    const invalid = pose(170)
    invalid[25] = { ...invalid[11] }
    expect(readPoseMeasurement(invalid)).toBeNull()
    expect(counter.processFrame(invalid)).toMatchObject({ live: null, repCount: 0, attemptCount: 0 })
    const finished = completions(run(counter, rep('Perfect')))
    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ tier: 'Perfect', repCompleted: true, repCount: 1 })
    expect(Number.isFinite(finished[0].completed.maxSagDegrees)).toBe(true)
    expect(Number.isFinite(finished[0].completed.maxPikeDegrees)).toBe(true)
  })

  it('allows a long pause at the top but cancels a timed-out partial attempt', () => {
    const counter = createRepCounter()
    run(counter, hold(170, 330))
    expect(run(counter, rep('Perfect')).at(-1).repCount).toBe(1)
    run(counter, rep('Perfect').slice(0, 38))
    run(counter, hold(45, 270))
    expect(run(counter, rep('Perfect').slice(38)).at(-1)).toMatchObject({ repCount: 1, attemptCount: 1 })
    expect(run(counter, rep('Perfect')).at(-1).repCount).toBe(2)
  })

  it('allows a long held top below the return threshold before a complete rep', () => {
    const counter = createRepCounter()
    expect(run(counter, hold(150, 360)).at(-1)).toMatchObject({ repCount: 0, attemptCount: 0 })
    const finished = completions(run(counter, repFrames({ topElbow: 150, minElbow: 50 })))
    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ repCompleted: true, repCount: 1, attemptCount: 1 })
    expect(finished[0].completed.durationMs).toBeLessThan(8000)
  })

  it('expires an old top peak so a later small cycle uses its own range', () => {
    const counter = createRepCounter()
    run(counter, hold(180, 12))
    run(counter, hold(156, 360))
    const finished = completions(run(counter, repFrames({ topElbow: 156, minElbow: 140 })))
    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ tier: 'X', repCompleted: false, repCount: 0, attemptCount: 1 })
    expect(finished[0].completed.maxElbowAngle).toBeCloseTo(156, 4)
    expect(finished[0].completed.elbowTravelDegrees).toBeLessThan(20)
  })

  it('rejects upright motion and cancels an attempt when the person stands up', () => {
    const stand = (landmarks) => landmarks.map(({ x, y, ...rest }) => ({ ...rest, x: y, y: 1 - x }))
    const counter = createRepCounter()
    const standing = run(counter, rep('Perfect').map(stand))
    expect(standing.at(-1)).toMatchObject({ live: null, repCount: 0, attemptCount: 0 })
    run(counter, rep('Perfect').slice(0, 38))
    expect(counter.processFrame(stand(pose(45))).live).toBeNull()
    expect(run(counter, rep('Perfect').slice(38)).at(-1).attemptCount).toBe(0)
    expect(run(counter, rep('Perfect')).at(-1).repCount).toBe(1)
  })

  it.each(['justin', 'octavio'])('uses the preferred side when both sides are usable (%s)', (profileId) => {
    const counter = createRepCounter({ profileId })
    const left = rep('Perfect')
    const right = rep('Perfect', 'octavio')
    const outputs = run(counter, left.map((landmarks, index) => bothSides(landmarks, right[index], 0.6, 1)))
    expect(completions(outputs)[0].completed.side).toBe(profileId === 'justin' ? 'left' : 'right')
  })

  it('falls back to the other complete side if the preferred side cannot be tracked', () => {
    const outputs = run(createRepCounter(), repFrames({ side: 'right' }))
    expect(completions(outputs)[0].completed).toMatchObject({ tier: 'Perfect', side: 'right' })
  })

  it('keeps one side through completion and ignores a subsequent opposite-arm cycle', () => {
    const counter = createRepCounter()
    const selected = rep('Perfect')
    const first = run(counter, selected.map((landmarks, index) => bothSides(
      landmarks, pose(index < 38 ? 170 : 45, -10, 'right'), index < 38 ? 0.9 : 0.6, 1,
    )))
    expect(first.at(-1)).toMatchObject({ repCount: 1, attemptCount: 1 })
    const opposite = rep('Perfect', 'octavio').map((landmarks) => bothSides(pose(170), landmarks, 0.6, 1))
    expect(run(counter, opposite).at(-1)).toMatchObject({ repCount: 1, attemptCount: 1 })
  })

  it('does not switch arms during a brief loss of the locked side', () => {
    const counter = createRepCounter()
    const frames = rep('Perfect')
    run(counter, frames.slice(0, 38))
    const oppositeOnly = run(counter, hold(170, 3, -10, 'right'))
    expect(oppositeOnly.every((output) => output.live === null)).toBe(true)
    expect(completions(run(counter, frames.slice(38)))[0].completed.side).toBe('left')
  })

  it('keeps separate counts and calibration for independent counters', () => {
    const justin = createRepCounter({ profileId: 'justin' })
    const octavio = createRepCounter({ profileId: 'octavio' })
    const left = repFrames({ signedBody: 15 })
    const right = repFrames({ signedBody: 15, side: 'right' })
    left.forEach((landmarks, index) => {
      justin.processFrame(landmarks)
      octavio.processFrame(right[index])
    })
    const first = justin.processFrame(pose(170))
    const second = octavio.processFrame(pose(170, -10, 'right'))
    expect(first.history[0].tier).toBe('Good')
    expect(second.history[0].tier).toBe('Okay')
    expect(first.history).not.toBe(second.history)
    expect(run(justin, rep('Perfect')).at(-1).repCount).toBe(2)
    expect(octavio.processFrame(pose(170, -10, 'right')).repCount).toBe(1)
  })

  it.each(['justin', 'octavio'])('distinguishes sag from pike instead of rating absolute bend alone (%s)', (profileId) => {
    const side = profileId === 'justin' ? 'left' : 'right'
    const score = (signedBody) => completions(run(createRepCounter({ profileId }), repFrames({ signedBody, side })))[0].completed
    const sag = score(15)
    const pike = score(-15)
    const excessivePike = score(-65)
    expect(sag.tier).toBe(profileId === 'justin' ? 'Good' : 'Okay')
    expect(pike.tier).toBe('Perfect')
    expect(sag.maxSagDegrees).toBeCloseTo(15, 5)
    expect(pike.maxPikeDegrees).toBeCloseTo(15, 5)
    expect(excessivePike).toMatchObject({ tier: 'X', accepted: false, points: 0 })
  })

  it('measures signed joint geometry and preserves grading across scales and video aspect ratios', () => {
    const original = pose(85, 25)
    expect(readPoseMeasurement(original)).toMatchObject({ side: 'left' })
    expect(readPoseMeasurement(original).elbowAngle).toBeCloseTo(85, 9)
    expect(readPoseMeasurement(original).signedBodyDeviation).toBeCloseTo(25, 9)
    expect(readPoseMeasurement(pose(85, -25)).signedBodyDeviation).toBeCloseTo(-25, 9)
    const reference = createRepCounter()
    const widescreen = createRepCounter()
    const ratio = 720 / 1280
    rep('Okay').forEach((landmarks, index) => {
      const transformed = landmarks.map(({ x, y, ...rest }, joint) => ({
        ...rest, x: x * 0.45 + 0.12, y: (y * 0.45 + 0.04) / ratio, z: joint * 0.01,
      }))
      const baseline = reference.processFrame(landmarks, frameMetadata(index))
      const actual = widescreen.processFrame(transformed, frameMetadata(index, { width: 1280, height: 720 }))
      expect(actual.repCount).toBe(baseline.repCount)
      expect(actual.attemptCount).toBe(baseline.attemptCount)
      expect(actual.live?.elbowAngle).toBeCloseTo(baseline.live.elbowAngle, 8)
      expect(actual.live?.signedBodyDeviation).toBeCloseTo(baseline.live.signedBodyDeviation, 8)
      if (baseline.completed) {
        expect(actual.completed.tier).toBe(baseline.completed.tier)
        expect(actual.completed.score).toBeCloseTo(baseline.completed.score, 8)
        expect(actual.completed.elbowTravelDegrees).toBeCloseTo(baseline.completed.elbowTravelDegrees, 8)
      }
    })
  })
})
