import assert from "node:assert/strict";
import { test } from "node:test";
import { runAttentionCases } from "./attention_cases.mjs";
import { AttentionDetector, calibrationFrom } from "../src/core/detector.js";

for (const result of runAttentionCases()) {
  test(result.name, () => assert.deepEqual(result.observed.map((item) => item.event), result.expected));
}

test("a long frame gap restarts closure timing and contributes zero PERCLOS time", () => {
  const detector = new AttentionDetector();
  const closed = { ear: .1, mar: .1, yaw: 0, pitch: 0 };
  detector.update(0, closed);
  const later = detector.update(4000, closed);
  assert.equal(later.valid, 0);
  assert.deepEqual(later.events, []);
});

test("calibration uses medians and rejects implausible open-eye baselines", () => {
  const open = { ear: .3, mar: .12, yaw: 4, pitch: -1, roll: 0 };
  const result = calibrationFrom([open, open, { ...open, ear: .1, mar: .9, yaw: 20 }]);
  assert.deepEqual(result, { earThreshold: .21, marThreshold: .26, neutral: { pitch: -1, yaw: 4, roll: 0 } });
  assert.equal(calibrationFrom([{ ...open, ear: .08 }]), null);
});
