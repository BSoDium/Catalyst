// After `react-router build`: gives every prerendered page its Content-Security-Policy (docs/web-architecture.md, "Prerendered pages").
//
// A prerendered page is a static file on the CDN: no response to carry a per-request nonce (the build's one would be the same for everyone, and public),
// and `vercel.json`'s headers cannot hold a per-page value. So each page's policy is a `<meta http-equiv="Content-Security-Policy">` that names the
// SHA-256 of each of its inline scripts (the router state, the module loader), the same policy as the server's (`buildCsp`) otherwise. The nonce attributes
// the render wrote are removed (the browser hides them from the DOM anyway, and nothing names them any more).
//
//   node --experimental-strip-types scripts/prerender/seal-csp.mts [buildClientDir]
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { globeRoutesFile } from "../../app/lib/globe-routes-file.ts";
import { originOf, parseOrigins } from "../../app/lib/security-headers.ts";
import { getTilesConfig } from "../../app/lib/tiles-config.server.ts";
import { sealPage } from "./seal-page.mts";

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? htmlFiles(path) : name.endsWith(".html") ? [path] : [];
  });
}

const dir = process.argv[2] ?? "build/client";
const tiles = getTilesConfig();
const connectOrigins = [originOf(tiles.primaryUrl), originOf(tiles.fallbackPmtilesUrl), ...parseOrigins(process.env.CATALYST_CSP_CONNECT_EXTRA)].filter((o): o is string => o !== null);
const files = htmlFiles(dir);
for (const file of files) writeFileSync(file, sealPage(readFileSync(file, "utf8"), connectOrigins));
console.log(`[seal-csp] ${files.length} prerendered page(s) sealed`);

// The routes' file: prerendered at its route's path, which the host answers with the function. Moved to its content-named static address (`globeRoutesFile`),
// the one the shell's data names (the hash is of the same JSON text), and the route's own copies (and the unused `.data` of the route) removed.
const routesPath = join(dir, "globe-routes.json");
if (existsSync(routesPath)) {
  const json = readFileSync(routesPath, "utf8");
  const target = join(dir, globeRoutesFile(json));
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(target, json);
  rmSync(routesPath);
  rmSync(`${routesPath}.data`, { force: true });
  console.log(`[seal-csp] routes file at ${target}`);
}
