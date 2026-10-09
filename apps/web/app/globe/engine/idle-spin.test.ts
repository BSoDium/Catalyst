import { afterEach, describe, expect, it } from "vitest";
import { IdleSpin, SPIN, SPIN_DEFAULTS, applySpinFlags, easeInAngle, spinBlock, spinFrameDue, stopAngle, stopSpeed, type SpinContext } from "./idle-spin";
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

/** Drive the machine at a fixed frame period; returns the per-frame angles and speeds. */
function run(s: IdleSpin, from: number, to: number, dtMs: number, c: SpinContext = rest) {
  const angles: number[] = [];
  const speeds: number[] = [];
  for (let t = from + dtMs; t <= to + 1e-6; t += dtMs) {
    angles.push(s.step(t, c));
    speeds.push(s.speed);
  }
  return { angles, speeds, total: angles.reduce((a, b) => a + b, 0) };
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

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
    expect(s.phase).toBe("easing-in");
    expect(s.speed).toBe(0); // from rest
    expect(s.step(SPIN.idleMs + 16, rest)).toBeGreaterThan(0);
  });
  it("an input stops it at once (no coasting) and restarts the clock; not one more degree is applied", () => {
    const s = new IdleSpin(0);
    s.step(SPIN.idleMs, rest);
    run(s, SPIN.idleMs, SPIN.idleMs + 5000, 16);
    expect(s.speed).toBeGreaterThan(0);
    s.activity(SPIN.idleMs + 5100);
    expect(s.spinning).toBe(false);
    expect(s.speed).toBe(0);
    expect(s.step(SPIN.idleMs + 5116, rest)).toBe(0);
    expect(s.step(SPIN.idleMs + 5132, rest)).toBe(0);
    expect(s.wait(SPIN.idleMs + 5100, rest)).toBe(SPIN.idleMs);
    expect(s.step(5100 + 2 * SPIN.idleMs - 1 + SPIN.idleMs, rest)).toBe(0);
    s.activity(100_000);
    expect(s.step(100_000 + SPIN.idleMs - 1, rest)).toBe(0);
    expect(s.step(100_000 + SPIN.idleMs, rest)).toBe(0);
    expect(s.spinning).toBe(true);
  });
  it("a frame after a long stall advances at most maxStepMs of the profile", () => {
    const s = new IdleSpin(0);
    s.step(SPIN.idleMs, rest);
    const first = s.step(SPIN.idleMs + 60_000, rest);
    expect(first).toBeCloseTo(easeInAngle(SPIN.maxStepMs), 9);
    expect(first).toBeLessThan(0.02); // a stalled start does not jump
  });
  it("hard reasons stop it at once, with no coasting", () => {
    for (const why of [{ reduced: true }, { hidden: true }, { lost: true }, { suspended: true }]) {
      const s = new IdleSpin(0);
      s.step(SPIN.idleMs, rest);
      run(s, SPIN.idleMs, SPIN.idleMs + 6000, 16);
      expect(s.step(SPIN.idleMs + 6016, with_(why))).toBe(0);
      expect(s.spinning).toBe(false);
      expect(s.speed).toBe(0);
    }
    SPIN.enabled = false;
    const s = new IdleSpin(0);
    expect(s.step(SPIN.idleMs, rest)).toBe(0);
    expect(s.spinning).toBe(false);
  });
  it("a block that is not an input stops it by coasting, then there is nothing to wait for", () => {
    const blocked = with_({ selected: true });
    const s = new IdleSpin(0);
    s.step(SPIN.idleMs, rest);
    const t0 = SPIN.idleMs + 8000;
    run(s, SPIN.idleMs, t0, 16);
    expect(s.phase).toBe("cruise");
    const v0 = s.speed;
    expect(v0).toBe(SPIN.degPerSec);
    const a = s.step(t0 + 16, blocked);
    expect(a).toBeGreaterThan(0); // it keeps going: inertia
    expect(s.phase).toBe("stopping");
    expect(s.spinning).toBe(true);
    expect(s.wait(t0 + 16, blocked)).toBeNull();
    const r = run(s, t0 + 16, t0 + 3000, 16, blocked);
    expect(s.spinning).toBe(false);
    expect(s.speed).toBe(0);
    expect(r.angles.at(-1)).toBe(0); // and stays at rest
  });
});

describe("idle rotation: velocity profile", () => {
  it("accelerates from rest to the cruise speed along a smoothstep over easeInMs: monotonic, zero start, flat end", () => {
    const s = new IdleSpin(0);
    s.step(SPIN.idleMs, rest);
    const r = run(s, SPIN.idleMs, SPIN.idleMs + SPIN.easeInMs + 2000, 16);
    const n = Math.ceil(SPIN.easeInMs / 16);
    for (let i = 1; i < n; i++) expect(r.speeds[i]!).toBeGreaterThanOrEqual(r.speeds[i - 1]!);
    expect(r.speeds[0]!).toBeLessThan(0.01 * SPIN.degPerSec); // starts from rest, not with a jump
    expect(r.speeds[Math.round(n / 2) - 1]!).toBeCloseTo(SPIN.degPerSec / 2, 1); // smoothstep(0.5) = 0.5
    expect(r.speeds[n]!).toBe(SPIN.degPerSec);
    expect(r.speeds.at(-1)).toBe(SPIN.degPerSec);
    expect(s.phase).toBe("cruise");
    // the acceleration is bounded (no frame kicks): the per-frame speed change never exceeds the steepest part of the smoothstep
    const steepest = (1.5 * SPIN.degPerSec * 16) / SPIN.easeInMs;
    for (let i = 1; i < r.speeds.length; i++) expect(Math.abs(r.speeds[i]! - r.speeds[i - 1]!)).toBeLessThanOrEqual(steepest * 1.001);
  });
  it("the distance turned is the exact integral of the profile, whatever the frame period", () => {
    for (const dt of [8.33, 16.7, 33.3, 90]) {
      const s = new IdleSpin(0);
      s.step(SPIN.idleMs, rest);
      const t = SPIN.idleMs + 10_000; // 3 s of ease and 7 s of cruise
      const r = run(s, SPIN.idleMs, t, dt);
      const elapsed = Math.floor(10_000 / dt) * dt;
      expect(r.total, `dt ${dt}`).toBeCloseTo(easeInAngle(elapsed), 6);
    }
    // closed form: V*E/2 during the ease (the smoothstep's mean is 1/2) plus V per second after
    expect(easeInAngle(SPIN.easeInMs)).toBeCloseTo((SPIN.degPerSec * SPIN.easeInMs) / 2000, 9);
    expect(easeInAngle(SPIN.easeInMs + 1000)).toBeCloseTo((SPIN.degPerSec * SPIN.easeInMs) / 2000 + SPIN.degPerSec, 9);
  });
  it("frame-rate independent: 30, 60 and 120 Hz and a jittery clock turn the same", () => {
    const totals = [8.33, 16.7, 33.3].map((dt) => {
      const s = new IdleSpin(0);
      s.step(SPIN.idleMs, rest);
      return run(s, SPIN.idleMs, SPIN.idleMs + 6000, dt).total;
    });
    for (const t of totals) expect(t).toBeCloseTo(totals[1]!, 0);
    // a jittery clock (frame periods from 4 to 30 ms) reaches the same angle at the same time
    const j = new IdleSpin(0);
    j.step(SPIN.idleMs, rest);
    let t = SPIN.idleMs;
    let total = 0;
    let k = 0;
    while (t < SPIN.idleMs + 6000) {
      t = Math.min(SPIN.idleMs + 6000, t + 4 + ((k++ * 7) % 27));
      total += j.step(t, rest);
    }
    expect(total).toBeCloseTo(easeInAngle(6000), 6);
  });
  it("coasts to rest in stopMs: from cruise, from the middle of the ease, with a quadratic fade (immediate deceleration, soft end)", () => {
    expect(stopSpeed(4, 0)).toBe(4);
    expect(stopSpeed(4, SPIN.stopMs)).toBe(0);
    expect(stopSpeed(4, SPIN.stopMs * 2)).toBe(0);
    expect(stopSpeed(4, SPIN.stopMs / 2)).toBeCloseTo(1, 9);
    expect(stopAngle(4, SPIN.stopMs)).toBeCloseTo((4 * SPIN.stopMs) / 3000, 9);
    for (const startAfter of [0, 1000, SPIN.easeInMs / 2, 9000]) {
      const s = new IdleSpin(0);
      s.step(SPIN.idleMs, rest);
      const t0 = SPIN.idleMs + Math.max(16, Math.round(startAfter / 16) * 16); // on the frame grid
      run(s, SPIN.idleMs, t0, 16);
      const v0 = s.speed;
      const blocked = with_({ focused: true });
      const r = run(s, t0, t0 + SPIN.stopMs + 200, 16, blocked);
      expect(s.spinning).toBe(false);
      const stopped = r.speeds.findIndex((v) => v === 0);
      expect(stopped * 16, `from ${startAfter}`).toBeGreaterThanOrEqual(SPIN.stopMs - 16);
      expect(stopped * 16).toBeLessThanOrEqual(SPIN.stopMs + 16);
      for (let i = 1; i < r.speeds.length; i++) expect(r.speeds[i]!).toBeLessThanOrEqual(r.speeds[i - 1]!); // never speeds up again
      expect(r.speeds[0]!).toBeLessThan(v0); // decelerates from the first frame
      expect(r.total).toBeCloseTo(stopAngle(v0, SPIN.stopMs), 1);
      expect(sum(r.angles.slice(stopped + 1))).toBeCloseTo(0, 9);
    }
  });
  it("the coasting angle does not depend on the frame period either", () => {
    const totals = [8.33, 16.7, 50].map((dt) => {
      const s = new IdleSpin(0);
      s.step(SPIN.idleMs, rest);
      run(s, SPIN.idleMs, SPIN.idleMs + 8000, 10);
      return run(s, SPIN.idleMs + 8000, SPIN.idleMs + 8000 + SPIN.stopMs + 100, dt, with_({ inset: 720 })).total;
    });
    for (const t of totals) expect(t).toBeCloseTo(stopAngle(SPIN.degPerSec, SPIN.stopMs), 1);
  });
  it("settle (camera motion, a condition change that is not an input) makes a turning globe coast and restarts the idle clock; it does nothing at rest", () => {
    const s = new IdleSpin(0);
    s.step(SPIN.idleMs, rest);
    run(s, SPIN.idleMs, SPIN.idleMs + 5000, 16);
    s.settle(SPIN.idleMs + 5000);
    expect(s.phase).toBe("stopping");
    expect(s.step(SPIN.idleMs + 5016, rest)).toBeGreaterThan(0);
    run(s, SPIN.idleMs + 5016, SPIN.idleMs + 6200, 16);
    expect(s.spinning).toBe(false);
    // it starts over a whole delay after the settle, not after the stop
    expect(s.wait(SPIN.idleMs + 6200, rest)).toBe(SPIN.idleMs + 5000 + SPIN.idleMs - (SPIN.idleMs + 6200));
    const idle = new IdleSpin(0);
    idle.settle(100);
    expect(idle.spinning).toBe(false);
    expect(idle.wait(100, rest)).toBe(SPIN.idleMs);
  });
  it("an input during the coast stops it at once", () => {
    const s = new IdleSpin(0);
    s.step(SPIN.idleMs, rest);
    run(s, SPIN.idleMs, SPIN.idleMs + 5000, 16);
    s.settle(SPIN.idleMs + 5000);
    s.step(SPIN.idleMs + 5100, rest);
    s.activity(SPIN.idleMs + 5200);
    expect(s.speed).toBe(0);
    expect(s.step(SPIN.idleMs + 5216, with_({ selected: true }))).toBe(0);
  });
});

describe("idle rotation: speed and redraw rate", () => {
  it("is slight: one turn in 90 to 150 s, eased in over a few seconds, coasting to rest in about a second", () => {
    expect(360 / SPIN_DEFAULTS.degPerSec).toBeGreaterThanOrEqual(90);
    expect(360 / SPIN_DEFAULTS.degPerSec).toBeLessThanOrEqual(150);
    expect(SPIN_DEFAULTS.easeInMs).toBeGreaterThanOrEqual(2500);
    expect(SPIN_DEFAULTS.easeInMs).toBeLessThanOrEqual(4000);
    expect(SPIN_DEFAULTS.stopMs).toBeGreaterThanOrEqual(800);
    expect(SPIN_DEFAULTS.stopMs).toBeLessThanOrEqual(1200);
  });
  it("moves the disc's centre at least one art pixel per 70 ms at 1440x900 (2.5 css px art pixel), against 227 ms at the old 1.2 deg/s", () => {
    const r = zoomToRadiusPx(2.7);
    const msPerArtPx = (1000 * 2.5) / (SPIN.degPerSec * (Math.PI / 180) * r);
    expect(msPerArtPx).toBeLessThanOrEqual(70);
    expect((1000 * 2.5) / (1.2 * (Math.PI / 180) * r)).toBeGreaterThan(200);
  });
  it("redraws on every display refresh up to a ceiling of about 70 a second", () => {
    expect(spinFrameDue(16.7, 0)).toBe(true); // 60 Hz: every frame
    expect(spinFrameDue(8.3, 0)).toBe(false); // 120 Hz: every other frame
    expect(spinFrameDue(25, 8.3)).toBe(true); // ... the one after that
    expect(1000 / SPIN.minFrameMs).toBeGreaterThanOrEqual(60);
    expect(1000 / SPIN.minFrameMs).toBeLessThanOrEqual(75);
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
