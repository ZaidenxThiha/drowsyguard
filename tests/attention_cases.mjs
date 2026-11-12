import { AttentionDetector } from "../src/core/detector.js";

const normal = { ear: .29, mar: .11, yaw: 0, pitch: 0 };
const closure = { ear: .11 };
const eventSpan = (start, end, metrics) => ({ start, end, metrics });
const cases = [
  { name: "Steady attention", length: 5000, spans: [], expected: [] },
  { name: "Normal blink", length: 3000, spans: [eventSpan(1000, 1200, closure)], expected: ["blink"] },
  { name: "Prolonged eye closure", length: 4000, spans: [eventSpan(1000, 2500, closure)], expected: ["eyeClosure"] },
  { name: "Sustained yawn", length: 4000, spans: [eventSpan(1000, 2500, { mar: .52 })], expected: ["yawn"] },
  { name: "Brief mouth opening", length: 3000, spans: [eventSpan(1000, 1550, { mar: .45 })], expected: [] },
  { name: "Moderate left turn", length: 3300, spans: [eventSpan(1000, 2150, { yaw: -19 })], expected: ["lookingAway"] },
  { name: "Moderate right turn", length: 3300, spans: [eventSpan(1000, 2150, { yaw: 19 })], expected: ["lookingAway"] },
  { name: "Sustained upward turn", length: 3300, spans: [eventSpan(1000, 2150, { pitch: -19 })], expected: ["lookingAway"] },
  { name: "Up and to the left", length: 3300, spans: [eventSpan(1000, 2150, { pitch: -13, yaw: -13 })], expected: ["lookingAway"] },
  { name: "Up and to the right", length: 3300, spans: [eventSpan(1000, 2150, { pitch: -13, yaw: 13 })], expected: ["lookingAway"] },
  { name: "Brief upward glance", length: 3300, spans: [eventSpan(1000, 1700, { pitch: -25 })], expected: [] },
  { name: "Small diagonal movement", length: 3300, spans: [eventSpan(1000, 3000, { pitch: -10, yaw: 10 })], expected: [] },
  { name: "Quick sideways glance", length: 3300, spans: [eventSpan(1000, 1700, { yaw: 25 })], expected: [] },
  { name: "Yaw below threshold", length: 3300, spans: [eventSpan(1000, 3000, { yaw: 17 })], expected: [] },
  { name: "Sustained head drop", length: 3500, spans: [eventSpan(1000, 2200, { pitch: 28 })], expected: ["headDown"] },
  { name: "Interrupted face tracking", length: 3500, spans: [eventSpan(1000, 1750, closure), eventSpan(1750, 2000, null), eventSpan(2000, 2750, closure)], expected: [] },
  {
    name: "Repeated partial-second closure", length: 18000,
    spans: Array.from({ length: 9 }, (_, index) => eventSpan(index * 2000, index * 2000 + 600, closure)),
    expected: ["perclos"],
  },
  { name: "Two distinct yawns", length: 6000, spans: [eventSpan(600, 1800, { mar: .42 }), eventSpan(2800, 4300, { mar: .48 })], expected: ["yawn", "yawn"] },
];

export function runAttentionCases() {
  return cases.map(({ name, length, spans, expected }) => {
    const detector = new AttentionDetector();
    const observed = [];
    for (let time = 0; time <= length; time += 50) {
      const span = spans.find((item) => time >= item.start && time < item.end);
      const metrics = span?.metrics === null ? null : { ...normal, ...span?.metrics };
      const state = detector.update(time, metrics);
      observed.push(...state.events.map((event) => ({ event, time })));
    }
    return { name, length, expected, observed };
  });
}
