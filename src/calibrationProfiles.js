// Demo calibration uses the same local Pose Landmarker Lite 0.10.21 model as
// the camera. These are side-view, aspect-corrected 2D joint measurements, not
// pixel distances or a different MediaPipe model for each person.
// Provenance, clip exclusions, and replay results: docs/demo-calibration.md.
const common = {
  visibility: 0.5,
  smoothingMs: 65,
  armAngle: 140,
  descentDegrees: 12,
  returnTolerance: 6,
  topHoldMs: 100,
  minDurationMs: 450,
  maxDurationMs: 8000,
  maxGapMs: 250,
  maxBodySlope: 45,
  minWristBelow: 0.05,
  topPeakWindowMs: 1000,
}

export const CALIBRATION_PROFILES = Object.freeze({
  justin: Object.freeze({
    ...common, id: 'justin', label: 'Justin', preferredSide: 'left', returnAngle: 155,
    targetAngle: 60,
    minAcceptedTravelDegrees: 50,
    travelKnots: [[0, 0], [18, 10], [50, 49], [102, 70], [112, 100]],
    sagKnots: [[0, 100], [11, 100], [22, 49], [38, 25], [50, 0]],
    pikeKnots: [[0, 100], [20, 100], [35, 49], [45, 25], [55, 0]],
  }),
  octavio: Object.freeze({
    ...common, id: 'octavio', label: 'Octavio', preferredSide: 'right', returnAngle: 150,
    targetAngle: 60,
    minAcceptedTravelDegrees: 65,
    travelKnots: [[0, 0], [18, 10], [65, 49], [97, 70], [106, 100]],
    sagKnots: [[0, 100], [7, 100], [10, 49], [24, 25], [40, 0]],
    pikeKnots: [[0, 100], [20, 100], [35, 49], [45, 25], [55, 0]],
  }),
})

export function getCalibrationProfile(id = 'justin') {
  if (!Object.hasOwn(CALIBRATION_PROFILES, id)) throw new RangeError(`Unknown calibration profile: ${id}`)
  return CALIBRATION_PROFILES[id]
}
