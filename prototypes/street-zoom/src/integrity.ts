/**
 * In-page line-integrity measurement (driven by scripts/line-integrity.mjs and scripts/line-regression.mjs through
 * window.__app.integrity). It never changes what the app renders for the user; it is a test harness.
 *
 * Method (docs/pixel-line-rules.md):
 *   1. Hide every layer but one line class, so the metric is per class.
 *   2. Render the SAME map with the plain-colour style at high resolution (the reference, 18 reference px per art cell)
 *      and read the R (ink) channel. "Touch" = any reference ink in the cell footprint. "Centre" = ink at the exact
 *      cell centre, i.e. the native raster of the line at the style's width.
 *   3. Compare with the class codes the pass produced for the same view (read back from the art texture).
 */
import type { Map as MLMap } from "maplibre-gl";
import {
  blockFraction,
  changedRatio,
  compareMasks,
  components8,
  count,
  dilate,
  inkMask,
  makeMask,
  removeStairs,
  type Mask,
} from "./core/artLine";
import type { Street } from "./street";
import { SPECS, applyCell, legacyWidthPaint } from "./style/monoStyle";

/** Layer groups, by line class. Ids not present in the current style are ignored. */
export const CLASSES: Record<string, string[]> = {
  "roads-major": ["road-highway-case", "road-major-case", "road-major-fill"],
  "roads-medium": ["road-medium-case", "road-medium-fill"],
  "roads-minor": ["road-minor"],
  "water-edge": ["water-edge-detail", "water-edge", "waterway-major"],
  buildings: ["building-outline"],
  boundary: ["boundary-country", "world-borders", "world-coast"],
  dotted: ["road-minor-dotted", "road-other-dotted", "path-dotted", "waterway-minor", "boundary-region", "waterway-canal", "rail"],
  fills: ["water-fill", "park-fill", "building-fill"],
};

/** Classes whose ink is solid lines (the guaranteed-width rules apply). */
export const INK_CLASSES = ["roads-major", "roads-medium", "roads-minor", "water-edge", "buildings", "boundary"];

const REF_CELL = 18; // reference px per art cell

export interface View {
  lon: number;
  lat: number;
  zoom: number;
}

function setVisible(map: MLMap, ids: string[] | null): void {
  for (const l of map.getStyle().layers) {
    if (l.id === "background") continue;
    const on = ids === null || ids.includes(l.id);
    map.setLayoutProperty(l.id, "visibility", on ? "visible" : "none");
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

async function settle(street: Street): Promise<void> {
  await street.whenSettled(60000);
  await nextFrame();
}

/** One art image: class codes read right after the pass of a forced repaint. */
async function captureCodes(street: Street): Promise<{ cols: number; rows: number; codes: Uint8Array }> {
  const comp = street.compositor;
  if (!comp) throw new Error("no compositor");
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("captureCodes timeout")), 15000);
    comp.onFrame = (c) => {
      comp.onFrame = null;
      clearTimeout(t);
      const r = c.readCodes();
      if (r) resolve(r);
      else reject(new Error("no codes"));
    };
    street.map.triggerRepaint();
  });
}

export interface RefImage {
  w: number;
  h: number;
  /** ink channel, 0..255 */
  r: Uint8Array;
  g: Uint8Array;
  ratio: number;
}

async function captureRef(street: Street, ratio: number): Promise<RefImage> {
  const map = street.map;
  const canvas = map.getCanvas();
  const scratch = document.createElement("canvas");
  const keep = canvas.width / canvas.clientWidth;
  (map as unknown as { setPixelRatio: (r: number) => void }).setPixelRatio(ratio);
  await settle(street);
  const img = await new Promise<ImageData>((resolve) => {
    map.once("render", () => {
      scratch.width = canvas.width;
      scratch.height = canvas.height;
      const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(canvas, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    });
    map.triggerRepaint();
  });
  const n = img.width * img.height;
  const r = new Uint8Array(n);
  const g = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = img.data[i * 4]!;
    g[i] = img.data[i * 4 + 1]!;
  }
  (map as unknown as { setPixelRatio: (r: number) => void }).setPixelRatio(keep);
  await settle(street);
  return { w: img.width, h: img.height, r, g, ratio };
}

/** Cells (cols x rows) that contain any ink in the reference footprint. */
function touchMask(ref: RefImage, channel: "r" | "g", cell: number, cols: number, rows: number, thr = 128): Mask {
  const m = makeMask(cols, rows);
  const src = ref[channel];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let hit = 0;
      const y1 = Math.min(ref.h, (cy + 1) * cell);
      const x1 = Math.min(ref.w, (cx + 1) * cell);
      for (let y = cy * cell; y < y1 && !hit; y++) {
        const row = y * ref.w;
        for (let x = cx * cell; x < x1; x++) {
          if (src[row + x]! > thr) {
            hit = 1;
            break;
          }
        }
      }
      m.data[cy * cols + cx] = hit;
    }
  }
  return m;
}

/** Cells whose exact centre (shifted by dx, dy reference px) has ink: the native raster of the reference. */
function centreMask(ref: RefImage, channel: "r" | "g", cell: number, cols: number, rows: number, dx = 0, dy = 0, thr = 128): Mask {
  const m = makeMask(cols, rows);
  const src = ref[channel];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = Math.round(cx * cell + cell / 2 + dx);
      const y = Math.round(cy * cell + cell / 2 + dy);
      if (x < 0 || y < 0 || x >= ref.w || y >= ref.h) continue;
      m.data[cy * cols + cx] = src[y * ref.w + x]! > thr ? 1 : 0;
    }
  }
  return m;
}

/** Tone level (sixteenths) of the fill at each cell centre, shifted by dx, dy reference px. */
function centreLevels(ref: RefImage, cell: number, cols: number, rows: number, dx = 0, dy = 0): Int8Array {
  const out = new Int8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = Math.round(cx * cell + cell / 2 + dx);
      const y = Math.round(cy * cell + cell / 2 + dy);
      if (x < 0 || y < 0 || x >= ref.w || y >= ref.h) continue;
      out[cy * cols + cx] = Math.round((ref.g[y * ref.w + x]! / 255) * 16);
    }
  }
  return out;
}

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

export interface ClassStat {
  cls: string;
  /** ink cells in the pass output */
  out: number;
  /** cells that touch reference ink (any-ink footprint) */
  touch: number;
  /** fraction of touch cells with no ink in the output (strict, cell for cell) */
  touchMiss: number;
  /** fraction of touch cells with no output ink within one cell: the line is really missing there */
  lineMiss: number;
  /** same two numbers against the native raster of the min-one-art-pixel reference ("ideal"), when comparable */
  ideal: { cells: number; lineMiss: number; strictMiss: number; spurious: number; sizeRatio: number; components: number } | null;
  /** 8-connected components of output vs of the touch mask (>1 = the output fragments lines) */
  components: { out: number; touch: number; ratio: number };
  /** 8-connected components of the output over those of the native raster (1 = the same lines, > 1 = fragmented) */
  fragmentation: number | null;
  /** fraction of ink cells inside a fully inked 2x2 block (thickness doubling; ~0 for 1 px lines) */
  blocks: number;
}

function cellInfo(street: Street): { cellCss: number; ratio: number; refCell: number } {
  const c = street.cellCss();
  const dpr = window.devicePixelRatio || 1;
  const eff = Math.max(1, Math.round(c * dpr)) / dpr;
  const ratio = REF_CELL / eff;
  return { cellCss: eff, ratio, refCell: REF_CELL };
}

function restoreLegacyWidths(map: MLMap): void {
  for (const spec of SPECS) {
    if (spec.type === "line" && map.getLayer(spec.id)) map.setPaintProperty(spec.id, "line-width", legacyWidthPaint(spec) as never);
  }
  for (const id of ["world-coast", "world-borders"]) if (map.getLayer(id)) map.setPaintProperty(id, "line-width", 0.6);
}

export async function measureStatic(street: Street, opts: { view: View; classes?: string[]; legacyWidths: boolean; thinStairs?: boolean }): Promise<ClassStat[]> {
  const map = street.map;
  street.setView(opts.view);
  await settle(street);
  const { cellCss, ratio, refCell } = cellInfo(street);
  const out: ClassStat[] = [];
  for (const cls of opts.classes ?? Object.keys(CLASSES)) {
    const ids = CLASSES[cls]!.filter((id) => map.getLayer(id));
    if (!ids.length) continue;
    setVisible(map, ids);
    await settle(street);
    const art = await captureCodes(street);
    const O = inkMask(art.cols, art.rows, art.codes);
    const refNominal = await captureRef(street, ratio);
    const T = touchMask(refNominal, "r", refCell, art.cols, art.rows);
    let ideal: ClassStat["ideal"] = null;
    if (INK_CLASSES.includes(cls)) {
      let refIdeal = refNominal;
      if (opts.legacyWidths) {
        applyCell(map, cellCss);
        refIdeal = await captureRef(street, ratio);
        restoreLegacyWidths(map);
      }
      let C = centreMask(refIdeal, "r", refCell, art.cols, art.rows);
      if (opts.thinStairs) C = removeStairs(C);
      const cmp = compareMasks(C, O);
      ideal = { cells: cmp.ideal, lineMiss: round(cmp.lineMiss), strictMiss: round(cmp.strictMiss), spurious: round(cmp.spurious), sizeRatio: round(cmp.sizeRatio, 3), components: components8(C).n };
    }
    const nT = count(T);
    const dO = dilate(O, 1);
    let miss = 0;
    let lineMiss = 0;
    for (let i = 0; i < T.data.length; i++) {
      if (T.data[i]) {
        if (!O.data[i]) miss++;
        if (!dO.data[i]) lineMiss++;
      }
    }
    const cO = components8(O).n;
    const cT = components8(T).n;
    out.push({
      cls,
      out: count(O),
      touch: nT,
      touchMiss: nT ? round(miss / nT) : 0,
      lineMiss: nT ? round(lineMiss / nT) : 0,
      ideal,
      components: { out: cO, touch: cT, ratio: cT ? round(cO / cT, 3) : 0 },
      fragmentation: ideal && ideal.components ? round(cO / ideal.components, 3) : null,
      blocks: round(blockFraction(O), 3),
    });
  }
  setVisible(map, null);
  return out;
}

export interface MotionStat {
  steps: number;
  stepArt: number;
  dir: [number, number];
  /** mean changed cells per frame, per ink cell of the plain native raster (same denominator for every variant) */
  changedOut: number;
  /** the same for the native raster with this variant's own thinning applied (the ideal this variant must match) */
  changedIdeal: number;
  /** ... and for the plain native raster, no thinning */
  changedPlain: number;
  /** changedOut / changedIdeal (1 = as stable as native rasterisation with the same thinning) */
  ratio: number;
  /** changedOut / changedPlain */
  ratioPlain: number;
  /** cells that go ink -> not -> ink (or the reverse) across three frames, per ink cell of the plain raster */
  reversalsOut: number;
  reversalsIdeal: number;
  reversalsPlain: number;
}

/** Slow pan by `stepArt` art pixels per frame along `dir`; compares frame-to-frame change with the native raster. */
export async function measureMotion(
  street: Street,
  opts: { view: View; classes?: string[]; steps?: number; stepArt?: number; dir?: [number, number]; legacyWidths: boolean; thinStairs?: boolean },
): Promise<MotionStat> {
  const map = street.map;
  const steps = opts.steps ?? 24;
  const stepArt = opts.stepArt ?? 0.25;
  const dir = opts.dir ?? [1, 0];
  street.setView(opts.view);
  await settle(street);
  const { cellCss, ratio, refCell } = cellInfo(street);
  const ids = (opts.classes ?? INK_CLASSES).flatMap((c) => CLASSES[c]!).filter((id) => map.getLayer(id));
  setVisible(map, ids);
  await settle(street);
  const c0 = map.getCenter();
  const c0px = map.project(c0);

  // ideal: the native raster of the min-width reference, sampled with the centres shifted by the pan
  if (opts.legacyWidths) applyCell(map, cellCss);
  const ref = await captureRef(street, ratio);
  if (opts.legacyWidths) restoreLegacyWidths(map);
  const first = await captureCodes(street);
  const { cols, rows } = first;

  const stepCss = stepArt * cellCss;
  // targets are computed from the START camera: unproject is relative to the current transform
  const targets = Array.from({ length: steps }, (_, i) => map.unproject([c0px.x + dir[0] * stepCss * (i + 1), c0px.y + dir[1] * stepCss * (i + 1)]));
  const outs: Mask[] = [inkMask(cols, rows, first.codes)];
  const plain: Mask[] = [centreMask(ref, "r", refCell, cols, rows)];
  for (let k = 1; k <= steps; k++) {
    map.jumpTo({ center: targets[k - 1]! });
    const a = await captureCodes(street);
    outs.push(inkMask(cols, rows, a.codes));
    plain.push(centreMask(ref, "r", refCell, cols, rows, dir[0] * stepCss * k * ratio, dir[1] * stepCss * k * ratio));
  }
  const ideals = opts.thinStairs ? plain.map((m) => removeStairs(m)) : plain;
  const series = (ms: Mask[]) => {
    let ch = 0;
    let rev = 0;
    for (let k = 0; k < ms.length - 1; k++) {
      ch += changedRatio(ms[k]!, ms[k + 1]!).changed;
      if (k + 2 < ms.length) {
        const a = ms[k]!.data;
        const b = ms[k + 1]!.data;
        const c = ms[k + 2]!.data;
        for (let i = 0; i < a.length; i++) if (a[i] === c[i] && a[i] !== b[i]) rev++;
      }
    }
    return { changed: ch, rev };
  };
  let denom = 0;
  for (let k = 0; k < plain.length - 1; k++) denom += count(plain[k]!);
  const o = series(outs);
  const id = series(ideals);
  const pl = series(plain);
  setVisible(map, null);
  map.jumpTo({ center: c0 });
  const per = (v: number) => (denom ? round(v / denom) : 0);
  return {
    steps,
    stepArt,
    dir,
    changedOut: per(o.changed),
    changedIdeal: per(id.changed),
    changedPlain: per(pl.changed),
    ratio: id.changed ? round(o.changed / id.changed, 3) : 0,
    ratioPlain: pl.changed ? round(o.changed / pl.changed, 3) : 0,
    reversalsOut: per(o.rev),
    reversalsIdeal: per(id.rev),
    reversalsPlain: per(pl.rev),
  };
}

/** Tone churn during a pan: fill interior cells must not change (a screen-anchored stipple never swims). */
export async function measureFillChurn(
  street: Street,
  opts: { view: View; steps?: number; stepArt?: number; dir?: [number, number] },
): Promise<{ interiorCells: number; changed: number; churn: number; steps: number; samples: { k: number; x: number; y: number; from: number; to: number }[] }> {
  const map = street.map;
  const steps = opts.steps ?? 16;
  const stepArt = opts.stepArt ?? 0.5;
  const dir = opts.dir ?? [1, 0];
  street.setView(opts.view);
  await settle(street);
  const { cellCss, ratio, refCell } = cellInfo(street);
  const ids = CLASSES.fills!.filter((id) => map.getLayer(id));
  setVisible(map, ids);
  await settle(street);
  const ref = await captureRef(street, ratio);
  const first = await captureCodes(street);
  const { cols, rows } = first;
  const c0 = map.getCenter();
  const c0px = map.project(c0);
  const stepCss = stepArt * cellCss;
  const frames: Uint8Array[] = [first.codes];
  const levels: Int8Array[] = [centreLevels(ref, refCell, cols, rows)];
  const targets = Array.from({ length: steps }, (_, i) => map.unproject([c0px.x + dir[0] * stepCss * (i + 1), c0px.y + dir[1] * stepCss * (i + 1)]));
  for (let k = 1; k <= steps; k++) {
    map.jumpTo({ center: targets[k - 1]! });
    frames.push((await captureCodes(street)).codes);
    levels.push(centreLevels(ref, refCell, cols, rows, dir[0] * stepCss * k * ratio, dir[1] * stepCss * k * ratio));
  }
  // interior = a cell whose 5x5 neighbourhood has ONE constant tone level (>0) in both frames: no polygon edge
  // nearby, so nothing may change there (edge cells legitimately change when a polygon edge crosses them; a
  // screen-anchored stipple must not change anywhere else)
  const flat = (lv: Int8Array, x: number, y: number): number => {
    const v = lv[y * cols + x]!;
    if (v <= 0 || x < 2 || y < 2 || x >= cols - 2 || y >= rows - 2) return 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (lv[(y + dy) * cols + x + dx] !== v) return 0;
    return v;
  };
  let interior = 0;
  let changed = 0;
  const samples: { k: number; x: number; y: number; from: number; to: number }[] = [];
  for (let k = 0; k < steps; k++) {
    for (let y = 2; y < rows - 2; y++) {
      for (let x = 2; x < cols - 2; x++) {
        const a = flat(levels[k]!, x, y);
        if (!a || flat(levels[k + 1]!, x, y) !== a) continue;
        interior++;
        const i = y * cols + x;
        if (frames[k]![i] !== frames[k + 1]![i]) {
          changed++;
          if (samples.length < 12) samples.push({ k, x, y, from: frames[k]![i]!, to: frames[k + 1]![i]! });
        }
      }
    }
  }
  setVisible(map, null);
  map.jumpTo({ center: c0 });
  return { interiorCells: interior, changed, churn: interior ? round(changed / interior) : 0, steps, samples };
}

/** Whole-scene art image as class codes plus the grid size, for screenshots-free comparisons. */
export async function snapshotCodes(street: Street): Promise<{ cols: number; rows: number; codes: number[] }> {
  setVisible(street.map, null);
  await settle(street);
  const r = await captureCodes(street);
  return { cols: r.cols, rows: r.rows, codes: Array.from(r.codes) };
}
