import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAP_CONTRAST, MAP_CONTRAST_DARK, PALETTE_LEVELS, buildRamp, roleLevel, type Rgb } from "./palette";

/**
 * What the HUD (labels, markers, nav) needs from the map behind it: the map recedes (its loudest level is well
 * below the ink) and the text over it stays AA-readable even when the brightest map tone is right under it. The tokens are read
 * from app.css, the plates from the code that draws them (overlay/hud-layer.ts, app.css `.nav-scrim`).
 */
const css = readFileSync(new URL("../../app.css", import.meta.url), "utf8");
const token = (scheme: "light" | "dark", name: string): Rgb => {
  const block = scheme === "light" ? css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)")) : css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("--color-background") > 0 ? css.indexOf("@theme") : undefined);
  const m = new RegExp(`${name}:\\s*#([0-9a-f]{6})`).exec(block);
  if (!m) throw new Error(`${scheme} ${name} missing`);
  return [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16) / 255) as unknown as Rgb;
};
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (c: Rgb) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
export const contrast = (a: Rgb, b: Rgb) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
/** `top` at `alpha` over `under` (sRGB channels, as CSS compositing does). */
const over = (top: Rgb, alpha: number, under: Rgb): Rgb => [0, 1, 2].map((i) => top[i]! * alpha + under[i]! * (1 - alpha)) as unknown as Rgb;

for (const scheme of ["light", "dark"] as const) {
  describe(`HUD readability over the map (${scheme})`, () => {
    const bg = token(scheme, "--background");
    const fg = token(scheme, "--foreground");
    const muted = token(scheme, "--muted-foreground");
    const ramp = buildRamp(bg, fg);
    const peak = ramp[roleLevel("peak")]!;
    const ink = ramp[roleLevel("ink")]!;
    // the brightest map tone is the peak; a route line (full ink) can still pass under a label
    const behind = [peak, ink];

    it("the map tops out well below the ink: peak is at most 6:1 against the page and the ink is at least 3:1 above it", () => {
      expect(PALETTE_LEVELS).toBeGreaterThanOrEqual(10);
      expect(contrast(peak, bg)).toBeLessThan(6);
      expect(contrast(peak, bg)).toBeGreaterThan(3.5); // roads and coastlines stay legible
      expect(contrast(ink, peak)).toBeGreaterThanOrEqual(3); // WCAG 1.4.11: a marker is distinct from the loudest map tone
      expect(MAP_CONTRAST).toBeLessThan(0.7);
      expect(MAP_CONTRAST_DARK).toBeLessThan(0.7);
    });
    it("label text (foreground on the 82 % page plate) is at least 7:1 even over a full-ink route", () => {
      for (const under of behind) expect(contrast(fg, over(bg, 0.82, under))).toBeGreaterThanOrEqual(7);
    });
    it("a selected label (page colour on a solid ink plate) is opaque, so its ratio does not depend on the map", () => {
      expect(contrast(bg, fg)).toBeGreaterThanOrEqual(15);
    });
    it("muted text (muted foreground on a 90 % page plate) are at least 4.5:1 over the peak and over ink", () => {
      for (const under of behind) expect(contrast(muted, over(bg, 0.9, under))).toBeGreaterThanOrEqual(4.5);
    });
    it("the Credits link (subtle foreground) is dimmer than muted text by colour, yet still AA against the page and over a map tone under its page-colour halo", () => {
      const subtle = token(scheme, "--subtle-foreground");
      expect(contrast(subtle, bg)).toBeLessThan(contrast(muted, bg));
      expect(contrast(subtle, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(subtle, over(bg, 0.9, peak))).toBeGreaterThanOrEqual(4);
      // dimmer by colour, never by opacity
      expect(readFileSync(new URL("../../components/attribution-button.tsx", import.meta.url), "utf8")).not.toMatch(/className="[^"]*opacity|style=\{\{[^}]*opacity/);
    });
    it("nav links (muted foreground under the nav scrim, about 80 % page colour at the text) are at least 4.5:1 over the peak", () => {
      expect(contrast(muted, over(bg, 0.8, peak))).toBeGreaterThanOrEqual(4.5);
    });
  });
}
