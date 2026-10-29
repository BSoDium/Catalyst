import { describe, expect, it } from "vitest";
import { fitZoom, silhouetteRadiusPx } from "./geo";
import { IMMERSION, immersiveZoom, interactiveZoom, narrowness, openingZoom } from "./immersion";
import { moonAmount } from "./moon";
import { LANDING, TUNING } from "./tuning";

describe("narrowness", () => {
  it("is whole on a phone, none on a wide window, and smooth between", () => {
    expect(narrowness(390)).toBe(1);
    expect(narrowness(LANDING.narrowPx)).toBe(1);
    expect(narrowness(LANDING.widePx)).toBe(0);
    expect(narrowness(1440)).toBe(0);
    const mid = narrowness((LANDING.narrowPx + LANDING.widePx) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe("immersiveZoom", () => {
  const phone = { w: 390, h: 844 };
  const fit = fitZoom(phone.w, phone.h, TUNING.fitMargin);

  it("brings the planet wider than a phone's screen, over half its height", () => {
    const z = immersiveZoom(phone.w, phone.h, fit);
    const r = silhouetteRadiusPx(z, phone.h);
    expect(z).toBeGreaterThan(fit);
    expect(r).toBeCloseTo(IMMERSION.overscan * (phone.w / 2), 0);
    expect(r).toBeGreaterThan(phone.w / 2); // the sides are cut off
    expect((2 * r) / phone.h).toBeGreaterThan(0.5); // over half the height
  });
  it("is the fit on a wide window, and never under it", () => {
    const wide = { w: 1440, h: 900 };
    const f = fitZoom(wide.w, wide.h, TUNING.fitMargin);
    expect(immersiveZoom(wide.w, wide.h, f)).toBe(f);
    expect(immersiveZoom(300, 100, 5)).toBeGreaterThanOrEqual(5);
  });
  it("keeps the planet to a share of the height when the width alone would ask for more, and never under the fit's", () => {
    const fit600 = fitZoom(600, 900, TUNING.fitMargin);
    const z = immersiveZoom(600, 900, fit600);
    expect(silhouetteRadiusPx(z, 900)).toBeCloseTo(IMMERSION.maxHeightShare * 900, 0);
    expect(z).toBeGreaterThan(fit600);
    // (a window whose fit is already bigger than the cap keeps the fit)
    const fitShort = fitZoom(600, 500, TUNING.fitMargin);
    expect(immersiveZoom(600, 500, fitShort)).toBeCloseTo(fitShort, 6);
  });
  it("is the fit for a window with no size", () => {
    expect(immersiveZoom(0, 0, 3)).toBe(3);
  });
});

describe("the effects measured from the world view", () => {
  it("are whole at the phone's closer zoom, where the fit's would have gone", () => {
    const fit = fitZoom(390, 844, TUNING.fitMargin);
    const world = immersiveZoom(390, 844, fit);
    expect(moonAmount(world, world)).toBe(1);
    expect(moonAmount(world, fit)).toBeLessThan(1);
  });
});

describe("the zoom the home page opens at", () => {
  const phone = { minZoom: 1.06, world: 1.9, fit: 1.34 };

  it("is the lowest zoom when the hero is at rest at the start", () => {
    expect(openingZoom({ ...phone, showcaseActive: true, showcaseOn: true })).toBe(phone.minZoom);
  });

  it("is the world view, the closer zoom of a phone, when the visitor came back from another page and the hero starts collapsed", () => {
    expect(openingZoom({ ...phone, showcaseActive: true, showcaseOn: false })).toBe(phone.world);
  });

  it("is the whole-globe fit on a page without a showcase", () => {
    expect(openingZoom({ ...phone, showcaseActive: false, showcaseOn: false })).toBe(phone.fit);
  });

  it("is, on a wide window, the lowest zoom (where a gesture leaves the planet), not the whole-globe fit half a level closer", () => {
    expect(openingZoom({ minZoom: 1.5, world: 2.18, fit: 2.18, showcaseActive: true, showcaseOn: false })).toBe(1.5);
    expect(interactiveZoom({ minZoom: 1.5, world: 2.18, fit: 2.18 })).toBe(1.5);
    expect(interactiveZoom({ ...phone })).toBe(phone.world);
  });
});
