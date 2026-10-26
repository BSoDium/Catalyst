/**
 * Vercel app module: a default-exported Hono app. It is not what Vercel runs
 * directly: scripts/build.mjs bundles it into dist/index.mjs and ../index.mjs
 * (the preset's entry) re-exports that bundle. Keep this file minimal; all
 * logic lives in ./app.
 *
 * Content is validated once, at module load. On Vercel there is no separate
 * startup phase to abort, so an invalid projection is logged loudly and the
 * app serves 503 (GET /health reports it) instead of crashing every request
 * into an opaque platform error. `src/server.ts` (dev server and built
 * artifact) exits non-zero instead.
 *
 * Deploying: the repository ruleset requires a successful "Preview - catalyst-v2-api"
 * deployment on every pull request, and Vercel skips that project ("Not affected") when
 * a pull request touches nothing it depends on, which then blocks the merge. A change in
 * this folder (such as this note) makes the project affected, so its preview is built. The
 * same goes for apps/web: the requirement is per commit, so the last commit of a pull
 * request has to touch both folders, or one of the two previews is skipped (Vercel reports it
 * as "Skipped - Not affected", and the ruleset does not count that as a success). A pull request
 * that only changes scripts/ or docs/ (the public leak check, say) builds neither preview: one line
 * in a file of each of apps/api and apps/web is enough.
 */
import { Hono } from "hono";
import { createApp } from "./app";
import { loadContent } from "./content";

const state = loadContent(process.env);
if (state.status === "invalid") {
  console.error(`[catalyst-api] FATAL: content failed validation, serving 503.\n${state.reason}`);
}

const app: Hono = createApp(state);

export default app;
