import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { FOV_DEG, fitZoom, lonLatToVec3, projectLonLat, viewBasis } from "./geo";
import { clampInset, fadeMask, fadeZone, freeWidth, insetShiftBuf, renderMargin, scissorBufWidth } from "./inset";
import { cubicBezier } from "./motion";

describe("inset maths", () => {
  it("clamps the inset to a usable range", () => {
    expect(clampInset(-5, 1000)).toBe(0);
    expect(clampInset(Number.NaN, 1000)).toBe(0);
    expect(clampInset(500, 1000)).toBe(500);
    expect(clampInset(990, 1000)).toBe(850);
  });
  it("shifts the centre by half the inset, in whole buffer pixels", () => {
    expect(insetShiftBuf(720, 3)).toBe(120);
    expect(insetShiftBuf(721, 3)).toBe(120);
    expect(insetShiftBuf(0, 3)).toBe(0);
    expect(Number.isInteger(insetShiftBuf(333, 2.4))).toBe(true);
  });
  it("leaves the left part free", () => {
    expect(freeWidth(1440, 720)).toBe(720);
    expect(freeWidth(1440, 0)).toBe(1440);
  });
  it("fits the whole globe in the free area at minimum zoom", () => {
    // Free area 720x844 (inset 720 of 1440): the limiting side is the width, so the globe must be smaller than
    // when it fits the whole box.
    expect(fitZoom(freeWidth(1440, 720), 844, 0.12)).toBeLessThan(fitZoom(1440, 844, 0.12));
  });
});

describe("fade zone, scissor and mask", () => {
  it("anchors the zone on the panel edge and covers a margin beyond it", () => {
    const z = fadeZone(1440, 720);
    expect(z.end).toBeCloseTo(720 + renderMargin(1440));
    expect(z.start).toBeLessThan(720);
    expect(z.start).toBeLessThan(z.end);
  });
  it("collapses to the box edge when there is no inset, so it is continuous with the panel sliding in", () => {
    const z = fadeZone(1440, 0);
    expect(z.start).toBe(1440);
    expect(z.end).toBe(1440);
    // a 4 px inset yields a zone of about 2 px: it grows smoothly from nothing
    expect(fadeZone(1440, 4).end - 1436).toBeLessThan(3);
  });
  it("has no scissor and no mask without an inset", () => {
    expect(scissorBufWidth(1440, 0, 3, 0, 480)).toBeNull();
    expect(fadeMask(1440, 0)).toBeNull();
  });
  it("scissors to the free area plus the margin, never beyond the buffer", () => {
    const w = scissorBufWidth(1440, 720, 3, 0, 480)!;
    expect(w * 3).toBeGreaterThanOrEqual(720 + renderMargin(1440));
    expect(w * 3).toBeLessThan(720 + renderMargin(1440) + 3);
    expect(scissorBufWidth(1440, 100, 3, 0, 480)).toBeLessThanOrEqual(480);
  });
  it("makes the scissor at least as wide as the opaque part of the mask", () => {
    for (const inset of [10, 120, 400, 720, 1100]) {
      const z = fadeZone(1440, inset);
      expect(scissorBufWidth(1440, inset, 3, -1, 481)! * 3 + -1).toBeGreaterThanOrEqual(Math.min(z.end, 481 * 3 - 1) - 1e-6);
    }
  });
  it("builds a gradient that is opaque on the left and transparent at the end", () => {
    const m = fadeMask(1440, 720)!;
    expect(m.startsWith("linear-gradient(to right, #000 ")).toBe(true);
    expect(m.endsWith(`transparent ${fadeZone(1440, 720).end.toFixed(1)}px)`)).toBe(true);
    // the canvas is offset in its box: stops move with it
    expect(fadeMask(1440, 720, -2)!).toContain(`${(fadeZone(1440, 720).end + 2).toFixed(1)}px`);
  });
});

describe("projection centre shift", () => {
  const width = 1440;
  const height = 900;
  const pixel = 3;
  const bufW = width / pixel;
  const bufH = height / pixel;
  const inset = 720;
  const shift = insetShiftBuf(inset, pixel);

  it("puts the view centre in the middle of the free area", () => {
    const basis = viewBasis({ lon: 2.35, lat: 48.86, zoom: 3.2 }, height);
    const p = projectLonLat(2.35, 48.86, basis, width, height, 1, width / 2 - shift * pixel);
    expect(p.x).toBeCloseTo((width - inset) / 2, 6);
    expect(p.y).toBeCloseTo(height / 2, 6);
  });

  it("agrees with the GPU camera (setViewOffset) for every point", () => {
    // The renderer shifts the camera with `setViewOffset`; labels and picking use `projectLonLat` with a shifted
    // centre. Both must land on the same pixel.
    const view = { lon: 10, lat: 20, zoom: 3.4 };
    const basis = viewBasis(view, height);
    const cam = new PerspectiveCamera(FOV_DEG, bufW / bufH, 0.02, 20);
    cam.position.set(basis.c[0] * basis.d, basis.c[1] * basis.d, basis.c[2] * basis.d);
    cam.up.set(...basis.north);
    cam.lookAt(0, 0, 0);
    cam.setViewOffset(bufW, bufH, shift, 0, bufW, bufH);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    for (const [lon, lat] of [
      [10, 20],
      [14, 24],
      [2.35, 48.86],
      [-5, 5],
    ] as const) {
      const ndc = new Vector3(...lonLatToVec3(lon, lat)).project(cam);
      const gx = ((ndc.x + 1) / 2) * width;
      const gy = ((1 - ndc.y) / 2) * height;
      const ours = projectLonLat(lon, lat, basis, width, height, 1, width / 2 - shift * pixel);
      expect(ours.x).toBeCloseTo(gx, 3);
      expect(ours.y).toBeCloseTo(gy, 3);
    }
  });
});

describe("cubicBezier", () => {
  const ease = cubicBezier(0.2, 0, 0, 1);
  it("is anchored at 0 and 1 and monotonic", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let last = 0;
    for (let i = 1; i <= 100; i++) {
      const v = ease(i / 100);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });
  it("starts fast and ends slow (ease-out)", () => {
    expect(ease(0.25)).toBeGreaterThan(0.5);
    expect(ease(0.5)).toBeGreaterThan(0.8);
  });
  it("is linear for the linear curve", () => {
    const lin = cubicBezier(0, 0, 1, 1);
    expect(lin(0.3)).toBeCloseTo(0.3, 4);
  });
});
