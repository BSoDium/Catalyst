// Regression guard for the Vercel deploy (runs at the end of `pnpm build`, so CI and the Vercel build both
// fail on it). It reproduces what the deployed function has: only index.mjs and dist/index.mjs, with no
// node_modules and no workspace sources around them.
//
// The first deployment answered 500 FUNCTION_INVOCATION_FAILED on every path: the Hono preset had picked
// src/app.ts as the entry and compiled it file by file, so at runtime the function imported
// @catalyst/schemas, whose package.json exports raw .ts. This script fails if the entry is not the bundle,
// or if the bundle needs anything that is not inside it.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message) => {
  console.error(`check-function: ${message}`);
  process.exit(1);
};

// 1. Entry detection, as @vercel/hono does it: candidates in this order, the first one that imports "hono" wins.
const names = ["app", "index", "server", "src/app", "src/index", "src/server"];
const extensions = ["js", "cjs", "mjs", "ts", "cts", "mts"];
const importsHono = /(?:from|require|import)\s*(?:\(\s*)?["']hono["']\s*(?:\))?/;
const candidates = names
  .flatMap((n) => extensions.map((e) => `${n}.${e}`))
  .filter((f) => existsSync(join(root, f)) && importsHono.test(readFileSync(join(root, f), "utf8")));
if (candidates[0] !== "index.mjs") {
  fail(`the Vercel Hono preset would pick ${candidates[0] ?? "no entry"} instead of index.mjs (candidates: ${candidates.join(", ")}). Do not add a root app.* before index.mjs.`);
}
if (!existsSync(join(root, "dist", "index.mjs"))) fail("dist/index.mjs is missing: run scripts/build.mjs first.");

// 2. Run the function the way it is deployed: a clean directory, nothing resolvable but the two files.
const dir = mkdtempSync(join(tmpdir(), "catalyst-api-function-"));
try {
  mkdirSync(join(dir, "dist"));
  cpSync(join(root, "index.mjs"), join(dir, "index.mjs"));
  cpSync(join(root, "dist", "index.mjs"), join(dir, "dist", "index.mjs"));
  writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
  if (readdirSync(dir).includes("node_modules")) fail("unexpected node_modules in the scratch directory");

  const probe = `
    const { default: app } = await import("./index.mjs");
    if (typeof app?.fetch !== "function") throw new Error("the default export is not a fetch handler");
    const expectations = [["GET", "/health", 200], ["GET", "/v1/projection", 200], ["GET", "/v1/places", 200], ["GET", "/nope", 404], ["POST", "/v1/places", 405]];
    for (const [method, path, status] of expectations) {
      const res = await app.fetch(new Request("http://localhost" + path, { method }));
      if (res.status !== status) throw new Error(method + " " + path + " answered " + res.status + ", expected " + status);
    }
  `;
  const env = { ...process.env };
  delete env.CATALYST_CONTENT;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: dir, env, encoding: "utf8", timeout: 30_000 });
  if (run.status !== 0) fail(`the bundled function does not run on its own:\n${run.stderr || run.stdout}`);
  console.log("check-function: index.mjs + dist/index.mjs run standalone (/health, /v1/projection, /v1/places, 404, 405).");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
