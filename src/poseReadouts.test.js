import { describe, expect, it } from 'vitest'
import { createPoseReadouts } from './poseReadouts.js'
import { createRepCounter } from './scoringEngine.js'
import { frameMetadata, pose, rep } from './test-utils/poseFixtures.js'

const inspect = (observer, frames) => frames.map((landmarks) => observer.processFrame(landmarks))

describe('createPoseReadouts', () => {
  it.each(['justin', 'octavio'])('exposes the counter diagnostics and history unchanged for %s', (profileId) => {
    const observer = createPoseReadouts({ profileId })
    const counter = createRepCounter({ profileId })
    const frames = ['Perfect', 'Good', 'Okay', 'X'].flatMap((tier) => rep(tier, profileId))
    let last
    frames.forEach((landmarks, index) => {
      const frame = frameMetadata(index)
      const { live, completed, history, repCount, attemptCount } = counter.processFrame(landmarks, frame)
      last = observer.processFrame(landmarks, frame)
      expect(last).toEqual({ live, completed, history, repCount, attemptCount })
    })
    expect(last).toMatchObject({ repCount: 3, attemptCount: 4 })
    expect(last.history.map((entry) => entry.tier)).toEqual(['Perfect', 'Good', 'Okay', 'X'])
    expect(last.history.at(-1)).toMatchObject({ accepted: false, points: 0, repNumber: 3 })
  })

  it('publishes live motion diagnostics and immutable completed snapshots', () => {
    const observer = createPoseReadouts()
    const outputs = inspect(observer, rep('Perfect'))
    const moving = outputs.find((output) => output.live?.phase === 'moving')
    expect(moving.live).toMatchObject({ side: 'left', phase: 'moving' })
    expect(moving.live.elbowTravelDegrees).toBeGreaterThan(0)
    const completed = outputs.find((output) => output.completed)
    expect(completed.completed).toMatchObject({ tier: 'Perfect', accepted: true, points: 4 })
    expect(completed.history[0]).toBe(completed.completed)
    expect(Object.isFrozen(completed.completed)).toBe(true)
    expect(Object.isFrozen(completed.history)).toBe(true)
    inspect(observer, rep('Good'))
    expect(completed.history).toHaveLength(1)
    expect(completed.completed.tier).toBe('Perfect')
  })

  it('clears live tracking during loss while retaining history and recovering for a new rep', () => {
    const observer = createPoseReadouts()
    const saved = inspect(observer, rep('Good')).at(-1).history
    inspect(observer, rep('Perfect').slice(0, 38))
    const missing = inspect(observer, Array.from({ length: 9 }, () => []))
    expect(missing.every((output) => output.live === null && output.completed === null)).toBe(true)
    expect(missing.at(-1).history).toBe(saved)
    expect(missing.at(-1)).toMatchObject({ repCount: 1, attemptCount: 1 })
    expect(inspect(observer, rep('Perfect').slice(38)).at(-1).history).toBe(saved)
    const recovered = inspect(observer, rep('Perfect')).at(-1)
    expect(recovered).toMatchObject({ repCount: 2, attemptCount: 2 })
    expect(recovered.history.map((entry) => entry.tier)).toEqual(['Good', 'Perfect'])
  })

  it('forwards video timestamps so duplicate and backward frames cannot append history', () => {
    const observer = createPoseReadouts()
    let last
    rep('Perfect').forEach((landmarks, index) => {
      const frame = frameMetadata(index)
      last = observer.processFrame(landmarks, frame)
      for (const timestamp of [frame.timestamp, frame.timestamp - 100]) {
        const ignored = observer.processFrame(pose(45, 60), { ...frame, timestamp })
        expect(ignored.completed).toBeNull()
        expect(ignored.history).toBe(last.history)
        expect(ignored.live).toBe(last.live)
        expect(ignored.repCount).toBe(last.repCount)
        expect(ignored.attemptCount).toBe(last.attemptCount)
      }
    })
    expect(last.history).toHaveLength(1)
  })

  it('keeps observer instances and named profile options independent', () => {
    const justin = createPoseReadouts({ profileId: 'justin' })
    const octavio = createPoseReadouts({ profileId: 'octavio' })
    const justinLast = inspect(justin, rep('Good', 'justin')).at(-1)
    const octavioLast = inspect(octavio, rep('Good', 'octavio')).at(-1)
    expect(justinLast.history[0]).toMatchObject({ side: 'left', tier: 'Good' })
    expect(octavioLast.history[0]).toMatchObject({ side: 'right', tier: 'Good' })
    expect(justinLast.history).not.toBe(octavioLast.history)
    expect(inspect(justin, rep('Perfect')).at(-1).repCount).toBe(2)
    expect(octavio.processFrame(pose(170, -10, 'right'))).toMatchObject({ repCount: 1, attemptCount: 1 })
  })
})
