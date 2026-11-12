import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

await import("../build.mjs");
const { serve } = await import("./serve.mjs");
const temp = await mkdtemp(join(tmpdir(), "drowsyguard-"));
const video = join(temp, "camera.y4m");
execFileSync("ffmpeg", ["-loglevel", "error", "-i", "test_videos/portrait.mp4", "-pix_fmt", "yuv420p", video]);
const chromePath = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((path) => path && existsSync(path));
const server = serve({ port: 0 });
let browser;
try {
  await new Promise((resolve, reject) => server.once("listening", resolve).once("error", reject));
  const url = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({
    executablePath: chromePath,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${video}`],
  });
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 1050 } });
  await page.addInitScript(() => {
    window.alertToneStarts = 0;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.alertToneStarts++;
      return start.apply(this, args);
    };
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  assert.equal(await page.getByLabel("Look-away angle (°)").inputValue(), "18");
  await page.getByRole("button", { name: "Try sample" }).click();
  await page.waitForFunction(() => Number(document.getElementById("ear").textContent) > 0);
  await page.waitForFunction(() => /°$/.test(document.getElementById("yaw").textContent));
  await page.locator("#mesh").uncheck();
  assert.equal(await page.locator("#overlay").evaluate((c) => c.getContext("2d").getImageData(0, 0, c.width, c.height).data.some(Boolean)), false);
  await page.locator("#mesh").check();
  await page.locator("#mirror").uncheck();
  assert.equal(await page.locator("#viewport").evaluate((el) => el.classList.contains("mirror")), false);
  await page.locator("#mirror").check();
  if (process.env.SCREENSHOT_DIR) {
    await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, "dashboard.png"), fullPage: true });
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export session CSV" }).click();
  const csv = [];
  for await (const chunk of createReadStream(await (await download).path())) csv.push(chunk);
  const rows = Buffer.concat(csv).toString().trimEnd().split(/\r?\n/);
  assert.ok(rows.length > 1);
  assert.ok(rows.every((row) => row.split(",").length === rows[0].split(",").length));
  assert.match(rows[1], /^sample,.*?,sample,1,/);

  await page.locator("#file").setInputFiles("test_videos/low-light.mp4");
  await page.waitForFunction(() => document.getElementById("feed-heading").textContent === "Video playback");
  await page.waitForFunction(() => Number(document.getElementById("ear").textContent) > 0);
  await page.waitForFunction(() => document.getElementById("tracking").textContent === "Playback finished");
  assert.equal(await page.locator("#export").isEnabled(), true);

  await page.getByRole("button", { name: "Start camera" }).click();
  await page.waitForFunction(() => Number(document.getElementById("ear").textContent) > 0);
  await page.locator("#method").selectOption("geometric");
  await page.waitForFunction(() => /°$/.test(document.getElementById("pitch").textContent));
  await page.locator("#calibrate").click();
  await page.waitForFunction(() => document.getElementById("calibration-info").textContent.includes("Calibration complete"), null, { timeout: 20_000 });
  const earThreshold = page.locator("#earThreshold");
  const initialTones = await page.evaluate(() => window.alertToneStarts);
  await earThreshold.fill("0.65");
  await earThreshold.press("Tab");
  await page.waitForFunction(() => document.getElementById("notice").textContent.includes("Prolonged eye closure"));
  await page.waitForFunction((count) => window.alertToneStarts === count + 1, initialTones);
  await page.waitForFunction(() => document.getElementById("perclos-card").classList.contains("high-perclos"), null, { timeout: 25_000 });
  assert.equal(await page.evaluate(() => window.alertToneStarts), initialTones + 1);
  await earThreshold.fill("0.05");
  await earThreshold.press("Tab");
  await page.locator("#notice").waitFor({ state: "hidden", timeout: 1500 });
  assert.equal(await page.locator("#perclos-card").evaluate((element) => element.classList.contains("high-perclos")), true);
  await page.waitForTimeout(2600);
  assert.equal(await page.evaluate(() => window.alertToneStarts), initialTones + 1);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  assert.equal(await page.locator("#video").evaluate((element) => element.srcObject), null);
  assert.equal(await page.locator("#tracking").textContent(), "Offline");

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.SCREENSHOT_DIR) {
    await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, "mobile.png"), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log("Chrome passed sample playback, upload, overlay, mirror, CSV export, fake camera, calibration, stop and mobile layout.");
} finally {
  await browser?.close();
  server.close();
  await rm(temp, { recursive: true, force: true });
}
