import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5190, strictPort: true, host: true },
  preview: { port: 5190, strictPort: true, host: true },
  worker: { format: "es" },
  build: {
    target: "es2022",
    sourcemap: false,
    // synthetic.html is the line-connectivity harness (scripts/line-regression.mjs)
    rollupOptions: { input: { main: resolve(__dirname, "index.html"), synthetic: resolve(__dirname, "synthetic.html") } },
  },
});
