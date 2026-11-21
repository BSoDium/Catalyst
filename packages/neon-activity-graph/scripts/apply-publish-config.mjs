// `npm publish` does not apply `publishConfig.exports` (pnpm does): while developing, `exports` point at the sources (`src/*.ts`, so a workspace or the playground needs no build), and the published package must point at `dist`.
// `prepack` runs this to copy `publishConfig.exports` over `exports` in package.json for the tarball; `postpack` (`--restore`) puts the sources back.
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const file = new URL("../package.json", import.meta.url);
const backup = new URL("../package.json.dev", import.meta.url);

if (process.argv.includes("--restore")) {
  if (existsSync(backup)) {
    copyFileSync(backup, file);
    rmSync(backup);
  }
} else {
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  if (!pkg.publishConfig?.exports) throw new Error("no publishConfig.exports");
  copyFileSync(file, backup);
  pkg.exports = pkg.publishConfig.exports;
  delete pkg.publishConfig.exports;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
