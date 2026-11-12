import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = await realpath("dist").catch(async () => {
  await import("../build.mjs");
  return realpath("dist");
});
const contentTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  ".wasm": "application/wasm", ".mp4": "video/mp4", ".png": "image/png",
};

export function serve({ port = 4173, host = "127.0.0.1" } = {}) {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const file = await realpath(resolve(root, "." + (path.endsWith("/") ? path + "index.html" : path)));
      if (!file.startsWith(root + sep)) throw new Error("Outside static site");
      const info = await stat(file);
      if (!info.isFile()) throw new Error("Not a file");
      const headers = { "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream", "Accept-Ranges": "bytes" };
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (range && (start > end || start >= info.size)) {
        res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
        return;
      }
      if (range) headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
      headers["Content-Length"] = end - start + 1;
      res.writeHead(range ? 206 : 200, headers);
      if (req.method === "HEAD" || info.size === 0) res.end();
      else createReadStream(file, { start, end }).on("error", () => res.destroy()).pipe(res);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    }
  });
  return server.listen(port, host);
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const server = serve({ port: Number(process.env.PORT ?? 4173) });
  server.on("listening", () => console.log(`DrowsyGuard at http://127.0.0.1:${server.address().port}`));
}
