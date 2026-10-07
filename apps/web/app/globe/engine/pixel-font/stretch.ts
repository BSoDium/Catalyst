/**
 * The taller size of the map type (pure, unit tested).
 *
 * Tiny5 (the baked table) is drawn for an 8 px em: 5 px capitals and a 4 px x-height. At the map's art pixel (2.5 CSS px) that
 * is a 12 px capital, and the derived bold (a one-cell double strike) is then 2 of 5 rows wide: thick, with its counters
 * closed, hardly readable. The type is made TALLER on the same grid instead: every glyph gets extra rows, 5 to 7 for a capital
 * or an ascender, 4 to 5 for a lowercase letter, so a bold stem is 2 cells in 7 rows and the letters keep their open shapes.
 * The widths, the advances and the one-cell stems are untouched: it stays the same calculator-like pixel face, only taller
 * (the proportions of a 5 x 7 character LCD).
 *
 * Which rows are repeated is decided per glyph, on its body (the part from the baseline up to the first blank row when what is
 * above that is a mark of at most `MAX_MARK_ROWS` rows: the dot of an i, an accent): the repeated rows are the ones that thicken
 * nothing, a row of vertical stems or of a curve's flank, never a horizontal bar (the bars of E, B, e, s stay one cell thick) and
 * never a blank gap, spread evenly. A letter and its accented form share the same body bitmap, so they get the same rows and
 * their bodies are identical. Everything that is not part of the body (the marks above, the descender below) is kept as it is.
 */
import type { Glyph } from "./pixel-font";

/** Rows of a mark above a body (an accent, the dot of an i) that is kept apart from the body when a blank row separates them. */
const MAX_MARK_ROWS = 3;
/** Smallest body that is stretched on its own (below it the glyph is one body). */
const MIN_BODY_ROWS = 3;

/** The height a body of `h` rows gets: a capital or an ascender 5 to 7, a lowercase 4 to 5, anything else grows with it. */
export function stretchedHeight(h: number): number {
  if (h <= 3) return h;
  if (h === 4) return 5;
  if (h === 5) return 7;
  return h + 2;
}

/** The runs of lit cells of a row of `w` columns as lengths. */
function runs(row: number, w: number): number[] {
  const out: number[] = [];
  let run = 0;
  for (let x = 0; x < w; x++) {
    if ((row >> (w - 1 - x)) & 1) run++;
    else if (run) {
      out.push(run);
      run = 0;
    }
  }
  if (run) out.push(run);
  return out;
}

/**
 * What repeating row `index` of `body` costs. A bar (a run of 3 or more cells) or a flat curve apex (2) would get thicker, a
 * blank row is a wider gap. A row whose ink is all inside a neighbour's (a stem continuing a bar, a stem under a stem) only
 * extends strokes that are already there: free. Any other row (a diagonal's step, a stem with a new branch) would distort the
 * shape, so repeating it costs; the outer rows of the glyph cost a little (the top of a letter is its shape).
 */
function repeatCost(body: readonly number[], w: number, index: number): number {
  const row = body[index]!;
  if (row === 0) return 8;
  let cost = 0;
  for (const r of runs(row, w)) cost += r >= 3 ? 30 : r === 2 ? 3 : 0;
  const prev = index > 0 ? body[index - 1]! : 0;
  const next = index < body.length - 1 ? body[index + 1]! : 0;
  const continues = (row & prev) === row || (row & next) === row;
  if (!continues) cost += 6;
  else if (index === 0 || index === body.length - 1) cost += 0.5;
  else cost += 0;
  if (!continues && (index === 0 || index === body.length - 1)) cost += 5;
  return cost;
}

/** Indices (ascending, distinct) of the `k` rows of `body` to repeat. Exhaustive: bodies are at most a dozen rows. */
export function rowsToRepeat(body: readonly number[], w: number, k: number): number[] {
  const h = body.length;
  if (k <= 0 || h === 0) return [];
  const ideal: number[] = [];
  // where a plain proportional stretch would repeat rows
  for (let j = 0, prev = -1; j < h + k; j++) {
    const src = Math.min(h - 1, Math.floor(((j + 0.5) * h) / (h + k)));
    if (src === prev) ideal.push(src);
    prev = src;
  }
  let best: number[] = [];
  let bestCost = Infinity;
  const pick: number[] = [];
  const walk = (from: number) => {
    if (pick.length === k) {
      let cost = 0;
      pick.forEach((r, n) => {
        cost += repeatCost(body, w, r);
        cost += 1.5 * Math.abs(r - (ideal[n] ?? r));
        if (n > 0 && pick[n - 1] === r - 1) cost += 4; // two neighbours repeated: a stem three times as long
      });
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        best = [...pick];
      }
      return;
    }
    for (let r = from; r < h; r++) {
      pick.push(r);
      walk(r + 1);
      pick.pop();
    }
  };
  walk(0);
  return best;
}

/** The glyph made taller (see the header). A glyph without ink above the baseline is returned as it is. */
export function stretched(g: Glyph): Glyph {
  const above = Math.max(0, Math.min(g.top, g.rows.length));
  if (above === 0) return g;
  // marks: the rows above the first blank row below them, when at most MAX_MARK_ROWS and a real body is left
  let marks = 0;
  let gap = 0;
  const firstBlank = g.rows.slice(0, above).findIndex((r) => r === 0);
  if (firstBlank > 0 && firstBlank <= MAX_MARK_ROWS) {
    let end = firstBlank;
    while (end < above && g.rows[end] === 0) end++;
    if (above - end >= MIN_BODY_ROWS) {
      marks = firstBlank;
      gap = end - firstBlank;
    }
  }
  const start = marks + gap;
  const body = g.rows.slice(start, above);
  const extra = stretchedHeight(body.length) - body.length;
  if (extra <= 0) return g;
  const repeat = new Set(rowsToRepeat(body, g.w, extra));
  const rows: number[] = [...g.rows.slice(0, start)];
  body.forEach((r, i) => {
    rows.push(r);
    if (repeat.has(i)) rows.push(r);
  });
  rows.push(...g.rows.slice(above));
  return { ...g, top: g.top + extra, rows };
}
