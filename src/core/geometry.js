/**
 * Small, dependency-free 2D/3D geometry helpers.
 *
 * All functions are pure so they can be unit-tested in Node.
 */

/** Euclidean distance between two 2D or 3D points sharing x/y/z keys. */
export function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 2D distance (ignores z). */
export function distance2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Midpoint of two points. */
export function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
  };
}

export function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Signed angle in degrees between two vectors (2D), positive anticlockwise.
 * Returns 0 for zero-length vectors.
 */
export function angleBetween(a, b) {
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  if (la === 0 || lb === 0) return 0;
  const cos = clamp((a.x * b.x + a.y * b.y) / (la * lb), -1, 1);
  const sin = (a.x * b.y - a.y * b.x) / (la * lb);
  return (Math.atan2(sin, cos) * 180) / Math.PI;
}

/** Wraps an angle in degrees into the range (-180, 180]. */
export function wrapDegrees(deg) {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Adds two 3-vectors given as arrays. */
export function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Subtracts 3-vectors: a - b. */
export function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Scales a 3-vector. */
export function scale3(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length3(a) {
  return Math.sqrt(dot3(a, a));
}

export function normalize3(a) {
  const L = length3(a);
  return L === 0 ? [0, 0, 0] : [a[0] / L, a[1] / L, a[2] / L];
}

/**
 * Inverts a 3x3 matrix (row-major array of 9 numbers). Returns null if singular.
 * @param {number[]} m
 * @returns {number[] | null}
 */
export function invert3x3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    A,
    -(b * i - c * h),
    b * f - c * e,
    B,
    a * i - c * g,
    -(a * f - c * d),
    C,
    -(a * h - b * g),
    a * e - b * d,
  ];
  return inv.map((v) => v / det);
}

/** Multiplies a 3x3 matrix (row-major) by a 3-vector. */
export function mul3x3v(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Multiplies two 3x3 matrices (row-major). */
export function mul3x3(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] =
        a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

/**
 * Extracts Tait-Bryan angles (degrees) from a 3x3 rotation matrix.
 *
 * Uses camera coordinates (x right, y up, z into the scene). The face looks
 * along -Z at rest. Rotation order is Ry(yaw) Rx(-pitch) Rz(roll), so positive
 * pitch looks down, positive yaw looks left, and positive roll is counterclockwise
 * in the unmirrored image.
 *
 * @param {number[]} R row-major 3x3 rotation matrix (not necessarily orthonormal)
 * @returns {{pitch:number, yaw:number, roll:number}}
 */
export function eulerFromRotation(R) {
  const pitch = Math.asin(clamp(R[5], -1, 1));
  const gimbalLock = Math.abs(Math.cos(pitch)) < 1e-7;
  const yaw = gimbalLock ? Math.atan2(-R[6], R[0]) : Math.atan2(R[2], R[8]);
  const roll = gimbalLock ? 0 : Math.atan2(R[3], R[4]);
  const d = 180 / Math.PI;
  return { pitch: pitch * d, yaw: yaw * d, roll: roll * d };
}

/**
 * Maps raw Euler angles to the angles the dashboard displays, given whether the
 * preview is mirrored.
 *
 * Raw angles are measured in the camera's image frame (see {@link eulerFromRotation}).
 * A horizontal flip reverses yaw and roll while leaving pitch unchanged.
 *
 * @param {{pitch:number, yaw:number, roll:number}} raw
 * @param {boolean} mirrored preview is horizontally flipped (default for selfie cams)
 * @returns {{pitch:number, yaw:number, roll:number}} display angles
 */
export function poseSigns(raw, mirrored) {
  if (!mirrored) return raw;
  return { pitch: raw.pitch, yaw: -raw.yaw, roll: -raw.roll };
}

/**
 * Orthonormalises a 3x3 rotation estimate with Gram-Schmidt.
 *
 * Singular-value decomposition of a noisy fit would be the textbook answer; Gram-Schmidt
 * is cheaper, stable enough at our noise level (we average the basis over frames) and
 * keeps the function dependency-free.
 *
 * @param {number[]} R row-major 3x3
 * @returns {number[]} row-major 3x3 orthonormal matrix (rows are the basis vectors)
 */
export function orthonormalize3x3(R) {
  // Rows of R are the basis vectors r1 (x), r2 (y), r3 (z).
  const r1 = normalize3([R[0], R[1], R[2]]);
  const r2raw = [R[3], R[4], R[5]];
  const proj = dot3(r2raw, r1);
  const r2 = normalize3([
    r2raw[0] - proj * r1[0],
    r2raw[1] - proj * r1[1],
    r2raw[2] - proj * r1[2],
  ]);
  const r3 = cross3(r1, r2);
  return [...r1, ...r2, ...r3];
}
