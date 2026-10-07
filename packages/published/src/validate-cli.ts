import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePublishedProjection } from "@catalyst/schemas";
import { resolveValidateTarget } from "./validate-target";

/** `pnpm validate:published [path]`: validates a projection file (default: the committed one). A relative path is relative to where the command was typed. */
const arg = process.argv[2];
const target = arg === undefined ? fileURLToPath(new URL("../data/projection.json", import.meta.url)) : resolveValidateTarget(arg);
try {
  const p = parsePublishedProjection(JSON.parse(readFileSync(target, "utf8")));
  console.log(`ok: ${target} (${p.places.length} places, ${p.groups.length} groups, ${p.routes.length} routes)`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
