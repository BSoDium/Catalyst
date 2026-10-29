import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("the lights are fetched when the showcase comes on, not only when the globe is made", () => {
  it("asks for them at creation wherever the page has a night (the showcase's capability, not the hero's state: coming back to the globe from another page makes it with the hero collapsed, and its night is there) and again in `setShowcase`", () => {
    const src = readFileSync("app/globe/engine/renderer.ts", "utf8");
    expect(src).toMatch(/if \(this\.showcaseActive\) this\.wantLights\(\);/);
    expect(src).toMatch(/setShowcase\(on: boolean\) \{\s*this\.appShowcase = on;\s*if \(on\) this\.wantLights\(\);/);
    // (once: the idle request is made one time, whoever asks first)
    expect(src).toMatch(/if \(this\.lightsAsked \|\| this\.disposed\) return;/);
  });
});
