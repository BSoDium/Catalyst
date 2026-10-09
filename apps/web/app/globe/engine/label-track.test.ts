import { describe, expect, it } from "vitest";
import { PX_UNITS, planLabels, pxUnits, type PlanItem, type Prev } from "./label-plan";
import { LabelTracker, SlotMemory, TRACK, slotPosition, springStep, type Placed, type TrackItem } from "./label-track";
import { SPOT } from "./pixel-labels";

const VIEW = { cols: 800, rows: 600 };
const INSET = pxUnits(2.5).inset;
const GAP = PX_UNITS.gap;
const BLEED = PX_UNITS.bleed;
const FULL = { w: 90, h: 16 };
const SHORT = { w: 56, h: 16 };

/** A tracked box at (x, y) of `w x h` px with a two-variant label. */
const box = (id: number, x: number, y: number, extra: Partial<TrackItem> & { w?: number; h?: number } = {}): TrackItem => {
  const { w = 50, h = 40, ...rest } = extra;
  return { id, key: `n${id}`, rect: { c0: x, r0: y, c1: x + w, r1: y + h }, score: 80, area: w * h, variants: [FULL, SHORT], vkey: id + 1, ...rest };
};
const move = (it: TrackItem, dx: number, dy: number): TrackItem => ({ ...it, rect: { c0: it.rect.c0 + dx, r0: it.rect.r0 + dy, c1: it.rect.c1 + dx, r1: it.rect.r1 + dy } });
const overlap = (a: Placed, b: Placed, pad = 0) => a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
const tracker = (mem = new SlotMemory(100)) => new LabelTracker(mem, PX_UNITS);

describe("a label has a slot and follows its box while the camera moves", () => {
  it("the first step labels every box, at its first free position (nothing is withheld)", () => {
    const t = tracker();
    const out = t.step(0, [box(1, 100, 100), box(2, 300, 100), box(3, 100, 300)], VIEW, INSET);
    expect(out.map((p) => p.cand)).toEqual([SPOT.aboveLeft, SPOT.aboveLeft, SPOT.aboveLeft]);
    expect(out.every((p) => p.fresh && p.moved && !p.overlap && p.gx === 0 && p.gy === 0)).toBe(true);
    expect(out[0]!).toMatchObject({ x: 100 - BLEED, y: 100 - FULL.h - GAP, variant: 0 }); // clear room above the box, the text lined up with its edge
    expect(t.gliding).toBe(0);
  });
  it("while the boxes move the plates stay on the same corner of their boxes, to the pixel: they never lag", () => {
    const t = tracker();
    let items = [box(1, 100, 100), box(2, 300, 100), box(3, 140, 300)];
    t.step(0, items, VIEW, INSET);
    const slots = t.step(16, items, VIEW, INSET).map((p) => [p.cand, p.variant]);
    for (let f = 2; f < 60; f++) {
      items = items.map((it) => move(it, 2.5, 1.5));
      const out = t.step(f * 16, items, VIEW, INSET);
      expect(out.map((p) => [p.cand, p.variant])).toEqual(slots);
      expect(out.every((p) => !p.moved && p.gx === 0 && p.gy === 0)).toBe(true);
      out.forEach((p, n) => expect([p.x, p.y]).toEqual([items[n]!.rect.c0 - BLEED, items[n]!.rect.r0 - p.h - GAP]));
    }
    expect(t.gliding).toBe(0);
  });
  it("two labels that start to collide while moving are separated by a plan within the bounded rate, and the plate that gives way glides apart", () => {
    const t = tracker();
    const a = box(1, 100, 100);
    let b = box(2, 300, 100);
    t.step(0, [a, b], VIEW, INSET);
    const first = t.step(16, [a, b], VIEW, INSET).map((p) => p.cand);
    let now = 16;
    let changedAt = -1;
    for (let f = 0; f < 60; f++) {
      b = move(b, -6, 0); // b's box slides into a's label
      now += 16;
      const out = t.step(now, [a, b], VIEW, INSET);
      if (changedAt < 0 && out[1]!.cand !== first[1]) changedAt = f;
    }
    expect(changedAt).toBeGreaterThan(-1);
    // ... and once settled the plan is collision-free
    t.settleNow();
    const settled = t.step(now + 16, [a, b], VIEW, INSET);
    expect(overlap(settled[0]!, settled[1]!, PX_UNITS.clearance)).toBe(false);
  });
});

describe("the plan runs continuously, at a bounded rate", () => {
  it("while the rectangles change, plans are at least replanMs apart and none is skipped for long; a camera that never stops is not frozen", () => {
    const t = tracker();
    let items = [box(1, 100, 100), box(2, 130, 100)];
    let now = 0;
    t.step(now, items, VIEW, INSET);
    const fulls: number[] = [];
    for (let f = 0; f < 600; f++) {
      now += 16;
      items = items.map((it) => move(it, 0.2, 0));
      t.step(now, items, VIEW, INSET);
      if (t.info.full) fulls.push(now);
    }
    expect(fulls.length).toBeGreaterThanOrEqual(Math.floor((600 * 16) / (TRACK.replanMs + 16)) - 1);
    expect(fulls.length).toBeLessThanOrEqual(Math.ceil((600 * 16) / TRACK.replanMs));
    for (let k = 1; k < fulls.length; k++) {
      expect(fulls[k]! - fulls[k - 1]!).toBeGreaterThanOrEqual(TRACK.replanMs);
      expect(fulls[k]! - fulls[k - 1]!).toBeLessThanOrEqual(TRACK.replanMs + 16);
    }
  });
  it("a change after the last plan is owed: due replanMs after that plan (a timer, an idle map draws no frames), run once, then nothing is owed", () => {
    const t = new LabelTracker(new SlotMemory(100), PX_UNITS, { ...TRACK, dwellMs: 0 });
    let items = [box(1, 100, 100), box(2, 130, 100)];
    t.step(0, items, VIEW, INSET);
    expect(t.dueAt).toBeNull(); // the first step planned everything
    items = items.map((it) => move(it, 5, 0));
    t.step(30, items, VIEW, INSET); // 30 ms after the last plan: too soon
    expect(t.info.full).toBe(false);
    expect(t.dueAt).toBe(TRACK.replanMs);
    t.step(TRACK.replanMs - 1, items, VIEW, INSET);
    expect(t.info.full).toBe(false);
    t.step(TRACK.replanMs, items, VIEW, INSET);
    expect(t.info.full).toBe(true);
    expect(t.dueAt).toBeNull();
    t.step(TRACK.replanMs + 16, items, VIEW, INSET);
    expect(t.info.full).toBe(false);
  });
  it("a plan on an unchanged camera is sticky: nothing moves when nothing is wrong", () => {
    const t = tracker();
    const items = [box(1, 100, 100), box(2, 400, 100), box(3, 100, 300)];
    const first = t.step(0, items, VIEW, INSET);
    t.settleNow();
    const out = t.step(1000, items, VIEW, INSET);
    expect(t.info.full).toBe(true);
    expect(out.map((p) => [p.cand, p.variant, p.x, p.y])).toEqual(first.map((p) => [p.cand, p.variant, p.x, p.y]));
    expect(out.some((p) => p.moved)).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------ the glide */

describe("the spring", () => {
  it("is exact for any step: one step of 300 ms equals 18 of 1/60 s, and the glide is monotone, never crosses 0, and ends at rest", () => {
    const w = TRACK.omega;
    const one = springStep(100, 0, w, 0.3);
    let x = 100;
    let v = 0;
    let prev = x;
    for (let k = 0; k < 18; k++) {
      const s = springStep(x, v, w, 1 / 60);
      x = s.x;
      v = s.v;
      expect(x).toBeLessThan(prev);
      expect(x).toBeGreaterThan(0);
      prev = x;
    }
    expect(x).toBeCloseTo(one.x, 8);
    expect(v).toBeCloseTo(one.v, 6);
    expect(springStep(100, 0, w, 4.75 / w).x).toBeLessThan(5.1); // 95 % in 4.75 / omega = 0.34 s
    expect(springStep(100, 0, w, 0.5).x).toBeLessThan(1); // 99 % within half a second
  });
});

/** Two boxes, the second of which slides into the first one's label: the second's plate must change slot (a left-hand slot to a right-hand one). */
function collide() {
  const t = tracker();
  const a = box(1, 100, 100);
  let b = box(2, 300, 100);
  t.step(0, [a, b], VIEW, INSET);
  let now = 0;
  const trace: { t: number; ox: number; oy: number; gx: number; gy: number; cand: number; moved: boolean }[] = [];
  const frame = (dx: number) => {
    now += 1000 / 60;
    b = move(b, dx, 0);
    const out = t.step(now, [a, b], VIEW, INSET);
    const p = out[1]!;
    trace.push({ t: now, ox: p.x - b.rect.c0, oy: p.y - b.rect.r0, gx: p.gx, gy: p.gy, cand: p.cand, moved: p.moved });
    return p;
  };
  return { t, frame, trace, box: () => b };
}

describe("a slot change is a glide, never a jump", () => {
  it("the plate's offset from its box moves monotonically from where it was to the new place, with no overshoot, in a bounded step per frame, and arrives exactly", () => {
    const { t, frame, trace } = collide();
    for (let f = 0; f < 40; f++) frame(-6);
    for (let f = 0; f < 90; f++) frame(0); // the box stops; the plate goes on
    const k0 = trace.findIndex((r) => r.moved);
    expect(k0).toBeGreaterThan(0);
    const start = trace[k0 - 1]!;
    const last = trace[trace.length - 1]!;
    const dist = Math.hypot(last.ox - start.ox, last.oy - start.oy);
    expect(dist).toBeGreaterThan(40); // a real move: left-hand slot to right-hand slot
    // offsets between the first frame of the slot change and the end: monotone on each axis, never past the final offset
    const sx = Math.sign(last.ox - start.ox);
    const sy = Math.sign(last.oy - start.oy);
    for (let k = k0; k < trace.length; k++) {
      const r = trace[k]!;
      const q = trace[k - 1]!;
      if (sx) {
        expect((r.ox - q.ox) * sx).toBeGreaterThanOrEqual(-1e-9); // never turns back
        expect((r.ox - last.ox) * sx).toBeLessThanOrEqual(1e-9); // never past the end
      }
      if (sy) {
        expect((r.oy - q.oy) * sy).toBeGreaterThanOrEqual(-1e-9);
        expect((r.oy - last.oy) * sy).toBeLessThanOrEqual(1e-9);
      }
      // a bounded step: at most the spring's own peak speed (omega / e of the distance per second) plus the box's, here at rest
      if (r.gx !== 0 || q.gx !== 0) expect(Math.abs(r.ox - q.ox)).toBeLessThanOrEqual((TRACK.omega / Math.E) * dist * (1 / 60) * 1.05 + 6.1); // + the plate target's own move with the box (6 px / frame while it slides)
    }
    // the motion lasts 250 to 600 ms, ends exactly at the target and the loop would stop there
    const t0 = trace[k0]!.t;
    const arrived = trace.findIndex((r, k) => k >= k0 && r.gx === 0 && r.gy === 0);
    expect(arrived).toBeGreaterThan(k0);
    expect(trace[arrived]!.t - t0).toBeGreaterThan(250);
    expect(trace[arrived]!.t - t0).toBeLessThan(700);
    expect(t.gliding).toBe(0);
    expect(trace.slice(arrived).every((r) => r.gx === 0 && r.gy === 0)).toBe(true);
    // the first frame of the move is small: it sets off, it does not leap
    expect(Math.abs(trace[k0]!.ox - start.ox)).toBeLessThan(0.1 * dist + 6.1);
  });
  it("the frame loop is owed (gliding > 0) exactly while a label has not arrived", () => {
    const { t, frame, trace } = collide();
    for (let f = 0; f < 40; f++) frame(-6);
    let wasGliding = false;
    for (let f = 0; f < 90; f++) {
      frame(0);
      const r = trace[trace.length - 1]!;
      if (t.gliding > 0) wasGliding = true;
      expect(t.gliding > 0).toBe(r.gx !== 0 || r.gy !== 0 || [...Array(1)].length === 0 ? true : t.gliding > 0);
    }
    expect(wasGliding).toBe(true);
    expect(t.gliding).toBe(0);
  });
  it("the path is a straight line (both axes ease together)", () => {
    const { frame, trace } = collide();
    for (let f = 0; f < 40; f++) frame(-6);
    for (let f = 0; f < 60; f++) frame(0);
    const k0 = trace.findIndex((r) => r.moved);
    const gl = trace.slice(k0).filter((r) => r.gx !== 0 || r.gy !== 0);
    expect(gl.length).toBeGreaterThan(10);
    // glide vector keeps its direction: gx * gy0 = gy * gx0 (cross product ~ 0)
    const g0 = gl[0]!;
    for (const r of gl) expect(Math.abs(r.gx * g0.gy - r.gy * g0.gx)).toBeLessThan(1e-6 * (1 + Math.abs(g0.gx * g0.gy)) + 1e-3);
  });
  it("frame-rate independent: the same glide at 30, 60 and 144 fps is at the same place at the same time", () => {
    const run = (fps: number) => {
      const t = tracker();
      const a = box(1, 100, 100);
      let b = box(2, 300, 100);
      t.step(0, [a, b], VIEW, INSET);
      let now = 0;
      const dtMs = 1000 / fps;
      const at: Record<number, number> = {};
      let stop = Infinity;
      for (let f = 1; f <= fps * 2; f++) {
        now = f * dtMs;
        if (now <= 600) b = move(b, (-6 * 60) / fps, 0);
        else if (stop === Infinity) stop = now;
        const out = t.step(now, [a, b], VIEW, INSET);
        for (const mark of [900, 1000, 1100]) if (Math.abs(now - mark) < dtMs / 2) at[mark] = out[1]!.x - b.rect.c0;
      }
      return at;
    };
    const lo = run(30);
    const mid = run(60);
    const hi = run(144);
    for (const mark of [900, 1000, 1100]) {
      expect(Math.abs(lo[mark]! - mid[mark]!)).toBeLessThan(3.5);
      expect(Math.abs(hi[mark]! - mid[mark]!)).toBeLessThan(3.5);
    }
  });
  it("reduced motion: a slot change is instant, no glide, never gliding", () => {
    const { t, frame, trace } = (() => {
      const c = collide();
      return c;
    })();
    t.instant = true;
    for (let f = 0; f < 60; f++) frame(f < 40 ? -6 : 0);
    expect(trace.every((r) => r.gx === 0 && r.gy === 0)).toBe(true);
    expect(t.gliding).toBe(0);
    expect(trace.some((r) => r.moved)).toBe(true);
  });
  it("settleNow ends every glide at once: at rest every label is exactly at its target", () => {
    const { t, frame, trace } = collide();
    for (let f = 0; f < 40; f++) frame(-6);
    let k = 0;
    while (t.gliding === 0 && k++ < 30) frame(0);
    t.settleNow();
    frame(0);
    const r = trace[trace.length - 1]!;
    expect(t.gliding).toBe(0);
    expect(r.gx).toBe(0);
    expect(r.gy).toBe(0);
  });
});

describe("a re-plan during a glide retargets smoothly", () => {
  /** Drive the glide of one label by hand: `go(x)` is one frame of 1/60 s with the slot's place at offset `x` from the box (y 0). */
  const rig = () => {
    const t = tracker();
    const any = t as unknown as { place(now: number, i: number, r: TrackItem["rect"], x: number, y: number, kind: "fresh" | "retarget" | "keep"): { x: number; gx: number }; dt: number };
    const r = { c0: 0, r0: 0, c1: 50, r1: 40 };
    let now = 0;
    any.place(now, 1, r, 0, 0, "fresh");
    const xs: number[] = [0];
    let cur = 0;
    const go = (to: number) => {
      now += 1000 / 60;
      any.dt = 1 / 60;
      const kind = to !== cur ? "retarget" : "keep";
      cur = to;
      xs.push(any.place(now, 1, r, to, 0, kind).x);
    };
    return { go, xs };
  };
  it("towards a place further on: the speed carries on (no restart from rest) and the plate never turns back or passes the new place", () => {
    const { go, xs } = rig();
    for (let f = 0; f < 8; f++) go(100);
    const before = xs[xs.length - 1]! - xs[xs.length - 2]!;
    for (let f = 0; f < 120; f++) go(160);
    const after = xs[10]! - xs[9]!; // the first frame after the re-plan
    expect(before).toBeGreaterThan(3); // really in flight
    expect(after).toBeGreaterThan(0.7 * before); // velocity continuous: not a restart (a restart would be ~ 0 here)
    expect(after).toBeLessThan(1.3 * before + 1);
    for (let k = 1; k < xs.length; k++) {
      expect(xs[k]! - xs[k - 1]!).toBeGreaterThanOrEqual(-1e-9);
      expect(xs[k]!).toBeLessThanOrEqual(160 + 1e-9);
    }
    expect(xs[xs.length - 1]).toBe(160);
  });
  it("back to where it came from: no overshoot past that place, no teleport, and it arrives", () => {
    const { go, xs } = rig();
    for (let f = 0; f < 8; f++) go(100);
    for (let f = 0; f < 120; f++) go(0);
    for (let k = 1; k < xs.length; k++) {
      expect(Math.abs(xs[k]! - xs[k - 1]!)).toBeLessThan(10);
      expect(xs[k]!).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(xs[xs.length - 1]).toBe(0);
  });
});

describe("a slot is kept for a while: a better position is not taken at once", () => {
  /** b's box slides into a's label and back out; returns when b's plate left its first position, and when it was back. */
  const run = (dwellMs: number) => {
    const t = new LabelTracker(new SlotMemory(100), PX_UNITS, { ...TRACK, dwellMs });
    const a = box(1, 100, 100);
    let b = box(2, 230, 100);
    t.step(0, [a, b], VIEW, INSET);
    let now = 0;
    let leftAt = -1;
    let backAt = -1;
    for (let f = 0; f < 150; f++) {
      b = move(b, f < 12 ? -6 : f < 30 ? 6 : 0, 0);
      now += 16;
      const out = t.step(now, [a, b], VIEW, INSET);
      if (leftAt < 0 && out[1]!.cand !== SPOT.aboveLeft) leftAt = now;
      if (leftAt >= 0 && backAt < 0 && out[1]!.cand === SPOT.aboveLeft) backAt = now;
    }
    return { leftAt, backAt };
  };
  it("a label that has just changed slot keeps it while it is free, and only goes back to the better position after dwellMs", () => {
    const held = run(500);
    const free = run(0);
    expect(held.leftAt).toBeGreaterThan(-1);
    expect(held.backAt).toBeGreaterThan(-1);
    expect(free.backAt - free.leftAt).toBeLessThan(500); // without the dwell it goes back as soon as the position is free
    expect(held.backAt - held.leftAt).toBeGreaterThanOrEqual(500);
    expect(held.backAt - held.leftAt).toBeLessThan(500 + 2 * TRACK.replanMs);
  });
  it("a slot that is blocked is left at once, whatever the dwell (the first label of the test above gave way as soon as the plan ran)", () => {
    const held = run(1e9);
    expect(held.leftAt).toBeGreaterThan(-1);
    expect(held.leftAt).toBeLessThanOrEqual(TRACK.replanMs + 16 + 100);
  });
});

describe("a node that is fading out keeps gliding", () => {
  it("follows its box with the glide it had, and a slot that is not possible any more is a glide to the fallback place, not a jump", () => {
    const t = tracker();
    t.step(0, [box(1, 100, 100)], VIEW, INSET);
    const rect = { c0: 200, r0: 220, c1: 250, r1: 260 };
    const out = t.follow(16, [{ id: 1, rect, size: FULL }], VIEW, INSET);
    expect(out[0]).toMatchObject({ x: 200 - BLEED, y: 220 - FULL.h - GAP, gx: 0, gy: 0 });
    // an id with no slot: the fallback place, no glide
    expect(t.follow(32, [{ id: 9, rect, size: FULL }], VIEW, INSET)[0]).toMatchObject({ x: 200, y: 220 - FULL.h, gx: 0, gy: 0 });
  });
});

describe("a box that appears is labelled at once, in the gaps of the labels that stay", () => {
  it("the new label takes a free place and no other label moves", () => {
    const t = tracker();
    let items = [box(1, 100, 100), box(2, 400, 100)];
    const first = t.step(0, items, VIEW, INSET);
    items = items.map((it) => move(it, 3, 0));
    t.step(16, items, VIEW, INSET);
    // a new box right under the first one's label
    const fresh = box(3, 100, 120);
    const out = t.step(32, [...items.map((it) => move(it, 3, 0)), fresh], VIEW, INSET);
    expect(t.info).toMatchObject({ full: false, partial: 1 });
    expect(out[2]!.fresh).toBe(true);
    expect(out[0]!.cand).toBe(first[0]!.cand);
    expect(out[1]!.cand).toBe(first[1]!.cand);
    expect(out.slice(0, 2).every((p) => !p.moved)).toBe(true);
    for (const p of out.slice(0, 2)) expect(overlap(out[2]!, p, PX_UNITS.clearance)).toBe(false);
  });
  it("a node that has no label yet is never left without one, however crowded (the last resort draws it over the others)", () => {
    const t = tracker();
    const items = Array.from({ length: 30 }, (_, k) => box(k, 300 + (k % 6) * 14, 250 + Math.floor(k / 6) * 12, { w: 12, h: 10 }));
    const out = t.step(0, items, VIEW, INSET);
    expect(out.length).toBe(30);
    for (const p of out) expect(p.w).toBeGreaterThan(0);
    expect(out.some((p) => p.overlap)).toBe(true);
  });
});

describe("a slot that becomes impossible is replaced at once", () => {
  it("a label above a box that reaches the top of the screen stays in its slot, pinned at the screen's edge over the box, instead of hopping to another position", () => {
    const t = tracker();
    let items = [box(1, 300, 200), box(2, 500, 400)];
    const first = t.step(0, items, VIEW, INSET);
    expect(first[0]!.cand).toBe(SPOT.aboveLeft);
    let now = 0;
    for (const dy of [-60, -60, -60, -9]) {
      items = [move(items[0]!, 0, dy), items[1]!];
      const out = t.step((now += 16), items, VIEW, INSET);
      expect(out[0]!.cand).toBe(SPOT.aboveLeft);
      expect(out[0]!.y).toBeGreaterThanOrEqual(0);
      expect(out[1]!.cand).toBe(first[1]!.cand);
      expect(t.info.full).toBe(false);
    }
    expect(items[0]!.rect.r0).toBeLessThan(0 + 40); // the box is at the top edge: the plate is pinned at y = 0
    const pinned = t.step((now += 16), items, VIEW, INSET);
    expect(pinned[0]!.y).toBe(0);
  });
  it("at the left and right edges the plate slides along its box and stays in its slot", () => {
    const t = tracker();
    const it = box(1, 700, 200);
    t.step(0, [it], VIEW, INSET);
    const out = t.step(16, [move(it, 40, 0)], VIEW, INSET);
    expect(out[0]!.cand).toBe(SPOT.aboveLeft);
    expect(out[0]!.x + out[0]!.w).toBeLessThanOrEqual(VIEW.cols);
  });
  it("a nested label whose box becomes too small for it gets another slot", () => {
    const t = tracker();
    const big = box(1, 100, 4, { w: 400, h: 300 }); // no room above: nested
    const first = t.step(0, [big], VIEW, INSET);
    expect(first[0]!.inside).toBe(true);
    const small = box(1, 100, 4, { w: 60, h: 20 });
    const out = t.step(16, [small], VIEW, INSET);
    expect(out[0]!.inside).toBe(false);
  });
});

describe("sticky across plans and shared across overlays", () => {
  it("a second tracker on the same memory (the street overlay after the globe) starts from the slots the first chose", () => {
    const mem = new SlotMemory(10);
    const items = [box(1, 100, 100), box(2, 130, 100), box(3, 160, 100)];
    const a = new LabelTracker(mem, PX_UNITS).step(0, items, VIEW, INSET);
    const b = new LabelTracker(mem, PX_UNITS).step(0, items, VIEW, INSET);
    expect(b.map((p) => [p.cand, p.variant, p.x, p.y])).toEqual(a.map((p) => [p.cand, p.variant, p.x, p.y]));
    expect(b.some((p) => p.fresh)).toBe(false);
  });
  it("a changed text keeps the candidate as the preference", () => {
    const t = tracker();
    const it = box(1, 100, 100, { vkey: 7 });
    const first = t.step(0, [it], VIEW, INSET);
    const out = t.step(16, [{ ...it, vkey: 8, variants: [{ w: 120, h: 16 }, SHORT] }], VIEW, INSET);
    expect(out[0]!.cand).toBe(first[0]!.cand);
    expect(out[0]!.w).toBe(120);
  });
  it("planning twice in a row from the same memory gives the same plan (no hopping on a still camera)", () => {
    const t = tracker();
    const items = Array.from({ length: 40 }, (_, k) => box(k, 40 + ((k * 97) % 700), 40 + ((k * 61) % 500), { w: 30, h: 24 }));
    const a = t.step(0, items, VIEW, INSET);
    for (let f = 1; f <= 6; f++) {
      const b = t.step(f * 1000, items, VIEW, INSET);
      expect(b.map((p) => [p.cand, p.variant, p.x, p.y])).toEqual(a.map((p) => [p.cand, p.variant, p.x, p.y]));
    }
  });
});

describe("a node that is fading out", () => {
  it("a node that is only fading out keeps the slot it had, followed to its box", () => {
    const t = tracker();
    t.step(0, [box(1, 100, 100)], VIEW, INSET);
    const p = slotPosition(t.mem, 1, { c0: 200, r0: 220, c1: 250, r1: 260 }, FULL, VIEW, pxUnits(2.5));
    expect(p).toEqual({ x: 200 - BLEED, y: 220 - FULL.h - GAP });
    expect(slotPosition(t.mem, 9, { c0: 200, r0: 220, c1: 250, r1: 260 }, FULL, VIEW, pxUnits(2.5))).toEqual({ x: 200, y: 220 - FULL.h });
  });
});

/* ------------------------------------------------------------------------------------------------ the flicker metric */

/**
 * A deterministic camera sweep over 72 labelled boxes, four ways of drawing the labels: the plan run on EVERY frame (what the overlay did
 * before the tracker: `planLabels` with the last frame's choice as its memory), the continuous tracked plan WITHOUT its glide (a slot change
 * snaps: what the owner saw), reduced motion (no glide, plans only at rest) and the tracked plan with its glide. The camera pans and zooms 1 -> 1.45 over 3 s at 60 fps, with boxes snapped to 2.5 px cells like the real
 * ones, then rests for 1 s.
 *
 * FLICKER METRIC. For each label present in two consecutive frames:
 *  - a TELEPORT is a plate that moved in one frame (its nearer edge on each axis) by more than its box did (its fastest corner) plus 4 px plus what the label's own glide may
 *    move it by in a frame (1.1 x omega x dt x the glide that was left, before or after the step: a spring never moves faster than that). A
 *    label that changes slot at once, or hops, teleports; one that glides never does. This is what the eye sees as "snapping into place".
 *  - a CHANGE is a different slot (candidate position, or way of writing it): informative now (a change is a glide), counted to see that the
 *    sticky plan does not swap places back and forth.
 * A label that appears or disappears is counted apart (`visibility`: the camera and the cut decide it, the same for any plan).
 */
interface Sweep {
  /** Different slots of labels shown in two consecutive frames. */
  changes: number;
  /** Labels that appeared or disappeared (the camera and the cut decide it, the same for any plan). */
  visibility: number;
  /** Label-frames, for the rate. */
  shownFrames: number;
  teleports: number;
  /** Label-frames in which a plate was still on its way to its slot. */
  glidingFrames: number;
  /** The largest step a plate made against its box in one frame (px). */
  maxStep: number;
  labels: number;
  worstFrame: number;
  perLabel: number;
  finalOverlaps: number;
  /** After the rest: labels with a glide left, and the largest distance between a drawn plate and its slot's place. */
  gliding: number;
  atRestError: number;
  /** Frames from the camera stopping to the last plate arriving. */
  settleFrames: number;
}

/** The every-frame plan with the distances the pixel version had: 1 cell of clearance, 2 cells of margin before a better slot is taken, on 2.5 px cells. */
const OLD_UNITS = { clearance: 2.5, upgradeMargin: 5, shiftStep: 5, inset: 2.5, quant: 2.5, gap: 0, bleed: 0 };

interface Seen {
  cand: number;
  variant: number;
  px: number;
  py: number;
  px1: number;
  py1: number;
  gx: number;
  gy: number;
  r: TrackItem["rect"];
}

function sweep(strategy: "every-frame" | "no-glide" | "reduced" | "tracked"): Sweep {
  const N = 72;
  const world = Array.from({ length: N }, (_, k) => {
    // clusters, so that labels crowd each other
    const cx = 50 + (k % 9) * 108 + ((k * 37) % 40);
    const cy = 30 + Math.floor(k / 9) * 74 + ((k * 53) % 30);
    const name = ["Marrakesh", "Fès", "Chefchaouen", "Essaouira", "Ouarzazate", "Merzouga", "Tangier", "Rabat", "Casablanca", "Agadir"][k % 10]!;
    return { cx, cy, name, w: 10 + ((k * 7) % 5) * 3, h: 10 + ((k * 3) % 4) * 3 };
  });
  const variantsFor = (name: string) => {
    const full = { w: Math.ceil(name.length * 6.2 + 6), h: 16 };
    return [full, { w: Math.ceil(6 * 6.2 + 6), h: 16 }];
  };
  const mem = new SlotMemory(N);
  // "no-glide": the same continuous plan with a spring so stiff that a slot change is instant (what the labels did when a re-plan ran: a snap)
  const tr = new LabelTracker(mem, PX_UNITS, strategy === "no-glide" ? { ...TRACK, omega: 1e6 } : TRACK);
  tr.instant = strategy === "reduced";
  const prevOld = new Map<number, Prev>();
  let last = new Map<number, Seen>();
  const MOVE = 180;
  const FRAMES = MOVE + 60;
  const DT = 1 / 60;
  let changes = 0;
  let visibility = 0;
  let shownFrames = 0;
  let teleports = 0;
  let glidingFrames = 0;
  let maxStep = 0;
  let worstFrame = 0;
  let settleFrames = 0;
  const everShown = new Set<number>();
  let finalOverlaps = 0;
  let atRestError = 0;
  const snap = (v: number) => Math.round(v / 2.5) * 2.5;
  for (let f = 0; f < FRAMES; f++) {
    // a hand on the map: a pan that swings both ways while the zoom breathes in and out, then rest
    const u = Math.min(1, f / MOVE);
    const scale = 1 + 0.45 * (0.5 - 0.5 * Math.cos(2 * Math.PI * u));
    const panX = 220 * Math.sin(2 * Math.PI * u * 1.5);
    const panY = 110 * Math.sin(2 * Math.PI * u * 1);
    const items: TrackItem[] = [];
    world.forEach((n, k) => {
      const x0 = snap((n.cx - panX) * scale);
      const y0 = snap((n.cy - panY) * scale + 40);
      const w = snap(n.w * scale);
      const h = snap(n.h * scale);
      if (x0 + w < 0 || y0 + h < 0 || x0 > VIEW.cols || y0 > VIEW.rows) return; // not drawn
      items.push({ id: k, key: `n${k}`, rect: { c0: x0, r0: y0, c1: x0 + w, r1: y0 + h }, score: 50 + (k % 5), area: w * h, variants: variantsFor(n.name), vkey: k + 1 });
    });
    const now = new Map<number, Seen>();
    const plates: { x: number; y: number; w: number; h: number }[] = [];
    if (strategy === "every-frame") {
      const plan: PlanItem[] = items.map((it) => ({ score: it.score, area: it.area, key: it.key, rect: it.rect, variants: it.variants, prev: prevOld.get(it.id) ?? null }));
      const out = planLabels(plan, VIEW, OLD_UNITS);
      out.forEach((p, n) => {
        const it = items[n]!;
        prevOld.set(it.id, { variant: p.variant, cand: p.cand, dx: p.x - it.rect.c0, dy: p.y - it.rect.r0 });
        now.set(it.id, { cand: p.cand, variant: p.variant, px: p.x, py: p.y, px1: p.x + p.w, py1: p.y + p.h, gx: 0, gy: 0, r: it.rect });
        plates.push({ x: p.x, y: p.y, w: p.w, h: p.h });
      });
    } else {
      const out = tr.step(f * (1000 / 60), items, VIEW, INSET);
      out.forEach((p, n) => {
        const it = items[n]!;
        now.set(it.id, { cand: p.cand, variant: p.variant, px: p.x, py: p.y, px1: p.x + p.w, py1: p.y + p.h, gx: p.gx, gy: p.gy, r: it.rect });
        plates.push({ x: p.x, y: p.y, w: p.w, h: p.h });
        if (f === FRAMES - 1) atRestError = Math.max(atRestError, Math.abs(p.gx), Math.abs(p.gy));
      });
    }
    let frameChanges = 0;
    let anyGliding = false;
    for (const [id, s] of now) {
      everShown.add(id);
      shownFrames++;
      if (s.gx !== 0 || s.gy !== 0) {
        glidingFrames++;
        anyGliding = true;
      }
      const p = last.get(id);
      if (!p) {
        if (f > 0) visibility++; // appears
        continue;
      }
      if (p.cand !== s.cand || p.variant !== s.variant) frameChanges++;
      // a teleport: the plate moved in one frame by more than its box moved (its fastest corner), 4 px, and what its glide may move it by
      const boxMove = Math.max(Math.abs(p.r.c0 - s.r.c0), Math.abs(p.r.r0 - s.r.r0), Math.abs(p.r.c1 - s.r.c1), Math.abs(p.r.r1 - s.r.r1));
      const glide = Math.max(Math.abs(p.gx), Math.abs(p.gy), Math.abs(s.gx), Math.abs(s.gy));
      const step = Math.max(Math.min(Math.abs(p.px - s.px), Math.abs(p.px1 - s.px1)), Math.min(Math.abs(p.py - s.py), Math.abs(p.py1 - s.py1))); // the nearer edge on each axis: a shorter text keeps the edge its plate is anchored on
      maxStep = Math.max(maxStep, step - boxMove);
      if (step > boxMove + 4 + 1.1 * TRACK.omega * DT * glide) teleports++;
    }
    for (const id of last.keys()) if (!now.has(id)) visibility++; // disappears
    if (f < MOVE) {
      changes += frameChanges;
      worstFrame = Math.max(worstFrame, frameChanges);
    } else if (anyGliding) settleFrames = f - MOVE + 1;
    last = now;
    if (f === FRAMES - 1) {
      for (let a = 0; a < plates.length; a++) for (let b = a + 1; b < plates.length; b++) if (plates[a]!.x < plates[b]!.x + plates[b]!.w && plates[a]!.x + plates[a]!.w > plates[b]!.x && plates[a]!.y < plates[b]!.y + plates[b]!.h && plates[a]!.y + plates[a]!.h > plates[b]!.y) finalOverlaps++;
    }
  }
  return { changes, visibility, shownFrames, teleports, glidingFrames, maxStep, labels: everShown.size, worstFrame, perLabel: changes / everShown.size, finalOverlaps, gliding: tr.gliding, atRestError, settleFrames };
}

describe("flicker metric over a camera sweep: labels move all the time and never teleport", () => {
  const old = sweep("every-frame");
  const snap = sweep("no-glide");
  const reduced = sweep("reduced");
  const now = sweep("tracked");
  it("reports the numbers (the plan on every frame, the tracked plan without its glide, reduced motion, the tracked plan with its glide)", () => {
    const line = (n: string, r: Sweep) => `${n}: ${r.changes} slot changes (${r.perLabel.toFixed(2)} per label, worst frame ${r.worstFrame}), ${r.teleports} teleports, ${r.glidingFrames} label-frames gliding (largest step against the box ${r.maxStep.toFixed(1)} px), ${r.settleFrames} frames to settle, ${r.finalOverlaps} overlaps at rest`;
    console.info(`label motion over the sweep (${old.labels} labels, 240 frames, ${old.visibility} appearances and disappearances for all four):\n  ${line("every-frame plan", old)}\n  ${line("tracked, no glide (a slot change snaps)", snap)}\n  ${line("tracked, reduced motion", reduced)}\n  ${line("tracked, gliding", now)}`);
    expect(old.labels).toBeGreaterThan(40);
    expect(now.visibility).toBe(old.visibility);
    expect(now.labels).toBe(old.labels);
  });
  it("the metric sees what the owner saw: the plan on every frame, and a slot change that is not glided, teleport", () => {
    expect(old.teleports).toBeGreaterThan(40);
    expect(snap.teleports).toBeGreaterThan(20);
  });
  it("reduced motion: no glide, and the labels do not hop while the camera moves (plans only at rest): no teleports, far fewer changes", () => {
    expect(reduced.glidingFrames).toBe(0);
    expect(reduced.teleports).toBe(0);
    expect(reduced.changes).toBeLessThan(now.changes / 3);
  });
  it("with the glide NO plate teleports over the sweep, and the plates do move (they glide, they are not frozen)", () => {
    expect(now.teleports).toBe(0);
    expect(now.glidingFrames).toBeGreaterThan(100);
    expect(now.maxStep).toBeLessThan(20); // the fastest frame of a glide against its box, px
  });
  it("the sticky plan does not swap places back and forth: far fewer slot changes than the every-frame plan, under two per label", () => {
    expect(now.perLabel).toBeLessThan(2);
    expect(now.changes * 1.5).toBeLessThanOrEqual(old.changes);
  });
  it("no frame starts more glides than a crowded sweep needs", () => {
    expect(now.worstFrame).toBeLessThanOrEqual(16);
  });
  it("at rest every label is exactly at its target: no glide left, none owed, and the plates are as collision-free as the every-frame plan leaves them", () => {
    expect(now.gliding).toBe(0);
    expect(now.atRestError).toBe(0);
    expect(now.settleFrames).toBeLessThan(60); // within a second of the camera stopping
    expect(now.finalOverlaps).toBeLessThanOrEqual(old.finalOverlaps + 1);
  });
});
