import { describe, expect, it } from "vitest";
import { matchesArchive } from "./archive";

describe("matchesArchive", () => {
  it("finds the entry by its words and their starts", () => {
    for (const q of ["v1", "version 1", "old", "arch", "first version", "Archived"]) expect(matchesArchive(q), q).toBe(true);
  });
  it("does not find it by nothing, one stray letter or other words", () => {
    for (const q of ["", "  ", "o", "s", "lisbon", "version lisbon"]) expect(matchesArchive(q), q).toBe(false);
  });
});
