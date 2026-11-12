export const DEFAULTS = Object.freeze({
  earThreshold: 0.2, marThreshold: 0.32, yawThreshold: 18, smoothing: 80,
});

const WINDOW_MS = 30_000;
const MAX_GAP_MS = 500;
const LOOK_AWAY_RELEASE_MARGIN_DEG = 3;
const RADIANS_PER_DEGREE = Math.PI / 180;

export const EVENT_LABELS = Object.freeze({
  blink: "Blink",
  yawn: "Yawn",
  eyeClosure: "Prolonged eye closure",
  perclos: "High eye closure",
  lookingAway: "Looking away",
  headDown: "Head down",
});

function eyesClosed(metrics, { earThreshold }) {
  // Smooth the onset, then allow a fresh open-eye reading to clear the alert.
  return metrics.ear < earThreshold && (metrics.rawEar ?? metrics.ear) < earThreshold;
}

function lookingAway({ yaw, pitch }, { yawThreshold }, fired) {
  if (!Number.isFinite(yaw) && !Number.isFinite(pitch)) return false;
  const horizontal = Number.isFinite(yaw) ? yaw : 0;
  // Positive pitch points down and has its own alert. For an upward turn,
  // the dot product with straight ahead combines the horizontal and vertical turn.
  const upward = Number.isFinite(pitch) ? Math.min(0, pitch) : 0;
  const forward = Math.cos(horizontal * RADIANS_PER_DEGREE) * Math.cos(upward * RADIANS_PER_DEGREE);
  const limit = yawThreshold - (fired ? LOOK_AWAY_RELEASE_MARGIN_DEG : 0);
  return forward <= Math.cos(limit * RADIANS_PER_DEGREE);
}

const RULES = [
  { key: "eyeClosure", duration: 1250, active: eyesClosed },
  { key: "yawn", duration: 1000, active: (m, s) => m.mar >= s.marThreshold },
  { key: "lookingAway", duration: 1000, active: lookingAway },
  { key: "headDown", duration: 1000, active: (m) => m.pitch >= 22 },
];

export class AttentionDetector {
  #last = null;
  #intervals = [];
  #episodes = new Map();
  #highPerclos = false;
  blinks = 0;
  yawns = 0;

  interrupt() {
    this.#last = null;
    this.#episodes.clear();
  }

  update(time, metrics, settings = DEFAULTS) {
    const events = [];
    if (this.#last) {
      const elapsed = time - this.#last.time;
      if (elapsed > 0 && elapsed <= MAX_GAP_MS) {
        this.#intervals.push({ start: this.#last.time, end: time, closed: this.#last.closed });
      } else {
        this.interrupt();
      }
    }
    const cutoff = time - WINDOW_MS;
    while (this.#intervals[0]?.end <= cutoff) this.#intervals.shift();
    let valid = 0;
    let closed = 0;
    for (const span of this.#intervals) {
      const elapsed = span.end - Math.max(span.start, cutoff);
      valid += elapsed;
      if (span.closed) closed += elapsed;
    }
    const perclos = valid > 0 ? closed / valid : 0;
    if (!metrics) {
      this.interrupt();
      return { events, alerts: [], perclos, valid, highPerclos: false };
    }

    const alerts = [];
    this.#last = { time, closed: eyesClosed(metrics, settings) };
    for (const rule of RULES) {
      let episode = this.#episodes.get(rule.key);
      if (rule.active(metrics, settings, episode?.fired)) {
        if (!episode) {
          episode = { start: time, fired: false };
          this.#episodes.set(rule.key, episode);
        }
        if (time - episode.start >= rule.duration) {
          if (!episode.fired) {
            events.push(rule.key);
            if (rule.key === "yawn") this.yawns++;
            episode.fired = true;
          }
          if (rule.key !== "yawn") alerts.push(rule.key);
        }
      } else if (episode) {
        const duration = time - episode.start;
        if (rule.key === "eyeClosure" && duration >= 60 && duration < 400) {
          this.blinks++;
          events.push("blink");
        }
        this.#episodes.delete(rule.key);
      }
    }
    const high = valid >= 15_000 && perclos >= (this.#highPerclos ? 0.16 : 0.2);
    if (high && !this.#highPerclos) events.push("perclos");
    this.#highPerclos = high;
    return { events, alerts, perclos, valid, highPerclos: high };
  }
}

export function calibrationFrom(samples) {
  const median = (key) => {
    const sorted = samples.map((sample) => sample[key]).sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return (sorted[middle] + sorted[Math.ceil(sorted.length / 2) - 1]) / 2;
  };
  const ear = median("ear");
  const mar = median("mar");
  if (!(ear >= 0.12 && ear <= 0.6 && mar < 0.35)) return null;
  return {
    earThreshold: Math.round(ear * 0.7 * 200) / 200,
    marThreshold: Math.round(Math.max(0.26, mar * 1.8) * 200) / 200,
    neutral: { pitch: median("pitch"), yaw: median("yaw"), roll: median("roll") },
  };
}
