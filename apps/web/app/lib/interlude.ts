/**
 * The search palette's hidden entry, "I like surprises", that plays the cinematic interlude (globe/engine/cinematic.ts; the request to the globe is `globe/interlude.ts`).
 */
import { foldText } from "./search";

/** The entry's name, its second line, and the words (and the longer phrases they begin) it is found by. */
export const SURPRISE = {
  title: "I like surprises",
  sub: "Play the studio parody",
  words: ["i", "like", "surprises", "surprise", "impress", "me", "easter", "egg", "universal", "parody", "cinematic"],
} as const;

/**
 * Whether the typed query finds the entry. It is meant to be hard to come across: every word of the query must begin one of the entry's own words and the longest of them must have
 * at least five letters (so "impress", "surpr", "easter egg" find it; "par" or "uni", the start of Paris or a university, "like", "i" and "place" do not), and it is listed after
 * everything else the query matches, not among it.
 */
export function matchesSurprise(query: string): boolean {
  const words = foldText(query).split(" ").filter(Boolean);
  if (words.length === 0 || Math.max(...words.map((w) => w.length)) < 5) return false;
  return words.every((w) => SURPRISE.words.some((x) => x.startsWith(w) && (w.length >= 2 || x === w)));
}
