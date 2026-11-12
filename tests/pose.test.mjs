/**
 * Round-trip tests for the head-pose solver.
 *
 * Strategy: take the canonical MediaPipe face model, place it with a known rotation
 * and translation in front of a synthetic pinhole camera, project the 7 model
 * landmarks with the solver's own forward model, and check that
 * {@link PoseFromLandmarks} recovers the angles. This exercises exactly the maths
 * that runs in the browser.
 *
 * Geometry conventions (see src/core/pose.js):
 *   camera frame: x right, y up, z into the scene; a visible face has t[2] > 0.
 *   image:         normalised coordinates, y down (pixels on screen).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildFaceModel,
  FACE_MODEL_LANDMARKS,
  PoseFromLandmarks,
  projectPoint,
  refinePose,
  orthographicFit,
  orthographicInitialGuess,
  angleFromPoseMatrix,
  poseFromMatrix,
} from "../src/core/pose.js";
import { eulerFromRotation, mul3x3 } from "../src/core/geometry.js";

const csvPath = fileURLToPath(new URL("../assets/data/canonical_face_model.csv", import.meta.url));
const canonical = readFileSync(csvPath, "utf8")
  .trim()
  .split("\n")
  .map((line) => {
    const [x, y, z] = line.split(",").map(Number);
    return { x, y, z };
  });
const MODEL = buildFaceModel(canonical);

/**
 * Rotation from head angles. Positive pitch = looking down, positive yaw = turning to
 * the subject's left, positive roll = tilting to the subject's left shoulder (the
 * convention eulerFromRotation documents).
 */
function anglesToR(pitch, yaw, roll) {
  const d = Math.PI / 180;
  const cx = Math.cos(pitch * d);
  const sx = Math.sin(pitch * d);
  const cy = Math.cos(yaw * d);
  const sy = Math.sin(yaw * d);
  const cz = Math.cos(roll * d);
  const sz = Math.sin(roll * d);
  const Rx = [1, 0, 0, 0, cx, sx, 0, -sx, cx];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul3x3(mul3x3(Ry, Rx), Rz);
}

const W = 1280;
const H = 720;
const CAM = { w: W, h: H, cx: W / 2, cy: H / 2, f: 1.2 * Math.hypot(W, H) };
const SCALE = 0.007; // metres per canonical-model unit (outer eye corners ≈ 6 cm)
const DEPTH = 0.55; // metres

function syntheticLandmarks(pitch, yaw, roll, { t = [0, 0, DEPTH], noisePx = 0, cam = CAM } = {}) {
  const R = anglesToR(pitch, yaw, roll);
  const lm = new Array(468).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
  FACE_MODEL_LANDMARKS.forEach((idx, k) => {
    const p = projectPoint(R, t, MODEL[k], SCALE, cam);
    const jx = noisePx ? (Math.random() - 0.5) * 2 * noisePx : 0;
    const jy = noisePx ? (Math.random() - 0.5) * 2 * noisePx : 0;
    lm[idx] = { x: p.x + jx / cam.w, y: p.y + jy / cam.h, z: 0 };
  });
  return lm;
}

test("face model: 7 points, nose in front of the eye plane, symmetric", () => {
  assert.equal(MODEL.length, 7);
  const nose = MODEL[0];
  const chin = MODEL[1];
  // Model space (see buildFaceModel): x towards the subject's left, y up (forehead),
  // z towards the back of the head, so the nose tip is the most protruding point
  // (largest y is not true for the chin, but z of nose < z of chin and eyes).
  const eyes = [MODEL[3], MODEL[4]];
  const chinZ = chin[2];
  const eyeZ = Math.min(eyes[0][2], eyes[1][2]);
  assert.ok(nose[1] > chin[1], "nose is above the chin");
  assert.ok(nose[2] < Math.max(chinZ, eyeZ), "nose protrudes in front of chin and eyes");
  assert.ok(Math.abs(MODEL[3][0] + MODEL[4][0]) < 1e-9, "eye corners symmetric about x = 0");
});

test("eulerFromRotation inverts yaw * pitch * roll composition", () => {
  const cases = [
    [10, 0, 0],
    [0, 20, 0],
    [0, 0, -15],
    [12, -25, 8],
    [-30, 30, -20],
  ];
  for (const [p, y, r] of cases) {
    const e = eulerFromRotation(anglesToR(p, y, r));
    assert.ok(Math.abs(e.pitch - p) < 1e-6, `pitch ${e.pitch} != ${p}`);
    assert.ok(Math.abs(e.yaw - y) < 1e-6, `yaw ${e.yaw} != ${y}`);
    assert.ok(Math.abs(e.roll - r) < 1e-6, `roll ${e.roll} != ${r}`);
  }
});

test("orthographicFit recovers a fronto-parallel rotation and unbiased scale", () => {
  const pts = MODEL.map(([x, y]) => ({
    x: (CAM.cx + CAM.f * SCALE * x / DEPTH) / W,
    y: (CAM.cy - CAM.f * SCALE * y / DEPTH) / H,
  }));
  const { R, s } = orthographicFit(pts, MODEL, CAM);
  const e = eulerFromRotation(R);
  assert.ok(Math.abs(e.pitch) < 2 && Math.abs(e.yaw) < 2 && Math.abs(e.roll) < 2, JSON.stringify(e));
  const expected = (SCALE * CAM.f) / DEPTH;
  assert.ok(Math.abs(s / expected - 1) < 1e-9, `scale ${s} vs ${expected}`);
});

test("refinePose keeps an exact solution exactly", () => {
  const pts = MODEL.map((P) => projectPoint([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, DEPTH], P, SCALE, CAM));
  const out = refinePose([1, 0, 0, 0, 1, 0, 0, 0, 1], SCALE, [0, 0, DEPTH], pts, MODEL, CAM, 5);
  assert.ok(out.error < 1e-12, `error ${out.error}`);
  const e = eulerFromRotation(out.R);
  assert.ok(Math.abs(e.pitch) < 1e-6 && Math.abs(e.yaw) < 1e-6 && Math.abs(e.roll) < 1e-6);
});

test("refinePose converges in rotation from a badly scaled start", () => {
  const pts = MODEL.map((P) => projectPoint([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, DEPTH], P, SCALE, CAM));
  for (const f of [0.5, 2]) {
    const out = refinePose([1, 0, 0, 0, 1, 0, 0, 0, 1], (SCALE * f * DEPTH) / DEPTH, [0, 0, DEPTH * f], pts, MODEL, CAM, 60);
    const e = eulerFromRotation(out.R);
    assert.ok(Math.abs(e.pitch) < 1 && Math.abs(e.yaw) < 1, `scale x${f}: ${JSON.stringify(e)}`);
    assert.ok(out.error < 1e-3, `scale x${f}: residual ${out.error}`);
  }
});

test("PoseFromLandmarks recovers known poses from clean projections", () => {
  const cases = [
    [0, 0, 0],
    [15, 0, 0],
    [-20, 0, 0],
    [0, 25, 0],
    [0, -25, 0],
    [0, 0, 20],
    [10, -20, 10],
    [25, 30, -15],
    [-15, 5, 30],
    [5, -35, -25],
  ];
  for (const [p, y, r] of cases) {
    const lm = syntheticLandmarks(p, y, r);
    const est = new PoseFromLandmarks({ model3D: MODEL });
    const out = est.estimate(lm, W, H);
    assert.ok(Math.abs(out.pitch - p) < 1.0, `pitch ${out.pitch.toFixed(2)} vs ${p}`);
    assert.ok(Math.abs(out.yaw - y) < 1.0, `yaw ${out.yaw.toFixed(2)} vs ${y}`);
    assert.ok(Math.abs(out.roll - r) < 1.0, `roll ${out.roll.toFixed(2)} vs ${r}`);
    assert.ok(out.reproj < 0.5, `reprojection error ${out.reproj} px`);
  }
});

test("PoseFromLandmarks is stable under 1.5 px landmark jitter", () => {
  const est = new PoseFromLandmarks({ model3D: MODEL });
  const truth = [8, -15, 5];
  const errs = [];
  for (let frame = 0; frame < 90; frame++) {
    const lm = syntheticLandmarks(truth[0], truth[1], truth[2], { noisePx: 1.5 });
    const out = est.estimate(lm, W, H);
    errs.push(Math.abs(out.pitch - truth[0]), Math.abs(out.yaw - truth[1]));
  }
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
  const max = Math.max(...errs);
  assert.ok(mean < 1.0, `mean error ${mean.toFixed(2)} deg`);
  assert.ok(max < 4.0, `max error ${max.toFixed(2)} deg`);
});

test("orthographicInitialGuess places the model near the observed face", () => {
  const pts = MODEL.map((P) => projectPoint([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, DEPTH], P, 0.02, CAM));
  const g = orthographicInitialGuess(pts, MODEL, CAM);
  assert.ok(g.t[2] > 0.1 && g.t[2] < 2, `depth ${g.t[2]}`);
  assert.ok(g.s > 0);
});

test("poseFromMatrix decodes a column-major identity", () => {
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1, 0.2, 0.3, 1];
  const { R, t } = poseFromMatrix(m);
  assert.deepEqual(R, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.deepEqual(t, [0.1, 0.2, 0.3]);
});

test("angleFromPoseMatrix removes native scale and converts camera handedness", () => {
  const yaw = 20 * Math.PI / 180;
  const c = Math.cos(yaw) * 1.2;
  const s = Math.sin(yaw) * 1.2;
  const nativeMatrix = [c, 0, s, 0, 0, 1.2, 0, 0, -s, 0, c, 0, 0, 0, -40, 1];
  const pose = angleFromPoseMatrix(nativeMatrix);
  assert.ok(Math.abs(pose.yaw - 20) < 1e-9);
  assert.equal(Math.abs(pose.pitch), 0);
  assert.equal(Math.abs(pose.roll), 0);
});
