import { describe, expect, it } from "vitest";
import { MOON, moonAmount, moonDiameter, moonPlace, moonSprite, orbitAngle, semiMajor, spriteCells, toRad, type MoonGeometry } from "./moon";

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

describe("the moon's sprite", () => {
  it("is a disc with a one-pixel outline, symmetric in its outline, lit on the upper left", () => {
    const n = spriteCells(40, 4);
    expect(n % 2).toBe(1);
    const s = moonSprite(n);
    const at = (i: number, j: number) => s[j * n + i]!;
    expect(at(0, 0)).toBe(0);
    expect(at(n - 1, n - 1)).toBe(0);
    const mid = (n - 1) / 2;
    expect(at(mid, 0)).toBe(1);
    expect(at(0, mid)).toBe(1);
    expect(at(n - 1, mid)).toBe(1);
    expect(at(mid, n - 1)).toBe(1);
    let lit = 0;
    let shade = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) (i + j < n - 1 ? (at(i, j) === 2 ? lit++ : 0) : at(i, j) === 3 ? shade++ : 0);
    expect(lit).toBeGreaterThan(shade / 2);
    expect(shade).toBeGreaterThan(0);
  });

  it("asks for an odd number of cells, at least nine", () => {
    expect(spriteCells(10, 4)).toBe(9);
    expect(spriteCells(54, 3) % 2).toBe(1);
  });
});
