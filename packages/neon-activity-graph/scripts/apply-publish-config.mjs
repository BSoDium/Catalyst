// While developing, `exports` point at the sources (`src/*.ts`, so a workspace or the playground needs no build); the published package must point at `dist`. npm has no way to swap them at publish time (it ignores `publishConfig.exports` and warns about unknown `publishConfig` keys), so `publishExports` holds the published ones.
// `prepack` runs this to copy `publishExports` over `exports` in package.json for the tarball; `postpack` (`--restore`) puts the sources back.
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
  if (!pkg.publishExports) throw new Error("no publishExports");
  copyFileSync(file, backup);
  pkg.exports = pkg.publishExports;
  delete pkg.publishExports;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
