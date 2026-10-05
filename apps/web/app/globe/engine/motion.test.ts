import { describe, expect, it } from "vitest";
import { createFlight, isStill, releaseVelocity, sampleFlight, stepInertia } from "./motion";

describe("flights", () => {
  const from = { lon: 170, lat: 10, zoom: 2 };
  const to = { lon: -170, lat: 40, zoom: 3.2 };
  const f = createFlight(from, to, 1000);

  it("takes the short way across the antimeridian", () => {
    expect(f.to.lon).toBeCloseTo(190);
  });
  it("starts at from, ends exactly at to, and reports done", () => {
    expect(sampleFlight(f, 1000, 1).view.lon).toBeCloseTo(170);
    const end = sampleFlight(f, 1000 + f.duration, 1);
    expect(end.done).toBe(true);
    expect(end.view.lat).toBe(40);
    expect(end.view.zoom).toBe(3.2);
  });
  it("bounds its duration", () => {
    expect(f.duration).toBeGreaterThanOrEqual(450);
    expect(f.duration).toBeLessThanOrEqual(1600);
  });
  it("never dips below the minimum zoom", () => {
    const far = createFlight({ lon: 0, lat: 0, zoom: 2 }, { lon: 180, lat: 0, zoom: 2 }, 0);
    for (let t = 0; t <= far.duration; t += 20) expect(sampleFlight(far, t, 1.9).view.zoom).toBeGreaterThanOrEqual(1.9 - 1e-9);
  });
});

describe("inertia", () => {
  it("decays and then stops exactly", () => {
    let v = { lon: 0.05, lat: 0.02 };
    let steps = 0;
    while (!isStill(v) && steps < 2000) {
      v = stepInertia(v, 16, 400, 320).velocity;
      steps++;
    }
    expect(isStill(v)).toBe(true);
    expect(steps).toBeLessThan(2000);
  });
  it("caps the step so a long frame cannot overshoot", () => {
    const { move } = stepInertia({ lon: 1, lat: 0 }, 500, 400, 320);
    expect(move.lon).toBeCloseTo(48);
  });
});

describe("releaseVelocity", () => {
  const drag = (t0: number) => [
    { t: t0, dx: 10, dy: 0 },
    { t: t0 + 16, dx: 10, dy: 0 },
    { t: t0 + 32, dx: 10, dy: 0 },
  ];
  it("flings in the drag direction (dragging right moves the view west)", () => {
    const v = releaseVelocity(drag(100), 140, 400, 0, 2.2);
    expect(v).not.toBeNull();
    expect(v!.lon).toBeLessThan(0);
  });
  it("does not fling after the pointer rested", () => {
    expect(releaseVelocity(drag(100), 400, 400, 0, 2.2)).toBeNull();
  });
  it("ignores slow drags", () => {
    expect(releaseVelocity([{ t: 0, dx: 0.1, dy: 0 }, { t: 16, dx: 0.1, dy: 0 }], 20, 400, 0, 2.2)).toBeNull();
  });
});
