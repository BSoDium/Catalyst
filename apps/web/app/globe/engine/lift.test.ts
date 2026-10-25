import { describe, expect, it } from "vitest";
import { CAPTION_BOTTOM_R, CAPTION_HALF_R, landingScale, liftFor, placeAbove } from "./lift";
import { LANDING, LIFT } from "./tuning";

describe("the lift: the planet's centre goes up so it clears what covers the bottom, as far as there is room", () => {
  // 1440 x 900, the planet 300 px in radius at the lowest zoom, the name covering the bottom 182 px.
  const base = { height: 900, planetPx: 300, reachTopPx: 330, cover: 182 };

  it("is what makes the lowest drawn point (the ring's, as far below the centre as its top is above) clear the cover by `gapPx`", () => {
    const lift = liftFor(base);
    expect(lift).toBeCloseTo(450 + 330 + LIFT.gapPx - (900 - 182), 9);
    expect(450 - lift + 330 + LIFT.gapPx).toBeCloseTo(900 - 182, 9);
  });

  it("is 0 when nothing covers the planet: no cover, or a cover the planet already clears", () => {
    expect(liftFor({ ...base, cover: 0 })).toBe(0);
    expect(liftFor({ ...base, cover: 60 })).toBe(0);
    expect(liftFor({ ...base, planetPx: 0 })).toBe(0);
    expect(liftFor({ ...base, height: 0 })).toBe(0);
  });

  it("never pushes the highest thing (the planet, or the ring) out of the window: `marginPx` is kept above it", () => {
    const tall = liftFor({ ...base, cover: 600 });
    expect(450 - tall - 330).toBeGreaterThanOrEqual(LIFT.marginPx - 1e-9);
    expect(tall).toBeCloseTo(450 - 330 - LIFT.marginPx, 9);
    // the ring's top counts when it is higher than the planet
    expect(liftFor({ ...base, cover: 600, reachTopPx: 380 })).toBeLessThan(tall);
    // a reach under the planet's own is the planet's
    expect(liftFor({ ...base, cover: 600, reachTopPx: 100 })).toBeCloseTo(450 - 300 - LIFT.marginPx, 9);
  });

  it("never goes negative, and grows with the cover until the room stops it", () => {
    let last = 0;
    for (let cover = 0; cover <= 700; cover += 20) {
      const v = liftFor({ ...base, cover });
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeGreaterThanOrEqual(last - 1e-9);
      last = v;
    }
    expect(liftFor({ ...base, reachTopPx: 900 })).toBe(0); // no room above at all
  });

  it("answers a phone upright: the stacked block covers more than half the page, the planet goes as high as the room allows", () => {
    const phone = { height: 844, planetPx: 140, reachTopPx: 200, cover: 560 };
    const lift = liftFor(phone);
    expect(lift).toBeCloseTo(422 - 200 - LIFT.marginPx, 9);
    expect(422 - lift - 200).toBeGreaterThanOrEqual(LIFT.marginPx - 1e-9);
  });
});

describe("placeAbove: the biggest planet whose caption clears the content, its lower part free to go under it", () => {
  const reachTop = (r: number) => r * 1.15 + 30;
  const args = { height: 1000, cx: 500, rMax: 380, reachTop };

  it("keeps the planet as big as the room allows when nothing is under the caption's column", () => {
    const p = placeAbove({ ...args, blocks: [{ x0: 0, x1: 60, top: 100 }, { x0: 940, x1: 1000, top: 100 }] })!;
    expect(p.r).toBe(380);
    expect(p.top).toBe(1000);
  });

  it("puts the caption's lowest line `gapPx` above the highest block under it, and lets the planet's bottom go under", () => {
    const top = 620;
    const p = placeAbove({ ...args, blocks: [{ x0: 200, x1: 800, top }] })!;
    expect(p.top).toBe(top);
    const centreY = 1000 / 2 - p.lift;
    expect(centreY + CAPTION_BOTTOM_R * p.r).toBeLessThanOrEqual(top - LIFT.gapPx + 1e-6);
    expect(centreY + p.r).toBeGreaterThan(top); // the planet itself goes under the block
    expect(centreY - reachTop(p.r)).toBeGreaterThanOrEqual(LIFT.marginPx - 1e-6); // the ring's top stays in the window
  });

  it("is the largest such planet (one step bigger would not fit)", () => {
    const blocks = [{ x0: 200, x1: 800, top: 560 }];
    const p = placeAbove({ ...args, blocks })!;
    expect(p.r).toBeLessThan(380);
    const bigger = p.r + 2;
    const highest = LIFT.marginPx + reachTop(bigger);
    const lowest = Math.min(500, 560 - LIFT.gapPx - CAPTION_BOTTOM_R * bigger);
    expect(highest).toBeGreaterThan(lowest);
  });

  it("a smaller planet has a narrower column: it may clear a block a larger one would stand over", () => {
    // a block just outside the narrow column but inside the wide one
    const blocks = [{ x0: 640, x1: 900, top: 200 }];
    const p = placeAbove({ ...args, blocks })!;
    expect(500 + CAPTION_HALF_R * p.r).toBeLessThanOrEqual(640 + 1e-6);
  });

  it("never lifts the planet above what its ring needs, and never lowers it below the page's middle", () => {
    const p = placeAbove({ ...args, blocks: [] })!;
    expect(p.lift).toBe(0);
    const q = placeAbove({ ...args, blocks: [{ x0: 0, x1: 1000, top: 90 }] })!; // no room at all: the smallest planet, as high as it goes
    expect(q.r).toBe(40);
    expect(q.lift).toBeGreaterThan(0);
  });
});

describe("a lower ceiling on the radius (landingScale) never breaks the clearance rule", () => {
  const reachTop = (r: number) => r * 1.15 + 30;
  // the home screen's blocks: the intro and search on the left, the section list on the right, the name across the bottom
  const blocks = [{ x0: 40, x1: 420, top: 640 }, { x0: 780, x1: 1000, top: 380 }, { x0: 40, x1: 900, top: 760 }];
  it("however the radius is capped, the caption's column stays off the blocks it would stand over, and its lowest line stays above them", () => {
    for (const w of [640, 800, 1000, 1100, 1440, 1920]) {
      const p = placeAbove({ height: 900, cx: 500, rMax: 420 * landingScale(w), reachTop, blocks })!;
      const centreY = 900 / 2 - p.lift;
      for (const b of blocks) {
        const overColumn = b.x1 > 500 - CAPTION_HALF_R * p.r && b.x0 < 500 + CAPTION_HALF_R * p.r;
        if (overColumn) expect(centreY + CAPTION_BOTTOM_R * p.r, `width ${w}, block at ${b.x0}`).toBeLessThanOrEqual(b.top - LIFT.gapPx + 1e-6);
      }
      expect(centreY - reachTop(p.r)).toBeGreaterThanOrEqual(LIFT.marginPx - 1e-6);
    }
  });
  it("a lower cap only ever makes the planet smaller, never bigger than the uncapped one (the search steps 2 px, from a different start)", () => {
    const free = placeAbove({ height: 900, cx: 500, rMax: 420, reachTop, blocks })!;
    for (const w of [800, 1100, 1920]) expect(placeAbove({ height: 900, cx: 500, rMax: 420 * landingScale(w), reachTop, blocks })!.r).toBeLessThanOrEqual(free.r + 2);
  });
});

describe("landingScale: a phone keeps the whole planet, a wide window a little less, smoothly between", () => {
  it("is 1 up to the narrow width and `desktop` from the wide one", () => {
    expect(landingScale(375)).toBe(1);
    expect(landingScale(LANDING.narrowPx)).toBe(1);
    expect(landingScale(LANDING.widePx)).toBeCloseTo(LANDING.desktop, 12);
    expect(landingScale(2560)).toBeCloseTo(LANDING.desktop, 12);
  });
  it("only ever goes down as the window widens, with no step", () => {
    let prev = 1;
    for (let w = 300; w <= 2000; w += 10) {
      const s = landingScale(w);
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      expect(prev - s).toBeLessThan(0.01);
      prev = s;
    }
  });
});
