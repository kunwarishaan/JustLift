# Just Lift

A two-player local push-up web app built with Vite and React in plain JavaScript.

The app includes a playable two-player push-up game with a live webcam, pose
debugging overlay, rep counting, and form-based points. Its minimal game screen
is a functional harness that can be replaced without rewriting the turn logic.
Optional player names and completed-game history are stored locally in the
browser, with no account service or backend.

## Development

Use Node.js 22.12+ (Node.js 22.20.0 was used for setup).

```sh
npm install
npm run dev
```

## Production build

```sh
npm run build
npm run preview
```

The production build is written to `dist/`.

## Pose detector

`App.jsx` mounts `LocalGame.jsx`, which wraps `GameScreen.jsx` with optional name
entry and Stats. `GameScreen` mounts `PoseDetector.jsx` only during an active
turn. Camera access starts when you select **Start Turn**; allow the
browser's camera permission prompt. Use localhost or HTTPS for webcam
access. The video is muted and plays inline, and microphone access is never requested.

```jsx
import PoseDetector from './PoseDetector.jsx'

function handlePoseUpdate(landmarks) {
  // One flat array of 33 MediaPipe landmarks, or [] if no pose is available.
  // For example: landmarks[11] is the left shoulder.
}

<PoseDetector onPoseUpdate={handlePoseUpdate} />
```

The callback runs every animation frame while tracking is active. Inference runs
only on new video frames; intervening animation frames reuse the latest result.
Each landmark contains `x`, `y`, `z`, and `visibility` in MediaPipe's normalized
image coordinate system. Coordinates and the preview are unmirrored. The overlay
uses the video's intrinsic dimensions and scales with it without cropping.
Yellow markers highlight shoulders (11–12), elbows (13–14), wrists (15–16),
hips (23–24), and knees (25–26). Low-visibility points are hidden in the overlay
but remain in callback data so consumers can choose their confidence threshold.

Camera denial, missing/busy cameras, model failures, and interrupted tracking show
visible errors. On failure or unmount, the component cancels its animation loop,
stops camera tracks, and closes the detector, including resources that finish
initializing after unmount. Changing the callback does not restart tracking.

All inference happens in the browser in `VIDEO` mode. No frames or landmarks are
uploaded. MediaPipe is pinned to `0.10.21`, whose runtime does not include the
usage telemetry present in newer releases. Review that behavior before upgrading.
The runtime WASM files are copied from the installed package before `dev` and
`build`; the model is included in `public/models/`. Both load from the app's own
origin, with no external runtime services or CDN downloads.

The included model is Google's
[Pose Landmarker Lite, float16, version 1](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task).
See the [MediaPipe web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
for the model API and coordinate definitions.

## Scoring engine

`src/scoringEngine.js` has no React or browser dependencies. Create a counter
once per player/round and feed it the landmarks from `onPoseUpdate`:

```js
import { createRepCounter } from './scoringEngine.js'

const counter = createRepCounter()

function handlePoseUpdate(landmarks) {
  const result = counter.processFrame(landmarks)
  // Always: { repCompleted, repCount }
  // On completion: also { tier: 'X' | 'Okay' | 'Good' | 'Super' | 'Perfect' }
}
```

The counter enters down at an elbow angle of 90° or less and completes one rep
on returning to 160° or more. A starting down position is accepted. It selects
the more visible complete body side when tracking begins and keeps that side
while it remains reliable, including between reps.
Missing or unreliable landmarks cancel an unfinished rep without losing the
completed count. Frames held at the same position cannot add duplicate reps.

Scores equally weight elbow travel (90° of observed range earns full credit)
and the worst shoulder–hip–knee deviation from 180° during the attempt (45° or
more loses all alignment credit). Tiers are X below 50, Okay from 50, Good from
70, Super from 85, and Perfect from 95. These game thresholds are documented in
the module for later tuning; they have not been calibrated against recordings.

`calculateAngle(a, b, c)` is also exported for three-dimensional vector angles.
It returns `null` for invalid or degenerate points. The detector currently sends
normalized image coordinates, so scores use that coordinate space. For
aspect-corrected geometry, scale each landmark's `y` by the actual video height
divided by its width before calling the engine. This API does not receive video
dimensions and does not assume the camera's requested resolution was granted.

## Two-player game

1. Enter optional names and select **Continue**, or select **Skip names** to use
   Player 1 and Player 2. Player 1 then selects **Start Turn** and performs
   push-ups in view of the camera.
2. Each completed rep updates the live count and latest tier, pulses the tier
   label, and plays a short synthesized beep when browser audio is available.
3. **End Turn** locks Player 1's score, releases the webcam, and readies Player 2.
4. Player 2 starts and ends their own turn. Results show both final scores and
   the winner or tie. **Play Again** resets both players to a fresh game with
   the same names.

Turns have no time limit. Only completed reps score; an unfinished rep is
discarded when the turn ends. Points are summed using X=0, Okay=1, Good=2,
Super=3, Perfect=4. An X still counts as a completed rep and triggers feedback.
Ending a turn with no reps is allowed, including a 0–0 tie.

The implementation separates responsibilities so the UI can be replaced:

- `gameState.js`: pure state transitions, tier point values, and winner selection.
- `useGame.js`: turn lifecycle, one fresh rep counter per turn, and guarded pose
  callbacks. Reuse this hook to build a different screen layout. Scores are
  updated only for newly completed reps, not on every webcam frame. Optional
  `playerNames` initialize the names, and `onGameComplete(players)` runs once
  on the accepted transition into results.
- `GameScreen.jsx` / `.css`: controls, scoreboard, tier pulse, and results.
- `repAudio.js`: Web Audio oscillator/gain beeps, unlocked in the Start Turn
  click handler. Audio failures do not block play. Nodes and contexts are
  released when a turn ends or the screen unmounts; no audio files are loaded.

Camera callbacks from ended turns are ignored immediately, even before React
finishes unmounting the detector. Each new turn gets a distinct session ID, so
late callbacks cannot score for another player or a replay. The visual pulse
respects the browser's reduced-motion preference.

## Optional names and local history

Submitted names are trimmed, limited to 40 characters, and remembered for the
next visit. Either field can be left blank to use its Player 1/Player 2 default.
**Skip names** always uses those defaults and leaves remembered names untouched.
These are local display names, without passwords or sign-in. Identical names
are allowed; player slots remain distinct throughout the game and history.

Every completed game, including guest and tied games, saves a snapshot with
its completion date, both names and scores, and winner. Unfinished games are
not saved. **Stats** is available from name entry and results and reads saved
games from localStorage on each visit, newest first. **Back** restores the
previous screen without resetting scores or saving the result again.

Storage uses versioned keys owned by this app:

- `just-lift:player-names:v1`: the two most recently submitted names.
- `just-lift:game:v1:<unique-game-id>`: one immutable completed-game record.

Each record has this shape (`winner` is slot `0`, slot `1`, or `null` for a tie):

```json
{
  "version": 1,
  "id": "example-game-id",
  "date": "2026-09-12T14:30:00.000Z",
  "players": [{ "name": "Ada", "score": 8 }, { "name": "Sam", "score": 5 }],
  "winner": 0
}
```

Game IDs prevent repeated names or later rounds from overwriting earlier games.
Repeated saves of the same record are harmless. Reads validate stored records,
skip damaged entries with a message, and leave unrelated localStorage data
untouched. Blocked or full storage cannot interrupt the core game; failures
are reported while final scores remain visible. History is not automatically
trimmed. It belongs to this browser and site address and is removed if that
site's browser data is cleared.

`gameStorage.js` owns persistence and validation. `LocalGame.jsx` connects the
optional screens and saving to the existing game. `PlayerSetup.jsx` and
`StatsView.jsx` contain their layouts. `GameScreen` and `useGame` also continue
to work directly without those optional props or any localStorage access.

## Tests

```sh
npm test
```

Component tests mock the camera and MediaPipe to cover frame delivery, error
handling, callback updates, and cleanup. Scoring tests use synthetic landmarks
to check angles, rep transitions, form tiers, and tracking loss. Game tests drive
the real scoring engine with synthetic poses through both turns, results, and
replays; audio tests verify scheduling and cleanup with a mocked AudioContext.
Local-history tests cover named and guest games, optional setup, storage errors,
record validation, and persistence across visits.
To check actual pose accuracy and sound, run `npm run dev`, select **Start Turn**,
allow webcam access, and move with your whole body in view.
