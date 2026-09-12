import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createRepCounter } from './scoringEngine.js'

// Captured detector output, not synthetic poses or expected counter output.
// This Node-only test fixture is never imported into the browser application.
const fixture = JSON.parse(gunzipSync(readFileSync(
  new URL('./test-fixtures/demo-landmarks.json.gz', import.meta.url),
)).toString('utf8'))
const annotations = JSON.parse(readFileSync(
  new URL('../docs/demo-video-labels.json', import.meta.url), 'utf8',
))
const clips = Object.fromEntries(fixture.clips.map((clip) => [clip.id, {
  ...clip,
  frames: clip.frames.map(([timestamp, coordinates]) => {
    const landmarks = []
    if (coordinates.length) fixture.landmarkIndices.forEach((index, position) => {
      const offset = position * fixture.pointFields.length
      landmarks[index] = Object.fromEntries(fixture.pointFields.map((field, i) => [field, coordinates[offset + i]]))
    })
    return { timestamp, landmarks }
  }),
}]))

// Independently counted from visual contact sheets (see the annotation file).
// Initial partial cycles do not contain an observed top and are excluded.
const cases = [
  ['justin_perfect', 11, Array(11).fill('Perfect')],
  ['justin_good', 9, Array(9).fill('Good')],
  ['justin_ok', 9, ['Okay', 'Okay', 'Okay', 'Okay', 'Okay', 'Okay', 'Good', 'Okay', 'Okay']],
  ['justin_X', 0, []],
  ['octavio_perfect', 9, Array(9).fill('Perfect')],
  ['octavio_good', 11, Array(11).fill('Good')],
  ['octavio_ok', 7, Array(7).fill('Okay')],
  ['octavio_X', 0, []],
]

function replay(clip, { stride = 1, duplicate = false, start = 0, end = Infinity } = {}) {
  const counter = createRepCounter({ profileId: clip.profileId })
  let final
  const completed = []
  const duplicateEvents = []
  let framesProcessed = 0
  for (let index = 0; index < clip.frames.length; index += stride) {
    const frame = clip.frames[index]
    if (frame.timestamp < start * 1000 || frame.timestamp > end * 1000) continue
    const metadata = { timestamp: frame.timestamp, width: clip.width, height: clip.height }
    final = counter.processFrame(frame.landmarks, metadata)
    framesProcessed += 1
    if (final.attemptCompleted) completed.push(final.completed)
    if (duplicate) {
      final = counter.processFrame(frame.landmarks, metadata)
      if (final.attemptCompleted || final.repCompleted) duplicateEvents.push(final)
    }
  }
  return { final, completed, accepted: completed.filter((rep) => rep.accepted), duplicateEvents, framesProcessed }
}

describe('recorded demo calibration replay', () => {
  it('retains complete 30fps captures with both body sides and detector tracking gaps', () => {
    expect(fixture.capture).toMatchObject({ packageVersion: '0.10.21', delegate: 'CPU', sampleRate: 30 })
    expect(fixture.landmarkIndices).toEqual([11, 12, 13, 14, 15, 16, 23, 24, 25, 26])
    expect(fixture.pointFields).toEqual(['x', 'y', 'z', 'visibility'])
    expect(fixture.clips.map((clip) => clip.id)).toEqual(cases.map(([id]) => id))
    expect(fixture.clips.reduce((count, clip) => count + clip.frames.length, 0)).toBe(9725)
    expect(fixture.clips.some((clip) => clip.frames.some(([, points]) => points.length === 0))).toBe(true)
    for (const clip of fixture.clips) {
      expect(clip.frames[0][0]).toBe(0)
      expect(clip.durationSeconds * 1000 - clip.frames.at(-1)[0]).toBeLessThan(75)
      expect(clip.frames.every(([, points]) => points.length === 0 || points.length === 40)).toBe(true)
    }
  })

  it.each(cases)('%s matches manually counted accepted cycles and per-rep form at 30fps', (id, count, tiers) => {
    const result = replay(clips[id])
    expect(result.framesProcessed).toBe(clips[id].frames.length)
    expect(result.final.repCount).toBe(count)
    expect(result.accepted).toHaveLength(count)
    expect(result.accepted.map((rep) => rep.tier)).toEqual(tiers)
    if (count === 0) {
      // Straight-arm body dips need not produce exactly one X event each.
      // Every detected attempt must be rejected and contribute no points/reps.
      expect(result.completed.length).toBeGreaterThan(0)
      expect(result.completed.every((rep) => rep.tier === 'X' && rep.points === 0 && rep.repNumber === 0)).toBe(true)
      return
    }

    const label = annotations.clips[`${id}.mov`]
    expect(label.fully_visible_cycles ?? label.manual_completed_attempts).toBe(count)
    const bottoms = label.bottom_times_seconds.slice(label.initial_partial_cycle ? 1 : 0)
    const tail = label.exclude_windows.find((window) => /get-up/.test(window.reason))
    result.accepted.forEach((rep, index) => {
      const completedAt = rep.completedAt / 1000
      // Visual timestamps are approximate: match the ordered movement cycle,
      // rather than requiring the algorithm's return threshold to match a
      // human's frame-exact definition of fully extended arms.
      expect(completedAt).toBeGreaterThanOrEqual(bottoms[index] - annotations.timestamp_tolerance_seconds)
      expect(completedAt).toBeLessThan((bottoms[index + 1] ?? tail.start) + annotations.timestamp_tolerance_seconds)
      expect(rep.repNumber).toBe(index + 1)
    })
  })

  it.each(cases)('%s does not emit another attempt when RAF repeats the same capture timestamp', (id) => {
    const baseline = replay(clips[id])
    const repeated = replay(clips[id], { duplicate: true })
    expect(repeated.duplicateEvents).toEqual([])
    expect(repeated.final.repCount).toBe(baseline.final.repCount)
    expect(repeated.final.attemptCount).toBe(baseline.final.attemptCount)
    expect(repeated.final.history).toEqual(baseline.final.history)
    expect(repeated.completed).toEqual(baseline.completed)
  })

  it.each(cases)('%s keeps the manual accepted count when sampled at 15fps', (id, count) => {
    const result = replay(clips[id], { stride: 2 })
    expect(result.final.repCount).toBe(count)
    expect(result.accepted).toHaveLength(count)
    if (count === 0) expect(result.completed.every((rep) => rep.tier === 'X' && rep.points === 0)).toBe(true)
    // Borderline form tiers and rejected feedback can change with sampling.
    // They are intentionally not required to match the 30fps sequence exactly.
  })

  it.each(Object.entries(annotations.clips).flatMap(([filename, label]) => (
    label.exclude_windows.filter((window) => window.end - window.start > 1.2)
      .map((window) => [filename.replace('.mov', ''), window.reason, window.start, window.end])
  )))('%s: isolated %s cannot earn reps (%ss–%ss)', (id, _, start, end) => {
    // Trim the uncertainty at manually annotated movement boundaries. Replay
    // each interval with a fresh counter so earlier reps cannot mask a false positive.
    const result = replay(clips[id], { start: start + 0.5, end: end - 0.5 })
    expect(result.framesProcessed).toBeGreaterThan(0)
    expect(result.final.repCount).toBe(0)
    expect(result.accepted).toEqual([])
  })

  it('does not report any attempt during Justin’s extended recorded top-plank hold', () => {
    const result = replay(clips.justin_perfect, { start: 12.8, end: 18.2 })
    expect(result.framesProcessed).toBeGreaterThan(150)
    expect(result.completed).toEqual([])
    expect(result.final.attemptCount).toBe(0)
  })

  it.each(Object.entries(annotations.clips).filter(([, label]) => label.initial_partial_cycle))(
    '%s ignores the initial rise whose descent began before recording', (filename, label) => {
      const result = replay(clips[filename.replace('.mov', '')], { end: label.completion_times_seconds[0] + 0.3 })
      expect(result.completed).toEqual([])
      expect(result.final.repCount).toBe(0)
    },
  )
})
