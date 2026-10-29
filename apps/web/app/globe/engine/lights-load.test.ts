import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("the lights are fetched when the showcase comes on, not only when the globe is made", () => {
  it("asks for them at creation (a page that starts with the showcase) and again in `setShowcase`: coming back to the globe from another page makes it before the hero says the showcase is on, and the lights were never there", () => {
    const src = readFileSync("app/globe/engine/renderer.ts", "utf8");
    expect(src).toMatch(/if \(opts\.showcase\) this\.wantLights\(\);/);
    expect(src).toMatch(/setShowcase\(on: boolean\) \{\s*this\.appShowcase = on;\s*if \(on\) this\.wantLights\(\);/);
    // (once: the idle request is made one time, whoever asks first)
    expect(src).toMatch(/if \(this\.lightsAsked \|\| this\.disposed\) return;/);
  });
});
