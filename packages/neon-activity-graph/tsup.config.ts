import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", react: "src/react.tsx", layout: "src/pure.ts" },
  format: ["esm"],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  // three (and its examples) and react are the host's: peer dependencies
  external: ["three", /^three\//, "react", /^react\//],
});
