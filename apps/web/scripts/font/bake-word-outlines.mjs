// Bakes the outlines of the cinematic interlude's word into a plain TypeScript table: `pnpm --filter @catalyst/web bake:word [word] [weight] [opsz] [tracking]`.
//
// Source: the page's own display face (Bricolage Grotesque, SIL OFL 1.1, public/fonts/bricolage-grotesque-5.3.0-latin-wght-opsz.woff2). It is a variable
// font in a woff2, which the font parser the repo has (fontkit) cannot instance, so the word is drawn the way the page draws it, in the Chromium the perf
// scripts use (the caption's weight, the given optical size, its own kerning and the caption's tracking), at a cap height of CAP_PX pixels, and its
// contours are traced from that picture (marching squares at half coverage) and simplified to within a thousandth of a cap height. The result is a set of
// closed polygons in CAP HEIGHTS (x to the right from the ink's left edge, y up from the baseline) that the engine extrudes into solid letters
// (engine/cinematic-word.ts) without a font parser. The table is `app/globe/engine/cinematic-glyphs.ts`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../perf/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT = path.join(here, "../../public/fonts/bricolage-grotesque-5.3.0-latin-wght-opsz.woff2");
const OUT = path.join(here, "../../app/globe/engine/cinematic-glyphs.ts");
const WORD = process.argv[2] ?? "UNIVERSAL";
const WEIGHT = Number(process.argv[3] ?? 800);
/** The optical size: 12 is the face's sturdy, wide cut (the 96 cut is narrower and finer), nearer a studio's wordmark. */
const OPSZ = Number(process.argv[4] ?? 12);
/** The caption's tracking for this face, em (engine/caption.ts `CAPTION_FACES.sans`). */
const TRACKING = Number(process.argv[5] ?? 0.02);
const CAP_PX = 800;
/** The simplification tolerance, cap heights. */
const EPS = 0.0022;

const browser = await launch({});
const page = await browser.newPage();
await page.setContent("<canvas id=c></canvas>");
const b64 = fs.readFileSync(FONT).toString("base64");
const out = await page.evaluate(
  async ({ b64, WORD, WEIGHT, OPSZ, TRACKING, CAP_PX, EPS }) => {
    // (the optical size is fixed by the face's own descriptor: a canvas sets it from the font size, which at this size is the finest cut)
    const face = new FontFace("Bk", `url(data:font/woff2;base64,${b64})`, { weight: "200 800", variationSettings: `"opsz" ${OPSZ}` });
    await face.load();
    document.fonts.add(face);
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = `${WEIGHT} 1000px Bk`;
    const capEm = probe.measureText("H").actualBoundingBoxAscent / 1000;
    const S = CAP_PX / capEm;
    const font = `${WEIGHT} ${S}px Bk`;
    probe.font = font;
    probe.letterSpacing = `${TRACKING * S}px`;
    const m = probe.measureText(WORD);
    const pad = 40;
    const W = Math.ceil(m.width + 2 * pad);
    const asc = Math.ceil(m.actualBoundingBoxAscent + pad);
    const desc = Math.ceil(m.actualBoundingBoxDescent + pad);
    const H = asc + desc;
    const c = document.getElementById("c");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.font = font;
    g.letterSpacing = `${TRACKING * S}px`;
    g.fillStyle = "#000";
    g.fillText(WORD, pad, asc);
    const data = g.getImageData(0, 0, W, H).data;
    const A = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : data[(y * W + x) * 4 + 3] / 255);
    // marching squares at half coverage: every cell's segments, joined into loops through the edge points they share
    const pts = new Map(); // edge id -> [x, y]
    const adj = new Map(); // edge id -> [ids]
    const H_ = (x, y) => 2 * (y * (W + 1) + x);
    const V_ = (x, y) => 2 * (y * (W + 1) + x) + 1;
    const point = (id, x0, y0, x1, y1) => {
      if (pts.has(id)) return;
      const a0 = A(x0, y0);
      const a1 = A(x1, y1);
      const t = a1 === a0 ? 0.5 : (0.5 - a0) / (a1 - a0);
      pts.set(id, [x0 + (x1 - x0) * t + 0.5, y0 + (y1 - y0) * t + 0.5]);
    };
    const link = (p, q) => {
      (adj.get(p) ?? adj.set(p, []).get(p)).push(q);
      (adj.get(q) ?? adj.set(q, []).get(q)).push(p);
    };
    for (let y = -1; y < H; y++) {
      for (let x = -1; x < W; x++) {
        const tl = A(x, y) >= 0.5 ? 1 : 0;
        const tr = A(x + 1, y) >= 0.5 ? 1 : 0;
        const br = A(x + 1, y + 1) >= 0.5 ? 1 : 0;
        const bl = A(x, y + 1) >= 0.5 ? 1 : 0;
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
        const centre = (A(x, y) + A(x + 1, y) + A(x + 1, y + 1) + A(x, y + 1)) / 4 >= 0.5;
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
      let a = 0;
      let b = 0;
      let far = -1;
      for (let i = 1; i < poly.length; i++) {
        const d = Math.hypot(poly[i][0] - poly[0][0], poly[i][1] - poly[0][1]);
        if (d > far) {
          far = d;
          b = i;
        }
      }
      keep[a] = keep[b] = 1;
      rec(a, b);
      rec(b, poly.length);
      return poly.filter((_, i) => keep[i]);
    };
    const inkLeft = Math.min(...loops.flat().map((p) => p[0]));
    const contours = loops.map((l) =>
      dp(l, EPS * CAP_PX).flatMap(([x, y]) => [Math.round(((x - inkLeft) / CAP_PX) * 1000) / 1000, Math.round(((asc - y) / CAP_PX) * 1000) / 1000]),
    );
    const ys = contours.flatMap((c) => c.filter((_, i) => i % 2 === 1));
    const xs = contours.flatMap((c) => c.filter((_, i) => i % 2 === 0));
    return { contours, widthCaps: Math.max(...xs), aboveCaps: Math.max(...ys), belowCaps: Math.max(0, -Math.min(...ys)) };
  },
  { b64, WORD, WEIGHT, OPSZ, TRACKING, CAP_PX, EPS },
);
await browser.close();

const body = `/**
 * The outlines of the cinematic interlude's word, baked by scripts/font/bake-word-outlines.mjs (do not edit): the page's display face, Bricolage Grotesque
 * (SIL OFL 1.1, public/fonts/LICENSE-bricolage-grotesque.txt), at weight ${WEIGHT}, optical size ${OPSZ}, with its own kerning and the caption's tracking, traced
 * from a drawing of it. Every contour is a closed polygon, flat \`[x0, y0, x1, y1, ...]\`, in CAP HEIGHTS: x to the right from the ink's left edge, y up from
 * the baseline. The outer contours and the holes are told apart by their winding at build time.
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
console.log(`${WORD}: ${out.contours.length} contours, ${out.contours.reduce((a, c) => a + c.length / 2, 0)} points, width ${out.widthCaps} caps, above ${out.aboveCaps}, below ${out.belowCaps}`);
