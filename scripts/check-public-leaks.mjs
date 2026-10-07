#!/usr/bin/env node
// Guards the public surface: after `pnpm build`, fail if private-layer vocabulary or
// credential names appear in the browser bundle, the server/API bundles, tracked
// files, or if the published projection contains anything beyond the strict contract.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PREVIEW_FILE, findPreviewLeaks, previewFilesInRepoListing } from "./lib/preview-leaks.mjs";

// Also guards the LOCAL preview file (the owner's real places incl. unpublished drafts, written by `pnpm export:preview`):
// it may exist on a developer machine only if git ignores it, and none of its places may appear in a production bundle.

const root = fileURLToPath(new URL("..", import.meta.url));

// Vocabulary that only exists in the private layers (source snapshot, archive, importer, secrets).
const FORBIDDEN = [
  "POLARSTEPS",
  "remember_token",
  "polarsteps",
  "sourceRefs",
  "mediaRef",
  "stepId",
  "tripId",
  "deleted-upstream",
  "contentHash",
  "PUBLIC_REPO_TOKEN",
];

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const targets = [
  ["browser bundle", "apps/web/build/client"],
  ["web server bundle", "apps/web/build/server"],
  ["api bundle", "apps/api/dist"],
  ["published projection", "packages/published/data"],
];

const failures = [];
let scanned = 0;
const bundleFiles = [];
for (const [label, rel] of targets) {
  const dir = join(root, rel);
  if (!existsSync(dir)) {
    failures.push(`${label}: ${rel} not found (run \`pnpm build\` first)`);
    continue;
  }
  for (const file of walk(dir)) {
    if (/\.(png|jpe?g|webp|ico|woff2?|map)$/i.test(file)) continue;
    const text = readFileSync(file, "utf8");
    scanned++;
    if (label !== "published projection") bundleFiles.push({ file: relative(root, file), text });
    for (const word of FORBIDDEN) {
      if (text.includes(word)) failures.push(`${label}: "${word}" found in ${relative(root, file)}`);
    }
  }
}

// No env files or raw source/archive directories tracked in the public repo.
const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
for (const f of tracked) {
  if (/(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example")) failures.push(`tracked env file: ${f}`);
  if (/^(source|archive|editorial)\//.test(f)) failures.push(`private-layer path tracked: ${f}`);
}

// The local preview file: never tracked, never untracked-and-unignored (`tracked` above lists both kinds).
for (const f of previewFilesInRepoListing(tracked)) failures.push(`preview file is tracked or not git-ignored: ${f} (it holds unpublished drafts; it must be ignored, see .gitignore)`);

// If the preview file exists here, none of its places may be inside a production bundle. Skipped otherwise.
const previewPath = join(root, PREVIEW_FILE);
if (existsSync(previewPath)) {
  try {
    failures.push(...findPreviewLeaks(bundleFiles, JSON.parse(readFileSync(previewPath, "utf8"))));
  } catch (e) {
    failures.push(`preview file is unreadable (${e.message.split("\n")[0]}); delete it or re-run \`pnpm export:preview\``);
  }
}

// The projection must satisfy the strict contract (unknown keys are errors).
try {
  execFileSync("pnpm", ["--silent", "validate:published"], { cwd: root, stdio: "pipe" });
} catch (e) {
  failures.push(`projection invalid:\n${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`);
}

if (failures.length) {
  console.error(`Public leak check FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`Public leak check passed: ${scanned} files scanned, ${tracked.length} tracked files checked.`);
