import { afterEach, describe, expect, it } from "vitest";
import { IdleSpin, SPIN, SPIN_DEFAULTS, applySpinFlags, spinBlock, spinFrameMs, yawStepDeg, type SpinContext } from "./idle-spin";
import { zoomToRadiusPx } from "./geo";

const rest: SpinContext = { reduced: false, hidden: false, lost: false, suspended: false, selected: false, focused: false, inset: 0, zoom: 2.7, minZoom: 2.7, busy: false };
const with_ = (c: Partial<SpinContext>): SpinContext => ({ ...rest, ...c });

afterEach(() => Object.assign(SPIN, SPIN_DEFAULTS));

describe("idle rotation: when it may run", () => {
  it("runs on the fully unzoomed world view with nothing going on", () => {
    expect(spinBlock(rest)).toBeNull();
  });
  it("each condition blocks it, with its own reason", () => {
    const cases: [Partial<SpinContext>, string][] = [
      [{ reduced: true }, "reduced-motion"],
      [{ hidden: true }, "hidden"],
      [{ lost: true }, "context-lost"],
      [{ suspended: true }, "street"],
      [{ selected: true }, "place-selected"],
      [{ focused: true }, "place-focused"],
      [{ inset: 720 }, "panel-open"],
      [{ zoom: 3.2 }, "zoomed-in"],
      [{ busy: true }, "camera-busy"],
    ];
    for (const [c, why] of cases) expect(spinBlock(with_(c)), why).toBe(why);
  });
  it("the unzoomed view is the whole-globe fit plus a small slack, whatever the screen's fit zoom is", () => {
    for (const minZoom of [1.9, 2.29, 2.7]) {
      expect(spinBlock(with_({ minZoom, zoom: minZoom }))).toBeNull();
      expect(spinBlock(with_({ minZoom, zoom: minZoom + SPIN.unzoomedSlack }))).toBeNull();
      expect(spinBlock(with_({ minZoom, zoom: minZoom + SPIN.unzoomedSlack + 0.01 }))).toBe("zoomed-in");
    }
  });
  it("the master switch (?no-rotate) wins over everything", () => {
    SPIN.enabled = false;
    expect(spinBlock(rest)).toBe("disabled");
  });
});

describe("idle rotation: the clock", () => {
  it("does nothing before the idle delay, then starts on the first tick after it", () => {
    const s = new IdleSpin(0);
    expect(s.wait(0, rest)).toBe(SPIN.idleMs);
    expect(s.wait(SPIN.idleMs - 1, rest)).toBe(1);
    expect(s.step(SPIN.idleMs - 1, rest)).toBe(0);
    expect(s.spinning).toBe(false);
    expect(s.wait(SPIN.idleMs, rest)).toBe(0);
    expect(s.step(SPIN.idleMs, rest)).toBe(0); // the frame that starts the turn moves nothing
    expect(s.spinning).toBe(true);
    expect(s.step(SPIN.idleMs + 1000, rest)).toBeCloseTo(SPIN.degPerSec, 9);
  });
  it("any activity stops it at once and restarts the clock", () => {
    const s = new IdleSpin(0);
    s.step(SPIN.idleMs, rest);
    s.step(SPIN.idleMs + 500, rest);
    expect(s.spinning).toBe(true);
    s.activity(SPIN.idleMs + 600);
    expect(s.spinning).toBe(false);
    expect(s.step(SPIN.idleMs + 700, rest)).toBe(0);
    expect(s.wait(SPIN.idleMs + 600, rest)).toBe(SPIN.idleMs);
    expect(s.step(2 * SPIN.idleMs + 599, rest)).toBe(0);
    expect(s.step(2 * SPIN.idleMs + 600, rest)).toBe(0);
    expect(s.spinning).toBe(true);
  });
  it("a block stops it on the next tick and there is nothing to wait for", () => {
    const s = new IdleSpin(0);
    s.step(SPIN.idleMs, rest);
    expect(s.step(SPIN.idleMs + 100, with_({ selected: true }))).toBe(0);
    expect(s.spinning).toBe(false);
    expect(s.wait(SPIN.idleMs + 100, with_({ selected: true }))).toBeNull();
  });
  it("a frame after a long stall advances at most maxStepMs", () => {
    const s = new IdleSpin(0);
    s.step(SPIN.idleMs, rest);
    expect(s.step(SPIN.idleMs + 60_000, rest)).toBeCloseTo(yawStepDeg(SPIN.maxStepMs), 9);
  });
  it("the angle only depends on elapsed time, not on how many frames it took", () => {
    const run = (dt: number) => {
      const s = new IdleSpin(0);
      s.step(SPIN.idleMs, rest);
      let t = SPIN.idleMs;
      let total = 0;
      while (t < SPIN.idleMs + 4000) {
        t += dt;
        total += s.step(t, rest);
      }
      return total;
    };
    expect(run(16.7)).toBeCloseTo(run(400), 0);
    expect(run(400)).toBeCloseTo(4 * SPIN.degPerSec, 0);
  });
});

describe("idle rotation: speed and redraw rate", () => {
  it("is slow: a few degrees per second at most, a full turn in several minutes", () => {
    expect(SPIN_DEFAULTS.degPerSec).toBeLessThanOrEqual(3);
    expect(360 / SPIN_DEFAULTS.degPerSec).toBeGreaterThanOrEqual(120);
    expect(yawStepDeg(1000)).toBe(SPIN.degPerSec);
    expect(yawStepDeg(-5)).toBe(0);
  });
  it("redraws once per art pixel the disc moves, within bounds", () => {
    const r = zoomToRadiusPx(2.7);
    const ms = spinFrameMs(2.5, r);
    expect(ms).toBeGreaterThanOrEqual(SPIN.minFrameMs);
    expect(ms).toBeLessThanOrEqual(SPIN.maxFrameMs);
    // the centre of the disc moves one art pixel in that time
    expect((ms / 1000) * SPIN.degPerSec * (Math.PI / 180) * r).toBeCloseTo(2.5, 0);
    expect(ms).toBeGreaterThan(100); // far fewer than the 60 a second of a running animation
    expect(spinFrameMs(2.5, 1e9)).toBe(SPIN.minFrameMs);
    expect(spinFrameMs(2.5, 0)).toBe(SPIN.maxFrameMs);
  });
});

describe("idle rotation: page flags", () => {
  const stub = (search: string, storage: Record<string, string> = {}) => {
    (globalThis as Record<string, unknown>).location = { search };
    (globalThis as Record<string, unknown>).sessionStorage = { getItem: (k: string) => storage[k] ?? null };
  };
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).location;
    delete (globalThis as Record<string, unknown>).sessionStorage;
  });
  it("is on for a visitor, and ?no-rotate (or sessionStorage no-rotate) switches it off on any page", () => {
    stub("");
    applySpinFlags();
    expect(SPIN.enabled).toBe(true);
    expect(SPIN.idleMs).toBe(SPIN_DEFAULTS.idleMs);
    stub("?no-rotate");
    applySpinFlags();
    expect(SPIN.enabled).toBe(false);
    stub("", { "no-rotate": "1" });
    applySpinFlags();
    expect(SPIN.enabled).toBe(false);
    stub("?globe-debug&rotate&no-rotate");
    applySpinFlags();
    expect(SPIN.enabled).toBe(false);
  });
  it("a page in debug mode (the browser checks) has it off, so their zero-frame idle assertions hold past the delay; ?rotate or ?spin-idle turn it on", () => {
    stub("?globe-debug");
    applySpinFlags();
    expect(SPIN.enabled).toBe(false);
    stub("", { "globe-debug": "1" });
    applySpinFlags();
    expect(SPIN.enabled).toBe(false);
    stub("?globe-debug&rotate");
    applySpinFlags();
    expect(SPIN.enabled).toBe(true);
    expect(SPIN.idleMs).toBe(SPIN_DEFAULTS.idleMs);
    stub("", { "globe-debug": "1", rotate: "1" });
    applySpinFlags();
    expect(SPIN.enabled).toBe(true);
  });
  it("the idle delay can only be changed in debug mode, within sane bounds; settings do not leak from one call to the next", () => {
    stub("?spin-idle=1500");
    applySpinFlags();
    expect(SPIN.idleMs).toBe(SPIN_DEFAULTS.idleMs);
    expect(SPIN.enabled).toBe(true);
    stub("?globe-debug&spin-idle=1500");
    applySpinFlags();
    expect(SPIN.idleMs).toBe(1500);
    expect(SPIN.enabled).toBe(true);
    stub("?globe-debug&spin-idle=5");
    applySpinFlags();
    expect(SPIN.idleMs).toBe(SPIN_DEFAULTS.idleMs);
    stub("");
    applySpinFlags();
    expect(SPIN.idleMs).toBe(SPIN_DEFAULTS.idleMs);
  });
});
