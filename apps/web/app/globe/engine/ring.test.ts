import { describe, expect, it } from "vitest";
import { DEG, fitZoom, silhouetteRadiusPx, silhouetteZoom } from "./geo";
import { activeLevels, roleLevel } from "./palette";
import { CAP_HEIGHT_EM, GlyphBuffer, placeGlyphs, ringAlpha, ringFloorZoom, ringLayout, ringPhase, ringText, ringTargetEm, ringTone } from "./ring";
import { SPIN } from "./idle-spin";
import { RING } from "./tuning";
import { RING_LINE_BUDGET, ringPhrases } from "../ring-text";

/** The identity the app hands in (the shape of `SITE` in lib/site.ts: this folder imports nothing from the app). */
const IDENTITY = {
  name: "Elliot Négrel-Jerzy",
  role: "Design engineer",
  location: "Paris",
  speciality: "Data visualisation, geospatial and cartography interfaces, design systems, computer graphics",
};
const LINE = ringText(ringPhrases(IDENTITY));

describe("silhouette zoom", () => {
  it("is the inverse of the silhouette radius, and `fitZoom` is built on it", () => {
    for (const h of [600, 900, 1200]) {
      for (const r of [80, 200, 396]) expect(silhouetteRadiusPx(silhouetteZoom(r, h), h)).toBeCloseTo(r, 6);
    }
    expect(fitZoom(1440, 900, 0.12)).toBeCloseTo(silhouetteZoom(450 * 0.88, 900), 12);
  });
});

describe("the ring's text", () => {
  it("is the phrases in capitals, a middle dot between them and one more to close the loop", () => {
    expect(ringText(["a b", "c"])).toBe("A B · C · ");
    expect(ringText([])).toBe("");
    expect(ringText(["  ", ""])).toBe("");
  });

  it("is the site identity, nothing else: the name, the role, the specialities that fit, the place", () => {
    // all of them when the budget allows
    expect(ringPhrases(IDENTITY, 1000)).toEqual([
      "Elliot Négrel-Jerzy",
      "Design engineer",
      "Data visualisation",
      "geospatial and cartography interfaces",
      "design systems",
      "computer graphics",
      "Paris",
    ]);
    // by default the last specialities that would make the line longer than the ring closes well with are left off
    expect(ringPhrases(IDENTITY)).toEqual(["Elliot Négrel-Jerzy", "Design engineer", "Data visualisation", "geospatial and cartography interfaces", "design systems", "Paris"]);
    expect(LINE).toBe("ELLIOT NÉGREL-JERZY · DESIGN ENGINEER · DATA VISUALISATION · GEOSPATIAL AND CARTOGRAPHY INTERFACES · DESIGN SYSTEMS · PARIS · ");
    expect(LINE.length).toBeLessThanOrEqual(RING_LINE_BUDGET);
    // never the name, the role or the place
    expect(ringPhrases(IDENTITY, 10)).toEqual(["Elliot Négrel-Jerzy", "Design engineer", "Paris"]);
  });

  it("leaves out what is blank, and a lone speciality is one phrase", () => {
    expect(ringPhrases({ name: " Ada ", role: "", location: "Lyon", speciality: "maps,, ,graphs" })).toEqual(["Ada", "maps", "graphs", "Lyon"]);
    expect(ringPhrases({ name: "Ada", role: "", location: "Lyon", speciality: "" })).toEqual(["Ada", "Lyon"]);
    expect(ringPhrases({ name: "A", role: "B", location: "C", speciality: "one field" })).toEqual(["A", "B", "one field", "C"]);
    expect(ringText(ringPhrases({ name: "", role: "", location: "", speciality: "" }))).toBe("");
  });
});

describe("the layout: the line closes evenly round the ring", () => {
  const adv = RING.type.advanceEm;
  // The silhouette's radius at the lowest zoom for the viewports the ring is checked at (1440x900, 1024x700, 390x844, 844x390, 1920x1080, the panel's half).
  const radii = [281, 190, 122, 100, 380, 150, 60];

  it("goes round a whole number of times and fills the circumference exactly: n * length advances of em * (0.6 + tracking)", () => {
    for (const r of radii) {
      const l = ringLayout(LINE.length, r);
      expect(Number.isInteger(l.repeats)).toBe(true);
      expect(l.repeats).toBeGreaterThanOrEqual(1);
      const em = l.emPerR * r;
      const circumference = 2 * Math.PI * r * (1 + RING.gap);
      expect(l.repeats * LINE.length * em * (adv + l.tracking)).toBeCloseTo(circumference, 6);
    }
  });

  it("takes more em beside a big planet (a laptop screen), the least on a small one, never past the cap", () => {
    expect(ringTargetEm(60)).toBe(RING.type.targetEmPx);
    expect(ringTargetEm(340)).toBeGreaterThan(RING.type.targetEmPx);
    expect(ringTargetEm(5000)).toBe(RING.type.maxEmPx);
  });

  it("keeps the letters near the target size, the tracking near the nominal, and never lets them touch", () => {
    for (const r of radii.filter((v) => v >= 100)) {
      const l = ringLayout(LINE.length, r);
      const em = l.emPerR * r;
      const target = ringTargetEm(r);
      expect(em).toBeLessThanOrEqual(target * (1 + RING.type.emSlack) + 1e-9);
      expect(l.tracking).toBeGreaterThan(0.02 - 1e-9);
      expect(Math.abs(l.tracking - RING.type.tracking)).toBeLessThan(0.2);
      // within the slack of the target, or, when the line is too long for the ring at that size (a phone: about 160 letters on a circle of 770 px),
      // shrunk by what it takes to keep the tightest tracking: never more than a third below the target
      if (em < target * (1 - RING.type.emSlack) - 1e-9) {
        expect(l.tracking).toBeCloseTo(0.02, 9);
        expect(em).toBeGreaterThan(target * (2 / 3));
      }
    }
    // A ring too small for the line at the smallest em shrinks the type instead of overlapping it.
    const tiny = ringLayout(LINE.length, 30);
    expect(tiny.tracking).toBeGreaterThanOrEqual(0.02 - 1e-9);
  });

  it("is a ratio of the silhouette: the same layout closes at any zoom", () => {
    const l = ringLayout(LINE.length, 281);
    const g = new GlyphBuffer();
    for (const r of [60, 140, 281, 396]) {
      placeGlyphs(g, { text: LINE, layout: l, phase: 0, r, cx: 0, cy: 0 });
      // The advance along the baseline circle is the em times (0.6 + tracking), whatever r is.
      const step = (2 * Math.PI) / (LINE.length * l.repeats);
      expect(step * r * (1 + RING.gap)).toBeCloseTo(g.em * (adv + l.tracking), 6);
    }
  });

  it("repeats more on a bigger ring", () => {
    expect(ringLayout(LINE.length, 380).repeats).toBeGreaterThanOrEqual(ringLayout(LINE.length, 122).repeats);
    expect(ringLayout(0, 200).repeats).toBe(1);
  });
});

describe("placement of the glyphs on the flat circle", () => {
  const text = "ABC DEF · ";
  const layout = { repeats: 3, emPerR: 0.04, tracking: 0.14 };
  const base = { text, layout, phase: 0, r: 280, cx: 700, cy: 450 };

  it("puts every glyph on one circle concentric with the planet, outside its silhouette, one cap height-ish above the baseline", () => {
    const g = new GlyphBuffer();
    const n = placeGlyphs(g, base);
    expect(n).toBe(text.replace(/ /g, "").length * 3);
    const baseline = base.r * (1 + RING.gap);
    expect(g.baseline).toBeCloseTo(baseline, 9);
    expect(g.radius).toBeCloseTo(baseline + (CAP_HEIGHT_EM / 2) * g.em, 9);
    for (let i = 0; i < n; i++) {
      expect(Math.hypot(g.x[i]! - base.cx, g.y[i]! - base.cy)).toBeCloseTo(g.radius, 3);
      expect(g.radius - (CAP_HEIGHT_EM / 2) * g.em).toBeGreaterThan(base.r); // the glyph's bottom is outside the disc
    }
  });

  it("starts at twelve o'clock and runs clockwise, equal steps, the last glyph one step before the first (the seam is no different)", () => {
    const g = new GlyphBuffer();
    placeGlyphs(g, { ...base, text: "ABCDEFGH", layout: { ...layout, repeats: 2 } });
    expect(g.count).toBe(16);
    expect(g.x[0]).toBeCloseTo(base.cx, 3);
    expect(g.y[0]).toBeCloseTo(base.cy - g.radius, 3);
    const step = (2 * Math.PI) / 16;
    for (let i = 0; i < 16; i++) {
      expect(g.angle[i]).toBeCloseTo(i * step, 6);
      // clockwise on the screen (y down): the glyph after twelve o'clock is to its RIGHT.
      if (i === 1) expect(g.x[1]! > g.x[0]!).toBe(true);
      const next = (i + 1) % 16;
      const chord = Math.hypot(g.x[next]! - g.x[i]!, g.y[next]! - g.y[i]!);
      expect(chord).toBeCloseTo(2 * g.radius * Math.sin(step / 2), 3);
    }
  });

  it("points every glyph's top away from the planet and keeps one size (no mirroring, no perspective)", () => {
    const g = new GlyphBuffer();
    placeGlyphs(g, base);
    for (let i = 0; i < g.count; i++) {
      // The glyph's up vector (0, -1) turned clockwise by its angle is (sin a, -cos a): the unit vector from the planet's centre to the glyph.
      const ux = Math.sin(g.angle[i]!);
      const uy = -Math.cos(g.angle[i]!);
      expect((g.x[i]! - base.cx) / g.radius).toBeCloseTo(ux, 3);
      expect((g.y[i]! - base.cy) / g.radius).toBeCloseTo(uy, 3);
    }
    expect(g.em).toBeCloseTo(layout.emPerR * base.r, 9);
  });

  it("turns with the phase: a whole step later glyph k sits where glyph k + 1 was", () => {
    const g0 = new GlyphBuffer();
    const g1 = new GlyphBuffer();
    const text40 = "A".repeat(40);
    const l = { repeats: 1, emPerR: 0.04, tracking: 0.14 };
    const step = (2 * Math.PI) / 40;
    placeGlyphs(g0, { ...base, text: text40, layout: l, phase: 0 });
    placeGlyphs(g1, { ...base, text: text40, layout: l, phase: step });
    for (let k = 0; k < 39; k++) {
      expect(g1.x[k]).toBeCloseTo(g0.x[k + 1]!, 2);
      expect(g1.y[k]).toBeCloseTo(g0.y[k + 1]!, 2);
    }
  });

  it("scales with the planet and follows its centre", () => {
    const a = new GlyphBuffer();
    const b = new GlyphBuffer();
    placeGlyphs(a, { ...base, r: 200, cx: 0, cy: 0 });
    placeGlyphs(b, { ...base, r: 400, cx: 10, cy: -5 });
    for (let i = 0; i < a.count; i++) {
      expect(b.x[i]! - 10).toBeCloseTo(2 * a.x[i]!, 2);
      expect(b.y[i]! + 5).toBeCloseTo(2 * a.y[i]!, 2);
    }
    expect(b.em).toBeCloseTo(2 * a.em, 9);
  });

  it("allocates nothing once the buffer is big enough", () => {
    const g = new GlyphBuffer();
    placeGlyphs(g, base);
    const xs = g.x;
    placeGlyphs(g, { ...base, phase: 1 });
    expect(g.x).toBe(xs);
  });
});

describe("the ring's clock", () => {
  it("runs clockwise at RING.degPerSec, on its own clock: the globe's idle rotation (SPIN) does not change it", () => {
    expect((ringPhase(1000) - ringPhase(0)) / DEG).toBeCloseTo(RING.direction * RING.degPerSec, 9);
    expect(RING.direction).toBe(1);
    expect(RING.degPerSec).toBeGreaterThan(0);
    const was = SPIN.degPerSec;
    try {
      SPIN.degPerSec = was * 20;
      expect((ringPhase(1000) - ringPhase(0)) / DEG).toBeCloseTo(RING.degPerSec, 9);
    } finally {
      SPIN.degPerSec = was;
    }
  });
});

describe("the lowest zoom", () => {
  const cases = [
    { w: 1440, h: 900 },
    { w: 720, h: 900 }, // the panel open
    { w: 390, h: 844 },
    { w: 844, h: 390 },
    { w: 1920, h: 1080 },
  ];

  it("is at least `floorBelowFit` below the fit and keeps the planet and the whole ring in the free area, with the margin", () => {
    for (const { w, h } of cases) {
      const fit = fitZoom(w, h, 0.12);
      const floor = ringFloorZoom({ fit, freeWidth: w, height: h });
      expect(floor).toBeLessThanOrEqual(fit - RING.zoom.floorBelowFit + 1e-9);
      const r = silhouetteRadiusPx(floor, h);
      const l = ringLayout(LINE.length, r);
      const outer = r * (1 + RING.gap) + CAP_HEIGHT_EM * l.emPerR * r;
      expect(outer).toBeLessThanOrEqual((Math.min(w, h) / 2) * (1 - RING.zoom.fitMargin) + 1e-6);
    }
  });

  it("is the highest such zoom when the room, not the 0.5 levels, decides (a very small screen)", () => {
    const fit = fitZoom(240, 240, 0.12);
    const floor = ringFloorZoom({ fit, freeWidth: 240, height: 240 });
    expect(floor).toBeLessThanOrEqual(fit - RING.zoom.floorBelowFit + 1e-9);
  });
});

describe("the fade", () => {
  const fit = 2.7;
  const floor = 2.0;

  it("is gone at the fit and above, full at the floor and below, and monotonic in between", () => {
    expect(ringAlpha(fit, fit, floor)).toBe(0);
    expect(ringAlpha(fit + 3, fit, floor)).toBe(0);
    expect(ringAlpha(floor, fit, floor)).toBe(1);
    expect(ringAlpha(floor - 1, fit, floor)).toBe(1);
    let last = 0;
    for (let z = fit; z >= floor; z -= 0.01) {
      const a = ringAlpha(z, fit, floor);
      expect(a).toBeGreaterThanOrEqual(last - 1e-12);
      last = a;
    }
  });

  it("is already zero before the camera is back at the fit, and full before it is at the floor", () => {
    expect(ringAlpha(fit - RING.zoom.fade.from * (fit - floor), fit, floor)).toBeCloseTo(0, 12);
    expect(ringAlpha(fit - RING.zoom.fade.to * (fit - floor), fit, floor)).toBeCloseTo(1, 12);
  });

  it("is off when there is no room below the fit (no ring: the floor is the fit)", () => {
    expect(ringAlpha(2.5, 2.5, 2.5)).toBe(0);
    expect(ringAlpha(2.0, 2.5, 2.5)).toBe(0);
  });

  it("is a staircase of palette tones, never above the role's level", () => {
    const levels = activeLevels();
    const tones = [0, 0.1, 0.4, 0.7, 1].map((a) => ringTone(a, levels));
    expect(tones[0]).toBe(0);
    expect(tones.at(-1)).toBe(roleLevel(RING.tone, levels));
    for (let i = 1; i < tones.length; i++) expect(tones[i]).toBeGreaterThanOrEqual(tones[i - 1]!);
  });
});
