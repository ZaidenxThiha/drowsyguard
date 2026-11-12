/**
 * Per-frame facial metrics: EAR, MAR and mouth openness ratio.
 *
 * References
 *  - Soukupová & Čech (2016), "Real-Time Eye Blink Detection using Facial Landmarks":
 *      EAR = (||p2-p6|| + ||p3-p5||) / (2 ||p1-p4||)
 *    with p1 = outer corner, p2/p3 = upper lid points, p4 = inner corner,
 *    p5/p6 = lower lid points.
 */
import { LANDMARKS } from "./landmarks.js";
import { distance, distance2D } from "./geometry.js";

/**
 * Eye Aspect Ratio for one eye.
 *
 * @param {Array<{x:number,y:number,z?:number}>} lm normalised landmarks
 * @param {{outer:number, top1:number, top2:number, inner:number, bottom1:number, bottom2:number}} eye
 * @param {{metric3D?: boolean}} [opts] use MediaPipe's z coordinate (mesh-relative depth)
 * @returns {number} EAR, dimensionless (open eyes are roughly 0.2–0.35)
 */
export function eyeAspectRatio(lm, eye, opts = {}) {
  const p1 = lm[eye.outer];
  const p2 = lm[eye.top1];
  const p3 = lm[eye.top2];
  const p4 = lm[eye.inner];
  const p5 = lm[eye.bottom1];
  const p6 = lm[eye.bottom2];
  const dist = opts.metric3D ? distance : distance2D;
  const horizontal = dist(p1, p4);
  if (horizontal < 1e-9) return 0;
  return (dist(p2, p6) + dist(p3, p5)) / (2 * horizontal);
}

/**
 * Both eyes' EAR plus the mean.
 *
 * @param {Array} lm
 * @param {{metric3D?: boolean}} [opts]
 * @returns {{left:number, right:number, mean:number}}
 */
export function eyeMetrics(lm, opts = {}) {
  const right = eyeAspectRatio(lm, LANDMARKS.rightEye, opts);
  const left = eyeAspectRatio(lm, LANDMARKS.leftEye, opts);
  return { left, right, mean: (left + right) / 2 };
}

/**
 * Inner lip opening divided by the distance between the inner mouth corners.
 *
 * @param {Array} lm
 * @param {{metric3D?: boolean}} [opts]
 * @returns {number}
 */
export function mouthAspectRatio(lm, opts = {}) {
  const m = LANDMARKS.mouth;
  const dist = opts.metric3D ? distance : distance2D;
  const width = dist(lm[m.innerLeft], lm[m.innerRight]);
  if (width < 1e-9) return 0;
  return dist(lm[m.innerTop], lm[m.innerBottom]) / width;
}

/**
 * Jaw opening measured between the inner lips, normalised by the
 * inter-ocular distance (a roughly rigid scale reference for pose changes).
 *
 * @param {Array} lm
 * @returns {number}
 */
export function mouthOpenRatio(lm) {
  const m = LANDMARKS.mouth;
  const e = LANDMARKS.pose;
  const iod = distance2D(lm[e.rightEyeOuter], lm[e.leftEyeOuter]);
  if (iod < 1e-9) return 0;
  return distance2D(lm[m.innerTop], lm[m.innerBottom]) / iod;
}

/**
 * Computes all per-frame metrics from one frame of landmarks.
 *
 * @param {Array<{x:number,y:number,z:number}>} lm
 * @param {{metric3D?: boolean}} [opts]
 * @returns {{ear:number, earLeft:number, earRight:number, mar:number, mouthOpen:number}}
 */
export function computeMetrics(lm, opts = {}) {
  // MediaPipe scales x and z by image width and y by image height.
  const aspect = opts.aspect ?? 1;
  const points = aspect === 1 ? lm : lm.map((p) => ({ ...p, y: p.y / aspect }));
  const eyes = eyeMetrics(points, opts);
  return {
    ear: eyes.mean,
    earLeft: eyes.left,
    earRight: eyes.right,
    mar: mouthAspectRatio(points, opts),
    mouthOpen: mouthOpenRatio(points),
  };
}
