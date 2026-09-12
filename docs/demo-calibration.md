# Recorded demo calibration

The two demo profiles were calibrated against the eight local recordings in
`demo_videos/`. This is a replay of the **same recordings used to choose the
thresholds**, not validation on unseen people, recordings, or camera setups.
The checked-in fixture makes that replay reproducible without a webcam, the
original movies, a browser, or another MediaPipe inference run.

Run the recorded regression suite with:

```sh
npm test -- src/demoCalibration.test.js
```

## Capture and independent labels

`docs/demo-video-labels.json` preserves the independent visual annotations:
AVFoundation contact sheets at half-second timestamps, supported by overview
sheets. Their counts were established from the videos, not from the counter's
output. Event times are approximate within about 0.5 seconds. “Completed
attempts” includes visible rises whose descents began before recording; the
separate fully visible count excludes those partial cycles.

Landmarks were extracted on 2026-09-12 in Chrome from the original local MOVs,
using the locally served `@mediapipe/tasks-vision@0.10.21`, CPU delegate,
`runningMode: 'VIDEO'`, `numPoses: 1`, and no segmentation masks. Each clip used
a fresh Pose Landmarker. The extraction sought the video sequentially to
`i / 30` seconds and called `detectForVideo(video, i / 30 * 1000)` after each
seek. Sampling stopped before the final 40 milliseconds, matching the capture
helper's loop. Missing detections remained empty arrays. Model assets and videos
were served locally; there was no remote inference service.

The model is Pose Landmarker Lite, float16, version 1, stored at
`public/models/pose_landmarker_lite.task`. Its SHA-256 is:

```text
59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a
```

The compressed fixture, `src/test-fixtures/demo-landmarks.json.gz`, contains
9,725 capture frames across all eight full clips, including 190 frames with no
detected pose. It is 1,317,767 bytes compressed (3,582,932 bytes of JSON). It keeps
the original capture timestamps and video dimensions, plus landmarks
11/12/13/14/15/16/23/24/25/26: both shoulders, elbows, wrists, hips, and knees.
Each retained point stores x, y, z, and visibility rounded to six decimals.
World landmarks and unused joints are omitted. Per-clip SHA-256 values identify
the complete source capture JSON before packing. Chrome's reported movie
durations can differ slightly from the AVFoundation annotation durations.

The archive format is documented in its own metadata: each frame is
`[timestampMilliseconds, coordinates]`; coordinates contain four values per
joint in `landmarkIndices` order, or an empty array for no detection. Node's
`fs` and `zlib` decode the archive only in the test file. Application code never
imports the fixture or movie labels, and filenames never determine runtime
ratings.

## Counter and score

The runtime uses each person's profile in `src/calibrationProfiles.js`. Player
slot 1 uses Justin's profile and slot 2 uses Octavio's, independently of the
optional display names. Justin's reliable camera-facing side is left; Octavio's
is right. The other side can be selected when the preferred side is unavailable,
but a cycle locks its chosen side to avoid mixing different joint trajectories.

Angles use the image plane with y scaled by `height / width`; inferred z is
excluded from this side-view calibration. This avoids hardcoded pixel positions
or body heights. Uniform image/body scale and translation cancel in the angles.
Perspective, camera direction, occlusion, and pose-estimation errors still
matter.

A turn first needs an observed top for 100 ms, then at least 12 degrees of elbow
descent, then a stable return for 100 ms. The minimum cycle duration is 450 ms;
an unfinished cycle times out after 8 seconds. EMA smoothing uses a 65 ms time
constant and real video timestamps. Repeated capture timestamps do not advance
the counter. Long tracking gaps require a new top, and a floor-posture gate
cancels standing/get-up movements. Full elbow excursion retains the top peak
from the last second, even while the top timestamp is refreshed. A long top
pause cannot contribute an old peak or consume the next rep's time limit.

The form features are elbow travel and the maximum smoothed signed body bend
during the attempt. Hip position below the shoulder–knee line is positive
**sag**; above the line is **pike**. Direction was essential: absolute bend alone
overlapped between Octavio's Perfect and Okay recordings, despite visibly
different sagging motion. Both directions can reduce the alignment score.

The piecewise knots below map a measurement in degrees to a component score
from 0 to 100. Values interpolate linearly between knots and clamp at the ends.
These are personalized demo thresholds, not clinical standards.

| Component | Justin `(degrees, score)` | Octavio `(degrees, score)` |
| --- | --- | --- |
| Elbow travel | (0,0), (18,10), (50,49), (102,70), (112,100) | (0,0), (18,10), (65,49), (97,70), (106,100) |
| Maximum sag | (0,100), (11,100), (22,49), (38,25), (50,0) | (0,100), (7,100), (10,49), (24,25), (40,0) |
| Maximum pike | (0,100), (20,100), (35,49), (45,25), (55,0) | Same as Justin |

Alignment is the lower of the sag and pike scores. The combined score is
`sqrt(travelScore * alignmentScore)`: X below 50, Okay from 50 to below 70,
Good from 70 to below 95, and Perfect from 95. A minimum travel floor also applies:
50 degrees for Justin and 65 for Octavio. These sit below the shallowest
accepted reference cycles (about 61 and 77 degrees respectively). Below the
floor, the combined score is capped at 49 so a tiny arm bend cannot qualify
solely through a straight body. The three accepted tiers match the recorded
categories and increment rep count and the player's goal progress, awarding
1/2/4 points for Okay/Good/Perfect respectively.
An X event provides feedback but adds neither a rep nor points.

## Replay results

The entire recording is replayed, including pauses, setup, tracking loss, and
standing. The test's accepted-count expectations come from the independent
visual counts, adjusted only for missing initial descents.

| Recording | Visible rises / fully observed cycles | Accepted at 30 fps | Form results |
| --- | --- | --- | --- |
| `justin_perfect.mov` | 11 / 11 | 11 | 11 Perfect |
| `justin_good.mov` | 10 / 9 | 9 | 9 Good |
| `justin_ok.mov` | 10 / 9 | 9 | 8 Okay, 1 Good |
| `justin_X.mov` | 11 deliberate invalid movements | 0 | All detected attempts X |
| `octavio_perfect.mov` | 10 / 9 | 9 | 9 Perfect |
| `octavio_good.mov` | 11 / 11 | 11 | 11 Good |
| `octavio_ok.mov` | 8 / 7 | 7 | 7 Okay |
| `octavio_X.mov` | 10 deliberate invalid movements | 0 | All detected attempts X |

Justin's Okay cycle around 24.3–25.5 seconds is visually straighter than the
surrounding sagging attempts. It scores Good rather than being forced into the
filename's category. Initial partial cycles in Justin Good/Okay and Octavio
Perfect/Okay are ignored until an observed top; that is deliberate startup
behavior, not an overlooked full rep.

The X clips contain both near-straight-arm body dips and raised-hip elbow
movements. An elbow-based counter is not required to produce one rejected event
per visible hip dip. Its required outcome here is zero accepted reps and zero
points. Rejected feedback counts therefore are not used as manual rep-count
ground truth.

All eight accepted counts also remain correct when every second cached frame
is replayed at 15 fps. That does not mean every detail is sampling-invariant:
Justin Good produces two additional rejected events, Octavio X produces one,
and one Justin Okay rep moves from a score of about 69.4 to 70.2, crossing into
Good. The suite asserts stable accepted counts at 15 fps without requiring the
same rejected-event sequence or borderline tiers. Repeating the exact same
capture timestamp, in contrast, must preserve the full 30 fps history exactly.

Additional tests replay annotated non-rep intervals independently, verify no
attempts during Justin's extended top-plank hold, and check that each accepted
event follows its corresponding visually annotated bottom. Annotation boundaries
are trimmed by 0.5 seconds for isolated negative-window checks.

## Limits and next check

This suite proves regression behavior on these captures, not general accuracy.
Octavio's measured Perfect maximum sag reaches about 6.8 degrees while the
smallest Okay sag is about 10 degrees: that narrow margin is sensitive to camera
angle, framing, and landmark noise. Use the same side-on demo setup and verify a
fresh mixed recording before claiming unseen-video performance. The background
person in Octavio Good did not add accepted reps in this cached replay; that
does not establish robust multi-person identity tracking.

The scoring and goal tests changed because the user explicitly changed the
counting and outcome rules: rejected X attempts no longer count as reps, each
player has a goal, and goal completion takes priority over points. This work is
therefore a scoring/gameplay change with presentation updates, not merely a UI
restyle. Recorded tests preserve an independent count reference while documenting
the limits of the personalized calibration.
