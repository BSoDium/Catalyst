import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The demo runs on the package's sources and is served from a sub-path on GitHub Pages (hence the relative base).
export default defineConfig({
  base: "./",
  resolve: { alias: { "neon-activity-graph": fileURLToPath(new URL("../src/index.ts", import.meta.url)) } },
  build: { outDir: "dist", emptyOutDir: true, target: "esnext" },
  server: { port: 5189 },
});
