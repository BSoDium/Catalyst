/**
 * The cover art's richer patterns (`lib/cover-art.ts` draws the first five, these are the other sixteen): noise of several kinds (fractal, ridged, warped, cells), contour and strata lines,
 * arcs, rays, a spiral, halftone dots, moire, dunes, and a few plain structures (stripes, blocks, scatter, waves). Each paints the tonal levels (0 .. 3) of a grid from the seeded
 * generator, as the first five do: pure, no Date, no DOM.
 */

export const EXTRA_PATTERNS = ["contours", "stripes", "blocks", "scatter", "waves", "fbm", "ridged", "warp", "voronoi", "truchet", "rays", "spiral", "halftone", "moire", "strata", "dunes"] as const;
export type ExtraPattern = (typeof EXTRA_PATTERNS)[number];

type Rng = () => number;
type Field = (x: number, y: number) => number;

/** What a pattern paints: the grid, the seeded generator, and the ordered dither of a smooth field in [0, 1] into the levels. */
export interface Canvas {
  cols: number;
  rows: number;
  rng: Rng;
  levels: Uint8Array;
  dither: (field: Field) => void;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise: random values on a lattice `cell` cells apart, smoothly interpolated. */
function noise(rng: Rng, cell: number, cols: number, rows: number): Field {
  const gw = Math.ceil(cols / cell) + 2;
  const gh = Math.ceil(rows / cell) + 2;
  const g = Array.from({ length: gw * gh }, () => rng());
  return (x, y) => {
    const fx = x / cell;
    const fy = y / cell;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = smooth(fx - ix);
    const ty = smooth(fy - iy);
    const at = (dx: number, dy: number) => g[Math.min(gh - 1, iy + dy) * gw + Math.min(gw - 1, ix + dx)]!;
    return (at(0, 0) * (1 - tx) + at(1, 0) * tx) * (1 - ty) + (at(0, 1) * (1 - tx) + at(1, 1) * tx) * ty;
  };
}

/** Fractal noise: `octaves` layers of value noise, each at half the scale and half the weight of the one before. */
function fractal(rng: Rng, cols: number, rows: number, base: number, octaves: number): Field {
  const layers = Array.from({ length: octaves }, (_, i) => noise(rng, Math.max(1.5, base / 2 ** i), cols, rows));
  return (x, y) => {
    let v = 0;
    let weight = 1;
    let total = 0;
    for (const layer of layers) {
      v += layer(x, y) * weight;
      total += weight;
      weight /= 2;
    }
    return v / total;
  };
}

export function extraLevels(pattern: ExtraPattern, { cols, rows, rng, levels, dither }: Canvas): void {
  const set = (x: number, y: number, level: number) => {
    if (x >= 0 && y >= 0 && x < cols && y < rows) levels[y * cols + x] = level;
  };
  const each = (fn: (x: number, y: number) => number) => {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) levels[y * cols + x] = fn(x, y);
  };

  if (pattern === "contours") {
    const f = noise(rng, 6 + rng() * 10, cols, rows);
    const bands = 3 + Math.floor(rng() * 5);
    each((x, y) => {
      const v = f(x, y) * bands;
      const fr = v - Math.floor(v);
      return fr < 0.12 ? 3 : fr < 0.5 ? 1 : 0;
    });
  } else if (pattern === "stripes") {
    const angle = rng() * Math.PI;
    const [ca, sa] = [Math.cos(angle), Math.sin(angle)];
    const period = 3 + rng() * 9;
    const phase = rng() * 20;
    const duty = 0.2 + rng() * 0.5;
    const wobble = rng() * 3;
    each((x, y) => {
      const t = (x * ca + y * sa) / period + Math.sin(x * 0.2 + phase) * wobble * 0.05 + phase;
      const fr = t - Math.floor(t);
      return fr < duty * 0.3 ? 3 : fr < duty ? 2 : 0;
    });
  } else if (pattern === "blocks") {
    const total = 3 + Math.floor(rng() * 2);
    let last = 0;
    const split = (x0: number, y0: number, x1: number, y1: number, depth: number): void => {
      // (the whole grid is always split once: a cover of one block is flat)
      if (depth === 0 || x1 - x0 < 5 || y1 - y0 < 4 || (depth < total && rng() < 0.12)) {
        // (a block is never the tone of the one before it: the cover is never flat)
        const level = (last + 1 + Math.floor(rng() * 3)) % 4;
        last = level;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, x === x0 || y === y0 ? Math.max(level, 1) : level);
        return;
      }
      if (x1 - x0 > (y1 - y0) * 1.4 || (rng() < 0.4 && x1 - x0 > 6)) {
        const m = x0 + Math.round((x1 - x0) * (0.3 + rng() * 0.4));
        split(x0, y0, m, y1, depth - 1);
        split(m, y0, x1, y1, depth - 1);
      } else {
        const m = y0 + Math.round((y1 - y0) * (0.3 + rng() * 0.4));
        split(x0, y0, x1, m, depth - 1);
        split(x0, m, x1, y1, depth - 1);
      }
    };
    split(0, 0, cols, rows, total);
  } else if (pattern === "scatter") {
    const n = 14 + Math.floor(rng() * 40);
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(rng() * cols);
      const cy = Math.floor(rng() * rows);
      const r = Math.floor(rng() * rng() * 6);
      const level = 1 + Math.floor(rng() * 3);
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + 0.5) set(cx + x, cy + y, level);
    }
  } else if (pattern === "waves") {
    const n = 2 + Math.floor(rng() * 4);
    const amp = 1.5 + rng() * 4;
    const k = 0.15 + rng() * 0.5;
    const phase = rng() * 6;
    const gap = Math.max(3, Math.floor(rows / (n + 1)));
    for (let w = 0; w < n; w++) {
      for (let x = 0; x < cols; x++) {
        const y = Math.round((w + 1) * gap + Math.sin(x * k + phase + w * 0.9) * amp);
        set(x, y, 3);
        set(x, y + 1, 2);
        set(x, y + 2, 1);
      }
    }
  } else if (pattern === "fbm") {
    const f = fractal(rng, cols, rows, 10 + rng() * 14, 4);
    const lo = 0.25 + rng() * 0.15;
    dither((x, y) => clamp01((f(x, y) - lo) * 2.2));
  } else if (pattern === "ridged") {
    const f = fractal(rng, cols, rows, 9 + rng() * 12, 4);
    dither((x, y) => clamp01((1 - Math.abs(2 * f(x, y) - 1)) ** 2 * 1.1 - 0.2));
  } else if (pattern === "warp") {
    const a = fractal(rng, cols, rows, 14, 3);
    const b = fractal(rng, cols, rows, 14, 3);
    const c = fractal(rng, cols, rows, 7 + rng() * 6, 3);
    const amount = 8 + rng() * 14;
    dither((x, y) => clamp01(c(x + (a(x, y) - 0.5) * amount, y + (b(x, y) - 0.5) * amount) * 1.5 - 0.2));
  } else if (pattern === "voronoi") {
    const sites = Array.from({ length: 7 + Math.floor(rng() * 14) }, () => ({ x: rng() * cols, y: rng() * rows, level: Math.floor(rng() * 4) }));
    each((x, y) => {
      let nearest = Infinity;
      let second = Infinity;
      let owner = sites[0]!;
      for (const s of sites) {
        const d = Math.hypot(x - s.x, (y - s.y) * 1.6);
        if (d < nearest) {
          second = nearest;
          nearest = d;
          owner = s;
        } else if (d < second) second = d;
      }
      return second - nearest < 0.9 ? 3 : owner.level;
    });
  } else if (pattern === "truchet") {
    const t = [4, 6, 8][Math.floor(rng() * 3)]!;
    const bias = rng();
    for (let ty = 0; ty < Math.ceil(rows / t); ty++) {
      for (let tx = 0; tx < Math.ceil(cols / t); tx++) {
        const centres = rng() < bias ? [[0, 0], [t, t]] : [[t, 0], [0, t]];
        for (let y = 0; y < t; y++) {
          for (let x = 0; x < t; x++) {
            const d = Math.min(...centres.map(([cx, cy]) => Math.abs(Math.hypot(x + 0.5 - cx!, y + 0.5 - cy!) - t / 2)));
            if (d < 0.75) set(tx * t + x, ty * t + y, d < 0.35 ? 3 : 2);
            else if (d < 1.6) set(tx * t + x, ty * t + y, 1);
          }
        }
      }
    }
  } else if (pattern === "rays") {
    const fx = cols * (0.2 + rng() * 0.6);
    const fy = rows * (0.2 + rng() * 0.6);
    const n = 6 + rng() * 22;
    const phase = rng() * 6;
    const reach = cols * (0.5 + rng());
    dither((x, y) => {
      const a = Math.atan2((y - fy) * 1.7, x - fx);
      const d = Math.hypot(x - fx, (y - fy) * 1.7);
      return clamp01((0.5 + 0.5 * Math.cos(a * n + phase)) ** 2 * (1 - d / reach));
    });
  } else if (pattern === "spiral") {
    const fx = cols * (0.3 + rng() * 0.4);
    const fy = rows * (0.3 + rng() * 0.4);
    const arms = 1 + Math.floor(rng() * 3);
    const tight = 2 + rng() * 3;
    const phase = rng() * 6;
    dither((x, y) => {
      const a = Math.atan2((y - fy) * 1.7, x - fx);
      const d = Math.hypot(x - fx, (y - fy) * 1.7);
      return clamp01((0.5 + 0.5 * Math.cos(a * arms + (d / tight) * 2 + phase)) * (1 - d / (cols * 0.9)) * 1.4);
    });
  } else if (pattern === "halftone") {
    const s = [3, 4, 5][Math.floor(rng() * 3)]!;
    const f = fractal(rng, cols, rows, 18, 2);
    const angle = rng() * 0.8;
    const [ca, sa] = [Math.cos(angle), Math.sin(angle)];
    each((x, y) => {
      const u = x * ca + y * sa;
      const v = -x * sa + y * ca;
      const cx = (Math.floor(u / s) + 0.5) * s;
      const cy = (Math.floor(v / s) + 0.5) * s;
      const r = f(clamp(cx * ca - cy * sa, 0, cols), clamp(cx * sa + cy * ca, 0, rows)) * s * 0.75;
      return Math.hypot(u - cx, v - cy) < r ? (r > s * 0.5 ? 3 : 2) : 0;
    });
  } else if (pattern === "moire") {
    const a = { x: rng() * cols, y: rng() * rows };
    const b = { x: rng() * cols, y: rng() * rows };
    const f1 = 1.3 + rng() * 1.2;
    const f2 = f1 + 0.1 + rng() * 0.4;
    dither((x, y) => clamp01((0.5 + 0.5 * Math.cos(Math.hypot(x - a.x, (y - a.y) * 1.7) * f1)) * (0.5 + 0.5 * Math.cos(Math.hypot(x - b.x, (y - b.y) * 1.7) * f2)) * 1.1));
  } else if (pattern === "strata") {
    const f = noise(rng, 12 + rng() * 10, cols, rows);
    const n = 5 + Math.floor(rng() * 9);
    const amp = 2 + rng() * 6;
    const layers = Array.from({ length: n }, () => Math.floor(rng() * 4));
    each((x, y) => {
      const t = ((y + (f(x, y) - 0.5) * amp * 2) / rows) * n;
      const i = Math.floor(t);
      return t - i < 0.12 ? 3 : layers[((i % n) + n) % n]!;
    });
  } else {
    // dunes: a sky that dithers down from the top, a low sun, and ridges of sand that stack toward the bottom
    const f = fractal(rng, cols, rows, 22, 3);
    const sun = { x: rng() * cols, y: rows * (0.2 + rng() * 0.3), r: 3 + rng() * 4 };
    const n = 3 + Math.floor(rng() * 3);
    dither((_, y) => clamp01(0.15 + 0.5 * (1 - y / rows)));
    for (let k = 0; k < n; k++) {
      for (let x = 0; x < cols; x++) {
        const top = Math.round(rows * (0.35 + 0.13 * k) + (f(x + k * 20, k * 9) - 0.5) * rows * 0.6);
        for (let y = top; y < rows; y++) set(x, y, k % 2 ? 1 : 2);
        set(x, top, 3);
      }
    }
    for (let y = 0; y < Math.floor(rows * 0.5); y++) for (let x = 0; x < cols; x++) if (Math.hypot(x - sun.x, (y - sun.y) * 1.7) < sun.r && levels[y * cols + x]! < 3) levels[y * cols + x] = 3;
  }
}
