import { describe, expect, it } from "vitest";
import { matchesSound } from "~/lib/sound-search";

describe("matchesSound", () => {
  it("finds the sound row by its words", () => {
    for (const q of ["mute", "unmute", "mus", "Sound", "mute music", "au"]) expect(matchesSound(q)).toBe(true);
  });
  it("leaves other queries alone", () => {
    for (const q of ["", "   ", "paris", "m", "mute paris"]) expect(matchesSound(q)).toBe(false);
  });
});
