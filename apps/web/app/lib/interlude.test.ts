import { describe, expect, it } from "vitest";
import { matchesSurprise } from "./interlude";

describe("finding the surprise", () => {
  it("is found by its own words, and only by a word of five letters or more", () => {
    for (const q of ["impress", "impress me", "surprises", "I like surprises", "i like surpr", "easter egg", "surpr", "universal", "parody"]) expect(matchesSurprise(q), q).toBe(true);
  });
  it("is not found by the start of a common word (par, uni, sur), nor by a word that is not its own", () => {
    for (const q of ["", " ", "i", "li", "me", "par", "uni", "sur", "imp", "egg", "like", "i like", "i like sur", "place", "zagreb", "impress zagreb", "like zagreb"]) expect(matchesSurprise(q), q).toBe(false);
  });
});
