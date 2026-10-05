import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

export default {
  ssr: true,
  // Vercel sets VERCEL=1 during builds. Locally we keep the standard
  // `build/server/index.js` layout so `pnpm start` (react-router-serve) works.
  presets: process.env.VERCEL ? [vercelPreset()] : [],
} satisfies Config;
