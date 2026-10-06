/** Pure polyline helpers shared by the generator and its tests: lines are arrays of [lon, lat] degrees. */

type Line = number[][];

const EPS = 1e-6;
const onAntimeridian = (a: number[], b: number[]) =>
  Math.abs(Math.abs(a[0]!) - 180) < EPS && Math.abs(Math.abs(b[0]!) - 180) < EPS;
const onSouthPole = (a: number[], b: number[]) => a[1]! <= -90 + EPS && b[1]! <= -90 + EPS;

/**
 * Make lines safe for any projection:
 *  - drop the artificial edges Natural Earth adds along the antimeridian and the south pole;
 *  - split segments that jump across the antimeridian (e.g. 178 -> -180) at +-180 so no line wraps the world.
 */
export function splitArtificial(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (const line of lines) {
    let cur: Line = [];
    const flush = () => {
      if (cur.length > 1) out.push(cur);
      cur = [];
    };
    for (let i = 0; i < line.length; i++) {
      const p = line[i]!;
      const prev = line[i - 1];
      if (prev && Math.abs(p[0]! - prev[0]!) > 180) {
        const side = prev[0]! > 0 ? 1 : -1;
        const t = (180 * side - prev[0]!) / (p[0]! + 360 * side - prev[0]!);
        const lat = prev[1]! + t * (p[1]! - prev[1]!);
        cur.push([180 * side, lat]);
        flush();
        cur.push([-180 * side, lat]);
      } else if (prev && (onAntimeridian(prev, p) || onSouthPole(prev, p))) {
        flush();
      }
      cur.push(p);
    }
    flush();
  }
  return dropArtificial(out);
}

function dropArtificial(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (const line of lines) {
    let cur: Line = [];
    for (const p of line) {
      const prev = cur[cur.length - 1];
      if (prev && (onAntimeridian(prev, p) || onSouthPole(prev, p))) {
        if (cur.length > 1) out.push(cur);
        cur = [];
      }
      cur.push(p);
    }
    if (cur.length > 1) out.push(cur);
  }
  return out;
}

/** Douglas-Peucker in lon/lat degrees; the end points are always kept. */
export function dp(points: Line, tol: number): Line {
  if (tol <= 0 || points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let max = 0;
    let idx = -1;
    const [ax, ay] = points[a]!;
    const [bx, by] = points[b]!;
    const dx = bx! - ax!;
    const dy = by! - ay!;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]!;
      let t = len2 ? ((px! - ax!) * dx + (py! - ay!) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px! - (ax! + t * dx), py! - (ay! + t * dy));
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Cut every segment longer than `maxDeg` (lon/lat degrees, the longer of the two components) into equal pieces along the same
 * straight lon/lat line. Geometry is unchanged; a renderer that draws straight chords never gets a segment that sinks into the
 * globe (the 49th parallel is otherwise one 28 degree segment after simplification).
 */
export function cutLongSegments(line: Line, maxDeg: number): Line {
  const out: Line = [line[0]!];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const n = Math.ceil(Math.max(Math.abs(b[0]! - a[0]!), Math.abs(b[1]! - a[1]!)) / maxDeg);
    for (let k = 1; k < n; k++) out.push([a[0]! + ((b[0]! - a[0]!) * k) / n, a[1]! + ((b[1]! - a[1]!) * k) / n]);
    out.push(b);
  }
  return out;
}

const key = (p: number[]) => `${Math.round(p[0]! * 1e5)},${Math.round(p[1]! * 1e5)}`;

/**
 * Join lines end to end (fewer, longer polylines: fewer first vertices in the delta coding, no change to what is drawn). Lines are taken in
 * order; a line is extended at an end point shared with exactly one other line still waiting. At a point where three or more line ends meet
 * (a tripoint) the first lines taken do not see each other (a processed line is no longer waiting), so one of them stays apart: which
 * lines join there depends on the order, deterministic for a given source file. Returns new lines, the input is not modified.
 */
export function mergeAtContinuations(lines: Line[]): Line[] {
  const alive = new Map<number, Line>(lines.map((l, i) => [i, l.slice()]));
  /** end point key -> ids of the lines having that point as first or last vertex (twice for a closed line). */
  const ends = new Map<string, number[]>();
  const add = (k: string, id: number) => (ends.get(k) ?? ends.set(k, []).get(k)!).push(id);
  const drop = (k: string, id: number) => {
    const l = ends.get(k)!;
    l.splice(l.indexOf(id), 1);
  };
  alive.forEach((l, id) => {
    add(key(l[0]!), id);
    add(key(l[l.length - 1]!), id);
  });
  const out: Line[] = [];
  for (const id of [...alive.keys()]) {
    let line = alive.get(id);
    if (!line) continue;
    alive.delete(id);
    drop(key(line[0]!), id);
    drop(key(line[line.length - 1]!), id);
    // Extend at the tail, then at the head (by reversing), while the shared end point belongs to exactly one other line.
    const closed = key(line[0]!) === key(line[line.length - 1]!);
    for (let pass = 0; pass < 2 && !closed; pass++) {
      for (;;) {
        const k = key(line[line.length - 1]!);
        const here = ends.get(k) ?? [];
        if (here.length !== 1) break;
        const otherId = here[0]!;
        const other = alive.get(otherId)!;
        alive.delete(otherId);
        drop(key(other[0]!), otherId);
        drop(key(other[other.length - 1]!), otherId);
        const oriented = key(other[0]!) === k ? other : other.slice().reverse();
        line = line.concat(oriented.slice(1));
      }
      line = line.slice().reverse();
    }
    out.push(line);
  }
  return out;
}

/** Position of the point on the line nearest to `p`: segment index + fraction, and its distance in km (equirectangular). */
function project(line: Line, p: number[]): { s: number; km: number; at: number[] } {
  const c = Math.cos((p[1]! * Math.PI) / 180) * 111.32;
  let best = { s: 0, km: Infinity, at: line[0]! };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const dx = (b[0]! - a[0]!) * c;
    const dy = (b[1]! - a[1]!) * 110.57;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, (((p[0]! - a[0]!) * c) * dx + ((p[1]! - a[1]!) * 110.57) * dy) / len2)) : 0;
    const at = [a[0]! + t * (b[0]! - a[0]!), a[1]! + t * (b[1]! - a[1]!)];
    const km = Math.hypot((p[0]! - at[0]!) * c, (p[1]! - at[1]!) * 110.57);
    if (km < best.km) best = { s: i - 1 + t, km, at };
  }
  return best;
}

/**
 * Remove the stretch of `line` between the points nearest to `from` and `to`. Returns the remaining pieces (0 to 2) and the removed
 * stretch, or null when either point is more than `maxKm` from the line (the cut belongs to another line of the same feature).
 */
export function cutBetween(line: Line, from: number[], to: number[], maxKm = 3): { kept: Line[]; removed: Line } | null {
  const a = project(line, from);
  const b = project(line, to);
  if (a.km > maxKm || b.km > maxKm) return null;
  const [lo, hi] = a.s <= b.s ? [a, b] : [b, a];
  const head = line.slice(0, Math.floor(lo.s) + 1).concat([lo.at]);
  const tail = [hi.at].concat(line.slice(Math.floor(hi.s) + 1));
  const removed = [lo.at].concat(line.slice(Math.floor(lo.s) + 1, Math.floor(hi.s) + 1), [hi.at]);
  const real = (l: Line) => l.length > 1 && l.some((q, i) => i > 0 && (q[0] !== l[0]![0] || q[1] !== l[0]![1]));
  return { kept: [head, tail].filter(real), removed };
}
