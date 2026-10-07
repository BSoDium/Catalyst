import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { publishedProjectionStructureSchema } from "./published";

/**
 * Emits the language-neutral contract consumed by the private content repo.
 * JSON Schema cannot express cross-references (route stops, related links);
 * those (group parents and cycles, empty groups, slug clashes) are enforced by `parsePublishedProjection` in this
 * repo's CI, and re-implemented in the private repo's export gate.
 */
export function buildJsonSchema(): string {
  // io "input": `groups` has a default, so as an INPUT it is optional. Old projections (without `groups`) stay valid.
  const schema = z.toJSONSchema(publishedProjectionStructureSchema, { target: "draft-2020-12", io: "input" });
  return `${JSON.stringify({ title: "Catalyst published projection", ...schema }, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL("../published.schema.json", import.meta.url));
  writeFileSync(out, buildJsonSchema());
  console.log(`wrote ${out}`);
}
