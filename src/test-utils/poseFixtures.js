// Side-on, normalized joint geometry. Positive body bend places the hip below
// the shoulder–knee line (sag); negative bend raises it (pike).
export const SIDE_JOINTS = {
  left: [11, 13, 15, 23, 25],
  right: [12, 14, 16, 24, 26],
}
export const FRAME_MS = 1000 / 30

export function pose(elbow, signedBody = -10, side = 'left') {
  const angle = elbow * Math.PI / 180
  const bend = signedBody * Math.PI / 180
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }))
  const joints = [
    [0.75, 0.4],
    [0.75, 0.6],
    [0.75 - 0.2 * Math.sin(angle), 0.6 - 0.2 * Math.cos(angle)],
    [0.45, 0.4],
    [0.45 - 0.3 * Math.cos(bend), 0.4 - 0.3 * Math.sin(bend)],
  ]
  SIDE_JOINTS[side].forEach((index, joint) => {
    landmarks[index] = { x: joints[joint][0], y: joints[joint][1], z: 0, visibility: 1 }
  })
  return landmarks
}

export const makePose = pose

// Real 30fps motion, including a visible top, eased descent/ascent, and enough
// time at the final top to settle tracking before another independent rep.
export function repFrames({ minElbow = 45, signedBody = -10, side = 'left', topElbow = 170 } = {}) {
  const frames = []
  const hold = (count, angle, bend) => {
    for (let index = 0; index < count; index += 1) frames.push(pose(angle, bend, side))
  }
  const ease = (value) => (1 - Math.cos(Math.PI * value)) / 2
  hold(12, topElbow, -10)
  for (let index = 1; index <= 24; index += 1) {
    const progress = ease(index / 24)
    frames.push(pose(topElbow + (minElbow - topElbow) * progress, signedBody, side))
  }
  hold(3, minElbow, signedBody)
  for (let index = 1; index <= 24; index += 1) {
    const progress = ease(index / 24)
    frames.push(pose(minElbow + (topElbow - minElbow) * progress, signedBody, side))
  }
  hold(12, topElbow, -10)
  return frames
}

export function rep(tier, profileId = 'justin') {
  const octavio = profileId === 'octavio'
  const settings = {
    Perfect: { minElbow: 45 },
    Good: { minElbow: 85 },
    Okay: { minElbow: 45, signedBody: octavio ? 16 : 26 },
    X: { minElbow: 125, signedBody: 45 },
  }[tier]
  if (!settings) throw new RangeError(`Unknown fixture tier: ${tier}`)
  return repFrames({ ...settings, side: octavio ? 'right' : 'left' })
}

export function frameMetadata(index, { start = 0, width = 1, height = 1 } = {}) {
  return { timestamp: start + index * FRAME_MS, width, height }
}
