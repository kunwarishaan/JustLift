# Just Lift

A local, sequential two-player exercise game built with Vite and React in plain
JavaScript. The Tempo interface shows a live camera, rep history, form readouts,
personal goal bars, an illustrated exercise catalogue, and final results. Names,
goals, optional weights, and game history stay in
this browser's localStorage; no account service or backend is required.

## Run it

Use Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Camera access requires localhost or HTTPS.

```sh
npm test
npm run build
npm run preview
```

The production build is written to `dist/`. The original `demo_videos/` movies
and recorded test fixtures are not included in the production bundle.

## Demo setup and rules

Choose from 24 exercises organized by Chest, Back, Biceps, Triceps, Shoulders,
and Legs using **Change exercise** on the "Make every rep count" screen. The
selected mode applies to both players and is locked once the first turn starts.
Each exercise has a gray/red anatomical illustration showing the person and
equipment. Illustrations are served by [ExerciseDB's public image service](https://oss.exercisedb.dev/)
and require an internet connection; no image library is bundled with the app.
The browser draws one GIF frame onto a canvas and keeps it still, including
under reduced motion. These display-only images do not enable another tracking
mode. Image failures show an explicit placeholder instead of a broken image.

Each player can also enter an optional weight in kg or lb beside their rep goal.
An empty or zero weight displays as Bodyweight. Modes and weights are UI settings
and saved workout metadata; they do not select another detector or affect rep
counts, form grades, goal credit, or winner calculation. The current calibrated
tracking implementation remains for push-ups. Use Push-ups for the live demo.

1. **Player 1 uses Justin's calibration; Player 2 uses Octavio's.** Display
   names are optional and do not change which calibration is used. Set each
   player's goal between 1 and 999 reps. Skipping names preserves the goals.
2. Use the same camera position, side-on orientation, and framing as the demo
   recordings. Keep shoulders, elbows, wrists, hips, and knees visible. Select
   **Start Turn**, allow the camera, and hold a straight-arm top briefly before
   the first descent. A rep already underway when tracking starts is ignored.
3. Okay, Good, and Perfect each add one rep and fill the goal bar. They
   earn 1, 2, and 4 points respectively. X feedback adds no reps or points.
   Accepted reps produce a visual pulse and a synthesized beep.
4. **End Turn** locks the first player's result and releases the camera. The
   second player then takes their turn. There is no turn time limit; reps above
   the goal can continue earning points while the bar remains full.
5. If only one player reaches their goal, that player wins regardless of points.
   If both reach their goals, higher points wins, with equal points a tie.
   If neither reaches their goal, there is no winner.
6. **Play Again** keeps the names, goals, weights, and exercise. **Change goals**, available before
   the first turn and after results, returns to setup without reloading. Goals
   are locked between the two players' turns.

These are personalized demo profiles, not a universal form classifier. The
[calibration report](docs/demo-calibration.md) explains the measured thresholds,
independent video annotations, replay results, and limitations. It includes the
one visibly straighter rep in Justin's Okay video that receives Good. A fresh
mixed rehearsal with the same camera setup is still needed to check live
performance beyond the recordings used for calibration.

## Camera and scoring interfaces

`PoseDetector.jsx` mounts only during an active turn. Its callback keeps the
original flat array of 33 normalized MediaPipe landmarks, or an empty array
when no pose is detected. The second argument adds actual video dimensions and
the capture timestamp in milliseconds:

```jsx
function handlePoseUpdate(landmarks, frame) {
  // frame: { timestamp, width, height }, or null if the video is unavailable.
  // landmarks[11] is the left shoulder: { x, y, z, visibility, ... }.
}

<PoseDetector onPoseUpdate={handlePoseUpdate} />
```

The callback runs every animation frame. Inference runs only for a new video
frame; cached callbacks reuse the same capture timestamp. The preview and
overlay are unmirrored, use the same intrinsic dimensions, and scale together.
Camera permission denial, missing cameras, and detector failures have visible
messages. Unmounting cancels the animation loop, stops every camera track, and
closes the detector, including resources that finish loading after unmount.
Microphone access is never requested.

Inference uses the locally installed `@mediapipe/tasks-vision@0.10.21` in VIDEO
mode, CPU delegate, and the local Pose Landmarker Lite model. The WASM files are
copied into `public/mediapipe/wasm` before dev/build; the model is in
`public/models/`. No camera frames or landmarks are uploaded. The interface
loads its fonts separately; inference assets load from the app's own origin.
See the [MediaPipe web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
for the model API and coordinate definitions.

The scoring engine is pure JavaScript with no React, DOM, timers, or IO:

```js
import { createRepCounter } from './src/scoringEngine.js'

const counter = createRepCounter({ profileId: 'justin' }) // or 'octavio'
function handlePoseUpdate(landmarks, frame) {
  const result = counter.processFrame(landmarks, frame)
  if (result.attemptCompleted) {
    // tier, repCount, attemptCount, completed diagnostics, and history.
    // repCompleted is false for X and true for accepted tiers.
  }
}
```

Pass the detector's metadata unchanged. Scoring corrects the image aspect ratio
and uses side-view 2D angles, rather than absolute pixel distances or inferred z.
`calculateAngle(a, b, c)` remains available separately for general 3D vector math.
Without metadata, the counter assumes distinct 30fps samples in a square
coordinate space, which is mainly useful for synthetic fixtures.

Movement detection and form grading are separate. A visible top, sufficient
elbow movement, and a stable return define an attempt. Grading uses calibrated
elbow travel plus signed shoulder-hip-knee alignment: sagging and piking have
separate tolerances. Very small excursions cannot qualify through alignment
alone. Repeated timestamps cannot add reps; short tracking gaps are tolerated,
while long gaps, standing, and timed-out attempts require a fresh top.

`useGame.js` owns the counter, turn lifecycle, session guards, audio, and HUD
measurements. `gameState.js` contains pure scoring and outcome transitions.
`GameScreen.jsx` renders them through a thin `useTurnPresentation` adapter.
There is one authoritative counter per turn, so the displayed meters and tier
cannot be produced by different scoring algorithms. Old camera callbacks are
ignored immediately after End Turn, including during batched React updates.
Reduced motion disables the slab and frame-edge animation while keeping tier
feedback visible.

## Local profiles and history

Names are trimmed and limited to 40 characters. Duplicate names are allowed;
player slots and calibration IDs remain distinct. These are local preferences,
not passwords, authentication, or automatic person recognition. Goals can be
increased manually between games, and Stats retains each game's goal and result.

Storage uses these versioned keys:

- `just-lift:player-names:v1`: last submitted names; Skip does not overwrite them.
- `just-lift:player-goals:v1`: last selected goals.
- `just-lift:workout-settings:v1`: selected exercise and each player's optional
  weight/unit. Skipping names retains these settings.
- `just-lift:game:v2:<id>`: a completed game snapshot with date, each player's
  name/profileId/goal/repCount/attemptCount/score, winner, and outcome. New records
  also include `workout: { exerciseId, loads }`; older records remain readable.
- `just-lift:game:v1:<id>`: older points-only records remain readable as recorded.

Results are saved once after both turns. Unfinished games are not saved. Stats
reads history newest first without resetting the current game. Invalid records
are skipped with a message; unrelated browser data is untouched. Blocked/full
storage cannot stop play. History belongs to this browser and site address,
so changing the port or clearing site data changes which history is available.

## Verification

Unit tests cover geometry, calibrated cycles and tiers, timestamp handling,
tracking recovery, goal outcomes, camera/audio cleanup, and storage versions.
Integration tests exercise the real game hook and scoring engine with timed
joint geometry through both turns, results, edits, and replay. Camera/audio IO
is mocked in those tests.

Catalogue tests cover all groups, search, selection, keyboard focus, dismissal,
and cleanup. Workout tests cover optional/invalid weights, kg/lb persistence,
shared-mode locking, and unchanged scoring with different loads. Existing
`LocalGame.test.jsx` expectations were updated for the exercise-neutral region
label and added workout metadata; `GoalUi.test.jsx` callback expectations now
include optional loads. Existing scoring and winner assertions are unchanged.
`ExerciseCatalogue.test.jsx` now checks the anatomical image wrapper instead of
an SVG and uses the new source-credit link as the last keyboard-focus target.

The recorded regression suite replays 9,725 cached MediaPipe frames from all
eight movies, including missing detections, setup, pauses, and standing. This
checks behavior on the calibration recordings, not accuracy on unseen footage:

```sh
npm test -- src/demoCalibration.test.js
```
