import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The playground runs on the package's sources (what `import "neon-activity-graph"` is in your own project).
export default defineConfig({
  resolve: { alias: { "neon-activity-graph": fileURLToPath(new URL("../src/index.ts", import.meta.url)) } },
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 5188 },
});
