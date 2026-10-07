import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5180, strictPort: true, host: true },
  preview: { port: 5180, strictPort: true, host: true },
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: false },
});
