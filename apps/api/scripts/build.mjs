// Bundles the API into self-contained ESM artifacts (workspace TS sources, zod,
// hono and the content JSON all inlined) so it can run under plain node:
//   dist/server.mjs  node entry (node dist/server.mjs, PORT defaults to 3001)
//   dist/index.mjs   the Vercel entry bundled the same way (default export = Hono app)
// Vercel does not need these artifacts; they prove the entry is bundleable.
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
