/**
 * Synthetic line-connectivity harness (synthetic.html). Draws known polylines (many angles, sub-pixel offsets, zooms)
 * with the REAL style paints and the REAL pixel pass, reads the art image back and checks, per polyline:
 *   - exactly the expected number of 8-connected components (a solid line is ONE; a hollow road is TWO outlines),
 *   - the ends are covered,
 *   - thickness: cells per step along the major axis (Bresenham count) ~ 1 for one-pixel lines.
 * Driven by scripts/line-integrity.mjs and scripts/line-regression.mjs through window.__synthetic.
 */
import { Map as MLMap, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { bresenhamCount, components8, count, inkMask, makeMask, type Mask } from "./core/artLine";
import { artPixelCss, cellDevicePx } from "./core/pixel";
import { parseConfig } from "./config";
import { CopyCompositor, type Compositor } from "./gl/compositors";
import type { PassParams } from "./gl/pixelPass";
import { SOLID_FROM } from "./core/artLine";
import { CHANNEL, SPECS, linePaint, type Spec } from "./style/monoStyle";

setWorkerUrl(workerUrl);
const cfg = parseConfig(location.search);
const dpr = window.devicePixelRatio || 1;
const container = document.getElementById("map")!;
const cellCss = cfg.px ?? artPixelCss(Math.min(container.clientWidth, container.clientHeight));
const cellOut = cellDevicePx(cellCss, dpr);
const cellEff = cellOut / dpr;

/** Spec ids exercised (key = class used in features). */
const SPEC_BY_ID = new Map<string, Spec>(SPECS.map((s) => [s.id, s]));
const DRAW = ["waterway-major", "road-minor", "building-outline", "road-major-case", "road-major-fill", "road-medium-case", "road-medium-fill", "road-minor-dotted", "rail", "boundary-region"];

function layers() {
  const out: unknown[] = [{ id: "background", type: "background", paint: { "background-color": CHANNEL.erase } }];
  for (const id of DRAW) {
    const spec = SPEC_BY_ID.get(id)!;
    const lp = linePaint(spec, cfg.widths, cellEff);
    out.push({ id, type: "line", source: "lines", filter: ["==", ["get", "cls"], id], ...lp });
  }
  return out;
}

const map = new MLMap({
  container,
  style: {
    version: 8,
    projection: { type: "mercator" },
    sources: { lines: { type: "geojson", data: { type: "FeatureCollection", features: [] }, tolerance: 0, buffer: 512, maxzoom: 22 } },
    layers: layers() as never,
  },
  center: [106.7, 10.78],
  zoom: 15,
  pixelRatio: cfg.scale ?? Math.min(dpr, 2),
  fadeDuration: 0,
  attributionControl: false,
  interactive: false,
  renderWorldCopies: false,
  canvasContextAttributes: { antialias: false, preserveDrawingBuffer: false },
  maxCanvasSize: [8192, 8192],
});

const passCfg = {
  params(): PassParams {
    return {
      bg: [1, 1, 1],
      fg: [0, 0, 0],
      muted: [0.5, 0.5, 0.5],
      cellOut,
      inkThreshold: cfg.inkThreshold,
      solidThreshold: cfg.solid ?? (cfg.rule === "legacy" || cfg.widths === "legacy" ? 1.1 : SOLID_FROM),
      anyThreshold: cfg.anyThreshold,
      rule: cfg.rule,
      thinIters: cfg.thin,
      thinMode: cfg.thinMode,
      pattern: cfg.pattern,
      dither: true,
      sharp: 0,
      focus: { x: 0, y: 0, radius: 0, feather: 1 },
      anchor: [0, 0],
    };
  },
};

let comp: Compositor | null = null;

const ready = new Promise<void>((resolve) =>
  map.once("load", () => {
    comp = new CopyCompositor(map, container, passCfg, cfg.compositor === "copy-art" ? "art" : "device");
    resolve();
  }),
);

type P = [number, number];

export interface LineCase {
  cls: string;
  /** degrees */
  angle: number;
  /** sub-cell offsets of the centre, in art px */
  ox: number;
  oy: number;
  /** half length in art px */
  half: number;
  /** extra vertex: bend by this many degrees at the middle (0 = straight) */
  bend?: number;
}

export interface LineResult extends LineCase {
  comps: number;
  cells: number;
  /** cells per major-axis step (1 for a one-pixel line) */
  perStep: number;
  blocks: number;
  endsCovered: boolean;
}

const BOX = 30; // cells per slot side

function endpoints(c: LineCase, cx: number, cy: number): P[] {
  const a = (c.angle * Math.PI) / 180;
  const dx = Math.cos(a) * c.half;
  const dy = Math.sin(a) * c.half;
  const p0: P = [cx + c.ox - dx, cy + c.oy - dy];
  const p2: P = [cx + c.ox + dx, cy + c.oy + dy];
  if (!c.bend) return [p0, [cx + c.ox, cy + c.oy], p2];
  const b = ((c.angle + c.bend) * Math.PI) / 180;
  return [p0, [cx + c.ox, cy + c.oy], [cx + c.ox + Math.cos(b) * c.half, cy + c.oy + Math.sin(b) * c.half]];
}

function captureCodes(): Promise<{ cols: number; rows: number; codes: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 15000);
    comp!.onFrame = (c) => {
      comp!.onFrame = null;
      clearTimeout(t);
      resolve(c.readCodes()!);
    };
    map.triggerRepaint();
  });
}

async function settled(): Promise<void> {
  const t0 = performance.now();
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (map.loaded() && map.areTilesLoaded()) resolve();
      else if (performance.now() - t0 > 20000) reject(new Error("map did not settle"));
      else setTimeout(check, 30);
    };
    check();
  });
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

/** Draw a batch of cases (one per slot) and evaluate each. */
async function runBatch(cases: LineCase[], zoom: number, expect: (c: LineCase) => number, anyCode = false): Promise<LineResult[]> {
  await ready;
  map.jumpTo({ zoom, center: [106.7, 10.78] });
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const cols = Math.floor(Math.ceil((cw * dpr) / cellOut) / BOX);
  const rows = Math.floor(Math.ceil((ch * dpr) / cellOut) / BOX);
  const feats: GeoJSON.Feature[] = [];
  const geom: P[][] = [];
  cases.slice(0, cols * rows).forEach((c, i) => {
    const sx = i % cols;
    const sy = Math.floor(i / cols);
    const cx = sx * BOX + BOX / 2;
    const cy = sy * BOX + BOX / 2;
    const pts = endpoints(c, cx, cy);
    geom.push(pts);
    const ll = pts.map((p) => {
      const g = map.unproject([p[0] * cellEff, p[1] * cellEff]);
      return [g.lng, g.lat];
    });
    const props = { cls: c.cls };
    feats.push({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: ll } });
    // a hollow road is the casing plus its erasing interior: same geometry, second class
    if (c.cls === "road-major-case") feats.push({ type: "Feature", properties: { cls: "road-major-fill" }, geometry: { type: "LineString", coordinates: ll } });
    if (c.cls === "road-medium-case") feats.push({ type: "Feature", properties: { cls: "road-medium-fill" }, geometry: { type: "LineString", coordinates: ll } });
  });
  (map.getSource("lines") as GeoJSONSource).setData({ type: "FeatureCollection", features: feats });
  await settled();
  const art = await captureCodes();
  const all = anyCode ? makeMask(art.cols, art.rows) : inkMask(art.cols, art.rows, art.codes);
  if (anyCode) for (let i = 0; i < all.data.length; i++) all.data[i] = art.codes[i] !== 0 ? 1 : 0;
  const results: LineResult[] = [];
  cases.slice(0, cols * rows).forEach((c, i) => {
    const sx = i % cols;
    const sy = Math.floor(i / cols);
    const box: Mask = makeMask(BOX, BOX);
    for (let y = 0; y < BOX; y++) for (let x = 0; x < BOX; x++) box.data[y * BOX + x] = all.data[(sy * BOX + y) * art.cols + sx * BOX + x] ?? 0;
    const { n } = components8(box);
    const cells = count(box);
    const pts = geom[i]!;
    let steps = 0;
    for (let k = 0; k < pts.length - 1; k++) steps += bresenhamCount(pts[k]!, pts[k + 1]!) - 1;
    steps += 1;
    // ends covered: some ink within 1 cell of each end (butt cap shortens a line by < 1 cell)
    const near = (p: P) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (box.data[(Math.floor(p[1]) - sy * BOX + dy) * BOX + (Math.floor(p[0]) - sx * BOX + dx)]) return true;
      return false;
    };
    let blk = 0;
    {
      const bm = box;
      const at = (x: number, y: number) => (x < 0 || y < 0 || x >= BOX || y >= BOX ? 0 : bm.data[y * BOX + x]!);
      for (let y = 0; y < BOX; y++) {
        for (let x = 0; x < BOX; x++) {
          if (!at(x, y)) continue;
          if ((at(x + 1, y) && at(x, y + 1) && at(x + 1, y + 1)) || (at(x - 1, y) && at(x, y - 1) && at(x - 1, y - 1)) || (at(x + 1, y) && at(x, y - 1) && at(x + 1, y - 1)) || (at(x - 1, y) && at(x, y + 1) && at(x - 1, y + 1))) blk++;
        }
      }
    }
    results.push({ ...c, comps: n, cells, perStep: cells / Math.max(1, steps), blocks: cells ? blk / cells : 0, endsCovered: near(pts[0]!) && near(pts[pts.length - 1]!) });
    void expect;
  });
  return results;
}

export interface Summary {
  cls: string;
  zoom: number;
  lines: number;
  /** fraction of lines whose component count differs from the expected */
  brokenFrac: number;
  /** fraction with a missing end */
  endMissFrac: number;
  /** fraction thicker than `1.25` cells per step */
  doubledFrac: number;
  /** fraction thinner than 0.85 cells per step (partial / dropped) */
  thinFrac: number;
  perStepMean: number;
  perStepMax: number;
  perStepMin: number;
  worst: LineResult[];
}

const ANGLES = Array.from({ length: 24 }, (_, i) => i * 7.5);
// not exactly 0: a horizontal line exactly on a cell boundary is a measure-zero tie that renders two rows (never zero)
const OFFSETS = [0.02, 0.27, 0.52, 0.77];

/** All angles x offsets for one class at one zoom; expected components given by `expected(cls, zoom)`. */
async function sweep(cls: string, zoom: number, opts: { bend?: number; half?: number; offsets?: number[]; angles?: number[]; expected?: number }): Promise<Summary> {
  await ready;
  const cases: LineCase[] = [];
  for (const angle of opts.angles ?? ANGLES) for (const ox of opts.offsets ?? OFFSETS) for (const oy of opts.offsets ?? OFFSETS) cases.push({ cls, angle, ox, oy, half: opts.half ?? 11, bend: opts.bend });
  const results: LineResult[] = [];
  // slots per frame
  const cols = Math.floor(Math.ceil((container.clientWidth * dpr) / cellOut) / BOX);
  const rows = Math.floor(Math.ceil((container.clientHeight * dpr) / cellOut) / BOX);
  const per = cols * rows;
  for (let i = 0; i < cases.length; i += per) results.push(...(await runBatch(cases.slice(i, i + per), zoom, () => opts.expected ?? 1)));
  const expected = opts.expected ?? 1;
  const per_ = results.map((r) => r.perStep);
  const broken = results.filter((r) => r.comps !== expected);
  const worst = [...results].sort((a, b) => Math.abs(b.comps - expected) - Math.abs(a.comps - expected) || b.perStep - a.perStep).slice(0, 4);
  return {
    cls,
    zoom,
    lines: results.length,
    brokenFrac: broken.length / results.length,
    endMissFrac: results.filter((r) => !r.endsCovered).length / results.length,
    doubledFrac: results.filter((r) => r.perStep > 1.25).length / results.length,
    thinFrac: results.filter((r) => r.perStep < 0.85).length / results.length,
    perStepMean: per_.reduce((a, b) => a + b, 0) / per_.length,
    perStepMax: Math.max(...per_),
    perStepMin: Math.min(...per_),
    worst,
  };
}

/** Dotted/dashed lines: density of lit cells per step must be steady across angles (never 0, never 1). */
async function dashSweep(cls: string, zoom: number): Promise<{ cls: string; zoom: number; densityMin: number; densityMax: number; densityMean: number; zeroFrac: number }> {
  await ready;
  const cases: LineCase[] = [];
  for (const angle of ANGLES) for (const ox of OFFSETS) for (const oy of OFFSETS) cases.push({ cls, angle, ox, oy, half: 11 });
  const cols = Math.floor(Math.ceil((container.clientWidth * dpr) / cellOut) / BOX);
  const rows = Math.floor(Math.ceil((container.clientHeight * dpr) / cellOut) / BOX);
  const per = cols * rows;
  const results: LineResult[] = [];
  for (let i = 0; i < cases.length; i += per) results.push(...(await runBatch(cases.slice(i, i + per), zoom, () => 1, true)));
  const d = results.map((r) => r.perStep);
  return { cls, zoom, densityMin: Math.min(...d), densityMax: Math.max(...d), densityMean: d.reduce((a, b) => a + b, 0) / d.length, zeroFrac: d.filter((x) => x < 0.05).length / d.length };
}

/** ASCII dump of one slot (debugging): '#' ink, 'o' tone, 'm' muted. */
async function dump(c: LineCase, zoom: number): Promise<string> {
  await ready;
  const r = await runBatch([c], zoom, () => 1);
  void r;
  const art = await captureCodes();
  const lines: string[] = [];
  for (let y = 0; y < BOX; y++) {
    let row = "";
    for (let x = 0; x < BOX; x++) {
      const k = art.codes[y * art.cols + x]!;
      row += k === 0 ? "." : k === 3 ? "o" : k === 4 ? "m" : "#";
    }
    lines.push(row);
  }
  return lines.join("\n");
}

/** Leave a fan of lines on screen (24 angles x 2 sub-pixel offsets) for a screenshot. */
async function fan(cls: string, zoom: number): Promise<void> {
  await ready;
  const cases: LineCase[] = [];
  for (const angle of ANGLES) for (const o of [0.27, 0.77]) cases.push({ cls, angle, ox: o, oy: 0.52 - o / 2, half: 11 });
  await runBatch(cases, zoom, () => 1);
}

/** Per-angle density (cells per major-axis step) of a dashed class, mean over the sub-pixel offsets. */
async function dashProfile(cls: string, zoom: number): Promise<[number, number, number, number][]> {
  await ready;
  const cases: LineCase[] = [];
  for (const angle of ANGLES) for (const ox of OFFSETS) for (const oy of OFFSETS) cases.push({ cls, angle, ox, oy, half: 11 });
  const cols = Math.floor(Math.ceil((container.clientWidth * dpr) / cellOut) / BOX);
  const rows = Math.floor(Math.ceil((container.clientHeight * dpr) / cellOut) / BOX);
  const results: LineResult[] = [];
  for (let i = 0; i < cases.length; i += cols * rows) results.push(...(await runBatch(cases.slice(i, i + cols * rows), zoom, () => 1, true)));
  return ANGLES.map((a) => {
    const d = results.filter((r) => r.angle === a).map((r) => r.perStep);
    return [a, d.reduce((x, y) => x + y, 0) / d.length, Math.min(...d), Math.max(...d)];
  });
}

(window as unknown as { __synthetic: unknown }).__synthetic = {
  dump,
  fan,
  dashProfile,
  ready: () => ready.then(() => true),
  info: () => ({ cellCss: cellEff, cellOut, dpr, scale: map.getCanvas().width / container.clientWidth, widths: cfg.widths, rule: cfg.rule, thin: cfg.thin }),
  sweep,
  dashSweep,
};
document.body.dataset.ready = "1";
