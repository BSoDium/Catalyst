#!/usr/bin/env node
// Generates the abstract SVG covers and figures of the DEMO fixture (packages/published/fixtures/demo.json) into
// apps/web/public/media/demo/. Pure node, no dependency, fully deterministic (every image has a seed; nothing reads the clock
// or Math.random), so the committed files are exactly what this script writes (a test in src/ checks it).
//
//   node packages/published/scripts/demo/generate-media.mjs          write the files (and remove stale ones)
//   node packages/published/scripts/demo/generate-media.mjs --check  exit 1 when a committed file differs
//
// Style, after docs/design-system.md: a flat plate (near-black or near-white), marks drawn on a pixel grid (cells of 10 px, stair-
// stepped lines, 4x4 Bayer-dithered fields), ink in three tones (faint, mid, full) and the one cyan signal used for a mark or two.
// Demo only: the real content never uses SVG, and the images carry no text.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Each image stays under this many bytes (the contract of the demo media, tested). */
export const MAX_SVG_BYTES = 12 * 1024;
export const MEDIA_DIR = fileURLToPath(new URL("../../../../apps/web/public/media/demo/", import.meta.url));

// --- Seeded randomness -----------------------------------------------------------------------------------------------------------

const fnv = (s) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
};
const mulberry = (seed) => {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const smooth = (f) => f * f * (3 - 2 * f);
/** 1D value noise on [0, 1]: `knots` random knots, smoothly interpolated. */
const noise1 = (r, knots) => {
  const k = Array.from({ length: knots + 3 }, () => r());
  return (t) => {
    const x = Math.min(Math.max(t, 0), 0.9999) * knots;
    const i = Math.floor(x);
    const s = smooth(x - i);
    return k[i] * (1 - s) + k[i + 1] * s;
  };
};
/** Fractal 1D noise in [0, 1]. */
const fbm1 = (r, base = 3, octaves = 3) => {
  const layers = Array.from({ length: octaves }, (_, o) => noise1(r, base * 2 ** o));
  const total = layers.reduce((n, _, o) => n + 0.5 ** o, 0);
  return (t) => layers.reduce((n, f, o) => n + f(t) * 0.5 ** o, 0) / total;
};
/** 2D value noise (period 64). */
const noise2 = (r) => {
  const g = Array.from({ length: 64 * 64 }, () => r());
  const at = (i, j) => g[(j & 63) * 64 + (i & 63)];
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const sx = smooth(x - i);
    const sy = smooth(y - j);
    return (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy;
  };
};
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const num = (v) => String(+v.toFixed(2));

// --- Plates, tones, dithering -----------------------------------------------------------------------------------------------------

const PLATES = {
  dark: { bg: "#0a0a0a", ink: "#f5f5f5", signal: "#38d4f5" },
  light: { bg: "#f1f1f1", ink: "#0a0a0a", signal: "#00698c" },
};
/** Tone levels used by the raster: 1 faint, 2 mid, 3 full ink, 4 signal. */
const TONES = { faint: [".16", "ink"], mid: [".42", "ink"], ink: ["1", "ink"], signal: ["1", "signal"] };
const LEVEL = { faint: 1, mid: 2, ink: 3, signal: 4 };
const LEVEL_TONE = [null, "faint", "mid", "ink", "signal"];
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const bayer = (x, y) => BAYER[((y % 4) + 4) % 4][((x % 4) + 4) % 4];

class Canvas {
  constructor(W, H, plate) {
    this.W = W;
    this.H = H;
    this.cell = 10;
    this.cols = Math.floor(W / this.cell);
    this.rows = Math.floor(H / this.cell);
    this.pal = PLATES[plate];
    this.grid = new Uint8Array(this.cols * this.rows);
    this.out = [];
    this.pats = new Map();
  }
  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }
  set(x, y, tone) {
    x = Math.round(x);
    y = Math.round(y);
    if (this.inside(x, y)) this.grid[y * this.cols + x] = tone === 0 ? 0 : LEVEL[tone];
  }
  get(x, y) {
    return this.inside(x, y) ? this.grid[y * this.cols + x] : 0;
  }
  hline(x, y, w, tone) {
    for (let i = 0; i < w; i++) this.set(x + i, y, tone);
  }
  vline(x, y, h, tone) {
    for (let i = 0; i < h; i++) this.set(x, y + i, tone);
  }
  fill(x, y, w, h, tone) {
    for (let j = 0; j < h; j++) this.hline(x, y + j, w, tone);
  }
  rect(x, y, w, h, tone) {
    this.hline(x, y, w, tone);
    this.hline(x, y + h - 1, w, tone);
    this.vline(x, y, h, tone);
    this.vline(x + w - 1, y, h, tone);
  }
  clear(x, y, w, h) {
    this.fill(x, y, w, h, 0);
  }
  line(x0, y0, x1, y1, tone) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, tone);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  disc(cx, cy, rad, tone) {
    for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++)
      for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) this.set(x, y, tone);
  }
  ring(cx, cy, rad, tone) {
    for (let y = Math.floor(cy - rad - 1); y <= Math.ceil(cy + rad + 1); y++)
      for (let x = Math.floor(cx - rad - 1); x <= Math.ceil(cx + rad + 1); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= rad + 0.5 && d > rad - 0.7) this.set(x, y, tone);
      }
  }
  /** Bayer-dither `density` (0..1, or a function of the cell returning 0..1) into a rectangle of the raster. */
  dither(x, y, w, h, density, tone) {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const d = typeof density === "function" ? density(x + i, y + j) : density;
        if (d * 16 > bayer(x + i, y + j)) this.set(x + i, y + j, tone);
      }
  }
  /** Corner brackets, a tick scale along the bottom and a micro-label bar: the annotation language, kept faint. */
  hud(r, { label = true, ticks = true } = {}) {
    const { cols, rows } = this;
    const m = 2;
    const L = 4;
    for (const [x, y, sx, sy] of [
      [m, m, 1, 1],
      [cols - 1 - m, m, -1, 1],
      [m, rows - 1 - m, 1, -1],
      [cols - 1 - m, rows - 1 - m, -1, -1],
    ]) {
      for (let i = 0; i < L; i++) {
        this.set(x + sx * i, y, "mid");
        this.set(x, y + sy * i, "mid");
      }
    }
    if (ticks) for (let x = m + 6; x < cols - m - 6; x += 2) this.set(x, rows - 1 - m, (x - m) % 10 === 0 ? "mid" : "faint");
    if (label) {
      const w = int(r, 8, 14);
      this.hline(m + 3, m + 2, w, "mid");
      this.hline(m + 3, m + 4, Math.floor(w / 2), "faint");
    }
  }
  flush() {
    const { cols, rows } = this;
    for (let level = 1; level <= 4; level++) {
      const open = new Map(); // "x,w" -> first row of the rectangle still growing downward
      const rects = [];
      for (let y = 0; y <= rows; y++) {
        const runs = new Set();
        if (y < rows) {
          for (let x = 0; x < cols; ) {
            if (this.grid[y * cols + x] !== level) {
              x++;
              continue;
            }
            let w = 1;
            while (x + w < cols && this.grid[y * cols + x + w] === level) w++;
            runs.add(`${x},${w}`);
            x += w;
          }
        }
        for (const [key, y0] of open) {
          if (runs.has(key)) continue;
          const [x, w] = key.split(",");
          rects.push(`M${x} ${y0}h${w}v${y - y0}h-${w}z`);
          open.delete(key);
        }
        for (const key of runs) if (!open.has(key)) open.set(key, y);
      }
      if (rects.length) {
        const [opacity, which] = TONES[LEVEL_TONE[level]];
        this.out.push(`<path fill="${this.pal[which]}"${opacity === "1" ? "" : ` fill-opacity="${opacity}"`} d="${rects.join("")}"/>`);
      }
    }
    this.grid.fill(0);
  }
  add(markup) {
    this.flush();
    this.out.push(markup);
  }
  /** A rectangle filled with `n` of 16 Bayer cells in `tone`. */
  pat(x, y, w, h, n, tone, extra = "") {
    if (n <= 0 || w <= 0 || h <= 0) return;
    this.add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${this.paint(n, tone)}"${extra}/>`);
  }
  /** The `fill` value of a Bayer pattern of `n` (1..16) of 16 cells in `tone`, defined on first use. */
  paint(n, tone) {
    if (n >= 16) return this.pal[TONES[tone][1]];
    const id = `${tone[0]}${n}`;
    if (!this.pats.has(id)) {
      const runs = [];
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; ) {
          if (BAYER[y][x] >= n) {
            x++;
            continue;
          }
          let w = 1;
          while (x + w < 4 && BAYER[y][x + w] < n) w++;
          runs.push(`M${x} ${y}h${w}v1h-${w}z`);
          x += w;
        }
      }
      const [opacity, which] = TONES[tone];
      this.pats.set(id, `<pattern id="${id}" width="4" height="4" patternUnits="userSpaceOnUse"><path fill="${this.pal[which]}"${opacity === "1" ? "" : ` fill-opacity="${opacity}"`} d="${runs.join("")}"/></pattern>`);
    }
    return `url(#${id})`;
  }
  /** A shape filled with the plate colour: hides what was drawn behind it. */
  bgPath(d) {
    this.add(`<path fill="${this.pal.bg}" d="${d}"/>`);
  }
  svg() {
    this.flush();
    const defs = this.pats.size ? `<defs>${[...this.pats.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v).join("")}</defs>` : "";
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.W} ${this.H}" width="${this.W}" height="${this.H}">` +
      `<rect width="${this.W}" height="${this.H}" fill="${this.pal.bg}"/>${defs}` +
      `<g transform="scale(${this.cell})" shape-rendering="crispEdges">${this.out.join("")}</g></svg>\n`
    );
  }
}

// --- Motifs: each draws on a Canvas (cell units) ----------------------------------------------------------------------------------

/** Dithered bands that thicken toward `y1` (a haze over a horizon). */
function haze(c, y0, y1, levels, tone = "mid") {
  const h = y1 - y0;
  levels.forEach((n, i) => c.pat(0, y0 + Math.floor((h * i) / levels.length), c.cols, Math.floor((h * (i + 1)) / levels.length) - Math.floor((h * i) / levels.length), n, tone));
}

/** A stair-step path along `ys` (one value per `step` cells), as `M..h..v..` commands from x0. */
function stair(ys, step, x0 = 0) {
  let d = `M${x0} ${ys[0]}`;
  for (let i = 1; i < ys.length; i++) {
    d += `h${step}`;
    const dy = ys[i] - ys[i - 1];
    if (dy) d += `v${dy}`;
  }
  return d + `h${step}`;
}

function rails(c, r, { tracks = 2 } = {}) {
  const { cols, rows } = c;
  const hy = Math.round(rows * (0.5 + r() * 0.06));
  const vx = Math.round(cols * (0.36 + r() * 0.2));
  haze(c, 0, hy, [0, 0, 1, 1, 2, 3, 5, 8]);
  for (let i = 0; i < 16; i++) c.set(int(r, 4, cols - 5), int(r, 4, Math.floor(hy * 0.6)), "mid");
  c.hline(0, hy, cols, "mid");
  // the ground gives back a faint reflection of the haze
  c.pat(0, hy + 1, cols, 3, 4, "faint");
  c.pat(0, hy + 4, cols, 4, 2, "faint");
  const spread = Math.round(cols * 0.2);
  for (let tr = 0; tr < tracks; tr++) {
    const off = tr === 0 ? 0 : Math.round(cols * (0.4 + r() * 0.08));
    for (const side of [-1, 1]) c.line(vx, hy, vx + off + side * spread, rows - 1, "ink");
    const N = 15;
    for (let k = 1; k <= N; k++) {
      const t = (k / N) ** 2.3;
      const y = hy + Math.round(t * (rows - 1 - hy));
      const hw = Math.round(spread * t) + 2;
      const cx = vx + Math.round(off * t);
      c.hline(cx - hw, y, hw * 2 + 1, tr === 0 ? "mid" : "faint");
    }
  }
  // masts with a cross-arm on the right, shrinking toward the vanishing point
  for (let k = 1; k <= 7; k++) {
    const t = (k / 7) ** 2.1;
    const x = vx + Math.round((spread + 9) * t) + Math.round(cols * 0.28 * t);
    const base = hy + Math.round(t * (rows - 1 - hy) * 0.5);
    const top = base - Math.round(5 + 24 * t);
    if (x < cols - 1) {
      c.vline(x, top, base - top, t > 0.5 ? "ink" : "mid");
      c.hline(x - Math.round(2 + 3 * t), top, Math.round(4 + 6 * t), "mid");
    }
  }
  // the lamp at the end of the line: the one signal mark
  c.vline(vx + 3, hy - 7, 7, "mid");
  c.fill(vx + 2, hy - 9, 3, 2, "signal");
  for (let i = 0; i < 7; i++) c.set(int(r, 2, cols - 3), hy - 1, "ink");
  c.hud(r);
}

function contours(c, r, { layers = 6, sun = true } = {}) {
  const { cols, rows } = c;
  const top = Math.round(rows * 0.18);
  haze(c, top, Math.round(rows * 0.62), [0, 1, 1, 2, 3, 4]);
  if (sun) c.disc(Math.round(cols * (0.62 + r() * 0.2)), Math.round(rows * 0.2), 3, "signal");
  const step = 2;
  for (let i = 0; i < layers; i++) {
    const f = fbm1(r, 2 + i, 3);
    const base = rows * (0.4 + (i / layers) * 0.5);
    const amp = rows * (0.07 + 0.012 * i);
    const ys = Array.from({ length: Math.ceil(cols / step) }, (_, k) => Math.round(base - amp * f(k / (cols / step)) * 1.6));
    const d = stair(ys, step);
    c.bgPath(`${d}V${rows}H0z`);
    c.add(`<path fill="${c.paint(i === layers - 1 ? 5 : [1, 2, 3, 4, 6, 8][i] ?? 8, i === layers - 1 ? "ink" : "mid")}" d="${d}V${rows}H0z"/>`);
    c.add(`<path fill="none" stroke="${c.pal.ink}" stroke-opacity="${i < 2 ? ".3" : i < 4 ? ".6" : "1"}" stroke-width="1" transform="translate(0 .5)" d="${d}"/>`);
  }
  c.hud(r);
}

function coast(c, r, { dir = 1 } = {}) {
  const { cols, rows } = c;
  const hy = Math.round(rows * 0.4);
  haze(c, 0, hy, [0, 0, 1, 2, 3, 5]);
  // the sea: wave lines, tighter toward the horizon
  for (let j = 0; j < 17; j++) {
    const t = j / 16;
    const y = hy + 1 + Math.round(t ** 1.7 * (rows - hy - 3));
    const wl = 4 + Math.round(t * 8);
    let d = `M0 ${y + 0.5}`;
    for (let x = 0; x < cols + wl; x += wl) d += `q${num(wl / 4)} ${num(-0.9 - t)} ${num(wl / 2)} 0t${num(wl / 2)} 0`;
    c.add(`<path fill="none" stroke="${c.pal.ink}" stroke-opacity="${num(0.18 + 0.4 * t)}" stroke-width=".55" shape-rendering="geometricPrecision" d="${d}"/>`);
  }
  // the cliff, and the road along it
  const f = fbm1(r, 4, 3);
  const step = 2;
  const ys = Array.from({ length: Math.ceil(cols / step) }, (_, k) => {
    const t = k / (cols / step);
    const edge = dir > 0 ? t : 1 - t;
    return Math.round(rows * (0.5 + 0.5 * edge ** 1.4) + (f(t) - 0.5) * 6 - 2);
  });
  const d = stair(ys, step);
  const closed = `${d}V${rows}H0z`;
  c.bgPath(closed);
  c.add(`<path fill="${c.paint(5, "mid")}" d="${closed}"/>`);
  c.add(`<path fill="none" stroke="${c.pal.ink}" stroke-width="1" transform="translate(0 .5)" d="${d}"/>`);
  // the road runs along the cliff, a few cells inland, dashed
  const roadAt = (x) => {
    const k = Math.min(ys.length - 1, Math.floor(x / step));
    return ys[k] + 5;
  };
  for (let x = 0; x < cols; x++) if (Math.floor(x / 4) % 2 === 0) c.set(x, roadAt(x), "ink");
  // the bus: a small signal box on the road
  const bx = Math.round(cols * (dir > 0 ? 0.36 : 0.62));
  const by = roadAt(bx);
  c.clear(bx - 3, by - 3, 7, 4);
  c.fill(bx - 3, by - 3, 6, 3, "signal");
  c.set(bx - 2, by, "ink");
  c.set(bx + 1, by, "ink");
  c.hud(r);
}

function labels(c, r, { resolved = false, count = 22 } = {}) {
  const { cols, rows } = c;
  for (let y = 6; y < rows - 4; y += 8) for (let x = 6; x < cols - 4; x += 8) c.set(x, y, "faint");
  const boxes = [];
  const overlap = (a, b) => a.x < b.x + b.w + 1 && b.x < a.x + a.w + 1 && a.y < b.y + b.h + 1 && b.y < a.y + a.h + 1;
  const collisions = [];
  for (let i = 0; i < count; i++) {
    const ax = int(r, 10, cols - 24);
    const ay = int(r, 10, rows - 12);
    const w = int(r, 7, 17);
    let box = { ax, ay, w, h: 3, x: ax + 2, y: ay - 4 };
    // after the first third, labels are pulled toward an earlier one on purpose (the collisions the engine has to resolve)
    if (i > count * 0.55 && boxes.length && r() < 0.55) {
      const other = boxes[int(r, 0, boxes.length - 1)];
      box = { ax: other.x + int(r, 1, 3), ay: other.y + other.h + int(r, 2, 4), w, h: 3, x: other.x + int(r, -2, 4), y: other.y + int(r, -1, 2) };
    }
    if (resolved) {
      for (let tries = 0; tries < 60 && boxes.some((b) => overlap(b, box)); tries++) {
        box.y += tries % 2 ? 4 : -4;
        if (tries % 7 === 6) box.x += 5;
      }
    }
    box.x = Math.max(4, Math.min(cols - box.w - 4, box.x));
    box.y = Math.max(4, Math.min(rows - 8, box.y));
    for (const b of boxes) if (!resolved && overlap(b, box)) collisions.push([b, box]);
    boxes.push(box);
  }
  const hot = new Set(collisions.slice(0, 3).flat());
  for (const b of boxes) {
    c.line(b.ax, b.ay, b.x, b.y + b.h - 1, "faint");
  }
  boxes.forEach((b, i) => {
    c.clear(b.x, b.y, b.w, b.h);
    c.rect(b.x, b.y, b.w, b.h, hot.has(b) ? "signal" : "mid");
    c.hline(b.x + 2, b.y + 1, b.w - 4 - (i % 3), "ink");
  });
  boxes.forEach((b) => c.set(b.ax, b.ay, "ink"));
  if (resolved) {
    const b = boxes[Math.floor(boxes.length / 2)];
    c.rect(b.x - 1, b.y - 1, b.w + 2, b.h + 2, "signal");
  }
  c.hud(r);
}

function globe(c, r, { rad = 22, yaw = 0.6, tilt = 0.4 } = {}) {
  const { cols, rows } = c;
  const light = c.pal.bg !== "#0a0a0a";
  const cx = Math.round(cols * 0.5);
  const cy = Math.round(rows * 0.5);
  const land = noise2(r);
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  for (let i = 0; i < 26; i++) c.set(int(r, 3, cols - 4), int(r, 3, rows - 4), r() < 0.3 ? "mid" : "faint");
  const pins = [];
  for (let y = cy - rad - 1; y <= cy + rad + 1; y++) {
    for (let x = cx - rad - 1; x <= cx + rad + 1; x++) {
      const dx = (x - cx) / rad;
      const dy = (y - cy) / rad;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const dz = Math.sqrt(1 - d2);
      // view normal -> world (undo the tilt about x, then the yaw about y)
      const y1 = dy * cosT + dz * sinT;
      const z1 = -dy * sinT + dz * cosT;
      const wx = dx * cosY + z1 * sinY;
      const wz = -dx * sinY + z1 * cosY;
      const wy = -y1;
      const lon = (Math.atan2(wx, wz) * 180) / Math.PI;
      const lat = (Math.asin(Math.max(-1, Math.min(1, wy))) * 180) / Math.PI;
      const n = land(wx * 2.6 + wz * 1.3 + 8, wy * 2.6 - wz * 1.2 + 3) * 0.7 + land(wx * 5.4 + 1, wy * 5.4 + wz * 2.2) * 0.3;
      const isLand = n > 0.5;
      const lit = Math.max(0, -0.45 * dx - 0.55 * dy + 0.7 * dz);
      // ink coverage: on a dark plate ink is light, so the lit side carries it; on paper the shadow side does
      const shade = light ? 1 - lit * 0.85 : 0.2 + 0.8 * lit;
      const rim = d2 > 0.9;
      let tone = null;
      if (rim) tone = "mid";
      else if (isLand) {
        if ((0.18 + 0.82 * shade) * 0.9 > bayer(x, y) / 16) tone = "ink";
      } else if (shade * 0.2 > bayer(x, y) / 16) tone = "mid";
      const w = 1.3 / Math.max(dz, 0.4);
      const gl = Math.abs(((lon + 15) % 30) - 15) < w || Math.abs(((lat + 15) % 30) - 15) < w;
      if (!tone && gl && !rim) tone = "faint";
      if (tone) c.set(x, y, tone);
      if (isLand && dz > 0.55 && lit > 0.4 && (x * 7 + y * 13) % 41 === 0 && pins.length < 3) pins.push([x, y]);
    }
  }
  // an orbit ring and the one signal pin with its ring
  for (let a = 0; a < 360; a += 2) {
    const t = (a * Math.PI) / 180;
    const px = cx + Math.cos(t) * (rad + 10);
    const py = cy + Math.sin(t) * (rad + 10) * 0.26;
    const behind = Math.sin(t) < 0 && Math.abs(px - cx) < rad;
    if (!behind) c.set(px, py, "faint");
  }
  const pin = pins[0] ?? [cx + 4, cy - 3];
  c.ring(pin[0], pin[1], 4, "signal");
  c.set(pin[0], pin[1], "signal");
  for (const p of pins.slice(1)) c.set(p[0], p[1], "ink");
  c.hud(r);
}

function strata(c, r, { lines = 26, signalLine = 17, amp = 1 } = {}) {
  const { cols, rows } = c;
  const top = 8;
  const gap = (rows - top - 9) / lines;
  const step = 4;
  for (let j = 0; j < lines; j++) {
    const y = top + j * gap + gap * 1.6;
    const f = fbm1(r, 5, 3);
    const hump = noise1(r, 3);
    let d = `M-2 ${num(y)}`;
    let prev = y;
    for (let x = 0; x <= cols + step; x += step) {
      const t = x / cols;
      const env = (0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** 1.5) * (0.55 + hump(t));
      const yy = y - amp * (f(t) - 0.35) * 22 * env;
      d += `l${step} ${num(yy - prev)}`;
      prev = yy;
    }
    d += `V${rows + 4}H-2z`;
    const sig = j === signalLine;
    c.add(`<path fill="${c.pal.bg}" stroke="${sig ? c.pal.signal : c.pal.ink}" stroke-opacity="${sig ? 1 : num(0.35 + 0.5 * (j / lines))}" stroke-width="${sig ? ".6" : ".4"}" stroke-linejoin="round" shape-rendering="geometricPrecision" d="${d}"/>`);
  }
  c.hud(r);
}

function riso(c, r, { rotate = 14 } = {}) {
  const { cols, rows, pal } = c;
  c.flush();
  const dots = [0.22, 0.34, 0.47, 0.62]
    .map((rr, i) => `<pattern id="k${i}" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(${rotate})"><circle cx=".8" cy=".8" r="${rr}" fill="${pal.ink}"/></pattern>`)
    .join("");
  const dotsB = [0.22, 0.34, 0.47, 0.62]
    .map((rr, i) => `<pattern id="s${i}" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(${rotate + 31})"><circle cx=".8" cy=".8" r="${rr}" fill="${pal.signal}"/></pattern>`)
    .join("");
  c.pats.set("riso", dots + dotsB);
  const A = [Math.round(cols * (0.4 + r() * 0.04)), Math.round(rows * 0.5), Math.round(rows * 0.4)];
  const B = [A[0] + Math.round(rows * 0.3), A[1] - Math.round(rows * 0.06), Math.round(rows * 0.3)];
  const group = (cx, cy, rad, prefix, blend) =>
    `<g style="mix-blend-mode:${blend}">` + [1, 0.78, 0.55, 0.32].map((k, i) => `<circle cx="${cx}" cy="${cy}" r="${num(rad * k)}" fill="url(#${prefix}${i})"/>`).join("") + "</g>";
  c.add(group(A[0], A[1], A[2], "k", "normal"));
  c.add(group(B[0], B[1], B[2], "s", pal.bg === "#0a0a0a" ? "screen" : "multiply"));
  // registration marks and a crop frame, as on a printed proof
  for (const [x, y] of [[4, 4], [cols - 5, 4], [4, rows - 5], [cols - 5, rows - 5]]) {
    c.hline(x - 1, y, 3, "mid");
    c.vline(x, y - 1, 3, "mid");
  }
  c.rect(8, 8, cols - 16, rows - 16, "faint");
  for (let i = 0; i < 5; i++) c.fill(cols - 22 + i * 3, rows - 7, 2, 1, i < 3 ? "ink" : "faint");
}

function platform(c, r, { lamps = 8 } = {}) {
  const { cols, rows } = c;
  const hy = Math.round(rows * 0.5);
  const vx = Math.round(cols * (0.38 + r() * 0.14));
  haze(c, 0, hy - 8, [0, 0, 0, 1, 1, 2]);
  c.hline(0, hy, cols, "mid");
  // the floor glows under the lamps and fades toward the viewer
  haze(c, hy + 1, rows, [10, 8, 6, 5, 4, 3, 2, 1].map((n) => Math.max(0, n - 3)), "faint");
  c.line(vx, hy, cols - 1, rows - 1, "ink");
  c.line(vx, hy, cols - 1, Math.round(rows * 0.74), "mid");
  const sig = Math.floor(lamps / 2);
  for (let k = 1; k <= lamps; k++) {
    const t = (k / lamps) ** 2;
    for (const side of [-1, 1]) {
      const x = vx + side * Math.round(4 + (cols * 0.34 + 4) * t);
      if (x < 1 || x > cols - 2) continue;
      const base = hy + Math.round(14 * t);
      const topY = base - Math.round(8 + 28 * t);
      const post = t > 0.3 ? "ink" : "mid";
      c.vline(x, topY, base - topY, post);
      if (t > 0.5) c.vline(x + 1, topY, base - topY, post);
      c.hline(x - 1, topY, 3, "ink");
      const lit = side === 1 && k === sig ? "signal" : "ink";
      c.fill(x - 1, topY + 1, 3, 1 + (t > 0.4 ? 1 : 0), lit);
      // reflection streak on the floor
      for (let i = 1; i <= Math.round(3 + 14 * t); i += 2) c.set(x, base + i, "faint");
    }
  }
  c.hud(r);
}

function monsoon(c, r, { drops = 120, roofs = true } = {}) {
  const { cols, rows } = c;
  const hy = Math.round(rows * 0.72);
  haze(c, 0, Math.round(rows * 0.5), [8, 7, 5, 4, 3, 2, 1, 1]);
  if (roofs) {
    let x = 0;
    while (x < cols) {
      const w = int(r, 6, 14);
      const h = int(r, 3, 9);
      c.fill(x, hy - h, w - 1, h, "faint");
      c.hline(x, hy - h, w - 1, "ink");
      c.vline(x, hy - h, h, "mid");
      c.vline(x + w - 2, hy - h, h, "mid");
      if (r() < 0.55) {
        // a pitched roof
        const half = Math.floor((w - 1) / 2);
        c.line(x, hy - h, x + half, hy - h - half, "ink");
        c.line(x + w - 2, hy - h, x + w - 2 - half, hy - h - half, "ink");
      }
      x += w;
    }
    c.hline(0, hy, cols, "ink");
  }
  c.pat(0, hy + 1, cols, rows - hy - 1, 3, "faint");
  // ripples on the wet street
  for (let i = 0; i < 4; i++) {
    const x = int(r, 8, cols - 14);
    const y = int(r, hy + 4, rows - 6);
    c.hline(x, y, 6 + i, "mid");
    c.hline(x - 2, y + 1, 10 + i, "faint");
  }
  // rain
  let d = "";
  let sig = "";
  for (let i = 0; i < drops; i++) {
    const x = r() * (cols + 20) - 10;
    const y = r() * hy * 0.95;
    const len = 2 + r() * 4;
    const seg = `M${num(x)} ${num(y)}l${num(-len * 0.28)} ${num(len)}`;
    if (i === 7) sig = seg;
    else d += seg;
  }
  c.add(`<path fill="none" stroke="${c.pal.ink}" stroke-opacity=".5" stroke-width=".3" shape-rendering="geometricPrecision" d="${d}"/>`);
  c.add(`<path fill="none" stroke="${c.pal.signal}" stroke-width=".4" shape-rendering="geometricPrecision" d="${sig}M${num(cols * 0.8)} ${num(hy * 0.5)}l-1.4 5"/>`);
  c.hud(r);
}

function timetable(c, r, { rowsN = 14 } = {}) {
  const { cols, rows } = c;
  const top = 8;
  const gap = Math.floor((rows - top - 6) / rowsN);
  const changed = new Set([3, 6, 7, 11].map((k) => k % rowsN));
  for (let i = 0; i < rowsN; i++) {
    const y = top + i * gap;
    c.hline(6, y + gap - 1, cols - 12, "faint");
    // departure time: four small cells
    for (let k = 0; k < 4; k++) c.fill(8 + k * 3 + (k > 1 ? 2 : 0), y + 1, 2, gap - 3, i % 3 === 0 ? "ink" : "mid");
    // destination bar and platform number
    c.fill(28, y + 1, int(r, 10, 34), gap - 3, "ink");
    c.fill(66, y + 2, int(r, 6, 14), 1, "mid");
    c.fill(cols - 22, y + 1, 3, gap - 3, "mid");
    if (changed.has(i)) {
      c.rect(5, y - 0, cols - 10, gap, "signal");
      c.fill(cols - 14, y + 1, 7, gap - 3, "signal");
    }
  }
  c.vline(26, top - 2, rows - top - 3, "faint");
  c.vline(cols - 25, top - 2, rows - top - 3, "faint");
  c.hud(r, { label: false, ticks: false });
}

function verse(c, r, { stanzas = 4, drift = 0 } = {}) {
  const { cols, rows } = c;
  const x0 = Math.round(cols * (0.22 + drift));
  let y = Math.round(rows * 0.2);
  const bandRows = Math.round(rows * 0.12);
  c.pat(0, rows - bandRows, cols, bandRows, 0, "mid");
  const sigStanza = Math.min(1, stanzas - 1);
  for (let s = 0; s < stanzas; s++) {
    const n = int(r, 3, 5);
    for (let l = 0; l < n; l++) {
      const w = int(r, 12, 44);
      const indent = r() < 0.3 ? int(r, 3, 6) : 0;
      c.hline(x0 + indent, y, w, s === sigStanza && l === 1 ? "signal" : l === n - 1 ? "mid" : "ink");
      y += 2;
    }
    y += 2;
    if (y > rows - 8) break;
  }
  // dithered margin at the right, as an ink shadow
  c.dither(cols - 18, 6, 12, rows - 12, (x, yy) => Math.max(0, 0.55 - (x - (cols - 18)) * 0.05 - Math.abs(yy - rows / 2) * 0.004), "mid");
  c.hud(r);
}

function frameui(c, r) {
  const { cols, rows } = c;
  const split = Math.round(cols * 0.62);
  // left: a plate with dithered stripes and a crosshair
  c.rect(5, 5, split - 7, rows - 10, "mid");
  haze(c, 7, rows - 7, [1, 2, 3, 5, 3, 2, 1]);
  const mx = Math.round(split / 2);
  const my = Math.round(rows / 2);
  c.hline(mx - 6, my, 13, "ink");
  c.vline(mx, my - 6, 13, "ink");
  c.set(mx, my, "signal");
  c.ring(mx, my, 9, "mid");
  // right: dotted-leader data rows
  const gap = 4;
  for (let i = 0; i < Math.floor((rows - 14) / gap); i++) {
    const y = 8 + i * gap;
    c.hline(split + 3, y, int(r, 5, 10), "mid");
    for (let x = split + 15; x < cols - 17; x += 2) c.set(x, y + 1, "faint");
    c.hline(cols - 16, y, int(r, 4, 9), i === 3 ? "signal" : "ink");
  }
  c.hud(r, { label: false });
}

function nested(c, r, { rects = 16 } = {}) {
  const { cols, rows } = c;
  const f = noise1(r, 4);
  for (let i = 0; i < rects; i++) {
    const t = i / rects;
    const ox = Math.round((f(t) - 0.5) * 14);
    const oy = Math.round((noise1(r, 3)(t) - 0.5) * 8);
    const m = 4 + i * 2;
    if (cols - 2 * m < 4 || rows - 2 * m < 4) break;
    c.rect(m + ox, m + oy, cols - 2 * m, rows - 2 * m, i === 9 ? "signal" : i % 3 === 0 ? "ink" : i % 3 === 1 ? "mid" : "faint");
  }
  c.hud(r, { label: false });
}

const MOTIFS = { rails, contours, coast, labels, globe, strata, riso, platform, monsoon, timetable, verse, frameui, nested };

// --- The images of the demo fixture ----------------------------------------------------------------------------------------------

const COVER = [1200, 630];
const FIGURE = [960, 600];

/**
 * Every image: file name, size, motif and options, plate and seed, with the alternative text the fixture uses. A cover is 1200x630,
 * a figure 960x600. Edit here and run the script; the fixture (`demo.json`) refers to these names and sizes.
 */
export const MEDIA = [
  // covers
  { name: "cover-night-trains", size: COVER, motif: "rails", plate: "dark", opts: {}, alt: "Two railway tracks running to a single lamp on a hazy horizon, drawn in pixels and dithered grey on black, with one cyan signal light" },
  { name: "cover-morocco-coast", size: COVER, motif: "coast", plate: "light", opts: { dir: 1 }, alt: "A dashed road on a cliff above the sea, wave lines receding to a dithered sky, a small cyan bus on the road" },
  { name: "cover-altiplano", size: COVER, motif: "contours", plate: "dark", opts: {}, alt: "Six layers of stair-stepped mountain ridges fading into dithered haze under a small cyan sun" },
  { name: "cover-pixel-globe", size: COVER, motif: "globe", plate: "dark", opts: { rad: 25, yaw: 0.9, tilt: 0.45 }, alt: "A pixel-art globe lit from the upper left, dithered continents, a faint orbit ring and one cyan location marker" },
  { name: "cover-collide", size: COVER, motif: "labels", plate: "light", opts: { count: 24 }, alt: "Rectangular map labels with leader lines to anchor points, a few overlapping pairs outlined in cyan" },
  { name: "cover-signal-study", size: COVER, motif: "riso", plate: "light", opts: { rotate: 14 }, alt: "Two overlapping halftone discs, one black and one cyan, with registration marks and a crop frame like a printed proof" },
  { name: "cover-sediment", size: COVER, motif: "strata", plate: "dark", opts: { lines: 26, signalLine: 17 }, alt: "Stacked wavy contour lines, each hiding the one behind, with a single cyan line in the lower half" },
  { name: "cover-monsoon-index", size: COVER, motif: "monsoon", plate: "dark", opts: { drops: 120 }, alt: "Rooftops under a dithered storm sky, thin diagonal rain streaks and ripples on a wet street" },
  { name: "cover-layover", size: COVER, motif: "verse", plate: "dark", opts: { stanzas: 5, drift: 0.04 }, alt: "Short white lines grouped in stanzas, one of them cyan, beside a dithered shadow at the right edge" },
  { name: "cover-voie-b", size: COVER, motif: "verse", plate: "light", opts: { stanzas: 4, drift: 0.1 }, alt: "Short black lines grouped in four stanzas on pale paper, one line in cyan" },
  // figures
  { name: "fig-night-trains-board", size: FIGURE, motif: "timetable", plate: "light", opts: { rowsN: 13 }, alt: "A departures board reduced to bars and cells, several rows outlined in cyan where a time changed" },
  { name: "fig-night-trains-platform", size: FIGURE, motif: "platform", plate: "dark", opts: { lamps: 8 }, alt: "An empty platform in perspective, posts with lamps on both sides, one lamp in cyan, faint reflections on the floor" },
  { name: "fig-coast-road", size: FIGURE, motif: "coast", plate: "dark", opts: { dir: -1 }, alt: "The coast road mirrored: a dashed road on a cliff on the right, dark sea lines on the left and a cyan bus" },
  { name: "fig-coast-swell", size: FIGURE, motif: "strata", plate: "light", opts: { lines: 20, signalLine: 12, amp: 0.8 }, alt: "Stacked swell lines on pale paper, one line in cyan" },
  { name: "fig-altiplano-ridges", size: FIGURE, motif: "contours", plate: "light", opts: { layers: 5, sun: false }, alt: "Five dithered ridge lines on pale paper, the nearest the darkest" },
  { name: "fig-altiplano-night", size: FIGURE, motif: "strata", plate: "dark", opts: { lines: 24, signalLine: 20, amp: 1.2 }, alt: "Close, layered lines of a plateau at night, a cyan line near the bottom" },
  { name: "fig-vietnam-line", size: FIGURE, motif: "rails", plate: "light", opts: { tracks: 1 }, alt: "A single track running to a lamp at the horizon, ink on pale paper, a cyan signal light" },
  { name: "fig-globe-hud", size: FIGURE, motif: "frameui", plate: "dark", opts: {}, alt: "An interface plate: a dithered panel with a crosshair on the left, rows of dotted-leader data on the right" },
  { name: "fig-globe-wire", size: FIGURE, motif: "globe", plate: "light", opts: { rad: 24, yaw: 2.4, tilt: 0.3 }, alt: "The pixel globe rotated, dark dithered continents on pale paper with a cyan marker" },
  { name: "fig-labels-before", size: FIGURE, motif: "labels", plate: "dark", opts: { count: 20 }, alt: "Map labels before collision resolution: overlapping boxes outlined in cyan among well-spaced ones" },
  { name: "fig-labels-after", size: FIGURE, motif: "labels", plate: "dark", opts: { count: 20, resolved: true }, alt: "The same labels after resolution: no overlap, the moved label framed in cyan" },
  { name: "fig-ledger-plot", size: FIGURE, motif: "strata", plate: "light", opts: { lines: 30, signalLine: 9, amp: 0.7 }, alt: "A pen-plotter drawing of thirty fine lines with a gentle swell, one line in cyan" },
  { name: "fig-signal-study-detail", size: FIGURE, motif: "riso", plate: "light", opts: { rotate: 38 }, alt: "Detail of the print: black and cyan halftone dots overlapping at a different angle" },
  { name: "fig-sediment-1", size: FIGURE, motif: "strata", plate: "dark", opts: { lines: 18, signalLine: 4, amp: 1 }, alt: "Plate 1 of the series: eighteen layered lines, a cyan line near the top" },
  { name: "fig-sediment-4", size: FIGURE, motif: "strata", plate: "light", opts: { lines: 22, signalLine: 8, amp: 1.1 }, alt: "Plate 4 of the series: twenty-two layered lines on pale paper" },
  { name: "fig-sediment-8", size: FIGURE, motif: "strata", plate: "dark", opts: { lines: 28, signalLine: 21, amp: 1.4 }, alt: "Plate 8 of the series: tall swells in twenty-eight lines" },
  { name: "fig-sediment-12", size: FIGURE, motif: "strata", plate: "light", opts: { lines: 14, signalLine: 11, amp: 1.6 }, alt: "Plate 12 of the series: fourteen lines with large swells, one cyan" },
  { name: "fig-night-platform-1", size: FIGURE, motif: "platform", plate: "dark", opts: { lamps: 6 }, alt: "A night platform in perspective, six pairs of lamp posts, one cyan lamp" },
  { name: "fig-night-platform-2", size: FIGURE, motif: "platform", plate: "light", opts: { lamps: 10 }, alt: "The same platform reversed to pale paper, ten pairs of posts, one cyan lamp" },
  { name: "fig-monsoon-1", size: FIGURE, motif: "monsoon", plate: "dark", opts: { drops: 90 }, alt: "Study 1: rooftops and rain under a dithered sky" },
  { name: "fig-monsoon-2", size: FIGURE, motif: "monsoon", plate: "light", opts: { drops: 110 }, alt: "Study 2: dark rooftops and rain on pale paper" },
];

export function renderImage(image) {
  const [w, h] = image.size;
  const c = new Canvas(w, h, image.plate);
  MOTIFS[image.motif](c, mulberry(fnv(`catalyst-demo/${image.name}`)), image.opts);
  return c.svg();
}

/** Path of the published URL (`/media/demo/<name>.svg`) of an image. */
export const mediaSrc = (name) => `/media/demo/${name}.svg`;
export const mediaByName = (name) => {
  const m = MEDIA.find((x) => x.name === name);
  if (!m) throw new Error(`unknown demo image "${name}"`);
  return m;
};

// --- CLI -------------------------------------------------------------------------------------------------------------------------

/** Files that belong in the media folder besides the generated ones (referenced by the fixture's places). */
const KEEP = new Set(["field-notes.svg"]);

function main(check) {
  mkdirSync(MEDIA_DIR, { recursive: true });
  const wanted = new Set(MEDIA.map((m) => `${m.name}.svg`));
  let bad = 0;
  for (const image of MEDIA) {
    const svg = renderImage(image);
    const path = join(MEDIA_DIR, `${image.name}.svg`);
    const bytes = Buffer.byteLength(svg);
    if (bytes > MAX_SVG_BYTES) {
      console.error(`${image.name}.svg is ${bytes} bytes (limit ${MAX_SVG_BYTES})`);
      bad++;
    }
    if (check) {
      if (!existsSync(path) || readFileSync(path, "utf8") !== svg) {
        console.error(`${image.name}.svg is out of date`);
        bad++;
      }
    } else {
      writeFileSync(path, svg);
      console.log(`${image.name}.svg  ${bytes} bytes`);
    }
  }
  for (const f of readdirSync(MEDIA_DIR)) {
    if (f.endsWith(".svg") && !wanted.has(f) && !KEEP.has(f)) {
      if (check) {
        console.error(`${f} is not produced by the generator`);
        bad++;
      } else {
        unlinkSync(join(MEDIA_DIR, f));
        console.log(`removed stale ${f}`);
      }
    }
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.includes("--check"));
