import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { publishedProjectionStructureSchema } from "./published";

/**
 * Emits the language-neutral contract consumed by the private content repo.
 * JSON Schema cannot express cross-references (route stops, related links);
 * those are enforced by `parsePublishedProjection` in this repo's CI.
 */
export function buildJsonSchema(): string {
  const schema = z.toJSONSchema(publishedProjectionStructureSchema, { target: "draft-2020-12" });
  return `${JSON.stringify({ title: "Catalyst published projection", ...schema }, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL("../published.schema.json", import.meta.url));
  writeFileSync(out, buildJsonSchema());
  console.log(`wrote ${out}`);
}
