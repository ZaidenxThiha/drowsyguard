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

test("look-away starts after one second and stays active until the head turns back", () => {
  const detector = new AttentionDetector();
  const turn = { ear: .29, mar: .1, pitch: -18, yaw: 0 };
  for (let time = 0; time < 1000; time += 100) {
    assert.deepEqual(detector.update(time, turn).alerts, []);
  }
  assert.deepEqual(detector.update(1000, turn).events, ["lookingAway"]);
  const nearLimit = detector.update(1100, { ...turn, pitch: -16 });
  assert.deepEqual(nearLimit.alerts, ["lookingAway"]);
  assert.deepEqual(nearLimit.events, []);
  assert.deepEqual(detector.update(1200, { ...turn, pitch: -14 }).alerts, []);
});

test("a raw open-eye frame clears an active eye alert while rolling PERCLOS remains high", () => {
  const detector = new AttentionDetector();
  const open = { ear: .29, rawEar: .29, mar: .1, yaw: 0, pitch: 0 };
  const closed = { ...open, ear: .1, rawEar: .1 };
  for (let time = 0; time < 20_000; time += 50) {
    detector.update(time, time < 10_000 ? open : closed);
  }
  const ongoing = detector.update(20_000, closed);
  assert.deepEqual(ongoing.alerts, ["eyeClosure"]);
  assert.equal(ongoing.highPerclos, true);

  // EAR still reflects the smoothing lag on the first reopened frame.
  const reopened = detector.update(20_050, { ...closed, rawEar: open.rawEar });
  assert.deepEqual(reopened.alerts, []);
  assert.deepEqual(reopened.events, []);
  assert.equal(reopened.highPerclos, true);
  for (let time = 20_100; time <= 30_000; time += 50) {
    const state = detector.update(time, open);
    assert.deepEqual(state.alerts, []);
  }
});
