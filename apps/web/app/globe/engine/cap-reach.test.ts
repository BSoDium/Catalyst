import { describe, expect, it } from "vitest";
import { capReaches, lonLatToVec3, projectUnit, viewBasis, zoomToRadiusPx } from "./geo";

const W = 1200;
const H = 800;
const out = { x: 0, y: 0, visible: false, facing: 0 };

describe("capReaches: a cap that is out of reach has no point on the canvas", () => {
  it("is sound: whenever a point of the cap is on the canvas, the cap is reached", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let n = 0; n < 4000; n++) {
      const zoom = 2 + rnd() * 4.5;
      const view = { lon: rnd() * 360 - 180, lat: rnd() * 120 - 60, zoom };
      const basis = viewBasis(view, H);
      const u = lonLatToVec3(view.lon + (rnd() - 0.5) * 40, view.lat + (rnd() - 0.5) * 30);
      const rho = rnd() * 0.12;
      // a point of the cap: the direction u turned by up to rho towards a random side
      const side = lonLatToVec3(rnd() * 360 - 180, rnd() * 180 - 90);
      const [sx, sy, sz] = side;
      const k = rnd() * rho;
      const p0 = [u[0] * Math.cos(k) + sx * Math.sin(k), u[1] * Math.cos(k) + sy * Math.sin(k), u[2] * Math.cos(k) + sz * Math.sin(k)] as [number, number, number];
      const len = Math.hypot(p0[0], p0[1], p0[2]);
      const p: [number, number, number] = [p0[0] / len, p0[1] / len, p0[2] / len];
      // the angle between p and u is at most rho only when `side` is orthogonal to u: take it so
      const dot = p[0] * u[0] + p[1] * u[1] + p[2] * u[2];
      if (Math.acos(Math.min(1, dot)) > rho) continue;
      const s = projectUnit(p[0], p[1], p[2], basis, H, 1, W / 2, { x: 0, y: 0, visible: false, facing: 0 }, H / 2);
      const onCanvas = s.visible && s.x >= 0 && s.x <= W && s.y >= 0 && s.y <= H;
      if (onCanvas) expect(capReaches({ u, rho }, basis, W, H, W / 2, H / 2, out)).toBe(true);
    }
  });
  it("skips a cap on the other side of the planet and one far off the screen, keeps one on it", () => {
    const view = { lon: 10, lat: 45, zoom: 5 };
    const basis = viewBasis(view, H);
    expect(zoomToRadiusPx(5)).toBeGreaterThan(1000);
    expect(capReaches({ u: lonLatToVec3(10, 45), rho: 0.01 }, basis, W, H, W / 2, H / 2, out)).toBe(true);
    expect(capReaches({ u: lonLatToVec3(-170, -45), rho: 0.05 }, basis, W, H, W / 2, H / 2, out)).toBe(false);
    expect(capReaches({ u: lonLatToVec3(40, 45), rho: 0.01 }, basis, W, H, W / 2, H / 2, out)).toBe(false);
  });
});
