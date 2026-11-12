/**
 * Head pose estimation for DrowsyGuard.
 *
 * Two independent estimators are provided because the report compares them:
 *
 *  1. {@link poseFromMatrix} — decodes MediaPipe's 4x4 facial transformation matrix.
 *     Free (the face-model mesh already produces it) but it comes from the landmark
 *     model's internal fitting and its accuracy is not documented for vehicle use.
 *
 *  2. {@link PoseFromLandmarks} — an independent geometric fit on 7 landmarks against
 *     the canonical 3D face model, in the spirit of solvePnP:
 *        a) solve the scaled-orthographic (weak-perspective) problem for the leading
 *           rotation rows ({@link orthographicFit});
 *        b) make depth consistent with human head size, keeping the observed apparent
 *           size ({@link orthographicInitialGuess});
 *        c) refine with Levenberg-Marquardt on the perspective reprojection error
 *           ({@link refinePose}).
 *
 * Conventions
 *   - Camera: origin at the optical centre, +X right, +Y up, +Z into the scene; a
 *     visible face therefore has translation z > 0.
 *   - Image: normalised coordinates x, y in [0, 1], y pointing DOWN (screen convention).
 *   - Face model: x towards the subject's left, y up (forehead), z into the face.
 *   - Angles are in degrees, composed as R = Ry(yaw) Rx(-pitch) Rz(roll):
 *       pitch > 0  looking down (nodding)
 *       yaw   > 0  looking left in the unmirrored image
 *       roll  > 0  counterclockwise in the unmirrored image
 *     Mirroring the preview reverses yaw and roll.
 */
import { eulerFromRotation, cross3, dot3, normalize3, clamp } from "./geometry.js";
import { solveSPD, solveSPDRefined, allFinite } from "./solve.js";
import { LANDMARKS } from "./landmarks.js";

/** Landmark indices used by the geometric fit (7 points spread over the whole face). */
export const FACE_MODEL_LANDMARKS = Object.freeze([
  LANDMARKS.pose.noseTip, // 1
  LANDMARKS.pose.chin, // 152
  LANDMARKS.pose.forehead, // 10
  LANDMARKS.pose.leftEyeOuter, // 263
  LANDMARKS.pose.rightEyeOuter, // 33
  LANDMARKS.pose.mouthLeft, // 61
  LANDMARKS.pose.mouthRight, // 291
]);

/**
 * Typical adult inter-ocular distance. Used only to pick a physically plausible
 * depth: with 7 near-coplanar points the scale and depth are nearly unobservable
 * (a bigger face further away projects identically), so one prior on face size is
 * required. The rotation estimate does not depend on it.
 */
export const INTER_OCULAR_M = 0.063;

/** Plausible distance of a driver's face from the dashboard camera (metres). */
const POSE_DEPTH_RANGE = Object.freeze({ min: 0.2, max: 1.5 });

/**
 * Converts MediaPipe canonical vertices (x right, y up, z toward the viewer)
 * to the solver frame by reversing Z.
 *
 * @param {Array<{x:number,y:number,z:number}>} canonical 468 canonical vertices
 * @returns {number[][]} the 7 model points, in canonical-mesh units
 */
export function buildFaceModel(canonical) {
  const convert = (p) => [p.x, p.y, -p.z];
  return FACE_MODEL_LANDMARKS.map((i) => convert(canonical[i]));
}

/**
 * Decodes MediaPipe's column-major 4x4 facial transformation matrix.
 *
 * @param {number[]} m 16 values (column-major)
 * @returns {{R:number[], t:number[]}} row-major 3x3 rotation, 3 translation values
 */
export function poseFromMatrix(m) {
  const at = (row, col) => m[col * 4 + row];
  return {
    R: [at(0, 0), at(0, 1), at(0, 2), at(1, 0), at(1, 1), at(1, 2), at(2, 0), at(2, 1), at(2, 2)],
    t: [at(0, 3), at(1, 3), at(2, 3)],
  };
}

/** Euler angles (deg) from MediaPipe's facial transformation matrix. */
export function angleFromPoseMatrix(m) {
  const R = poseFromMatrix(m).R;
  // MediaPipe's camera looks down -Z. Reflect both coordinate frames and
  // remove the uniform scale of the fitted similarity transform.
  const scale = Math.hypot(R[0], R[3], R[6]);
  return eulerFromRotation([R[0], R[1], -R[2], R[3], R[4], -R[5], -R[6], -R[7], R[8]]
    .map((value) => value / scale));
}

/**
 * Rodrigues' formula: axis-angle vector -> 3x3 rotation (row-major).
 *
 * @param {number[]} w
 * @returns {number[]}
 */
export function rodrigues(w) {
  const theta = Math.hypot(w[0], w[1], w[2]);
  if (theta < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const kx = w[0] / theta;
  const ky = w[1] / theta;
  const kz = w[2] / theta;
  const c = Math.cos(theta);
  const sn = Math.sin(theta);
  const v = 1 - c;
  return [
    c + kx * kx * v,
    kx * ky * v - kz * sn,
    kx * kz * v + ky * sn,
    ky * kx * v + kz * sn,
    c + ky * ky * v,
    ky * kz * v - kx * sn,
    kz * kx * v - ky * sn,
    kz * ky * v + kx * sn,
    c + kz * kz * v,
  ];
}

/** 3x3 matrix product (row-major). */
export function mm3(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}

/**
 * Projects a model point into normalised image coordinates (x right, y down).
 *
 * @param {number[]} R model -> camera rotation (row-major)
 * @param {number[]} t model origin in camera coordinates
 * @param {number[]} P model point
 * @param {number} s uniform model scale
 * @param {{w:number,h:number,cx:number,cy:number,f:number}} cam
 * @returns {{x:number,y:number}}
 */
export function projectPoint(R, t, P, s, cam) {
  const X = s * (R[0] * P[0] + R[1] * P[1] + R[2] * P[2]) + t[0];
  const Y = s * (R[3] * P[0] + R[4] * P[1] + R[5] * P[2]) + t[1];
  const Z = Math.max(s * (R[6] * P[0] + R[7] * P[1] + R[8] * P[2]) + t[2], 1e-9);
  // Camera y is up; image y is down.
  return { x: (cam.f * (X / Z) + cam.cx) / cam.w, y: (cam.cy - (cam.f * Y) / Z) / cam.h };
}

/**
 * Solves the scaled-orthographic pose problem (the pose part of a weak-perspective
 * solvePnP).
 *
 * The unknown rotation is written as the two leading rows of the 3x3 matrix R:
 * row1 . P is the image x of model point P and row2 . P its image y. Each
 * correspondence contributes u = s r1.P and v = s r2.P about the centroid, giving a
 * 6x6 normal system. The face is nearly planar, so the system is mildly
 * ill-conditioned and is solved with Cholesky plus iterative refinement.
 *
 * Normalised coordinates are converted to pixels before fitting.
 *
 * @param {Array<{x:number,y:number}>} image2D normalised points, y down
 * @param {number[][]} model3D model points (any consistent unit)
 * @param {{w:number,h:number,cx:number,cy:number,f:number}} cam
 * @returns {{R:number[], s:number, centroidU:number[], centroidP:number[]}}
 *   rotation (model -> camera, row-major) and apparent scale (px / model unit)
 */
export function orthographicFit(image2D, model3D, cam) {
  const im = image2D.map((p) => ({
    u: cam.w * p.x - cam.cx,
    v: cam.cy - cam.h * p.y, // flip to the camera frame (y up)
  }));
  const n = model3D.length;
  const cP = [0, 1, 2].map((k) => model3D.reduce((a, p) => a + p[k] / n, 0));
  const cU = im.reduce((a, q) => [a[0] + q.u / n, a[1] + q.v / n], [0, 0]);

  const A = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const b = new Array(6).fill(0);
  for (let i = 0; i < n; i++) {
    const p = [model3D[i][0] - cP[0], model3D[i][1] - cP[1], model3D[i][2] - cP[2]];
    const du = im[i].u - cU[0];
    const dv = im[i].v - cU[1];
    for (let a = 0; a < 3; a++) {
      b[a] += p[a] * du;
      b[a + 3] += p[a] * dv;
      for (let c = 0; c < 3; c++) {
        const cc = p[a] * p[c];
        A[a][c] += cc;
        A[a + 3][c + 3] += cc;
      }
    }
  }
  const x = solveSPDRefined(A, b, 0);

  // Orthogonalise the two rows (Gram-Schmidt). Under perspective their norms can
  // differ slightly; each normalised row is still a valid direction, and the scale is
  // estimated independently below, so no length bias leaks into the rotation.
  const row1 = normalize3(x.slice(0, 3));
  const r2 = x.slice(3, 6);
  const proj = dot3(r2, row1);
  const row2 = normalize3([r2[0] - proj * row1[0], r2[1] - proj * row1[1], r2[2] - proj * row1[2]]);
  const row3 = cross3(row1, row2);
  const R = [...row1, ...row2, ...row3];

  // Uniform scale from the apparent size about the centroid:
  //   s = |u - Uc| / |(r1 . P, r2 . P)|   (least squares over all correspondences)
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const q = [im[i].u - cU[0], im[i].v - cU[1]];
    const p = [model3D[i][0] - cP[0], model3D[i][1] - cP[1], model3D[i][2] - cP[2]];
    const u = dot3(p, row1);
    const v = dot3(p, row2);
    num += q[0] * q[0] + q[1] * q[1];
    den += u * u + v * v;
  }
  const valid = den > 1e-30 && Number.isFinite(num) && Number.isFinite(den);
  const s = Math.max(valid ? Math.sqrt(num / den) : 1, 1e-12);
  return { R, s, centroidU: cU, centroidP: cP };
}

/**
 * Orthographic initial guess for the perspective solver.
 *
 * The fit gives rotation and apparent size but not depth (scale x depth is almost
 * unobservable). Depth is chosen the way a human would: the face is a human face, so
 * its inter-ocular distance is about {@link INTER_OCULAR_M}; the apparent size then
 * fixes the distance, and the scale follows. Both are clamped to a plausible range so
 * that an extreme head pose (which inflates the apparent size) cannot explode the
 * initial guess.
 *
 * @param {Array<{x:number,y:number}>} image2D normalised points, y down
 * @param {number[][]} model3D model points (canonical-mesh units)
 * @param {{w:number,h:number,cx:number,cy:number,f:number}} cam
 * @returns {{R:number[], t:number[], s:number}} scale is in metres per model unit
 */
export function orthographicInitialGuess(image2D, model3D, cam, interOcularM = INTER_OCULAR_M) {
  const { R, s: apparentScale, centroidP, centroidU } = orthographicFit(image2D, model3D, cam);

  // Apparent size in physical units: at depth Z a model length L spans f L s / Z px.
  const li = FACE_MODEL_LANDMARKS.indexOf(LANDMARKS.pose.leftEyeOuter);
  const ri = FACE_MODEL_LANDMARKS.indexOf(LANDMARKS.pose.rightEyeOuter);
  const iodModel = Math.hypot(
    model3D[li][0] - model3D[ri][0],
    model3D[li][1] - model3D[ri][1],
    model3D[li][2] - model3D[ri][2],
  );
  const impliedDepth = cam.f * interOcularM / (iodModel * apparentScale);
  const Z = clamp(Number.isFinite(impliedDepth) ? impliedDepth : 0.6, POSE_DEPTH_RANGE.min, POSE_DEPTH_RANGE.max);
  const sMetric = apparentScale * Z / cam.f;
  const mp = [0, 3, 6].map((row) => dot3(R.slice(row, row + 3), centroidP));
  const t = [
    centroidU[0] * Z / cam.f - sMetric * mp[0],
    centroidU[1] * Z / cam.f - sMetric * mp[1],
    Z - sMetric * mp[2],
  ];
  return { R, t, s: sMetric };
}

/**
 * Depth for a face whose model-space length spans `pixelSize` pixels:
 * s * modelSize / Z = pixelSize / f  =>  Z = f * modelSize / pixelSize.
 *
 * @param {number} modelSize metres
 * @param {number} pixelSize pixels
 * @param {number} f focal length (pixels; use an isotropic focal length for isotropic pixels)
 * @returns {number} depth (0 if degenerate)
 */
export function depthFromApparentSize(modelSize, pixelSize, f) {
  if (!(modelSize > 0) || !(pixelSize > 0)) return 0;
  return (f * modelSize) / pixelSize;
}

/**
 * Levenberg-Marquardt refinement of {R, t} at a fixed model scale on the perspective reprojection error.
 *
 * Residuals are measured in pixels (y down), which keeps every derivative well
 * conditioned. The damping is relative to each normal-equation diagonal, because the
 * state variables are of wildly different units (radians vs pixels).
 *
 * @param {number[]} R initial rotation (model -> camera)
 * @param {number} s initial scale (metres per model unit)
 * @param {number[]} t initial translation
 * @param {Array<{x:number,y:number}>} image2D observed points (normalised, y down)
 * @param {number[][]} model3D
 * @param {{w:number,h:number,cx:number,cy:number,f:number}} cam
 * @param {number} [iterations=12]
 * @returns {{R:number[], s:number, t:number[], error:number}}
 *   `error` is the RMS reprojection error in pixels
 */
export function refinePose(R, s, t, image2D, model3D, cam, iterations = 12) {
  const n = model3D.length;
  const obs = image2D.map((p) => ({ x: p.x * cam.w, y: p.y * cam.h }));
  const residuals = (Rr, ss, tt) => {
    const r = [];
    for (let i = 0; i < n; i++) {
      const p = projectPoint(Rr, tt, model3D[i], ss, cam);
      r.push(p.x * cam.w - obs[i].x, p.y * cam.h - obs[i].y);
    }
    return r;
  };

  let Rc = R.slice();
  let tc = t.slice();
  let r = residuals(Rc, s, tc);
  let cost = r.reduce((a, v) => a + v * v, 0);
  const h = 1e-7;

  let lambda = 1e-4;
  for (let it = 0; it < iterations && cost >= 1e-12; it++) {
    // Jacobian w.r.t. [rotation(3), translation(3)] by finite differences.
    const J = Array.from({ length: 6 }, () => new Array(2 * n).fill(0));
    for (let k = 0; k < 6; k++) {
      const w = [0, 0, 0];
      const t2 = tc.slice();
      if (k < 3) w[k] = h;
      else t2[k - 3] += h;
      const R2 = k < 3 ? mm3(rodrigues(w), Rc) : Rc;
      const r2 = residuals(R2, s, t2);
      for (let i = 0; i < 2 * n; i++) J[k][i] = (r2[i] - r[i]) / h;
    }
    const JTJ = Array.from({ length: 6 }, () => new Array(6).fill(0));
    const JTr = new Array(6).fill(0);
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        let acc = 0;
        for (let i = 0; i < 2 * n; i++) acc += J[a][i] * J[b][i];
        JTJ[a][b] = acc;
      }
      let acc = 0;
      for (let i = 0; i < 2 * n; i++) acc += J[a][i] * r[i];
      JTr[a] = acc;
    }

    const diag = JTJ.map((row, i) => Math.max(row[i], 1e-12));
    let accepted = false;
    for (let attempt = 0; attempt < 14 && !accepted; attempt++) {
      const A = JTJ.map((row, i) => row.map((v, j) => (i === j ? v + lambda * diag[i] : v)));
      let d;
      try {
        d = solveSPD(A, JTr.map((v) => -v));
      } catch {
        lambda *= 10;
        continue;
      }
      if (!allFinite(d)) {
        lambda *= 10;
        continue;
      }
      const R2 = mm3(rodrigues([d[0], d[1], d[2]]), Rc);
      const t2 = [tc[0] + d[3], tc[1] + d[4], tc[2] + d[5]];
      if (!(t2[2] > 1e-6)) {
        lambda *= 10;
        continue;
      }
      const r2 = residuals(R2, s, t2);
      const c2 = r2.reduce((a, v) => a + v * v, 0);
      if (Number.isFinite(c2) && c2 < cost) {
        Rc = R2;
        tc = t2;
        r = r2;
        cost = c2;
        accepted = true;
        lambda = Math.max(lambda / 3, 1e-9);
      } else {
        lambda *= 10;
      }
    }
    if (!accepted || cost < 1e-12) break;
  }
  return { R: Rc, s, t: tc, error: Math.sqrt(cost / n) };
}

/**
 * Landmark-based head pose estimator. Stateful: it warm-starts from the previous
 * frame, which saves iterations and damps frame-to-frame jitter.
 */
export class PoseFromLandmarks {
  /**
   * @param {object} opts
   * @param {number[][]} opts.model3D model points from {@link buildFaceModel}
   * @param {number} [opts.interOcularM] real inter-ocular distance in metres
   */
  constructor({ model3D, interOcularM = INTER_OCULAR_M }) {
    this.model3D = model3D;
    this.interOcularM = interOcularM;
    this.prev = null;
    this.prevError = Infinity;
  }

  /**
   * @param {Array<{x:number,y:number,z:number}>} lm normalised landmarks, y down
   * @param {number} width frame width (px)
   * @param {number} height frame height (px)
   * @param {{cx?:number, cy?:number, f?:number}} [intrinsics] optional overrides (px)
   * @returns {{pitch:number, yaw:number, roll:number, R:number[], t:number[],
   *   scale:number, reproj:number, source:string}} reproj is RMS error in pixels
   */
  estimate(lm, width, height, intrinsics = {}) {
    const cam = {
      w: width,
      h: height,
      cx: intrinsics.cx ?? width / 2,
      cy: intrinsics.cy ?? height / 2,
      f: intrinsics.f ?? 1.2 * Math.hypot(width, height),
    };
    const pts2D = FACE_MODEL_LANDMARKS.map((i) => ({ x: lm[i].x, y: lm[i].y }));

    let start;
    let source;
    if (this.prev && this.prevError < 3) {
      start = this.prev;
      source = "warm-start";
    } else {
      start = orthographicInitialGuess(pts2D, this.model3D, cam, this.interOcularM);
      source = "orthographic";
    }
    const refined = refinePose(start.R, start.s, start.t, pts2D, this.model3D, cam, source === "warm-start" ? 5 : 15);

    // Reject a collapsed fit that is worse than the fresh initial guess.
    let best = refined;
    if (source === "warm-start" && refined.error > this.prevError * 2 + 2) {
      const fresh = orthographicInitialGuess(pts2D, this.model3D, cam, this.interOcularM);
      const again = refinePose(fresh.R, fresh.s, fresh.t, pts2D, this.model3D, cam, 15);
      if (again.error < refined.error) {
        best = again;
        source = "orthographic";
      }
    }
    this.prev = { R: best.R, s: best.s, t: best.t };
    this.prevError = best.error;
    const euler = eulerFromRotation(best.R);
    return {
      ...euler,
      R: best.R,
      t: best.t,
      scale: best.s,
      reproj: best.error,
      source,
    };
  }

  reset() {
    this.prev = null;
    this.prevError = Infinity;
  }
}
