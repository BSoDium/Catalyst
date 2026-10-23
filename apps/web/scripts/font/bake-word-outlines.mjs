// Bakes the outlines of the cinematic interlude's word into a plain TypeScript table: `pnpm --filter @catalyst/web bake:word [word] [weight] [gap] [wide]`.
//
// Source: the site's mono face (JetBrains Mono, SIL OFL 1.1, public/fonts/jetbrains-mono-5.3.0-latin-wght.woff2) at its heaviest: its capitals are squarish
// (straight sides, flat terminals, a bowl on the R and a curve on the S and U that are nearer a rounded rectangle than a circle), which is what a studio's
// wordmark looks like. It is a variable font in a woff2, which the font parser the repo has (fontkit) cannot instance, so each letter is drawn the way the page
// draws text, in the Chromium the perf scripts use, at a cap height of CAP_PX pixels, and its contours are traced from that picture (marching squares at half
// coverage) and simplified to within a thousandth of a cap height or so.
//
// The letters are then SET HERE, not by the font: a mono face gives every letter the same width, wide gaps and slab serifs on the I. The I is drawn as a plain
// bar (the stem of the L, a full cap high), and every letter is placed so that the nearest points of its outline and the previous letter's are `gap` cap heights
// apart (row by row, so a V tucks its arm over the E that follows and an A its foot under the L: the tight, even colour of a logotype). The letters are also
// drawn WIDER than the face draws them (`wide` times, with a thin stroke added so that the bars the widening leaves relatively thin keep up with the stems):
// a mono face's capitals are tall and narrow, a studio's are nearly square.
//
// The result is a set of closed polygons in CAP HEIGHTS (x to the right from the ink's left edge, y up from the baseline) that the engine extrudes into solid
// letters (engine/cinematic-word.ts) without a font parser. The table is `app/globe/engine/cinematic-glyphs.ts`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../perf/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT = path.join(here, "../../public/fonts/jetbrains-mono-5.3.0-latin-wght.woff2");
const OUT = path.join(here, "../../app/globe/engine/cinematic-glyphs.ts");
const WORD = process.argv[2] ?? "UNIVERSAL";
const WEIGHT = Number(process.argv[3] ?? 800);
/** The closest two letters' outlines come, cap heights. */
const GAP = Number(process.argv[4] ?? 0.085);
/** How much wider than the face draws them the letters are, and the stroke added to keep the horizontal bars up with the stems (cap heights). */
const WIDE = Number(process.argv[5] ?? 1.45);
const EMBOLDEN = 0.01;
const CAP_PX = 800;
/** The simplification tolerance, cap heights. */
const EPS = 0.0022;

const browser = await launch({});
const page = await browser.newPage();
await page.setContent("<canvas id=c></canvas>");
const b64 = fs.readFileSync(FONT).toString("base64");
const out = await page.evaluate(
  async ({ b64, WORD, WEIGHT, GAP, WIDE, EMBOLDEN, CAP_PX, EPS }) => {
    const face = new FontFace("Mono", `url(data:font/woff2;base64,${b64})`, { weight: "100 800" });
    await face.load();
    document.fonts.add(face);
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = `${WEIGHT} 1000px Mono`;
    const capEm = probe.measureText("H").actualBoundingBoxAscent / 1000;
    const S = CAP_PX / capEm;
    const font = `${WEIGHT} ${S}px Mono`;
    const pad = 40;
    const W = Math.ceil(S * 0.6 * WIDE) + 2 * pad + 40;
    const asc = Math.ceil(CAP_PX * 1.15) + pad;
    const H = asc + Math.ceil(CAP_PX * 0.12) + pad;
    const c = document.getElementById("c");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true });
    const raster = (draw) => {
      g.clearRect(0, 0, W, H);
      g.font = font;
      g.fillStyle = "#000";
      g.strokeStyle = "#000";
      g.lineJoin = "miter";
      g.miterLimit = 6;
      g.lineWidth = EMBOLDEN * CAP_PX;
      draw(g);
      return new Uint8ClampedArray(g.getImageData(0, 0, W, H).data);
    };
    const A = (data, x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : data[(y * W + x) * 4 + 3] / 255);
    /** The ink's left and right edge on every row (null where there is none). */
    const profile = (data) => {
      const left = new Array(H).fill(null);
      const right = new Array(H).fill(null);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) if (A(data, x, y) >= 0.5) { left[y] = x; break; }
        for (let x = W - 1; x >= 0; x--) if (A(data, x, y) >= 0.5) { right[y] = x + 1; break; }
      }
      return { left, right };
    };
    // the stem of the L: the first run of ink on a row through its middle
    /** A letter widened about its own left edge: drawn through a stretch, filled and stroked. */
    const wide = (g, ch) => {
      g.save();
      g.translate(pad, asc);
      g.scale(WIDE, 1);
      g.lineWidth = (EMBOLDEN * CAP_PX) / WIDE;
      g.fillText(ch, 0, 0);
      g.strokeText(ch, 0, 0);
      g.restore();
    };
    const L = raster((g) => wide(g, "L"));
    const stem = (() => {
      const y = asc - Math.round(CAP_PX * 0.5);
      let x = 0;
      while (x < W && A(L, x, y) < 0.5) x++;
      const x0 = x;
      while (x < W && A(L, x, y) >= 0.5) x++;
      return x - x0;
    })();
    const glyph = (ch) => (ch === "I" ? raster((g) => g.fillRect(pad + Math.round(S * 0.2), asc - CAP_PX - EMBOLDEN * CAP_PX / 2, stem, CAP_PX + EMBOLDEN * CAP_PX)) : raster((g) => wide(g, ch)));
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
      for (let y = -1; y < H; y++) {
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
        for (let y = 0; y < H; y++) {
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
    return { contours: flat, widthCaps: Math.max(...xs), aboveCaps: Math.max(...ys), belowCaps: Math.max(0, -Math.min(...ys)), stem: stem / CAP_PX };
  },
  { b64, WORD, WEIGHT, GAP, WIDE, EMBOLDEN, CAP_PX, EPS },
);
await browser.close();

const body = `/**
 * The outlines of the cinematic interlude's word, baked by scripts/font/bake-word-outlines.mjs (do not edit): the site's mono face, JetBrains Mono
 * (SIL OFL 1.1, public/fonts/LICENSE-jetbrains-mono.txt), at weight ${WEIGHT}, traced from drawings of its letters (widened ${WIDE} times, the I a plain bar) and set with
 * the nearest points of neighbouring letters ${GAP} cap heights apart. Every contour is a closed polygon, flat \`[x0, y0, x1, y1, ...]\`, in CAP HEIGHTS: x to
 * the right from the ink's left edge, y up from the baseline. The outer contours and the holes are told apart by their winding at build time.
 */
export const WORD_OUTLINES = {
  word: ${JSON.stringify(WORD)},
  weight: ${WEIGHT},
  /** The ink's width and its extents above and below the baseline, cap heights. */
  widthCaps: ${out.widthCaps},
  aboveCaps: ${out.aboveCaps},
  belowCaps: ${Math.round(out.belowCaps * 1000) / 1000},
  contours: ${JSON.stringify(out.contours)} as readonly (readonly number[])[],
} as const;
`;
fs.writeFileSync(OUT, body);
console.log(`${WORD}: ${out.contours.length} contours, ${out.contours.reduce((a, c) => a + c.length / 2, 0)} points, width ${out.widthCaps} caps, above ${out.aboveCaps}, below ${out.belowCaps}, stem ${out.stem.toFixed(3)}`);
