import { describe, expect, it } from "vitest";
import { CELL, MOON, dither4, moonAmount, moonDiameter, moonPlace, moonSprite, orbitAngle, sampleMoon, semiMajor, spriteCells, toRad, type MoonGeometry } from "./moon";
import { SURFACE } from "./surface";

const G: MoonGeometry = { cx: 700, cy: 400, s: 320, width: 1400, height: 800, blocks: [] };
const FRONT = toRad(90);
const BACK = toRad(270);

describe("the moon's orbit", () => {
  it("turns once in a period, and starts where the page says", () => {
    expect(orbitAngle(0)).toBeCloseTo(toRad(MOON.startDeg));
    expect(orbitAngle(MOON.periodMs) - orbitAngle(0)).toBeCloseTo(2 * Math.PI);
  });

  it("has a near half over the planet and a far half the planet hides", () => {
    const front = moonPlace(G, FRONT);
    const back = moonPlace(G, BACK);
    expect(front.front).toBe(true);
    expect(back.front).toBe(false);
    expect(front.alpha).toBe(1);
    // the far half's middle is inside the silhouette (the ellipse is flatter than the planet is tall)
    expect(Math.hypot(back.x - G.cx, back.y - G.cy)).toBeLessThan(G.s);
    expect(back.alpha).toBe(0);
    expect(front.size).toBeGreaterThan(back.size);
  });

  it("shows the far half again beyond the limb, softly", () => {
    const side = moonPlace(G, toRad(180 + 4));
    expect(Math.hypot(side.x - G.cx, side.y - G.cy)).toBeGreaterThan(G.s);
    expect(side.alpha).toBe(1);
    // across the limb it is partly there
    let partly = false;
    for (let d = 180; d < 270; d += 0.5) {
      const p = moonPlace(G, toRad(d));
      if (p.alpha > 0.05 && p.alpha < 0.95) partly = true;
    }
    expect(partly).toBe(true);
  });

  it("leans on the screen: the right-hand end is higher than the left-hand end", () => {
    expect(moonPlace(G, 0).y).toBeLessThan(moonPlace(G, Math.PI).y);
  });

  it("stays inside a narrow window, and never closer to the limb than the tuned minimum", () => {
    const narrow: MoonGeometry = { cx: 195, cy: 300, s: 170, width: 390, height: 800, blocks: [] };
    const d = moonDiameter(narrow.s);
    const a = semiMajor(narrow, d);
    expect(a).toBeGreaterThanOrEqual(MOON.minA * narrow.s - 1e-9);
    for (let deg = 0; deg < 360; deg += 5) {
      const p = moonPlace(narrow, toRad(deg));
      if (a > MOON.minA * narrow.s + 1e-9) {
        expect(p.x - p.size / 2).toBeGreaterThanOrEqual(-1);
        expect(p.x + p.size / 2).toBeLessThanOrEqual(narrow.width + 1);
      }
    }
    // a wide window gives it the tuned orbit
    expect(semiMajor(G, moonDiameter(G.s))).toBeCloseTo(MOON.a * G.s);
  });

  it("is taken away by the hero's text and comes back above it", () => {
    const p = moonPlace(G, FRONT);
    const under = moonPlace({ ...G, blocks: [{ x0: p.x - 100, x1: p.x + 100, top: p.y - 5 }] }, FRONT);
    const above = moonPlace({ ...G, blocks: [{ x0: p.x - 100, x1: p.x + 100, top: p.y + 200 }] }, FRONT);
    const beside = moonPlace({ ...G, blocks: [{ x0: p.x + 500, x1: p.x + 900, top: p.y - 5 }] }, FRONT);
    expect(under.alpha).toBe(0);
    expect(above.alpha).toBe(1);
    expect(beside.alpha).toBe(1);
  });

  it("belongs to the world view: gone by the time the first places are named", () => {
    expect(moonAmount(3, 3)).toBe(1);
    expect(moonAmount(3 + MOON.fadeFrom, 3)).toBe(1);
    expect(moonAmount(3 + MOON.fadeTo, 3)).toBe(0);
    expect(moonAmount(1, 3)).toBe(1);
  });
});

describe("the moon's picture", () => {
  /** A map of two halves: dark on the left of the middle, light on the right. */
  const map = { width: 8, height: 4, data: Uint8Array.from({ length: 32 }, (_, k) => (k % 8 < 4 ? 40 : 230)) };

  it("is read by direction: longitude 0 in the middle of the map, east to the right", () => {
    expect(sampleMoon(map, 0.9, 0, 0.1)).toBeGreaterThan(0.8);
    expect(sampleMoon(map, -0.9, 0, 0.1)).toBeLessThan(0.3);
  });

  it("has the globe's own dither: 0..1, a quarter-step lattice with period 8, and half of the pixels under one half", () => {
    let under = 0;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const d = dither4(x, y);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(1.25);
        expect(dither4(x + 8, y + 8)).toBeCloseTo(d);
        if (d < SURFACE.cover) under++;
      }
    expect(under).toBeGreaterThan(20);
    expect(under).toBeLessThan(44);
  });
});

describe("the moon's sprite", () => {
  const n = spriteCells(40, 4);
  const map = { width: 8, height: 4, data: Uint8Array.from({ length: 32 }, (_, k) => (k % 8 < 4 ? 40 : 230)) };

  it("is a disc with a one-pixel outline round a body in the page's colour", () => {
    expect(n % 2).toBe(1);
    const s = moonSprite(n, null, 0, 0);
    const at = (i: number, j: number) => s[j * n + i]!;
    const mid = (n - 1) / 2;
    expect(at(0, 0)).toBe(CELL.none);
    expect(at(n - 1, n - 1)).toBe(CELL.none);
    for (const [i, j] of [[mid, 0], [0, mid], [n - 1, mid], [mid, n - 1]] as const) expect(at(i, j)).toBe(CELL.outline);
    expect(at(mid, mid)).toBe(CELL.body);
    expect([...s].filter((c) => c > CELL.body)).toHaveLength(0);
  });

  it("with the picture has the ground in three tones, in the Earth's stipple: a share of the pixels, the same share as the Earth's cover", () => {
    const s = moonSprite(n, map, 0, 0);
    const inside = [...s].filter((c) => c >= CELL.body);
    const ground = inside.filter((c) => c > CELL.body);
    expect(ground.length / inside.length).toBeGreaterThan(SURFACE.cover - 0.12);
    expect(ground.length / inside.length).toBeLessThan(SURFACE.cover + 0.12);
    // the picture's dark half is on the left of the disc and the light on the right
    const mid = (n - 1) / 2;
    const left = [...s].filter((c, k) => k % n < mid && c > CELL.body);
    const right = [...s].filter((c, k) => k % n > mid && c > CELL.body);
    expect(left.every((c) => c === CELL.tone0)).toBe(true);
    expect(right.every((c) => c === CELL.tone2)).toBe(true);
  });

  it("puts the stipple where the buffer's dither does: the same pixel, the same answer wherever the sprite is", () => {
    const a = moonSprite(n, map, 3, 20);
    const b = moonSprite(n, map, 3 + 8, 20 + 8);
    expect([...a]).toEqual([...b]);
    const c = moonSprite(n, map, 4, 20);
    expect([...a]).not.toEqual([...c]);
  });

  it("asks for an odd number of cells, at least nine", () => {
    expect(spriteCells(10, 4)).toBe(9);
    expect(spriteCells(54, 3) % 2).toBe(1);
  });
});
