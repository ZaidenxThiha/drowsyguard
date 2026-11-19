# Prompt for the DrowsyGuard midterm presentation

Create a **19-slide, editable, 16:9 presentation in English** for a 15–20 minute undergraduate Computer Vision midterm. Budget 3–4 minutes for the live demo. Use the speaker assignments below and write speaker notes with a time estimate, speaking points, and any handoff for every slide.

The audience is a Computer Vision instructor and classmates. They should be able to explain how facial landmarks become timed alerts, why the team compared two landmark pipelines, and what the experiment measured.

## Project and source material

- **Title:** Face Landmarks and Driver Drowsiness Detection
- **Application:** DrowsyGuard
- **Presenters:** Thiha Aung (523K0073) and Thin Lei Sandi (523K0075)
- **Live demo:** https://zaidenxthiha.github.io/drowsyguard/
- **Source code:** https://github.com/ZaidenxThiha/drowsyguard
- **Report:** `output/docx/DrowsyGuard Midterm Report.docx`
- **Evaluation workbook:** `outputs/01a1cf58-b068-76b1-ad8f-d07f5ccf529a/DrowsyGuard Evaluation.xlsx`
- **Dashboard screenshot:** `docs/dashboard.png`
- Use `README.md`, `src/core/detector.js`, and `src/app.js` for current behavior. Use the report and workbook for background and measured results. If a source file is unavailable, use the facts supplied below. For alert behavior, prefer the current implementation over earlier wording in the report. Cite the papers and datasets you use by author, year, and source link.

## Slide sequence

| Slide | Presenter | Content |
| --- | --- | --- |
| 1 | Sandi | Title, course, both names and student IDs. |
| 2 | Sandi | Motivation and scope. Explain why eye closure, mouth opening and head orientation are observable cues and where they can be ambiguous. |
| 3 | Sandi | What facial landmarks are. Use a labeled face diagram showing eyes, lips, nose, chin and forehead. Explain sparse landmarks and dense face meshes. |
| 4 | Sandi | Landmark schemes and datasets. Introduce 300-W, WFLW, AFLW and 300-VW. Explain that the schemes differ in point count, annotation conventions and evaluation setting. |
| 5 | Sandi | Landmark evaluation. Explain normalized mean error, its normalization denominator and failure rate. Distinguish point error from the face-presence and alert checks used in this project. |
| 6 | Thiha | dlib pipeline. Diagram HOG features → linear SVM frontal face detection → 68-point shape predictor. |
| 7 | Thiha | Ensemble of regression trees. Show a mean shape initialized in the face box, then shape-indexed pixel features and successive coordinate updates. Cite Kazemi and Sullivan. |
| 8 | Thiha | Related methods. Briefly compare ASM/AAM shape constraints, SDM/LBF iterative regression, and CNN heatmaps or direct coordinate regression. |
| 9 | Sandi | MediaPipe pipeline. Explain BlazeFace, the face crop, dense landmarks, and how tracking can reuse the face region across frames. |
| 10 | Sandi | Face Mesh and Attention Mesh. Explain why eyes and lips need precise landmarks. Distinguish the 468-point canonical face surface from the task's 478 outputs, which include 10 iris points. |
| 11 | Sandi | 3D morphable models and pose. Explain mean face plus learned modes, then show how DrowsyGuard fits a fixed template to estimate pose. Cite Blanz and Vetter and use FLAME as a related example. |
| 12 | Thiha | Real-time tracking and method comparison. Compare landmark output, dimensionality, how the tested pipelines handle tracking, and when the detector reruns. Explain the trade-off between smoothing and response time. |
| 13 | Thiha | System design. Diagram webcam or local video → browser inference → landmarks → EAR, MAR and pose → timed rules → dashboard, alerts and CSV. Identify the two head-pose estimators. |
| 14 | Thiha | Alert logic. Show the EAR and MAR formulas, a timeline for sustained closure, and a compact view of calibration, head pose, rolling PERCLOS and alarm behavior. |
| 15 | Both | Live demo. Put the clickable demo link and a few steps on the slide. Put the full run of show in the notes. |
| 16 | Thiha | Benchmark method and latency. Explain the four fixture clips, warm-up handling and timed stages. Chart measured mean processing latency in milliseconds. |
| 17 | Thiha | Coverage and alert checks. Show tracked frames out of 90 by clip. Explain scripted cue validation and why the results do not establish precision or recall on drivers. |
| 18 | Sandi | Limitations, privacy and future work. Cover lighting, eyewear, occlusion, head pose versus gaze, and the need for annotated participant video. |
| 19 | Both | Conclusion and Q&A. Recap what the prototype measures and what was verified. Link to the live demo, repository and references. |

## Implementation facts to use

- DrowsyGuard is a browser-based classroom prototype. MediaPipe Face Landmarker runs locally with the CPU/WASM delegate. The app accepts a webcam or local video and shows a landmark overlay, live metrics, a chart, and an event log with CSV export.
- **EAR** = (distance(p2, p6) + distance(p3, p5)) / (2 × distance(p1, p4)). Compute one value per eye and average the two. **MAR** = distance between the inner lip centers / distance between the inner mouth corners. Convert normalized coordinates to consistent units before measuring distances.
- The default pose estimator decodes MediaPipe's facial transformation matrix. The optional geometric estimator fits seven canonical 3D points to the observed 2D landmarks. It starts with a scaled-orthographic fit and refines the perspective reprojection error. The app estimates head orientation. An eye-only glance may not register as looking away.
- **Calibration** takes 10 seconds of looking straight ahead, with eyes open and mouth relaxed. It estimates median neutral pose and personal EAR and MAR thresholds.
- **Default event rules:** blink when EAR is below 0.20 for 60–399 ms and the eyes reopen; prolonged closure at 1.25 s below the EAR threshold; yawn counted once when MAR reaches 0.32 for 1 s; looking away at 18° for 1 s in a sideways, upward or upward-diagonal direction; head down at 22° downward pitch for 1 s. The default look-away alert clears once the deviation drops below 15°.
- **PERCLOS** is the share of valid observed time classified as eye closure in a rolling 30-second window. The high indicator uses a 20% threshold after at least 15 seconds of valid observations. It can stay highlighted silently after the eyes reopen.
- **Alarm** beeps every 0.75 s during prolonged eye closure, looking away, or head down. When all active warning conditions clear, the beep stops on the first tracked frame showing recovery, even if the displayed values are still smoothing. A yawn is counted and logged.

## Measured results

Use the figures below as recorded. Label coverage as **frames with a detected face**. Latency is processing time, excluding video decoding, model loading and UI rendering.

| Fixture | MediaPipe detected / 90 | dlib detected / 90 | MediaPipe mean ms | dlib mean ms |
| --- | ---: | ---: | ---: | ---: |
| Portrait | 89 | 90 | 9.6 | 11.3 |
| Low light | 89 | 90 | 10.0 | 8.3 |
| Eye occlusion | 89 | 0 | 9.8 | 5.5 |
| No face | 0 | 0 | 2.8 | 5.5 |

The benchmark ran on Apple M4. Each fixture is 320 × 320 at 15 fps with 90 frames. The first five frames of each run are excluded from latency averages and included in coverage. The face-positive fixtures use variations of one portrait. MediaPipe runs in headless Chrome in video mode with transformation matrices enabled. dlib times grayscale conversion, HOG detection on each frame, and 68-point prediction when a face is found. Interpret time on missed detections accordingly. In particular, dlib's occlusion timing excludes landmark fitting because it found no face. Face coverage does not measure whether the landmarks were correct.

All 18 scripted alert sequences matched their expected events, and 34 automated unit tests passed. Explain what the scripted inputs exercise, including short blinks, sustained closure, yawn counting, upward and diagonal turns, head down, and tracking interruptions. These checks do not measure real-world drowsiness accuracy, sensitivity, specificity or precision/recall. Use “mean processing latency” on the chart. Any throughput estimate computed as 1,000 / mean milliseconds must be labeled as theoretical, since it is not observed live FPS.

## Live demo notes

1. Open the live URL on the presentation computer, allow the camera, and leave **Sound alerts** enabled.
2. Show the landmark overlay. Calibrate while facing forward, with eyes open and mouth relaxed. Use those 10 seconds to explain EAR, MAR and neutral pose.
3. Blink normally. Then close the eyes long enough to trigger the alarm and reopen them to show that the sound stops automatically.
4. Simulate a yawn and point out the counter. Turn sideways or diagonally upward for about one second, then face forward to demonstrate the look-away alert and automatic silence.
5. Show the chart, session events and **Export session CSV**. If camera access fails, use **Try sample** or the dashboard screenshot to explain the interface. The sample is a tracking fixture and contains no intentional alert sequence.

## Slide design and notes

Use a clean academic design with a light background, dark text and a teal accent drawn from the app. Keep slide text short and move explanations into speaker notes. Use the real dashboard screenshot for the application and clearly label any schematic diagrams. Draw a simple face landmark diagram, a detector flow, and an alert timeline. Use editable charts with units and legends. Include source notes on relevant slides and full references in the final notes or an optional untimed appendix.

Include answers in the notes for likely questions about why EAR needs calibration, why 468 and 478 both appear, why low dlib latency can coincide with no detections, why the alarm stops before the chart settles, and what an annotated video study would be needed to validate.
