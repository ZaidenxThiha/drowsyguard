/**
 * MediaPipe Face Landmarker topology and named landmark indices.
 *
 * Source: MediaPipe Face Mesh / canonical_face_model (468 points, 898 triangles).
 * Every index used by DrowsyGuard is named here so that both the browser app and
 * the Node verification scripts refer to the same definitions.
 */

/** Number of landmarks in the canonical face mesh. */
export const NUM_LANDMARKS = 468;

/** Landmark index groups used by the drowsiness and attention metrics. */
export const LANDMARKS = Object.freeze({
  // Right eye, as seen by the subject (MediaPipe's own naming: the subject's right).
  // Images are mirrored for display, so these appear on the left of the screen.
  rightEye: Object.freeze({
    outer: 33, // outer corner
    top1: 160, // upper lid, outer
    top2: 158, // upper lid, inner
    inner: 133, // inner corner
    bottom1: 153, // lower lid, inner
    bottom2: 144, // lower lid, outer
    iris: Object.freeze({
      center: 468,
      top: 470,
      bottom: 472,
      outer: 469,
      inner: 471,
    }),
  }),
  // Subject's left eye.
  leftEye: Object.freeze({
    outer: 362,
    top1: 385,
    top2: 387,
    inner: 263,
    bottom1: 373,
    bottom2: 380,
    iris: Object.freeze({
      center: 473,
      top: 475,
      bottom: 477,
      inner: 474,
      outer: 476,
    }),
  }),
  mouth: Object.freeze({
    leftCorner: 61,
    rightCorner: 291,
    innerTop: 13,
    innerBottom: 14,
    innerLeft: 78,
    innerRight: 308,
    upperLipInner: 12,
    lowerLipInner: 15,
    upperLipOuter: 0,
    lowerLipOuter: 17,
  }),
  pose: Object.freeze({
    noseTip: 1,
    chin: 152,
    forehead: 10,
    leftEyeOuter: 263,
    rightEyeOuter: 33,
    mouthLeft: 61,
    mouthRight: 291,
  }),
  /** Sparse subset used by the 3D model preview. */
  modelSubset: Object.freeze([
    1, 4, 5, 6, 8, 9, 10, 33, 46, 61, 70, 105, 109, 127, 133, 152, 168, 197,
    234, 263, 276, 291, 297, 326, 356, 372, 454,
  ]),
});

/**
 * Traces a closed contour along a polyline through the given points.
 * Utility for drawing the mesh wireframe.
 *
 * @param {ArrayLike<{x:number,y:number}>} points
 * @param {CanvasRenderingContext2D} ctx
 */
export function strokePolyline(points, ctx) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

/** Face mesh topology split into role-labelled edge lists for the overlay. */
export const MESH = Object.freeze({
  /** Facial outline-ish row order used to colour the mesh points by landmark id. */
  bands: Object.freeze([
    { from: 0, to: 116, color: "rgba(66, 133, 244, 0.55)" }, // face oval
    { from: 117, to: 131, color: "rgba(156, 39, 176, 0.55)" }, // right brow + eye
    { from: 132, to: 238, color: "rgba(255, 112, 67, 0.55)" }, // right cheek
    { from: 239, to: 262, color: "rgba(76, 175, 80, 0.55)" }, // nose bridge
    { from: 263, to: 302, color: "rgba(255, 179, 0, 0.6)" }, // left eye + brow
    { from: 303, to: 360, color: "rgba(38, 166, 154, 0.55)" }, // left cheek
    { from: 361, to: 467, color: "rgba(255, 82, 82, 0.55)" }, // jaw wrap
  ]),
  /** Contours drawn as solid bright lines on top of the point cloud. */
  contours: Object.freeze([
    // Right eye
    [
      33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163,
      7, 33,
    ],
    // Left eye
    [
      362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381,
      382, 362,
    ],
    // Outer lips
    [
      61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0,
      37, 39, 40, 185, 61,
    ],
    // Inner lips
    [
      78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13,
      82, 81, 80, 191, 78,
    ],
    // Nose
    [168, 6, 197, 195, 5, 4, 1, 2, 98, 327, 168],
    // Face oval
    [
      10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
      378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
      162, 21, 54, 103, 67, 109, 10,
    ],
  ]),
});

/** Returns a colour for a landmark id (used by the "colour by region" mode). */
export function bandColor(index) {
  for (const band of MESH.bands) {
    if (index >= band.from && index <= band.to) return band.color;
  }
  return "rgba(255, 255, 255, 0.5)";
}

/**
 * Named landmark indices printed by the landmark inspector.
 * Grouped by meaning so the "show indices" overlay stays legible.
 */
export const INSPECTOR_GROUPS = Object.freeze([
  {
    label: "Right eye (subject)",
    color: "#4caf50",
    ids: [33, 160, 158, 133, 153, 144],
  },
  {
    label: "Left eye (subject)",
    color: "#ff9800",
    ids: [362, 385, 387, 263, 373, 380],
  },
  {
    label: "Mouth",
    color: "#e91e63",
    ids: [61, 291, 13, 14, 78, 308],
  },
  {
    label: "Head pose",
    color: "#29b6f6",
    ids: [1, 152, 10, 263, 33, 61, 291],
  },
]);
