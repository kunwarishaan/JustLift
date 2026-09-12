import { createRepCounter } from './scoringEngine.js'

/** Standalone recorded-frame inspection adapter. The game consumes its own
 * counter's diagnostics instead of running a second scoring machine.
 */
export function createPoseReadouts(options) {
  const counter = createRepCounter(options)
  return {
    processFrame(landmarks, frame) {
      const { live, completed, history, repCount, attemptCount } = counter.processFrame(landmarks, frame)
      return { live, completed, history, repCount, attemptCount }
    },
  }
}
