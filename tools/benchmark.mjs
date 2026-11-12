import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, release } from "node:os";
import { readdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright-core";

await import("../build.mjs");
const fixtures = (await readdir("test_videos")).filter((name) => name.endsWith(".mp4")).sort();
await Promise.all(fixtures.map((name) => copyFile(`test_videos/${name}`, `dist/test_videos/${name}`)));
await build({
  stdin: { contents: 'export { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";', resolveDir: process.cwd() },
  bundle: true, format: "esm", outfile: "dist/benchmark-engine.js",
});
const { serve } = await import("./serve.mjs");
const server = serve({ port: 0 });
let browser;
try {
  await new Promise((resolve, reject) => server.once("listening", resolve).once("error", reject));
  const chrome = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));
  browser = await chromium.launch({ executablePath: chrome });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const rows = await page.evaluate(async (files) => {
    const { FaceLandmarker, FilesetResolver } = await import("./benchmark-engine.js");
    const resolver = await FilesetResolver.forVisionTasks("./wasm");
    const video = document.createElement("video");
    video.muted = true;
    const results = [];
    for (const file of files) {
      video.src = "./test_videos/" + file;
      await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
      const engine = await FaceLandmarker.createFromOptions(resolver, {
        baseOptions: { modelAssetPath: "./assets/models/face_landmarker.task", delegate: "CPU" },
        runningMode: "VIDEO", numFaces: 1, outputFacialTransformationMatrixes: true,
      });
      const totalFrames = Math.round(video.duration * 15);
      for (let index = 0; index < totalFrames; index++) {
        if (index) {
          video.currentTime = (index + .25) / 15;
          await new Promise((resolve) => { video.onseeked = resolve; });
        }
        const start = performance.now();
        const result = engine.detectForVideo(video, index * 1000 / 15);
        const latency = performance.now() - start;
        results.push({ method: "MediaPipe", file, frame: index, tracked: Number(result.faceLandmarks.length > 0), latency });
      }
      engine.close();
    }
    return results;
  }, fixtures);
  await mkdir("tmp/evidence", { recursive: true });
  await writeFile("tmp/evidence/mediapipe.json", JSON.stringify({
    environment: `Chrome ${browser.version()}, MediaPipe Tasks Vision 0.10.22-rc.20250304, ${cpus()[0].model}, ${arch()}, Darwin ${release()}`, rows,
  }));
  console.log(`MediaPipe benchmark logged ${rows.length} frames.`);
} finally {
  await browser?.close();
  server.close();
}
