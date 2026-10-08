import { describe, expect, it } from "vitest";
import { PX_UNITS, planLabels, pxUnits, type PlanItem, type Prev } from "./label-plan";
import { LabelTracker, SlotMemory, TRACK, anchored, slotPosition, type Placed, type TrackItem } from "./label-track";
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
    expect(out.every((p) => p.fresh && p.moved && !p.overlap)).toBe(true);
    expect(out[0]!).toMatchObject({ x: 100 - BLEED, y: 100 - FULL.h - GAP, variant: 0 }); // clear room above the box, the text lined up with its edge
  });
  it("frozen: while the rectangles change every frame the slots do not, and the plate stays on the same corner of its box", () => {
    const t = tracker();
    let items = [box(1, 100, 100), box(2, 190, 100), box(3, 140, 300)];
    t.step(0, items, VIEW, INSET);
    const slots = t.step(16, items, VIEW, INSET).map((p) => [p.cand, p.variant]);
    for (let f = 2; f < 40; f++) {
      items = items.map((it) => move(it, 2.5, 1.5));
      const out = t.step(f * 16, items, VIEW, INSET);
      expect(out.map((p) => [p.cand, p.variant])).toEqual(slots);
      expect(out.every((p) => !p.moved)).toBe(true);
      out.forEach((p, n) => {
        if (p.cand === SPOT.aboveLeft) expect([p.x, p.y]).toEqual([items[n]!.rect.c0 - BLEED, items[n]!.rect.r0 - p.h - GAP]);
      });
      expect(t.info).toMatchObject({ changed: true, full: false, partial: 0 });
    }
  });
  it("two labels that start to collide while moving are left alone until the camera settles (no hopping)", () => {
    const t = tracker();
    const a = box(1, 100, 100);
    let b = box(2, 300, 100);
    t.step(0, [a, b], VIEW, INSET);
    const first = t.step(16, [a, b], VIEW, INSET).map((p) => p.cand);
    let now = 16;
    for (let f = 0; f < 30; f++) {
      b = move(b, -6, 0); // b's box slides into a's label
      now += 16;
      const out = t.step(now, [a, b], VIEW, INSET);
      expect(out.map((p) => p.cand)).toEqual(first);
    }
    // ... and the plan on the settled camera gives a collision-free result
    const settled = t.step(now + TRACK.settleMs + 1, [a, b], VIEW, INSET);
    expect(t.info.full).toBe(true);
    expect(overlap(settled[0]!, settled[1]!, PX_UNITS.clearance)).toBe(false);
    expect(settled.some((p) => p.moved)).toBe(true);
  });
});

describe("the plan runs when the camera has settled, once", () => {
  it("due at the last change plus settleMs; one full plan, then nothing is owed", () => {
    const t = tracker();
    let items = [box(1, 100, 100), box(2, 130, 100)];
    t.step(0, items, VIEW, INSET);
    items = items.map((it) => move(it, 5, 0));
    t.step(100, items, VIEW, INSET);
    expect(t.dueAt).toBe(100 + TRACK.settleMs);
    t.step(100 + TRACK.settleMs - 1, items, VIEW, INSET);
    expect(t.info.full).toBe(false);
    t.step(100 + TRACK.settleMs, items, VIEW, INSET);
    expect(t.info.full).toBe(true);
    expect(t.dueAt).toBeNull();
    t.step(100 + TRACK.settleMs + 16, items, VIEW, INSET);
    expect(t.info.full).toBe(false);
  });
  it("a plan on an unchanged camera is sticky: nothing moves when nothing is wrong", () => {
    const t = tracker();
    const items = [box(1, 100, 100), box(2, 400, 100), box(3, 100, 300)];
    const first = t.step(0, items, VIEW, INSET);
    const out = t.step(1000, items, VIEW, INSET);
    expect(t.info.full).toBe(true);
    expect(out.map((p) => [p.cand, p.variant, p.x, p.y])).toEqual(first.map((p) => [p.cand, p.variant, p.x, p.y]));
    expect(out.some((p) => p.moved)).toBe(false);
  });
  it("a motion that never stops is re-planned at most once per maxFrozenMs, not on its first frame", () => {
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
    expect(fulls.length).toBeGreaterThanOrEqual(2);
    expect(fulls.length).toBeLessThanOrEqual(Math.ceil((600 * 16) / TRACK.maxFrozenMs));
    expect(fulls[0]! - 16).toBeGreaterThanOrEqual(TRACK.maxFrozenMs - 16);
    for (let k = 1; k < fulls.length; k++) expect(fulls[k]! - fulls[k - 1]!).toBeGreaterThanOrEqual(TRACK.maxFrozenMs);
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

describe("hover and selection are not plan inputs: the label is written longer around its slot", () => {
  const grid = VIEW;
  const units = pxUnits(2.5);
  const rect = { c0: 400, r0: 100, c1: 450, r1: 140 };
  it("a label anchored on the box's left edge grows to the right, one anchored on its right edge grows to the left", () => {
    const wide = { w: 160, h: 16 };
    const left = anchored(SPOT.aboveLeft, rect, wide, { x: 400 - BLEED, y: 100 - 16 - GAP }, grid, units);
    expect(left).toEqual({ x: 400 - BLEED, y: 100 - 16 - GAP });
    const right = anchored(SPOT.aboveRight, rect, wide, { x: 410, y: 100 - 16 - GAP }, grid, units);
    expect(right.x).toBe(450 - 160 + BLEED);
    expect(right.y).toBe(100 - 16 - GAP);
  });
  it("it never leaves the screen: it is pulled back inside", () => {
    const r = { c0: 740, r0: 100, c1: 790, r1: 140 };
    const p = anchored(SPOT.aboveLeft, r, { w: 160, h: 16 }, { x: 740, y: 84 }, grid, units);
    expect(p.x + 160).toBeLessThanOrEqual(800);
    expect(p.x).toBeGreaterThanOrEqual(0);
  });
  it("a label drawn over others (no candidate) keeps its place", () => {
    expect(anchored(-1, rect, { w: 120, h: 16 }, { x: 410, y: 90 }, grid, units)).toEqual({ x: 410, y: 90 });
  });
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
 * A deterministic camera sweep over 70 labelled boxes, compared with the plan run on EVERY frame (what the overlay did before: `planLabels`
 * with the last frame's choice as its memory). The camera pans 420 px and zooms 1 -> 1.7 over 3 s at 60 fps, with boxes snapped to 2.5 px cells
 * like the real ones, then rests for 0.5 s.
 *
 * FLICKER METRIC. For each label present in two consecutive frames, a CHANGE is a different slot (candidate position, or way of writing it)
 * and a JUMP is a plate that moved in one frame by more than its box did (its fastest corner) plus 4 px. A label that appears or disappears
 * is counted apart (`visibility`: the camera and the cut decide it, the same for any plan). The numbers are per label over the whole sweep
 * (changes / labels that were ever shown) and the worst frame (labels that changed in one frame).
 */
interface Sweep {
  /** Slot changes in the frames after the camera stopped (the settle plan; the every-frame plan has none left to make). */
  settleChanges: number;
  /** Different slots of labels shown in two consecutive frames: the flicker. */
  changes: number;
  /** Labels that appeared or disappeared (the camera and the cut decide it, the same for any plan). */
  visibility: number;
  /** Label-frames, for the rate. */
  shownFrames: number;
  jumps: number;
  labels: number;
  worstFrame: number;
  perLabel: number;
  finalOverlaps: number;
}

/** The every-frame plan with the distances the pixel version had: 1 cell of clearance, 2 cells of margin before a better slot is taken, on 2.5 px cells. */
const OLD_UNITS = { clearance: 2.5, upgradeMargin: 5, shiftStep: 5, inset: 2.5, quant: 2.5, gap: 0, bleed: 0 };

function sweep(strategy: "every-frame" | "tracked"): Sweep {
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
  const tr = new LabelTracker(mem, PX_UNITS);
  const prevOld = new Map<number, Prev>();
  let last = new Map<number, { cand: number; variant: number; px: number; py: number; r: TrackItem['rect'] }>();
  const FRAMES = 180 + 30;
  let changes = 0;
  let visibility = 0;
  let shownFrames = 0;
  let jumps = 0;
  let worstFrame = 0;
  let settleChanges = 0;
  const everShown = new Set<number>();
  let finalOverlaps = 0;
  const snap = (v: number) => Math.round(v / 2.5) * 2.5;
  for (let f = 0; f < FRAMES; f++) {
    // a hand on the map: a pan that swings both ways while the zoom breathes in and out, then rest
    const u = Math.min(1, f / 180);
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
    const now = new Map<number, { cand: number; variant: number; px: number; py: number; r: TrackItem['rect'] }>();
    let plates: { x: number; y: number; w: number; h: number }[] = [];
    if (strategy === "every-frame") {
      const plan: PlanItem[] = items.map((it) => ({ score: it.score, area: it.area, key: it.key, rect: it.rect, variants: it.variants, prev: prevOld.get(it.id) ?? null }));
      const out = planLabels(plan, VIEW, OLD_UNITS);
      out.forEach((p, n) => {
        const it = items[n]!;
        prevOld.set(it.id, { variant: p.variant, cand: p.cand, dx: p.x - it.rect.c0, dy: p.y - it.rect.r0 });
        now.set(it.id, { cand: p.cand, variant: p.variant, px: p.x, py: p.y, r: it.rect });
        plates.push({ x: p.x, y: p.y, w: p.w, h: p.h });
      });
    } else {
      const out = tr.step(f * (1000 / 60), items, VIEW, INSET);
      out.forEach((p, n) => {
        const it = items[n]!;
        now.set(it.id, { cand: p.cand, variant: p.variant, px: p.x, py: p.y, r: it.rect });
        plates.push({ x: p.x, y: p.y, w: p.w, h: p.h });
      });
    }
    let frameChanges = 0;
    for (const [id, s] of now) {
      everShown.add(id);
      shownFrames++;
      const p = last.get(id);
      if (!p) {
        if (f > 0) visibility++; // appears
        continue;
      }
      if (p.cand !== s.cand || p.variant !== s.variant) frameChanges++;
      // a jump: the plate moved in one frame by more than its box moved (its fastest corner) plus a cell and a half
      const boxMove = Math.max(Math.abs(p.r.c0 - s.r.c0), Math.abs(p.r.r0 - s.r.r0), Math.abs(p.r.c1 - s.r.c1), Math.abs(p.r.r1 - s.r.r1));
      if (Math.max(Math.abs(p.px - s.px), Math.abs(p.py - s.py)) > boxMove + 4) jumps++;
    }
    for (const id of last.keys()) if (!now.has(id)) visibility++; // disappears
    if (f < 180) {
      changes += frameChanges;
      worstFrame = Math.max(worstFrame, frameChanges);
    } else settleChanges += frameChanges; // the re-plan once the camera has stopped, glided

    last = now;
    if (f === FRAMES - 1) {
      for (let a = 0; a < plates.length; a++) for (let b = a + 1; b < plates.length; b++) if (plates[a]!.x < plates[b]!.x + plates[b]!.w && plates[a]!.x + plates[a]!.w > plates[b]!.x && plates[a]!.y < plates[b]!.y + plates[b]!.h && plates[a]!.y + plates[a]!.h > plates[b]!.y) finalOverlaps++;
    }
  }
  return { settleChanges, changes, visibility, shownFrames, jumps, labels: everShown.size, worstFrame, perLabel: changes / everShown.size, finalOverlaps };
}

describe("flicker metric over a camera sweep: labels keep their slot while the camera moves", () => {
  const old = sweep("every-frame");
  const now = sweep("tracked");
  it("reports both numbers (the plan on every frame, then the tracked plan)", () => {
    console.info(
      `label flicker over the sweep (${old.labels} labels, 210 frames, ${old.visibility} appearances and disappearances for both): every-frame plan ${old.changes} slot changes (${old.perLabel.toFixed(2)} per label, ${old.jumps} jumps, worst frame ${old.worstFrame}); tracked ${now.changes} (${now.perLabel.toFixed(2)} per label, ${now.jumps} jumps, worst frame ${now.worstFrame}) plus ${now.settleChanges} glided by the plan when the camera stopped`,
    );
    expect(old.labels).toBeGreaterThan(40);
    expect(now.visibility).toBe(old.visibility);
    expect(now.labels).toBe(old.labels);
  });
  it("the plan on every frame flickers (the problem)", () => {
    expect(old.perLabel).toBeGreaterThan(1);
  });
  it("the tracked plan changes a label's slot far less than once over the sweep, at least 5x less than the every-frame plan", () => {
    expect(now.perLabel).toBeLessThan(1);
    expect(now.changes * 5).toBeLessThanOrEqual(old.changes);
    expect(now.jumps * 5).toBeLessThanOrEqual(old.jumps);
  });
  it("no frame changes more than a handful of labels at once (appearing and disappearing boxes included)", () => {
    expect(now.worstFrame).toBeLessThanOrEqual(old.worstFrame);
    expect(now.worstFrame).toBeLessThanOrEqual(8);
  });
  it("at rest the labels are as collision-free as the every-frame plan leaves them", () => {
    expect(now.finalOverlaps).toBeLessThanOrEqual(old.finalOverlaps + 1);
  });
});
