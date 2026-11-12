import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { AttentionDetector, calibrationFrom, DEFAULTS, EVENT_LABELS } from "./core/detector.js";
import { poseSigns, wrapDegrees } from "./core/geometry.js";
import { computeMetrics } from "./core/metrics.js";
import { angleFromPoseMatrix, buildFaceModel, PoseFromLandmarks } from "./core/pose.js";

const byId = (id) => document.getElementById(id);
const video = byId("video");
const overlay = byId("overlay");
const ctx = overlay.getContext("2d");
const settings = { ...DEFAULTS };
const axes = ["pitch", "yaw", "roll"];
const target = (path) => new URL(path, document.baseURI).href;
const format = (value, places = 0) => Number.isFinite(value) ? value.toFixed(places) : "—";

let resources;
let detector = new AttentionDetector();
let geometric;
let engine;
let model;
let audio;
let lastBeep = -Infinity;
let stream;
let objectURL;
let source;
let generation = 0;
let callback = null;
let calibration;
let neutral;
let filtered;
let previousMediaTime;
let lastTimestamp = -Infinity;
let sessionStart;
let lastFrame;
let lastSample;
let lastDisplay;
let lastTracking = false;
let meanFps;
let meanInference;
let samples = [];
let events = [];

const series = [
  { label: "EAR", data: [], borderColor: "#8ee9c3", borderWidth: 2, pointRadius: 0 },
  { label: "MAR", data: [], borderColor: "#f8bf83", borderWidth: 2, pointRadius: 0 },
];
const chart = new window.Chart(byId("chart"), {
  type: "line",
  data: { datasets: series },
  options: {
    animation: false, responsive: true, maintainAspectRatio: false,
    parsing: false, normalized: true,
    plugins: { legend: { labels: { color: "#a0b0b5", usePointStyle: true, boxWidth: 8 } } },
    scales: {
      x: { type: "linear", min: 0, max: 30, grid: { color: "#2a373c" }, ticks: { color: "#a0b0b5", callback: (v) => v + " s" } },
      y: { min: 0, suggestedMax: .55, grid: { color: "#2a373c" }, ticks: { color: "#a0b0b5" } },
    },
  },
});

function showTracking(text, tone = "idle") {
  const element = byId("tracking");
  if (element.textContent !== text) element.textContent = text;
  element.dataset.tone = tone;
}

function showNotice(message = "") {
  const element = byId("notice");
  if (element.textContent !== message) element.textContent = message;
  element.hidden = !message;
}

function initialize() {
  resources ??= (async () => {
    const files = await FilesetResolver.forVisionTasks(target("./wasm"));
    const csv = await fetch(target("./assets/data/canonical_face_model.csv"));
    if (!csv.ok) throw new Error("The canonical face model could not be loaded.");
    model = buildFaceModel((await csv.text()).trim().split(/\r?\n/).map((line) => {
      const [x, y, z] = line.split(",").map(Number);
      return { x, y, z };
    }));
    engine = await FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: target("./assets/models/face_landmarker.task"), delegate: "CPU" },
      runningMode: "VIDEO", numFaces: 1, outputFacialTransformationMatrixes: true,
    });
  })().catch((error) => {
    resources = null;
    throw error;
  });
  return resources;
}

function prepareAudio() {
  if (!byId("sound").checked) return;
  try {
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    audio ??= new AudioContext();
    void audio.resume().catch(() => {});
  } catch { /* Visual alerts still work. */ }
}

function beep() {
  if (!byId("sound").checked || audio?.state !== "running" || performance.now() - lastBeep < 2400) return;
  lastBeep = performance.now();
  const start = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = 760;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(.12, start + .025);
  gain.gain.exponentialRampToValueAtTime(.0001, start + .24);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(start + .25);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
}

function renderMetrics(metrics, status) {
  byId("ear").textContent = format(metrics?.ear, 3);
  byId("mar").textContent = format(metrics?.mar, 3);
  byId("perclos").textContent = status?.valid ? format(status.perclos * 100, 1) + "%" : "—";
  for (const axis of axes) byId(axis).textContent = metrics && Number.isFinite(metrics[axis]) ? format(metrics[axis], 1) + "°" : "—";
  byId("yawns").textContent = detector.yawns;
  byId("blink-count").textContent = detector.blinks + (detector.blinks === 1 ? " blink" : " blinks");
  byId("fps").textContent = format(source ? meanFps : undefined, 1) + " FPS";
  byId("inference").textContent = format(source ? meanInference : undefined, 1) + " ms inference";
}

function cancelCalibration(message = "Look straight ahead with eyes open and mouth relaxed.") {
  calibration = null;
  byId("calibration-info").textContent = message;
  byId("calibrate").textContent = "Calibrate · 10 seconds";
}

function stop(message = "Offline", error = "") {
  generation++;
  source = null;
  lastTracking = false;
  if (callback !== null) {
    if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(callback);
    else cancelAnimationFrame(callback);
    callback = null;
  }
  video.pause();
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
  video.srcObject = null;
  video.removeAttribute("src");
  video.load();
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = null;
  detector.interrupt();
  if (calibration) cancelCalibration("Calibration ended with the session.");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  byId("placeholder").hidden = false;
  byId("stop").disabled = true;
  byId("calibrate").disabled = true;
  showNotice(error);
  showTracking(message, error ? "warn" : "idle");
  renderMetrics(null, null);
}

function clearSession() {
  geometric = new PoseFromLandmarks({ model3D: model });
  detector = new AttentionDetector();
  neutral = null;
  filtered = null;
  previousMediaTime = undefined;
  sessionStart = undefined;
  lastFrame = undefined;
  lastSample = -Infinity;
  lastDisplay = -Infinity;
  meanFps = undefined;
  meanInference = undefined;
  samples = [];
  events = [];
  byId("events").replaceChildren();
  byId("event-count").textContent = "0 EVENTS";
  byId("empty-log").hidden = false;
  byId("export").disabled = true;
  cancelCalibration();
  for (const dataset of series) dataset.data.length = 0;
  chart.options.scales.x.min = 0;
  chart.options.scales.x.max = 30;
  chart.update("none");
  renderMetrics(null, null);
}

async function start(kind, file) {
  stop();
  const id = generation;
  prepareAudio();
  showTracking("Loading model…");
  byId("stop").disabled = false;
  try {
    await initialize();
    if (id !== generation) return;
    if (kind === "camera") {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access needs HTTPS or localhost.");
      const incoming = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false,
      });
      if (id !== generation) {
        for (const track of incoming.getTracks()) track.stop();
        return;
      }
      stream = incoming;
      video.srcObject = stream;
      for (const track of stream.getVideoTracks()) {
        track.addEventListener("ended", () => {
          if (id === generation) stop("Camera disconnected");
        });
      }
    } else if (kind === "file") {
      objectURL = URL.createObjectURL(file);
      video.src = objectURL;
    } else {
      video.src = target("./test_videos/portrait.mp4");
    }

    await video.play();
    if (id !== generation) return;
    source = kind;
    byId("feed-heading").textContent = { camera: "Camera feed", file: "Video playback", sample: "Sample playback" }[kind];
    clearSession();
    byId("placeholder").hidden = true;
    showTracking("Detecting face…");
    schedule();
  } catch (error) {
    if (id !== generation) return;
    const detail = {
      NotAllowedError: "Camera access was declined. Enable it in the browser or open a video.",
      NotFoundError: "No camera found. Open a video or try the sample.",
      NotReadableError: "The camera is unavailable. Close other apps using it and retry.",
      NotSupportedError: "This video could not be played. Try an MP4 or WebM file.",
    }[error.name];
    stop("Could not start", detail ?? (error.message || "Loading failed. Try again."));
  }
}

function smooth(metrics, now) {
  const alpha = !filtered || !settings.smoothing ? 1 : 1 - Math.exp(-(now - filtered.time) / settings.smoothing);
  const values = {};
  for (const [key, value] of Object.entries(metrics)) {
    const prior = filtered?.values[key];
    const delta = value - prior;
    values[key] = Number.isFinite(prior) && Number.isFinite(value)
      ? prior + alpha * (axes.includes(key) ? wrapDegrees(delta) : delta)
      : value;
  }
  filtered = { time: now, values };
  return values;
}

function updateCalibration(raw, time) {
  if (!calibration) return;
  if (raw && axes.every((axis) => Number.isFinite(raw[axis]))) {
    if (time - calibration.last >= 65) {
      calibration.samples.push(raw);
      calibration.last = time;
    }
  }
  const remaining = Math.ceil((calibration.until - time) / 1000);
  if (remaining > 0) {
    byId("calibrate").textContent = `Calibrating · ${remaining} s`;
    return;
  }
  const result = calibration.samples.length >= 60 ? calibrationFrom(calibration.samples) : null;
  if (!result) {
    cancelCalibration("Calibration needs a clear, forward-facing view. Try again.");
    return;
  }
  for (const key of ["earThreshold", "marThreshold"]) {
    settings[key] = result[key];
    byId(key).value = result[key];
  }
  neutral = result.neutral;
  filtered = null;
  detector.interrupt();
  cancelCalibration("Calibration complete. Thresholds and neutral pose updated.");
  logEvent(time, "calibration", "Calibration complete");
}

function logEvent(time, key, label = EVENT_LABELS[key]) {
  const seconds = (time - sessionStart) / 1000;
  events.push({ seconds, key });
  const item = document.createElement("li");
  const stamp = document.createElement("time");
  stamp.textContent = seconds.toFixed(1) + " s";
  item.append(stamp, document.createTextNode(label));
  byId("events").prepend(item);
  if (byId("events").children.length > 100) byId("events").lastElementChild.remove();
  byId("empty-log").hidden = true;
  byId("event-count").textContent = events.length + (events.length === 1 ? " EVENT" : " EVENTS");
}

function plotAndLog(now, metrics, status, cost) {
  if (now - lastSample < 195) return;
  lastSample = now;
  const seconds = (now - sessionStart) / 1000;
  const max = Math.max(30, seconds);
  for (const [index, key] of ["ear", "mar"].entries()) {
    const values = series[index].data;
    values.push({ x: seconds, y: metrics?.[key] ?? null });
    while (values[0]?.x < max - 30) values.shift();
  }
  chart.options.scales.x.min = max - 30;
  chart.options.scales.x.max = max;
  chart.update("none");
  samples.push({
    seconds, source, tracking: Boolean(metrics), metrics, perclos: status.valid ? status.perclos : null,
    cost, fps: meanFps, method: byId("method").value, ...settings,
  });
  byId("export").disabled = false;
}

function draw(landmarks, width, height) {
  if (overlay.width !== width || overlay.height !== height) {
    overlay.width = width;
    overlay.height = height;
  }
  ctx.clearRect(0, 0, width, height);
  if (!landmarks || !byId("mesh").checked) return;
  ctx.fillStyle = "#a0f7cb";
  const size = Math.max(1.5, width / 550);
  for (const p of landmarks.slice(0, 468)) ctx.fillRect(p.x * width, p.y * height, size, size);
}

function schedule() {
  callback = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(frame) : requestAnimationFrame(frame);
}

function frame(browserTime, metadata) {
  callback = null;
  if (!source) return;
  if (video.ended) {
    stop("Playback finished");
    return;
  }
  const mediaTime = metadata?.mediaTime ?? video.currentTime;
  if (video.readyState < 2 || mediaTime === previousMediaTime) {
    schedule();
    return;
  }
  const now = source === "camera" ? browserTime : mediaTime * 1000;
  previousMediaTime = mediaTime;
  sessionStart ??= now;
  const delta = lastFrame === undefined ? 0 : browserTime - lastFrame;
  if (delta > 0 && delta < 1000) meanFps = meanFps === undefined ? 1000 / delta : .9 * meanFps + .1 * 1000 / delta;
  if (delta >= 500) {
    detector.interrupt();
    filtered = null;
    geometric.reset();
  }
  lastFrame = browserTime;
  const started = performance.now();
  const stamp = Math.max(browserTime, lastTimestamp + .001);
  lastTimestamp = stamp;
  let landmarks;
  let matrix;
  try {
    const result = engine.detectForVideo(video, stamp);
    landmarks = result.faceLandmarks[0];
    matrix = result.facialTransformationMatrixes[0]?.data;
  } catch (error) {
    stop("Tracking stopped", error.message || "The detector stopped responding.");
    return;
  }
  const cost = performance.now() - started;
  meanInference = meanInference === undefined ? cost : .9 * meanInference + .1 * cost;
  const { videoWidth: width, videoHeight: height } = video;
  let metrics = null;
  let raw;
  if (landmarks) {
    const facial = computeMetrics(landmarks, { aspect: width / height });
    let pose = matrix ? angleFromPoseMatrix(matrix) : {};
    if (byId("method").value === "geometric") {
      try {
        const fit = geometric.estimate(landmarks, width, height);
        pose = fit.reproj <= Math.max(5, width * .015) ? fit : {};
      } catch {
        geometric.reset();
        pose = {};
      }
    }
    raw = { ear: facial.ear, mar: facial.mar, ...Object.fromEntries(axes.map((axis) => [axis, pose[axis]])) };
    const relative = Object.fromEntries(axes.map((axis) => [axis, wrapDegrees(raw[axis] - (neutral?.[axis] ?? 0))]));
    metrics = smooth({ ear: raw.ear, mar: raw.mar, ...relative }, now);
  } else {
    filtered = null;
    geometric.reset();
  }
  lastTracking = Boolean(landmarks);
  updateCalibration(raw, now);
  const status = detector.update(now, calibration ? null : metrics, settings);
  for (const key of status.events) logEvent(now, key);
  showTracking(landmarks ? (status.alerts.length ? "Attention alert" : "Face tracked") : "Face not found",
    landmarks && !status.alerts.length ? "good" : "warn");
  showNotice(status.alerts.map((key) => EVENT_LABELS[key]).join(" · "));
  if (status.alerts.length) beep();
  draw(landmarks, width, height);
  if (browserTime - lastDisplay >= 95) {
    lastDisplay = browserTime;
    renderMetrics(metrics ? { ...metrics, ...poseSigns(metrics, byId("mirror").checked) } : null, status);
    byId("calibrate").disabled = !lastTracking || Boolean(calibration) || source === "sample";
  }
  plotAndLog(now, metrics, status, cost);
  schedule();
}

byId("camera").addEventListener("click", () => void start("camera"));
byId("sample").addEventListener("click", () => void start("sample"));
byId("file").addEventListener("change", (event) => {
  const [file] = event.target.files;
  event.target.value = "";
  if (file) void start("file", file);
});
byId("stop").addEventListener("click", () => stop());
video.addEventListener("ended", () => { if (source) stop("Playback finished"); });
video.addEventListener("error", () => {
  if (source) stop("Playback failed", "Try a different video file.");
});
window.addEventListener("pagehide", () => stop());
byId("mirror").addEventListener("change", updateMirror);
function updateMirror() { byId("viewport").classList.toggle("mirror", byId("mirror").checked); }
updateMirror();
byId("sound").addEventListener("change", prepareAudio);
byId("mesh").addEventListener("change", () => {
  if (!byId("mesh").checked) ctx.clearRect(0, 0, overlay.width, overlay.height);
});
byId("method").addEventListener("change", () => {
  neutral = null;
  filtered = null;
  detector.interrupt();
  geometric?.reset();
  cancelCalibration("Pose estimator changed. Calibrate to set a new neutral pose.");
});
byId("calibrate").addEventListener("click", () => {
  if (!lastTracking || !source || source === "sample" || calibration) return;
  detector.interrupt();
  calibration = { until: (source === "camera" ? lastFrame : video.currentTime * 1000) + 10_000, samples: [], last: -Infinity };
  byId("calibrate").disabled = true;
  byId("calibrate").textContent = "Calibrating · 10 s";
});
for (const key of Object.keys(DEFAULTS)) {
  byId(key).addEventListener("change", (event) => {
    if (event.target.value && event.target.checkValidity()) {
      settings[key] = Number(event.target.value);
      detector.interrupt();
    } else event.target.value = settings[key];
  });
}
byId("reset-settings").addEventListener("click", () => {
  Object.assign(settings, DEFAULTS);
  for (const [key, value] of Object.entries(DEFAULTS)) byId(key).value = value;
  for (const key of ["mesh", "mirror", "sound"]) byId(key).checked = true;
  byId("method").value = "matrix";
  detector.interrupt();
  geometric?.reset();
  neutral = null;
  filtered = null;
  updateMirror();
  cancelCalibration();
});
byId("export").addEventListener("click", () => {
  const header = "row_type,elapsed_s,source,face_tracked,ear,mar,perclos,pitch_deg,yaw_deg,roll_deg,inference_ms,fps,pose_estimator,ear_threshold,mar_threshold,yaw_limit_deg,smoothing_ms,event";
  const rows = samples.map((s) => [
    "sample", s.seconds.toFixed(3), s.source, Number(s.tracking), s.metrics?.ear, s.metrics?.mar, s.perclos,
    ...axes.map((axis) => s.metrics?.[axis]), s.cost, s.fps, s.method,
    s.earThreshold, s.marThreshold, s.yawThreshold, s.smoothing, "",
  ]);
  for (const event of events) rows.push(["event", event.seconds.toFixed(3), ...Array(15).fill(""), event.key]);
  rows.sort((a, b) => Number(a[1]) - Number(b[1]));
  const csv = [header, ...rows.map((row) => row.map((cell) => cell == null || Number.isNaN(cell) ? "" : cell).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "drowsyguard-session.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
