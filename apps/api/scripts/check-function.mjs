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
    const demo = process.env.CATALYST_CONTENT === "demo";
    const expectations = [["GET", "/health", 200], ["GET", "/v1/projection", 200], ["GET", "/v1/places", 200], ["GET", "/v1/poems", 200], ["GET", "/nope", 404], ["GET", "/v1/poems/nope", 404], ["GET", "/v1/projects/nope", 404], ["POST", "/v1/places", 405]];
    // The demo content is inlined in the bundle too: the entry detail endpoints must answer from it.
    if (demo) expectations.push(["GET", "/v1/poems/demo-poem", 200], ["GET", "/v1/projects/demo-project", 200], ["GET", "/v1/articles/demo-article", 200], ["GET", "/v1/artworks/demo-artwork", 200], ["GET", "/v1/articles/morocco-coast-bus", 200], ["GET", "/v1/poems/quai-de-nuit", 200], ["GET", "/v1/places/lisbon", 200]);
    for (const [method, path, status] of expectations) {
      const res = await app.fetch(new Request("http://localhost" + path, { method }));
      if (res.status !== status) throw new Error(method + " " + path + " answered " + res.status + ", expected " + status);
    }
    if (demo) {
      const poem = await (await app.fetch(new Request("http://localhost/v1/poems/demo-poem"))).json();
      if (poem.kind !== "poem" || !Array.isArray(poem.body) || !poem.body.some((b) => b.type === "verse")) throw new Error("the demo poem detail has no verse block");
      const list = await (await app.fetch(new Request("http://localhost/v1/poems"))).json();
      if (!Array.isArray(list) || list.length !== 4 || "body" in list[0]) throw new Error("/v1/poems must list the four demo poems as summaries without a body");
      const articles = await (await app.fetch(new Request("http://localhost/v1/articles"))).json();
      if (!Array.isArray(articles) || articles.length !== 5) throw new Error("/v1/articles must list the five demo articles");
    }
  `;
  for (const content of [undefined, "demo"]) {
    const env = { ...process.env };
    delete env.CATALYST_CONTENT;
    if (content) env.CATALYST_CONTENT = content;
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: dir, env, encoding: "utf8", timeout: 30_000 });
    if (run.status !== 0) fail(`the bundled function does not run on its own (content: ${content ?? "published"}):\n${run.stderr || run.stdout}`);
  }
  console.log("check-function: index.mjs + dist/index.mjs run standalone (/health, /v1/projection, /v1/places, /v1/poems, 404, 405; entry details with demo content).");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
