import { describe, expect, it } from 'vitest'
import { calculateAngle, createRepCounter } from './scoringEngine.js'

const EPSILON = 1e-7
const radians = (degrees) => (degrees * Math.PI) / 180
const point = (x, y, z = 0) => ({ x, y, z })
const SIDES = {
  left: [11, 13, 15, 23, 25],
  right: [12, 14, 16, 24, 26],
}

// These are real joint coordinates, not mocked angle results. Scaling keeps
// every coordinate inside the normalized camera frame for these test angles.
function pose({ left = null, right = null } = {}) {
  const landmarks = Array.from({ length: 33 }, () => ({ ...point(0, 0), visibility: 0 }))
  for (const [name, options] of Object.entries({ left, right })) {
    if (!options) continue
    const { elbow = 180, deviation = 0, visibility = 1 } = options
    const originX = name === 'left' ? 0.1 : 0.6
    const length = 0.15
    const elbowAngle = radians(elbow)
    const alignmentAngle = radians(180 - deviation)
    const joints = [
      point(originX, 0.1),
      point(originX + length, 0.1),
      point(originX + length - length * Math.cos(elbowAngle), 0.1 + length * Math.sin(elbowAngle)),
      point(originX, 0.4),
      point(originX + length * Math.sin(alignmentAngle), 0.4 - length * Math.cos(alignmentAngle)),
    ]
    SIDES[name].forEach((index, jointIndex) => {
      landmarks[index] = { ...joints[jointIndex] }
      if (visibility !== 'omitted') landmarks[index].visibility = visibility
    })
  }
  return landmarks
}

const leftPose = (elbow, deviation = 0, visibility = 1) => pose({ left: { elbow, deviation, visibility } })
const pending = (repCount = 0) => ({ repCompleted: false, repCount })
const completed = (tier, repCount = 1) => ({ repCompleted: true, tier, repCount })

function scoreRep(minElbow, maxElbow, deviation) {
  const counter = createRepCounter()
  expect(counter.processFrame(leftPose(minElbow, deviation))).toEqual(pending())
  return counter.processFrame(leftPose(maxElbow, deviation))
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
  it('allows an initial down position and includes the 90° and 160° boundaries', () => {
    const counter = createRepCounter()
    expect(counter.processFrame(leftPose(90))).toEqual(pending())
    expect(counter.processFrame(leftPose(130))).toEqual(pending())
    expect(counter.processFrame(leftPose(160))).toEqual(completed('Super'))
  })

  it('does not count repeated down or up frames as additional reps', () => {
    const counter = createRepCounter()
    expect(counter.processFrame(leftPose(180))).toEqual(pending())
    for (let index = 0; index < 5; index += 1) {
      expect(counter.processFrame(leftPose(70))).toEqual(pending())
    }
    expect(counter.processFrame(leftPose(180))).toEqual(completed('Perfect'))
    for (let index = 0; index < 5; index += 1) {
      expect(counter.processFrame(leftPose(180))).toEqual(pending(1))
    }
  })

  it('requires a down threshold before completing a rep', () => {
    const counter = createRepCounter()
    expect(counter.processFrame(leftPose(180))).toEqual(pending())
    expect(counter.processFrame(leftPose(90 + 2 * EPSILON))).toEqual(pending())
    expect(counter.processFrame(leftPose(180))).toEqual(pending())
    expect(counter.processFrame(leftPose(90))).toEqual(pending())
    expect(counter.processFrame(leftPose(160 - 2 * EPSILON))).toEqual(pending())
    expect(counter.processFrame(leftPose(160))).toEqual(completed('Perfect'))
  })

  it('tolerates angular floating-point error within 1e-7 degrees', () => {
    const counter = createRepCounter()
    expect(counter.processFrame(leftPose(90 + EPSILON / 2))).toEqual(pending())
    expect(counter.processFrame(leftPose(160 - EPSILON / 2))).toEqual(completed('Super'))
  })

  it.each([
    ['X', 90, 160, 60],
    ['Okay', 90, 160, 22.5],
    ['Good', 90, 160, 9],
    ['Super', 80, 170, 9],
    ['Perfect', 70, 160, 0],
  ])('scores a known geometric rep as %s', (tier, minElbow, maxElbow, deviation) => {
    expect(scoreRep(minElbow, maxElbow, deviation)).toEqual(completed(tier))
  })

  it.each([
    [50, 'Okay', 'X'],
    [70, 'Good', 'Okay'],
    [85, 'Super', 'Good'],
    [95, 'Perfect', 'Super'],
  ])('uses the inclusive tier boundary at %s and its numeric tolerance', (boundary, tier, lowerTier) => {
    const minElbow = boundary === 50 ? 80 : 70
    const maxElbow = 160
    const rangeScore = 100 * Math.min((maxElbow - minElbow) / 90, 1)
    for (const [targetScore, expectedTier] of [
      [boundary - 1e-5, lowerTier],
      [boundary - EPSILON / 2, tier],
      [boundary, tier],
      [boundary + 1e-5, tier],
    ]) {
      const alignmentScore = 2 * targetScore - rangeScore
      const deviation = 45 * (1 - alignmentScore / 100)
      expect(scoreRep(minElbow, maxElbow, deviation)).toEqual(completed(expectedTier))
    }
  })

  it('includes the immediately prior top in the elbow range', () => {
    const counter = createRepCounter()
    expect(counter.processFrame(leftPose(180))).toEqual(pending())
    expect(counter.processFrame(leftPose(90))).toEqual(pending())
    expect(counter.processFrame(leftPose(160))).toEqual(completed('Perfect'))
  })

  it('includes poor alignment during descent before reaching the bottom', () => {
    const counter = createRepCounter()
    counter.processFrame(leftPose(180))
    counter.processFrame(leftPose(120, 45))
    counter.processFrame(leftPose(70))
    expect(counter.processFrame(leftPose(160))).toEqual(completed('Okay'))
  })

  it('uses the worst alignment so repeated good frames do not dilute a poor frame', () => {
    function run(extraGoodFrames) {
      const counter = createRepCounter()
      counter.processFrame(leftPose(70))
      counter.processFrame(leftPose(100, 45))
      for (let index = 0; index < extraGoodFrames; index += 1) counter.processFrame(leftPose(120))
      return counter.processFrame(leftPose(160))
    }
    expect(run(0)).toEqual(completed('Okay'))
    expect(run(100)).toEqual(completed('Okay'))
  })

  it('caps range and alignment contributions at their documented limits', () => {
    expect(scoreRep(30, 180, 45)).toEqual(completed('Okay'))
    expect(scoreRep(90, 160, 90)).toEqual(completed('X'))
  })

  it('chooses the more visible complete side', () => {
    const counter = createRepCounter()
    expect(counter.processFrame(pose({
      left: { elbow: 180, visibility: 0.6 },
      right: { elbow: 90, visibility: 0.9 },
    }))).toEqual(pending())
    expect(counter.processFrame(pose({
      left: { elbow: 70, visibility: 0.6 },
      right: { elbow: 160, visibility: 0.9 },
    }))).toEqual(completed('Super'))
  })

  it('falls back to the complete side when the more visible side is missing a joint', () => {
    const counter = createRepCounter()
    function rightFrame(angle) {
      const landmarks = pose({
        left: { elbow: 180, visibility: 1 },
        right: { elbow: angle, visibility: 0.6 },
      })
      landmarks[15] = null
      return landmarks
    }
    expect(counter.processFrame(rightFrame(90))).toEqual(pending())
    expect(counter.processFrame(rightFrame(160))).toEqual(completed('Super'))
  })

  it('locks the selected side from descent through completion when visibility rankings change', () => {
    const counter = createRepCounter()
    counter.processFrame(pose({
      left: { elbow: 180, visibility: 0.95 },
      right: { elbow: 180, visibility: 0.8 },
    }))
    counter.processFrame(pose({
      left: { elbow: 120, visibility: 0.95 },
      right: { elbow: 175, visibility: 0.8 },
    }))
    counter.processFrame(pose({
      left: { elbow: 80, visibility: 0.7 },
      right: { elbow: 175, visibility: 0.99 },
    }))
    expect(counter.processFrame(pose({
      left: { elbow: 160, visibility: 0.7 },
      right: { elbow: 70, visibility: 0.99 },
    }))).toEqual(completed('Perfect'))
  })

  it('does not count the opposite arm as a second rep after the selected arm completes', () => {
    const counter = createRepCounter()
    counter.processFrame(pose({
      left: { elbow: 90, visibility: 0.95 },
      right: { elbow: 90, visibility: 0.8 },
    }))
    const completionFrame = pose({
      left: { elbow: 160, visibility: 0.7 },
      right: { elbow: 80, visibility: 0.99 },
    })
    expect(counter.processFrame(completionFrame)).toEqual(completed('Super'))
    expect(counter.processFrame(completionFrame)).toEqual(pending(1))
    expect(counter.processFrame(pose({
      left: { elbow: 160, visibility: 0.7 },
      right: { elbow: 160, visibility: 0.99 },
    }))).toEqual(pending(1))
  })

  it('resets a partial rep when its locked side disappears instead of switching arms', () => {
    const counter = createRepCounter()
    counter.processFrame(pose({
      left: { elbow: 90, visibility: 0.95 },
      right: { elbow: 70, visibility: 0.8 },
    }))
    expect(counter.processFrame(pose({ right: { elbow: 160 } }))).toEqual(pending())
    expect(counter.processFrame(pose({ right: { elbow: 170 } }))).toEqual(pending())
    expect(counter.processFrame(pose({ right: { elbow: 80 } }))).toEqual(pending())
    expect(counter.processFrame(pose({ right: { elbow: 170 } }))).toEqual(completed('Perfect'))
  })

  it.each([0.5, 'omitted'])('accepts visibility at 0.5 and defaults omitted visibility to 1', (visibility) => {
    const counter = createRepCounter()
    expect(counter.processFrame(leftPose(90, 0, visibility))).toEqual(pending())
    expect(counter.processFrame(leftPose(160, 0, visibility))).toEqual(completed('Super'))
  })

  it.each([
    ['missing pose', () => null],
    ['empty pose', () => []],
    ['missing joint', (landmarks) => { landmarks[13] = null; return landmarks }],
    ['missing z', (landmarks) => { delete landmarks[15].z; return landmarks }],
    ['nonfinite coordinate', (landmarks) => { landmarks[23].x = NaN; return landmarks }],
    ['low visibility', (landmarks) => { landmarks[25].visibility = 0.5 - 1e-8; return landmarks }],
    ['degenerate elbow', (landmarks) => { landmarks[13] = { ...landmarks[11] }; return landmarks }],
    ['degenerate alignment', (landmarks) => { landmarks[25] = { ...landmarks[23] }; return landmarks }],
  ])('resets partial state but preserves the count after %s', (_label, invalidFrame) => {
    const counter = createRepCounter()
    counter.processFrame(leftPose(70))
    expect(counter.processFrame(leftPose(160))).toEqual(completed('Perfect'))
    counter.processFrame(leftPose(70))
    expect(counter.processFrame(invalidFrame(leftPose(120)))).toEqual(pending(1))
    expect(counter.processFrame(leftPose(160))).toEqual(pending(1))
    counter.processFrame(leftPose(70))
    expect(counter.processFrame(leftPose(160))).toEqual(completed('Perfect', 2))
  })

  it('resets form statistics between completed reps', () => {
    const counter = createRepCounter()
    counter.processFrame(leftPose(90, 60))
    expect(counter.processFrame(leftPose(160, 60))).toEqual(completed('X'))
    counter.processFrame(leftPose(180))
    counter.processFrame(leftPose(70))
    expect(counter.processFrame(leftPose(180))).toEqual(completed('Perfect', 2))
  })

  it('does not share count or partial-rep state between counter instances', () => {
    const first = createRepCounter()
    const second = createRepCounter()
    expect(first.processFrame(leftPose(90))).toEqual(pending())
    expect(second.processFrame(leftPose(160))).toEqual(pending())
    expect(first.processFrame(leftPose(160))).toEqual(completed('Super'))
    expect(second.processFrame(leftPose(70))).toEqual(pending())
    expect(second.processFrame(leftPose(160))).toEqual(completed('Perfect'))
    expect(first.processFrame(leftPose(180))).toEqual(pending(1))
  })
})
