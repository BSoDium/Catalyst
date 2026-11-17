import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";
import { loadProjection } from "@catalyst/published/dev";
import { prerenderPaths } from "./app/lib/prerender-paths";

export default {
  ssr: true,
  // Opted in to the flags React Router 8 turns on, so the dev server stops warning about them and an upgrade is a version bump (docs/web-architecture.md).
  future: {
    v8_middleware: true,
    v8_splitRouteModules: true,
    v8_viteEnvironmentApi: true,
    v8_passThroughRequests: true,
    v8_trailingSlashAwareDataRequests: true,
  },
  // The pages served from the CDN as static files, with no function: the bare paths of the published projection (`lib/prerender-paths.ts`; docs/web-architecture.md, "Prerendered pages").
  prerender: async () => prerenderPaths(loadProjection("published")),
  // Vercel sets VERCEL=1 during builds. Locally we keep the standard
  // `build/server/index.js` layout so `pnpm start` (react-router-serve) works.
  presets: process.env.VERCEL ? [vercelPreset()] : [],
} satisfies Config;
