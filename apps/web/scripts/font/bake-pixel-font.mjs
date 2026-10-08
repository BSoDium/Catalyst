// Bakes the pixel font of the map labels into a plain TypeScript table: `pnpm --filter @catalyst/web bake:font`.
//
// Source: Fusion Pixel 10px Proportional (OFL 1.1, https://github.com/TakWolf/fusion-pixel-font) from the
// `@fontsource/fusion-pixel-10px-proportional-sc` npm package (a dev dependency pinned in the lockfile: nothing of it ships to
// the browser except the table this script writes). The font is drawn on a pixel grid (10 px em, 100 font units per pixel,
// 7 px capitals, 5 px x-height, 1 px stems), so every glyph is rasterised here by sampling its outline at the pixel centres:
// the result is exact, with no anti-aliasing and no dependence on a browser or on font loading. The table is
// `app/globe/engine/pixel-font/pixel-font-data.ts` (licence notice in its header, text in `OFL.txt` next to it). The package
// ships the whole font (a CJK font, 24,000 glyphs) as one file, so only the ranges the map's labels can use are baked:
// Latin (Basic, Latin-1, Extended-A/B), Greek, Cyrillic, general punctuation and currency signs. What the font does not have
// (Latin Extended-A letters such as š ł ą ő, Vietnamese stacks, other scripts) is composed or rasterised at runtime, see
// app/globe/engine/pixel-font/pixel-font.ts.
import * as fontkit from "fontkit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, "../../node_modules/@fontsource/fusion-pixel-10px-proportional-sc");
const outDir = path.join(here, "../../app/globe/engine/pixel-font");
const FILE = path.join(pkg, "files", "fusion-pixel-10px-proportional-sc-latin-400-normal.woff");
const EM = 10; // pixels per em
const PX = 100; // font units per pixel
const ROWS_ABOVE = 14; // rows scanned above the baseline
const ROWS_BELOW = 5;
/** The code point ranges baked (inclusive). */
const RANGES = [
  [0x20, 0x7e],
  [0xa0, 0x24f],
  [0x370, 0x3ff],
  [0x400, 0x4ff],
  [0x2010, 0x2027],
  [0x2030, 0x203a],
  [0x20a0, 0x20bf],
  [0x2122, 0x2122],
];

/** Winding number of the closed polygons of a glyph around (x, y) (non-zero rule). */
function inside(polys, x, y) {
  let wn = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      if (y0 <= y) {
        if (y1 > y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) > 0) wn++;
      } else if (y1 <= y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) < 0) wn--;
    }
  }
  return wn !== 0;
}

function polygons(glyph) {
  const polys = [];
  let cur = [];
  let last = [0, 0];
  const flatten = (p0, c1, c2, p3) => {
    const n = 8;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      cur.push([u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]]);
    }
  };
  for (const c of glyph.path.commands) {
    const a = c.args;
    if (c.command === "moveTo") {
      if (cur.length) polys.push(cur);
      cur = [[a[0], a[1]]];
      last = [a[0], a[1]];
    } else if (c.command === "lineTo") {
      cur.push([a[0], a[1]]);
      last = [a[0], a[1]];
    } else if (c.command === "quadraticCurveTo") {
      const c1 = [last[0] + (2 / 3) * (a[0] - last[0]), last[1] + (2 / 3) * (a[1] - last[1])];
      const c2 = [a[2] + (2 / 3) * (a[0] - a[2]), a[3] + (2 / 3) * (a[1] - a[3])];
      flatten(last, c1, c2, [a[2], a[3]]);
      last = [a[2], a[3]];
    } else if (c.command === "bezierCurveTo") {
      flatten(last, [a[0], a[1]], [a[2], a[3]], [a[4], a[5]]);
      last = [a[4], a[5]];
    } else if (c.command === "closePath") {
      if (cur.length) polys.push(cur);
      cur = [];
    }
  }
  if (cur.length) polys.push(cur);
  return polys;
}

const font = fontkit.openSync(FILE);
if (font.unitsPerEm !== EM * PX) throw new Error(`unexpected units per em ${font.unitsPerEm}`);
const entries = new Map();
let widest = 0;
for (const [from, to] of RANGES) {
  for (let cp = from; cp <= to; cp++) {
    if (!font.hasGlyphForCodePoint(cp)) continue;
    const g = font.glyphForCodePoint(cp);
    const polys = polygons(g);
    const adv = Math.round(g.advanceWidth / PX);
    const rows = [];
    let minX = Infinity;
    let maxX = -Infinity;
    for (let r = ROWS_ABOVE - 1; r >= -ROWS_BELOW; r--) {
      // row r covers y in [r, r + 1) pixels above the baseline
      const bits = [];
      for (let x = -2; x < adv + 6; x++) bits.push(inside(polys, (x + 0.5) * PX, (r + 0.5) * PX) ? 1 : 0);
      rows.push(bits);
      bits.forEach((b, i) => {
        if (b) {
          minX = Math.min(minX, i - 2);
          maxX = Math.max(maxX, i - 2);
        }
      });
    }
    if (minX === Infinity) {
      entries.set(cp, { adv, left: 0, top: 0, rows: [] }); // blank (space)
      continue;
    }
    // trim empty rows at the top and bottom
    const first = rows.findIndex((b) => b.some(Boolean));
    const lastRow = rows.length - 1 - [...rows].reverse().findIndex((b) => b.some(Boolean));
    const top = ROWS_ABOVE - first; // rows above the baseline of the first kept row
    const kept = rows.slice(first, lastRow + 1).map((bits) => bits.slice(minX + 2, maxX + 3));
    entries.set(cp, { adv, left: minX, top, rows: kept });
    widest = Math.max(widest, maxX - minX + 1);
  }
}

// One entry per glyph: `cp:advance:left:top:width:row,row,...` with each row a hex number (bit width - 1 - x is column x).
const lines = [];
for (const cp of [...entries.keys()].sort((a, b) => a - b)) {
  const e = entries.get(cp);
  const w = e.rows[0]?.length ?? 0;
  const hex = e.rows.map((bits) => parseInt(bits.join("") || "0", 2).toString(16));
  lines.push(`${cp.toString(16)}:${e.adv}:${e.left}:${e.top}:${w}:${hex.join(",")}`);
}
const header = `/**
 * GENERATED by scripts/font/bake-pixel-font.mjs from the Fusion Pixel 10px Proportional font; do not edit.
 *
 * Fusion Pixel Font, Copyright (c) 2022, TakWolf (https://takwolf.com), with Reserved Font Name 'Fusion Pixel'.
 * Licensed under the SIL Open Font License, Version 1.1 (the text is in OFL.txt, next to this file; also
 * https://openfontlicense.org). This table is a bitmap rendering of a subset of the font's glyphs; it is distributed under the
 * same licence, is not sold by itself and does not use the Reserved Font Name.
 *
 * Format: one glyph per ';'-separated entry, \`codepoint(hex):advance:left:top:width:rows\`. \`advance\` is the pen advance in
 * pixels, \`left\` the offset of the first column from the pen, \`top\` the number of rows the first row is above the baseline,
 * \`rows\` the bitmap rows from the top as hex numbers whose bit (width - 1 - x) is the pixel at column x.
 */
export const PIXEL_FONT_EM = ${EM};
export const PIXEL_FONT_DATA = "${lines.join(";")}";
`;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "pixel-font-data.ts"), header);
fs.copyFileSync(path.join(pkg, "LICENSE"), path.join(outDir, "OFL.txt"));
console.log(`${entries.size} glyphs, ${(header.length / 1024).toFixed(1)} KB, widest glyph ${widest} px -> ${outDir}`);
