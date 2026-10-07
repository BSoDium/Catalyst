import { describe, expect, it } from "vitest";
import { EASE, FILL_RADIUS, easeImage, matchRadius, stepBudget, type EaseFrame, type LevelImage } from "./ease";
import { buildWarpMesh, type WarpCamera } from "./warp";

const W = 24;
const H = 12;
const img = (): LevelImage => ({ lvl: new Uint8Array(W * H), line: new Uint8Array(W * H) });
const put = (i: LevelImage, x: number, y: number, level: number, line = 1) => {
  i.lvl[y * W + x] = level;
  i.line[y * W + x] = level > 0 ? line : 0;
};
const get = (i: LevelImage, x: number, y: number) => i.lvl[y * W + x]!;
const clone = (i: LevelImage): LevelImage => ({ lvl: i.lvl.slice(), line: i.line.slice() });
const hline = (i: LevelImage, y: number, x0: number, x1: number, level: number, line = 1) => {
  for (let x = x0; x <= x1; x++) put(i, x, y, level, line);
};
const frame = (o: Partial<EaseFrame> & Pick<EaseFrame, "target" | "prevTarget" | "prev">): EaseFrame => ({ cols: W, rows: H, mesh: null, step: 1, radius: 0, ...o });

describe("step budget (the fade is paced by time, not by frames)", () => {
  it("spends whole levels and carries the rest", () => {
    let carry = 0;
    let total = 0;
    for (let i = 0; i < 120; i++) {
      const s = stepBudget(carry, 8.3); // 120 Hz
      carry = s.carry;
      total += s.step;
    }
    // 120 frames of 8.3 ms = 996 ms = 41.5 levels at 24 ms per level
    expect(total).toBe(Math.floor((120 * 8.3) / EASE.msPerLevel));
    expect(carry).toBeLessThan(1);
  });
  it("is the same pace at 60 Hz and 120 Hz", () => {
    const run = (dt: number, frames: number) => {
      let carry = 0, total = 0;
      for (let i = 0; i < frames; i++) { const s = stepBudget(carry, dt); carry = s.carry; total += s.step; }
      return total;
    };
    expect(Math.abs(run(16.67, 60) - run(8.33, 120))).toBeLessThanOrEqual(1);
  });
  it("counts a long frame (a hidden tab, a stall) as at most maxDtMs, so a fade never jumps", () => {
    expect(stepBudget(0, 5000).step).toBe(Math.floor(EASE.maxDtMs / EASE.msPerLevel));
    expect(stepBudget(0, -5).step).toBe(0);
  });
});

describe("ease at rest (identity warp): every cell moves towards its target by at most `step` levels", () => {
  it("a line that appears climbs one level per tick and settles on its tone, a line that leaves falls the same way", () => {
    const target = img();
    hline(target, 5, 3, 18, 9);
    let prev = img();
    let prevTarget = img();
    const seen: number[] = [];
    for (let t = 0; t < 12; t++) {
      const out = easeImage(frame({ target, prevTarget, prev, step: 1 }));
      seen.push(get(out, 10, 5));
      prevTarget = clone(target);
      prev = out;
    }
    expect(seen.slice(0, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 9]);
    // and away
    const gone = img();
    const down: number[] = [];
    for (let t = 0; t < 11; t++) {
      const out = easeImage(frame({ target: gone, prevTarget: clone(target), prev, step: 1 }));
      down.push(get(out, 10, 5));
      prev = out;
    }
    expect(down).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0]);
  });
  it("a bigger step moves proportionally and never overshoots", () => {
    const target = img();
    put(target, 4, 4, 7);
    const out = easeImage(frame({ target, prevTarget: img(), prev: img(), step: 3 }));
    expect(get(out, 4, 4)).toBe(3);
    const prev = img();
    put(prev, 4, 4, 6);
    expect(get(easeImage(frame({ target, prevTarget: img(), prev, step: 3 })), 4, 4)).toBe(7);
  });
  it("step 0 keeps what is there", () => {
    const target = img();
    put(target, 4, 4, 7);
    const prev = img();
    put(prev, 4, 4, 2);
    put(prev, 9, 9, 5);
    const out = easeImage(frame({ target, prevTarget: img(), prev, step: 0 }));
    expect(get(out, 4, 4)).toBe(2);
    expect(get(out, 9, 9)).toBe(5);
  });
  it("a tone step of a class (the target changes level by one) moves by one level", () => {
    const a = img();
    hline(a, 3, 2, 10, 5);
    const b = img();
    hline(b, 3, 2, 10, 6);
    const out = easeImage(frame({ target: b, prevTarget: a, prev: a, step: 1 }));
    expect(get(out, 6, 3)).toBe(6);
  });
});

describe("ease while the camera moves: the previous image is looked up where the camera had it", () => {
  const cam = (x: number): WarpCamera => ({ lon: 0, lat: 0, zoom: 14, cx: (W * 2) / 2, cy: (H * 2) / 2, cell: 2 }); // lon is moved below
  const camAt = (cells: number): WarpCamera => {
    // a pan to the east by `cells`: lon grows by cells * cell css px / (512 * 2^zoom) * 360
    const lon = ((cells * 2) / (512 * 2 ** 14)) * 360;
    return { ...cam(0), lon };
  };
  it("a fully presented line that moves by whole cells keeps its tone at once, and leaves nothing behind", () => {
    const prevTarget = img();
    hline(prevTarget, 5, 4, 12, 9);
    const prev = clone(prevTarget);
    const target = img();
    hline(target, 5, 3, 11, 9); // the camera went east by one cell: content moves west
    const mesh = buildWarpMesh(camAt(0), camAt(1), W, H);
    const out = easeImage(frame({ target, prevTarget, prev, mesh, radius: matchRadius(mesh), step: 1 }));
    expect(Array.from(out.lvl)).toEqual(Array.from(target.lvl));
  });
  it("a line fading in keeps fading in while it slides (its presented tone follows the content)", () => {
    const prevTarget = img();
    hline(prevTarget, 5, 4, 12, 9);
    const prev = img();
    hline(prev, 5, 4, 12, 3); // 3 of 9 presented
    const target = img();
    hline(target, 5, 3, 11, 9);
    const mesh = buildWarpMesh(camAt(0), camAt(1), W, H);
    const out = easeImage(frame({ target, prevTarget, prev, mesh, radius: matchRadius(mesh), step: 1 }));
    for (let x = 3; x <= 11; x++) expect(get(out, x, 5), `x ${x}`).toBe(4);
  });
  it("content that arrives mid-pan (no same-tone line near it a frame ago) fades in from nothing", () => {
    const prevTarget = img();
    hline(prevTarget, 2, 4, 12, 9);
    const prev = clone(prevTarget);
    const target = clone(prevTarget);
    hline(target, 2, 3, 11, 9);
    target.lvl.fill(0);
    target.line.fill(0);
    hline(target, 2, 3, 11, 9);
    hline(target, 9, 3, 11, 6); // a new road, far from anything
    const mesh = buildWarpMesh(camAt(0), camAt(1), W, H);
    const out = easeImage(frame({ target, prevTarget, prev, mesh, radius: matchRadius(mesh), step: 1 }));
    expect(get(out, 6, 9)).toBe(1);
    expect(get(out, 6, 2)).toBe(9);
  });
  it("removed content next to nothing fades out while the camera moves; a line that moved is cleared at once (no trail)", () => {
    const prevTarget = img();
    hline(prevTarget, 5, 4, 12, 9);
    hline(prevTarget, 9, 4, 12, 7);
    const prev = clone(prevTarget);
    const target = img();
    hline(target, 5, 3, 11, 9); // the first road moved with the camera, the second one was removed
    const mesh = buildWarpMesh(camAt(0), camAt(1), W, H);
    const out = easeImage(frame({ target, prevTarget, prev, mesh, radius: matchRadius(mesh), step: 1 }));
    expect(get(out, 11, 5)).toBe(9);
    expect(get(out, 12, 5)).toBe(0); // the old last cell: gone with the move, not a trail
    expect(get(out, 6, 9)).toBe(6); // removed: fades
  });
  it("a sub-cell jitter of a thin line (one cell off the shifted position) is not a new line and not a lost one", () => {
    const prevTarget = img();
    hline(prevTarget, 5, 4, 12, 9);
    const prev = clone(prevTarget);
    const target = img();
    hline(target, 6, 3, 11, 9); // moved one cell sideways as well: the nearest-cell warp cannot tell
    const mesh = buildWarpMesh(camAt(0), camAt(1), W, H);
    const out = easeImage(frame({ target, prevTarget, prev, mesh, radius: matchRadius(mesh), step: 1 }));
    expect(Array.from(out.lvl)).toEqual(Array.from(target.lvl));
  });
  it("cells the previous image did not show (a pan uncovered them) take the target at once", () => {
    const target = img();
    hline(target, 5, 0, 3, 8); // the left cells come from outside the previous image
    const prevTarget = img();
    const mesh = buildWarpMesh(camAt(1), camAt(0), W, H); // the camera went west: new ground at the left
    const out = easeImage(frame({ target, prevTarget, prev: img(), mesh, radius: matchRadius(mesh), step: 1 }));
    expect(get(out, 0, 5)).toBe(8);
  });
});

describe("fill patterns are anchored to the screen", () => {
  it("a lit fill cell next to lit fill of the same tone was already there: no fade, the lattice does not move with the camera", () => {
    // the water lattice: lit cells stay at the same screen cells while the region slides
    const prevTarget = img();
    const lit = (i: LevelImage) => { for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 3) put(i, x, y, 4, 0); };
    lit(prevTarget);
    const prev = clone(prevTarget);
    const target = clone(prevTarget);
    const cam0: WarpCamera = { lon: 0, lat: 0, zoom: 14, cx: W, cy: H, cell: 2 };
    const cam1: WarpCamera = { ...cam0, lon: (5 * 2 / (512 * 2 ** 14)) * 360 }; // five cells east
    const mesh = buildWarpMesh(cam0, cam1, W, H);
    const out = easeImage(frame({ target, prevTarget, prev, mesh, radius: matchRadius(mesh), step: 1 }));
    expect(Array.from(out.lvl)).toEqual(Array.from(target.lvl));
  });
  it("a region that arrives (no fill within the lattice radius a frame ago) fades in; one that leaves fades out", () => {
    const target = img();
    put(target, 10, 4, 4, 0);
    const out = easeImage(frame({ target, prevTarget: img(), prev: img(), step: 1 }));
    expect(get(out, 10, 4)).toBe(1);
    const prev = img();
    put(prev, 10, 4, 4, 0);
    const gone = easeImage(frame({ target: img(), prevTarget: clone(prev), prev, step: 1 }));
    expect(get(gone, 10, 4)).toBe(3);
  });
  it("the receding edge of a region does not leave a trail while other fill is still within the lattice radius", () => {
    const prev = img();
    put(prev, 10, 4, 4, 0);
    const target = img();
    put(target, 10 + FILL_RADIUS, 4, 4, 0); // the lattice's next lit cell, within the radius
    const out = easeImage(frame({ target, prevTarget: clone(prev), prev, step: 1 }));
    expect(get(out, 10, 4)).toBe(0);
  });
  it("a line over a fill shows the louder of the two", () => {
    const prev = img();
    put(prev, 6, 6, 4, 0);
    const target = img();
    put(target, 6, 6, 9, 1);
    const out = easeImage(frame({ target, prevTarget: clone(prev), prev, step: 1 }));
    expect(get(out, 6, 6)).toBe(5); // from the fill's tone towards the line's
    expect(out.line[6 * W + 6]).toBe(1);
  });
});

describe("the cut: a seed that is a different picture is crossfaded cell by cell", () => {
  it("the old line fades out while the new one fades in (they are not the same content)", () => {
    const seed = img();
    hline(seed, 4, 2, 20, 10); // the globe's coast
    const target = img();
    hline(target, 6, 2, 20, 10); // the street's: two cells away
    let prev = seed;
    let prevTarget = clone(seed);
    const mid: [number, number][] = [];
    for (let t = 0; t < 11; t++) {
      const out = easeImage(frame({ target, prevTarget, prev, step: 1 }));
      mid.push([get(out, 10, 4), get(out, 10, 6)]);
      prev = out;
      prevTarget = clone(target);
    }
    expect(mid[0]).toEqual([9, 1]);
    expect(mid[4]).toEqual([5, 5]);
    expect(mid[10]).toEqual([0, 10]);
  });
  it("a cell the two share keeps its tone: nothing blinks where they agree", () => {
    const seed = img();
    hline(seed, 4, 2, 20, 10);
    const target = clone(seed);
    const out = easeImage(frame({ target, prevTarget: clone(seed), prev: seed, step: 1 }));
    expect(Array.from(out.lvl)).toEqual(Array.from(seed.lvl));
  });
});
