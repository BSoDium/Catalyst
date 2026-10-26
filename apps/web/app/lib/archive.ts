import { ARCHIVED_V1 } from "./site";
import { foldText } from "./search";

/** Whether the typed query finds the palette's "Version 1 (archived)" entry: every typed word begins one of the entry's own words (a single letter only if it is a whole word, so "1" does and "o" does not; "v1", "old", "arch" and "first version" find it; an empty query does not). */
export function matchesArchive(query: string): boolean {
  const words = foldText(query).split(" ").filter(Boolean);
  return words.length > 0 && words.every((w) => ARCHIVED_V1.words.some((x) => x.startsWith(w) && (w.length >= 2 || x === w)));
}
