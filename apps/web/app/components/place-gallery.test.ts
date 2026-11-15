import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { focusScrolls } from "./place-gallery";

describe("focusScrolls (#644)", () => {
  it("scrolls to a picture that is not on screen, even the next one", () => {
    expect(focusScrolls(0, 5, 4)).toBe(true);
    expect(focusScrolls(0, 3, 4)).toBe(true);
  });
  it("scrolls to a far picture, and leaves a visible neighbour alone", () => {
    expect(focusScrolls(300, 8, 4)).toBe(true);
    expect(focusScrolls(300, 5, 4)).toBe(false);
  });
});

describe("the carousel's markup (#644)", () => {
  // (without the comments, which say what the code does not do)
  const source = readFileSync(new URL("./place-gallery.tsx", import.meta.url), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  it("keeps every picture in the tab order: a box of no width, never visibility hidden", () => {
    expect(source).not.toMatch(/visibility\s*[:=]\s*["']?hidden/);
    expect(source).not.toMatch(/style\.visibility/);
  });
  it("has a role and a name", () => {
    expect(source).toMatch(/role="group"[^>]*aria-roledescription="carousel"[^>]*aria-label="Photographs"/);
  });
});
