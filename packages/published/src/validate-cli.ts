import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePublishedProjection } from "@catalyst/schemas";

/** `pnpm validate:published [path]`: validates a projection file (default: the committed one). */
const target = process.argv[2] ?? fileURLToPath(new URL("../data/projection.json", import.meta.url));
try {
  const p = parsePublishedProjection(JSON.parse(readFileSync(target, "utf8")));
  console.log(`ok: ${target} (${p.places.length} places, ${p.routes.length} routes)`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
