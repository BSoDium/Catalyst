// Tiny static server for a local PMTiles file with HTTP Range and CORS, the way deploy/docker/tiles serves one. For
// the street checks only (never deployed): the fallback archive of the visual and failover scripts.
//
//   node apps/web/scripts/street/serve-tiles.mjs <file.pmtiles> [port]   (default port 5240)
//
// Query-free paths: GET/HEAD /<anything>.pmtiles with `Range: bytes=a-b` -> 206. A counter of served requests is at
// GET /__stats (JSON) and can be reset with POST /__reset; `?delay=ms` on a request delays its answer (slow drills).
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";

export function serveTiles(file, port = 5240) {
  const size = statSync(file).size;
  const stats = { requests: 0, bytes: 0, ranges: 0 };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Range, If-Match, If-None-Match, If-Range",
      "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified",
    };
    if (req.method === "OPTIONS") return void res.writeHead(204, { ...cors, "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS" }).end();
    if (url.pathname === "/__stats") return void res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify(stats));
    if (url.pathname === "/__reset") {
      Object.assign(stats, { requests: 0, bytes: 0, ranges: 0 });
      return void res.writeHead(204, cors).end();
    }
    if (!url.pathname.endsWith(".pmtiles")) return void res.writeHead(404, cors).end();
    const delay = Number(url.searchParams.get("delay") ?? 0);
    const go = () => {
      stats.requests++;
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
      const base = { ...cors, "Accept-Ranges": "bytes", ETag: `"${size}"`, "Cache-Control": "no-store" };
      if (!range) {
        res.writeHead(200, { ...base, "Content-Length": size, "Content-Type": "application/octet-stream" });
        if (req.method === "HEAD") return void res.end();
        stats.bytes += size;
        return void createReadStream(file).pipe(res);
      }
      stats.ranges++;
      let start = range[1] === "" ? size - Number(range[2]) : Number(range[1]);
      let end = range[1] === "" || range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
      if (start >= size || start > end) return void res.writeHead(416, { ...base, "Content-Range": `bytes */${size}` }).end();
      res.writeHead(206, { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1, "Content-Type": "application/octet-stream" });
      if (req.method === "HEAD") return void res.end();
      stats.bytes += end - start + 1;
      createReadStream(file, { start, end }).pipe(res);
    };
    if (delay > 0) setTimeout(go, delay);
    else go();
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port, stats, url: `http://127.0.0.1:${port}/places.pmtiles` })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: serve-tiles.mjs <file.pmtiles> [port]");
    process.exit(2);
  }
  const { url } = await serveTiles(file, Number(process.argv[3] ?? 5240));
  console.log(`serving ${file} at ${url}`);
}
