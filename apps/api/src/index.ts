/**
 * Vercel deploy entry (zero-config Hono: a file importing `hono` with a
 * default-exported app). Keep this file minimal; all logic lives in ./app.
 *
 * Content is validated once, at module load. On Vercel there is no separate
 * startup phase to abort, so an invalid projection is logged loudly and the
 * app serves 503 (GET /health reports it) instead of crashing every request
 * into an opaque platform error. `src/server.ts` (dev server and built
 * artifact) exits non-zero instead.
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
