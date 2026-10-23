// Bakes the outlines of the cinematic interlude's word into a plain TypeScript table: `pnpm --filter @catalyst/web bake:word [word] [gap]`.
//
// The letters are DRAWN, not set in a font: a studio's wordmark is a logotype with one thick stroke, wide proportions, flat apexes and square corners, which no
// face in the repo has (the display sans is round and thin on the R; the mono has slabs and is narrow, and stretching it thins the bars). Each capital is built
// from rectangles, a few polygons for the diagonals and a few rounded corners (`LETTERS`, in cap heights, y up), drawn in the Chromium the perf scripts use,
// traced from that picture (marching squares at half coverage) and simplified to within a thousandth or so of a cap height, so the corners stay as drawn.
//
// The letters are then SET HERE: each so that the nearest points of its outline and the previous letter's are `gap` cap heights apart (row by row, so a V tucks
// its arm over the E that follows and an A its foot under the L: the tight, even colour of a logotype).
//
// The result is a set of closed polygons in CAP HEIGHTS (x to the right from the ink's left edge, y up from the baseline) that the engine extrudes into solid
// letters (engine/cinematic-word.ts). The table is `app/globe/engine/cinematic-glyphs.ts`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../perf/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "../../app/globe/engine/cinematic-glyphs.ts");
const WORD = process.argv[2] ?? "UNIVERSAL";
/** The closest two letters' outlines come, cap heights. */
const GAP = Number(process.argv[3] ?? 0.17);
const CAP_PX = 800;
/** The simplification tolerance, cap heights. */
const EPS = 0.0016;

const browser = await launch({});
const page = await browser.newPage();
await page.setContent("<canvas id=c></canvas>");
const out = await page.evaluate(
  async ({ WORD, GAP, CAP_PX, EPS }) => {
    const C = CAP_PX;
    // the strokes, cap heights: verticals a little thicker than horizontals (the eye sees equal ones as the other way)
    const T = 0.225;
    const H = 0.19;
    const D = 0.28; // a diagonal, measured along the horizontal
    const pad = 40;
    const W = Math.ceil(C * 1.2) + 2 * pad;
    const asc = Math.ceil(C * 1.08) + pad;
    const Hh = asc + Math.ceil(C * 0.1) + pad;
    const c = document.getElementById("c");
    c.width = W;
    c.height = Hh;
    const g = c.getContext("2d", { willReadFrequently: true });
    const X = (x) => pad + x * C;
    const Y = (y) => asc - y * C;
    const rect = (x0, y0, x1, y1) => g.fillRect(X(x0), Y(y1), (x1 - x0) * C, (y1 - y0) * C);
    const poly = (pts) => {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.closePath();
      g.fill();
    };
    /** A rectangle with each corner's radius (tl, tr, br, bl), cap heights. */
    const rr = (x0, y0, x1, y1, [tl, tr, br, bl]) => {
      g.beginPath();
      g.moveTo(X(x0 + tl), Y(y1));
      g.lineTo(X(x1 - tr), Y(y1));
      if (tr) g.arc(X(x1 - tr), Y(y1 - tr), tr * C, -Math.PI / 2, 0);
      g.lineTo(X(x1), Y(y0 + br));
      if (br) g.arc(X(x1 - br), Y(y0 + br), br * C, 0, Math.PI / 2);
      g.lineTo(X(x0 + bl), Y(y0));
      if (bl) g.arc(X(x0 + bl), Y(y0 + bl), bl * C, Math.PI / 2, Math.PI);
      g.lineTo(X(x0), Y(y1 - tl));
      if (tl) g.arc(X(x0 + tl), Y(y1 - tl), tl * C, Math.PI, Math.PI * 1.5);
      g.closePath();
      g.fill();
    };
    const hole = (fn) => {
      g.globalCompositeOperation = "destination-out";
      fn();
      g.globalCompositeOperation = "source-over";
    };
    /** Each letter: its width (cap heights) and how it is drawn, from its own left edge. */
    const LETTERS = {
      U: { w: 0.94, draw: (w) => { rr(0, 0, w, 1, [0, 0, 0.4, 0.4]); hole(() => rr(T, H, w - T, 1.01, [0, 0, 0.4 - T, 0.4 - T])); } },
      N: { w: 0.96, draw: (w) => { rect(0, 0, T, 1); rect(w - T, 0, w, 1); poly([[0, 1], [D, 1], [w, 0], [w - D, 0]]); } },
      I: { w: T, draw: () => rect(0, 0, T, 1) },
      V: { w: 1.04, draw: (w) => { poly([[0, 1], [D, 1], [w / 2 + 0.11, 0], [w / 2 - 0.11, 0]]); poly([[w, 1], [w - D, 1], [w / 2 - 0.11, 0], [w / 2 + 0.11, 0]]); } },
      E: { w: 0.74, draw: (w) => { rect(0, 0, T, 1); rect(0, 1 - H, w, 1); rect(0, 0.5 - H / 2, w * 0.86, 0.5 + H / 2); rect(0, 0, w, H); } },
      R: {
        w: 0.92,
        draw: (w) => {
          rect(0, 0, T, 1);
          rr(0, 0.42, w, 1, [0, 0.27, 0.27, 0]);
          hole(() => rr(T, 0.42 + H, w - T, 1 - H, [0, 0.07, 0.07, 0]));
          poly([[0.3, 0.46], [0.3 + D, 0.46], [w, 0], [w - D, 0]]);
        },
      },
      S: {
        w: 0.86,
        draw: (w) => {
          const r = 0.4;
          rr(0, 0.5 - H / 2, w, 1, [r, r, 0, 0.0]);
          hole(() => rr(T, 0.5 + H / 2, w + 0.1, 1 - H, [0.1, 0, 0, 0]));
          rr(0, 0, w, 0.5 + H / 2, [0, 0, r, r]);
          hole(() => rr(-0.1, H, w - T, 0.5 - H / 2, [0, 0, 0.1, 0]));
        },
      },
      A: {
        w: 1.1,
        draw: (w) => {
          poly([[0, 0], [D, 0], [w / 2 + 0.13, 1], [w / 2 - 0.13, 1]]);
          poly([[w, 0], [w - D, 0], [w / 2 - 0.13, 1], [w / 2 + 0.13, 1]]);
          rect(0.2, 0.2, w - 0.2, 0.2 + H * 0.95);
        },
      },
      L: { w: 0.72, draw: (w) => { rect(0, 0, T, 1); rect(0, 0, w, H); } },
    };
    const raster = (ch) => {
      g.clearRect(0, 0, W, Hh);
      g.fillStyle = "#000";
      g.globalCompositeOperation = "source-over";
      LETTERS[ch].draw(LETTERS[ch].w);
      return new Uint8ClampedArray(g.getImageData(0, 0, W, Hh).data);
    };
    const A = (data, x, y) => (x < 0 || y < 0 || x >= W || y >= Hh ? 0 : data[(y * W + x) * 4 + 3] / 255);
    /** The ink's left and right edge on every row (null where there is none). */
    const profile = (data) => {
      const left = new Array(Hh).fill(null);
      const right = new Array(Hh).fill(null);
      for (let y = 0; y < Hh; y++) {
        for (let x = 0; x < W; x++) if (A(data, x, y) >= 0.5) { left[y] = x; break; }
        for (let x = W - 1; x >= 0; x--) if (A(data, x, y) >= 0.5) { right[y] = x + 1; break; }
      }
      return { left, right };
    };
    const glyph = (ch) => raster(ch);
    /** Marching squares at half coverage over one glyph's picture: its closed loops, in the picture's pixels. */
    const trace = (data) => {
      const pts = new Map();
      const adj = new Map();
      const H_ = (x, y) => 2 * (y * (W + 1) + x);
      const V_ = (x, y) => 2 * (y * (W + 1) + x) + 1;
      const point = (id, x0, y0, x1, y1) => {
        if (pts.has(id)) return;
        const a0 = A(data, x0, y0);
        const a1 = A(data, x1, y1);
        const t = a1 === a0 ? 0.5 : (0.5 - a0) / (a1 - a0);
        pts.set(id, [x0 + (x1 - x0) * t + 0.5, y0 + (y1 - y0) * t + 0.5]);
      };
      const link = (p, q) => {
        (adj.get(p) ?? adj.set(p, []).get(p)).push(q);
        (adj.get(q) ?? adj.set(q, []).get(q)).push(p);
      };
      for (let y = -1; y < Hh; y++) {
        for (let x = -1; x < W; x++) {
          const tl = A(data, x, y) >= 0.5 ? 1 : 0;
          const tr = A(data, x + 1, y) >= 0.5 ? 1 : 0;
          const br = A(data, x + 1, y + 1) >= 0.5 ? 1 : 0;
          const bl = A(data, x, y + 1) >= 0.5 ? 1 : 0;
          const k = tl * 8 + tr * 4 + br * 2 + bl;
          if (k === 0 || k === 15) continue;
          const top = H_(x, y);
          const right = V_(x + 1, y);
          const bottom = H_(x, y + 1);
          const left = V_(x, y);
          point(top, x, y, x + 1, y);
          point(right, x + 1, y, x + 1, y + 1);
          point(bottom, x, y + 1, x + 1, y + 1);
          point(left, x, y, x, y + 1);
          const centre = (A(data, x, y) + A(data, x + 1, y) + A(data, x + 1, y + 1) + A(data, x, y + 1)) / 4 >= 0.5;
          const segs = {
            1: [[left, bottom]], 2: [[bottom, right]], 3: [[left, right]], 4: [[top, right]],
            5: centre ? [[left, top], [bottom, right]] : [[top, right], [left, bottom]],
            6: [[top, bottom]], 7: [[left, top]], 8: [[left, top]], 9: [[top, bottom]],
            10: centre ? [[top, right], [left, bottom]] : [[left, top], [bottom, right]],
            11: [[top, right]], 12: [[left, right]], 13: [[right, bottom]], 14: [[left, bottom]],
          }[k];
          for (const [p, q] of segs) link(p, q);
        }
      }
      const loops = [];
      const seen = new Set();
      for (const start of adj.keys()) {
        if (seen.has(start)) continue;
        const loop = [];
        let prev = -1;
        let cur = start;
        while (!seen.has(cur)) {
          seen.add(cur);
          loop.push(pts.get(cur));
          const [n0, n1] = adj.get(cur);
          const next = n0 !== prev && !seen.has(n0) ? n0 : n1 !== prev && !seen.has(n1) ? n1 : -1;
          if (next === -1) break;
          prev = cur;
          cur = next;
        }
        if (loop.length > 8) loops.push(loop);
      }
      return loops;
    };
    // Douglas-Peucker on a closed loop (cut at the two points farthest apart)
    const dp = (poly, eps) => {
      const keep = new Uint8Array(poly.length);
      const rec = (i, j) => {
        let worst = -1;
        let at = -1;
        const [ax, ay] = poly[i];
        const [bx, by] = poly[j % poly.length];
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 1e-9;
        for (let k = i + 1; k < j; k++) {
          const [px, py] = poly[k % poly.length];
          const d = Math.abs((px - ax) * dy - (py - ay) * dx) / len;
          if (d > worst) {
            worst = d;
            at = k;
          }
        }
        if (worst > eps) {
          keep[at % poly.length] = 1;
          rec(i, at);
          rec(at, j);
        }
      };
      let b = 0;
      let far = -1;
      for (let i = 1; i < poly.length; i++) {
        const d = Math.hypot(poly[i][0] - poly[0][0], poly[i][1] - poly[0][1]);
        if (d > far) {
          far = d;
          b = i;
        }
      }
      keep[0] = keep[b] = 1;
      rec(0, b);
      rec(b, poly.length);
      return poly.filter((_, i) => keep[i]);
    };
    // lay the letters out: each one so that the row-by-row distance to the one before is at least GAP
    const gapPx = GAP * CAP_PX;
    const letters = [];
    let prev = null;
    for (const ch of WORD) {
      const data = glyph(ch);
      const prof = profile(data);
      let off = 0;
      if (prev) {
        off = -Infinity;
        for (let y = 0; y < Hh; y++) {
          if (prev.prof.right[y] === null || prof.left[y] === null) continue;
          off = Math.max(off, prev.off + prev.prof.right[y] + gapPx - prof.left[y]);
        }
      } else off = -prof.left.filter((v) => v !== null).reduce((a, b) => Math.min(a, b), Infinity);
      letters.push({ ch, data, prof, off });
      prev = letters.at(-1);
    }
    const contours = [];
    for (const l of letters) for (const loop of trace(l.data)) contours.push(dp(loop, EPS * CAP_PX).map(([x, y]) => [x + l.off, y]));
    const round = (x) => Math.round(x * 1000) / 1000;
    const flat = contours.map((c) => c.flatMap(([x, y]) => [round(x / CAP_PX), round((asc - y) / CAP_PX)]));
    const ys = flat.flatMap((c) => c.filter((_, i) => i % 2 === 1));
    const xs = flat.flatMap((c) => c.filter((_, i) => i % 2 === 0));
    return { contours: flat, widthCaps: Math.max(...xs), aboveCaps: Math.max(...ys), belowCaps: Math.max(0, -Math.min(...ys)), stem: T };
  },
  { WORD, GAP, CAP_PX, EPS },
);
await browser.close();

const body = `/**
 * The outlines of the cinematic interlude's word, baked by scripts/font/bake-word-outlines.mjs (do not edit): nine capitals DRAWN as a logotype (one thick
 * stroke, wide, flat apexes, square corners; the script has the construction of each letter), traced from the drawing and set with the nearest points of
 * neighbouring letters ${GAP} cap heights apart. Every contour is a closed polygon, flat \`[x0, y0, x1, y1, ...]\`, in CAP HEIGHTS: x to the right from the
 * ink's left edge, y up from the baseline. The outer contours and the holes are told apart by their winding at build time.
 */
export const WORD_OUTLINES = {
  word: ${JSON.stringify(WORD)},
  /** The ink's width and its extents above and below the baseline, cap heights. */
  widthCaps: ${out.widthCaps},
  aboveCaps: ${out.aboveCaps},
  belowCaps: ${Math.round(out.belowCaps * 1000) / 1000},
  contours: ${JSON.stringify(out.contours)} as readonly (readonly number[])[],
} as const;
`;
fs.writeFileSync(OUT, body);
console.log(`${WORD}: ${out.contours.length} contours, ${out.contours.reduce((a, c) => a + c.length / 2, 0)} points, width ${out.widthCaps} caps, above ${out.aboveCaps}, below ${out.belowCaps}`);
