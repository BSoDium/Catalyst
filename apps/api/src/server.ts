/**
 * Node entry for local dev (`pnpm dev`) and the self-contained built artifact
 * (`pnpm build && pnpm start`). Not used by Vercel, which takes src/index.ts.
 * Unlike the Vercel entry it refuses to start on invalid content.
 */
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadContent } from "./content";

const state = loadContent(process.env);
if (state.status === "invalid") {
  console.error(`[catalyst-api] FATAL: refusing to start.\n${state.reason}`);
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3001);
const app = createApp(state);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[catalyst-api] content=${state.mode} listening on http://localhost:${info.port}`);
});
