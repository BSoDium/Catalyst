// Vercel function entry (zero-config Hono preset: it picks a root `index.*` before anything under `src/`).
//
// It only re-exports the self-contained bundle that `pnpm build` (scripts/build.mjs) emits: the app
// with @catalyst/schemas, @catalyst/published, zod, hono and the projection JSON inlined. Vercel's own
// per-file TypeScript pass cannot be used instead, because the workspace packages export raw .ts
// (`exports` -> src/index.ts) and the deployed function then fails with ERR_MODULE_NOT_FOUND on
// every request (see docs/api-contract.md, "Deployment on Vercel"). The preset only accepts a file that
// imports "hono", which is what the type annotation below is for; do not remove it.
//
// `pnpm build` fails if this chain stops working (scripts/check-function.mjs).
import bundled from "./dist/index.mjs";

/** @type {import("hono").Hono} */
const app = bundled;

export default app;
