/**
 * Where the horizon of a photograph is, as a share of its height from the top (0..1), or null when there is no clear one (a street, a crowd, a close-up).
 *
 * `rows` is the mean colour of each row of the picture (each channel 0..1, top to bottom, from a small copy of it; a plain number is a one-channel row). The horizon is the row where the picture changes most
 * from one side to the other, between the `from` and `to` share of its height (a line at the very top or bottom is an edge, not a horizon), and only when that
 * change stands out from the rest of the picture (`MIN_RATIO` times the average change): sky over sea, sky over land, snow under sky.
 */
export type HorizonRow = number | readonly number[];

export function findHorizon(input: readonly HorizonRow[], from = 0.15, to = 0.85): number | null {
  const n = input.length;
  if (n < 12) return null;
  const rows: number[][] = input.map((r) => (typeof r === "number" ? [r] : [...r]));
  const channels = rows[0]!.length;
  const smooth = rows.map((_, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    return Array.from({ length: channels }, (_c, c) => {
      let sum = 0;
      for (let k = a; k <= b; k++) sum += rows[k]![c]!;
      return sum / (b - a + 1);
    });
  });
  // the change across a row: the mean of the three rows below it minus the mean of the three above
  const span = 3;
  const change: number[] = new Array(n).fill(0);
  for (let i = span; i < n - span; i++) {
    // (the mean over the channels of the difference between the rows below and above: a change of colour counts as well as one of brightness)
    let total = 0;
    for (let c = 0; c < channels; c++) {
      let above = 0;
      let below = 0;
      for (let k = 1; k <= span; k++) {
        above += smooth[i - k]![c]!;
        below += smooth[i + k]![c]!;
      }
      total += Math.abs(below - above) / span;
    }
    change[i] = total / channels;
  }
  const lo = Math.max(span, Math.floor(n * from));
  const hi = Math.min(n - span - 1, Math.ceil(n * to));
  let best = -1;
  let bestAt = -1;
  for (let i = lo; i <= hi; i++) {
    if (change[i]! > best) {
      best = change[i]!;
      bestAt = i;
    }
  }
  const mean = change.reduce((s, v) => s + v, 0) / Math.max(1, n - 2 * span);
  if (bestAt < 0 || best < MIN_CHANGE || best < MIN_RATIO * mean) return null;
  return (bestAt + 0.5) / n;
}

/** The least change of luminance across a horizon (a share of the full range) and how many times the average change it must be. */
const MIN_CHANGE = 0.06;
const MIN_RATIO = 2;
