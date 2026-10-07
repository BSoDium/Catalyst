import { describe, expect, it } from "vitest";
import { isFitView, startsVeiled } from "./types";

describe("startsVeiled: what a reload may show before the first pixel-art frame", () => {
  it("a reload or direct load (no view, or a view fitted on a place) paints the page colour only, then fades the globe in", () => {
    expect(startsVeiled(null)).toBe(true);
    expect(startsVeiled(undefined)).toBe(true);
    const fit = { lon: 2, lat: 48, fitRadiusKm: 12 };
    expect(isFitView(fit)).toBe(true);
    expect(startsVeiled(fit)).toBe(true);
  });
  it("only a remount with a saved view shows at once (there is nothing to fade from)", () => {
    expect(startsVeiled({ lon: 2, lat: 48, zoom: 0.4 })).toBe(false);
    expect(startsVeiled({ lon: 2, lat: 48, zoom: 1, street: 3 })).toBe(false);
  });
});
