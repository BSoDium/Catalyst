// Bundles the API into self-contained ESM artifacts (workspace TS sources, zod,
// hono and the content JSON all inlined) so it can run under plain node:
//   dist/server.mjs  node entry (node dist/server.mjs, PORT defaults to 3001)
//   dist/index.mjs   src/index.ts bundled the same way (default export = Hono app); this is what the
//                    Vercel function runs, through the root index.mjs (see there and check-function.mjs)
// The workspace packages export raw .ts, which Vercel's per-file TypeScript pass does not handle at
// runtime: the deployed function must only ever load this bundle.
import { build } from "esbuild";
import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

await build({
  entryPoints: { server: "src/server.ts", index: "src/index.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  logLevel: "info",
  legalComments: "none",
});
