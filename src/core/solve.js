/**
 * Dense linear algebra used by the head-pose solver.
 *
 * Hand-written Cholesky with iterative refinement: the pose systems are small
 * (6–8 unknowns) and only mildly ill-conditioned (face landmarks are close to
 * coplanar), which is exactly the case where one or two refinement steps restore
 * full double precision at negligible cost.
 */

/**
 * Cholesky factorisation A = L L^T of a symmetric positive-definite matrix.
 *
 * @param {number[][]} A n x n symmetric matrix (not modified)
 * @returns {number[][]} lower-triangular L, row-major
 * @throws if A is not positive definite
 */
export function cholesky(A) {
  const n = A.length;
  if (n === 0) return [];
  let scale = 0;
  for (const row of A)
    for (const v of row) scale = Math.max(scale, Math.abs(v));
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > scale * 1e-14))
          throw new Error("Matrix is not positive definite");
        L[i][i] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return L;
}

/** Solves L y = b for lower-triangular L. */
export function forwardSubstitution(L, b) {
  const n = b.length;
  const y = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let j = 0; j < i; j++) s -= L[i][j] * y[j];
    y[i] = s / L[i][i];
  }
  return y;
}

/** Solves L^T x = y for lower-triangular L. */
export function backSubstitution(L, y) {
  const n = y.length;
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let j = i + 1; j < n; j++) s -= L[j][i] * x[j];
    x[i] = s / L[i][i];
  }
  return x;
}

/**
 * Solves A x = b for symmetric positive-definite A using Cholesky.
 *
 * @param {number[][]} A
 * @param {number[]} b
 * @returns {number[]}
 */
export function solveSPD(A, b) {
  const L = cholesky(A);
  return backSubstitution(L, forwardSubstitution(L, b));
}

/** Multiplies matrix A by vector x. */
export function matVec(A, x) {
  return A.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
}

/**
 * Solves A x = b for symmetric positive-definite A, followed by iterative
 * refinement steps that reduce the forward error even when A is ill-conditioned.
 *
 * @param {number[][]} A
 * @param {number[]} b
 * @param {number} [refinements=2]
 * @returns {number[]}
 */
export function solveSPDRefined(A, b, refinements = 2) {
  const L = cholesky(A);
  let x = backSubstitution(L, forwardSubstitution(L, b));
  for (let r = 0; r < refinements; r++) {
    const res = matVec(A, x).map((v, i) => b[i] - v);
    // dA = res in double precision; solve with the retained factorisation.
    const dx = backSubstitution(L, forwardSubstitution(L, res));
    x = x.map((v, i) => v + dx[i]);
  }
  return x;
}

/** True when every entry of v is finite. */
export function allFinite(v) {
  for (const x of v) if (!Number.isFinite(x)) return false;
  return true;
}
