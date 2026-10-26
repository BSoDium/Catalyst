import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAP_CONTRAST, MAP_CONTRAST_DARK, PALETTE_LEVELS, buildRamp, roleLevel, type Rgb } from "./palette";
import { AA_TEXT, LABEL_PLATE_ALPHA, LABEL_PLATE_FLOOR, LABEL_PLATE_MAX, composite, labelPlateAlpha, minPlateAlpha, roundPlateAlpha } from "./label-plate";
import { LABEL_TYPE } from "./label-text";

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
/** A plain number token of a scheme (`--label-plate-alpha: 0.7`). */
const numberToken = (scheme: "light" | "dark", name: string): number => {
  const block = scheme === "light" ? css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)")) : css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("@theme"));
  const m = new RegExp(`${name}:\\s*([0-9.]+);`).exec(block);
  if (!m) throw new Error(`${scheme} ${name} missing`);
  return Number(m[1]);
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

    it("the map tops out well below the ink: peak is at most 6:1 against the page and the ink is at least 3:1 above it", () => {
      expect(PALETTE_LEVELS).toBeGreaterThanOrEqual(10);
      expect(contrast(peak, bg)).toBeLessThan(6);
      expect(contrast(peak, bg)).toBeGreaterThan(3.5); // roads and coastlines stay legible
      expect(contrast(ink, peak)).toBeGreaterThanOrEqual(3); // WCAG 1.4.11: a marker is distinct from the loudest map tone
      expect(MAP_CONTRAST).toBeLessThan(0.7);
      expect(MAP_CONTRAST_DARK).toBeLessThan(0.7);
    });
    it("the map's loudest tone behind a plate is the peak (a box's outline at rest, one level above the coastline): the plate is built for it", () => {
      const coast = ramp[roleLevel("coast")]!;
      expect(contrast(peak, bg)).toBeGreaterThan(contrast(coast, bg));
      // the labels' translucent plate (below) is computed against `peak`; a route in full ink is louder and is a thin line a plate keeps clear of
      expect(contrast(ink, bg)).toBeGreaterThan(contrast(peak, bg));
    });
    it("paths: the faint tone (the `coast` level, never an alpha) holds 3:1 against the page for graphics (WCAG 1.4.11), below the box at rest; the selected legs' ink is louder still", () => {
      const faint = ramp[roleLevel("coast")]!;
      expect(contrast(faint, bg)).toBeGreaterThanOrEqual(3);
      expect(contrast(peak, bg)).toBeGreaterThan(contrast(faint, bg));
      expect(contrast(ink, bg)).toBeGreaterThan(contrast(faint, bg));
      // the fade-in steps through solid palette levels, each one a real colour of the ramp (no blend with the page)
      for (let level = 1; level <= roleLevel("coast"); level++) expect(ramp[level]).toBeDefined();
    });
    it("a selected label (page colour on a solid ink plate) is opaque, so its ratio does not depend on the map", () => {
      expect(contrast(bg, fg)).toBeGreaterThanOrEqual(15);
    });
    it("the translucent plate: --label-plate-alpha is a chosen value ABOVE the least alpha that keeps the name and the second line AA (4.5:1) over the worst tone behind them (the floor, rounded up to a percent), and still translucent", () => {
      const alpha = numberToken(scheme, "--label-plate-alpha");
      // pinned to the named constant (engine/label-plate.ts) and to the stylesheet's forced-scheme copies
      expect(alpha).toBe(LABEL_PLATE_ALPHA[scheme]);
      const text = { foreground: fg, muted };
      const least = labelPlateAlpha(text, bg, peak);
      // the floor is the WCAG minimum computed from the tokens (pinned: a change of a colour moves it and fails here), the token is clearly above it
      expect(roundPlateAlpha(least)).toBe(LABEL_PLATE_FLOOR[scheme]);
      expect(alpha).toBeGreaterThanOrEqual(least);
      expect(alpha - LABEL_PLATE_FLOOR[scheme]).toBeGreaterThanOrEqual(0.12); // owner, 2026-10-13: "not opaque enough": clearly more than the floor
      // recomputed with the blended colours, the way the compositor does it: both lines clear AA over the peak tone, and just under it does not
      const plate = composite(bg, alpha, peak);
      expect(contrast(fg, plate)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(muted, plate)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(muted, composite(bg, LABEL_PLATE_FLOOR[scheme] - 0.01, peak))).toBeLessThan(AA_TEXT); // one percent under the floor breaks the second line: the binding one
      // every quieter tone of the map is cleaner still: coastlines, borders, roads, the graticule
      for (let k = 0; k < ramp.length - 1; k++) {
        expect(contrast(fg, composite(bg, alpha, ramp[k]!))).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(muted, composite(bg, alpha, ramp[k]!))).toBeGreaterThanOrEqual(AA_TEXT);
      }
      // and it is the plate of the stylesheet's rules: the page colour at that alpha (token), the forced schemes carry the same value
      expect(css).toMatch(/--map-label-plate: color-mix\(in srgb, var\(--background\) calc\(var\(--label-plate-alpha\) \* 100%\), transparent\)/);
      expect(minPlateAlpha(fg, bg, peak)).toBeLessThan(alpha); // the name is never the binding line
      expect(alpha).toBeGreaterThan(0.5); // a plate that says what is behind it still hides most of it: a quarter of the map would not read as a ground
      expect(alpha).toBeLessThanOrEqual(LABEL_PLATE_MAX); // translucent: the map still shows through (a tenth of it or more)
    });
    it("map labels (app.css `.map-label`): a translucent plate of the page colour in EVERY state, the name in the foreground, the second line in the muted foreground, AA on the plate; selected is inverted and opaque", () => {
      const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\.map-(?:label|halo)[^{]*\{[^}]*\}/g)].map((m) => m[0]);
      expect(rules.length).toBeGreaterThanOrEqual(5);
      const all = rules.join("\n");
      // at rest: the foreground on the translucent page-colour plate (--map-label-plate), the second line muted
      expect(all).toMatch(/\.map-label \{[^}]*--map-label-plate: color-mix\(in srgb, var\(--background\)[^}]*color: var\(--foreground\);[^}]*background: var\(--map-label-plate\)/);
      // drawn over other labels (the last resort) the plate is opaque, or it would show the text under it
      expect(all).toMatch(/\.map-label\[data-over\] \{[^}]*--map-label-plate: var\(--background\)/);
      expect(all).toMatch(/\.map-label-sub \{[^}]*color: var\(--muted-foreground\)/);
      // hovered or focused: the text and the plate do not change (only the stacking order), never an underline
      const hover = /\.map-label\[data-mode="hover"\] \{([^}]*)\}/.exec(all)?.[1] ?? "";
      expect(hover).toMatch(/z-index/);
      expect(hover).not.toMatch(/background|color|shadow|underline|decoration/);
      expect(all).not.toMatch(/underline|text-decoration|inset 0 -1px/);
      // selected: inverted, the second line the page colour mixed 28 % toward the foreground
      expect(all).toMatch(/\[data-mode="selected"\] \{[^}]*background: var\(--foreground\);[^}]*color: var\(--background\)/);
      expect(all).toMatch(/\[data-mode="selected"\] \.map-label-sub \{[^}]*color-mix\(in srgb, var\(--background\) 72%, var\(--foreground\)\)/);
      // the feather is the plate's own shadow (engine/label-dom.ts, none when selected or opaque); there is no separate element any more, and the text has no shadow of its own
      expect(all).not.toMatch(/map-halo/);
      expect(all).not.toMatch(/text-shadow/);
      expect(all).not.toMatch(/(?<!-)opacity/); // no dimming in any state (the plate's own alpha is a colour)
      expect(css).toMatch(/\.map-label \{[^}]*font-family: var\(--font-mono\)/);
      // the feather is the plate's own colour, 1 to 2 px (engine/label-dom.ts, LABEL_TYPE.feather)
      expect(readFileSync(new URL("./label-dom.ts", import.meta.url), "utf8")).toMatch(/var\(--map-label-plate\)/);
      expect(LABEL_TYPE.feather.spread + LABEL_TYPE.feather.blur).toBeLessThanOrEqual(4);
      // reduced transparency: an opaque plate
      expect(css).toMatch(/prefers-reduced-transparency: reduce\) \{\s*\/\*[^*]*\*\/\s*\.map-label \{\s*--map-label-plate: var\(--background\)/);
      const invertedSub = over(bg, 0.72, fg);
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(15); // the name on the plate, at rest and hovered
      expect(contrast(bg, fg)).toBeGreaterThanOrEqual(15); // selected: page colour on the foreground plate
      expect(contrast(muted, bg)).toBeGreaterThanOrEqual(4.5); // the second line (11 px) on the plate: AA
      expect(contrast(invertedSub, fg)).toBeGreaterThanOrEqual(4.5); // ... and on the inverted plate
    });
    it("the credits line (subtle foreground on a map label's plate, `--label-plate-alpha`) is dimmer than muted text by colour, yet AA against the page and at least 3.5:1 over the loudest map tone", () => {
      const subtle = token(scheme, "--subtle-foreground");
      const plate = numberToken(scheme, "--label-plate-alpha");
      expect(readFileSync(new URL("../../app.css", import.meta.url), "utf8")).toMatch(/\.map-credits \{[^}]*background: var\(--map-label-plate\)/);
      expect(plate).toBeGreaterThan(0.7);
      expect(contrast(subtle, bg)).toBeLessThan(contrast(muted, bg));
      expect(contrast(subtle, bg)).toBeGreaterThanOrEqual(4.5);
      // worst case: a full-strength peak line under every glyph, unblurred (the card blurs what is behind it, and map lines are one art pixel thin)
      expect(contrast(subtle, over(bg, plate, peak))).toBeGreaterThanOrEqual(3.5);
      // dimmer by colour, never by opacity
      expect(readFileSync(new URL("../../components/attribution-button.tsx", import.meta.url), "utf8")).not.toMatch(/className="[^"]*opacity|style=\{\{[^}]*opacity/);
    });
    it("nav links (muted foreground under the nav scrim, about 80 % page colour at the text) are at least 4.5:1 over the peak", () => {
      expect(contrast(muted, over(bg, 0.8, peak))).toBeGreaterThanOrEqual(4.5);
    });
  });
}
