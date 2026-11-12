/**
 * Signal smoothing.
 *
 * - {@link OneEuroFilter}: Casiez, Roussel & Vogel (2012), "1€ Filter: A Simple
 *   Speed-based Low-pass Filter for Noisy Input in Interactive Systems", CHI '12.
 *   It is low-pass at rest (kills jitter) and nearly transparent during fast
 *   movement (no lag on blinks).
 * - {@link MovingAverage}: fixed-window mean, used for the PERCLOS / yawn logic
 *   and available in the UI as a simpler alternative.
 */

const TWO_PI = Math.PI * 2;

/** Low-pass rate for the derivative estimate (Hz). */
const D_CUTOFF = 1.0;

export class LowPassFilter {
  /** @param {number} alpha smoothing factor in [0,1]; 1 = no smoothing */
  constructor(alpha = 1) {
    this.alpha = alpha;
    this.y = null;
  }

  /**
   * @param {number} x input sample
   * @param {number} [alpha] override smoothing for this call
   * @returns {number}
   */
  filter(x, alpha = this.alpha) {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }

  /** Update the smoothing factor from a cutoff frequency and sample period (s). */
  setCutoff(fc, dt) {
    const tau = 1 / (TWO_PI * fc);
    this.alpha = 1 / (1 + tau / Math.max(dt, 1e-6));
    return this.alpha;
  }

  reset() {
    this.y = null;
  }
}

export class OneEuroFilter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.minCutoff=1.0] Hz, at rest
   * @param {number} [opts.beta=0.05] speed coefficient
   * @param {number} [opts.dCutoff=1.0] Hz, derivative filter
   */
  constructor({ minCutoff = 1.0, beta = 0.05, dCutoff = D_CUTOFF } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPassFilter();
    this.dx = new LowPassFilter();
    this.lastX = null;
    this.lastTime = null;
  }

  /** @param {number} value @param {number} tSample seconds @returns {number} */
  filter(value, tSample) {
    let dt = this.lastTime === null ? 1 / 30 : tSample - this.lastTime;
    if (!(dt > 0)) dt = 1e-3;
    this.lastTime = tSample;

    const dValue = this.lastX === null ? 0 : (value - this.lastX) / dt;
    this.lastX = value;
    const dxHat = this.dx.filter(dValue, this.dx.setCutoff(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    return this.x.filter(value, this.x.setCutoff(cutoff, dt));
  }

  /** True until the first sample has been filtered. */
  get initialized() {
    return this.x.y !== null;
  }

  reset() {
    this.x.reset();
    this.dx.reset();
    this.lastX = null;
    this.lastTime = null;
  }
}

/**
 * Fixed-size moving average over the last `size` samples.
 */
export class MovingAverage {
  /** @param {number} size window length in samples */
  constructor(size = 5) {
    this.size = Math.max(1, size | 0);
    this.values = [];
  }

  /** @param {number} x @returns {number} current average */
  push(x) {
    this.values.push(x);
    if (this.values.length > this.size) this.values.shift();
    return this.mean;
  }

  get mean() {
    if (this.values.length === 0) return 0;
    let s = 0;
    for (const v of this.values) s += v;
    return s / this.values.length;
  }

  clear() {
    this.values.length = 0;
  }
}

/**
 * A vector of independent 1€ filters (same parameters), used for the head pose
 * and for 3D preview points.
 */
export class VectorOneEuroFilter {
  /** @param {number} dims @param {object} [opts] */
  constructor(dims, opts = {}) {
    this.filters = Array.from({ length: dims }, () => new OneEuroFilter(opts));
  }

  /**
   * @param {ArrayLike<number>} values
   * @param {number} t seconds
   * @returns {number[]}
   */
  filter(values, t) {
    const out = new Array(values.length);
    for (let i = 0; i < values.length; i++)
      out[i] = this.filters[i].filter(values[i], t);
    return out;
  }

  reset() {
    for (const f of this.filters) f.reset();
  }
}
