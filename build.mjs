import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

const output = new URL("./dist/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  format: "esm",
  target: ["es2022"],
  outfile: "dist/src/app.js",
  minify: true,
});
await Promise.all([
  ...["index.html", "styles.css", "assets", "vendor/chart", "test_videos/portrait.mp4"].map((path) =>
    cp(new URL(path, import.meta.url), new URL(path, output), { recursive: true }),
  ),
  cp("node_modules/@mediapipe/tasks-vision/wasm", "dist/wasm", { recursive: true }),
]);
console.log("Static site built in dist/");
