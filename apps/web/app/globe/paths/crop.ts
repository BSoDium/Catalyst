/**
 * A path ends where it meets the box of its stops (pure, unit tested). The box of a place is drawn, and a path plugs into its edge instead of running
 * on to the place's middle: the same for every mode. The content repository already cuts the published ROAD polylines like that (a leg may end "on the
 * edge of the stop's bbox", packages/schemas published.ts); the other modes (a flight's arc, the great circle of a leg without a polyline, a rail or ferry
 * polyline the repository does not cut) used to run through the box to the recorded point, which looked odd next to the roads. `cropToBoxes` is applied
 * to EVERY leg by both renderers (`network.ts` for the globe, `leg-features.ts` for the street map), so the one rule cannot drift between them, and it
 * is idempotent: a road already cut at the edge ends ON the edge (or one polyline unit outside it), which is not "inside", so it is left as it is.
 *
 * The crop is done on the GROUND track (longitude, latitude), where the box is a rectangle, and not on the screen: the boxes are drawn in screen space
 * at the local scale of the camera, which is the same rectangle seen from above, but a screen-space cut would have to be redone at every camera move
 * and would differ between the two maps. A lifted arc (a flight on the globe) is cut at the point of the ground track that meets the edge, and the lift
 * is then re-based so that the cut end sits ON the surface, at the box edge, as a road does: a plane trail that stayed at its lifted height there
 * would hover above the edge by up to a few hundred km on a large box (the lift grows with the distance from the stop), and would not touch the
 * rectangle drawn under it. Re-basing subtracts the straight line (by distance along the path) between the lifts of the two new ends: the arch is
 * concave, so it stays above the surface and keeps its shape; a leg with no lift (the street map, a road) is untouched.
 */

/** `[west, south, east, north]`, degrees (the place's published `bbox`; never across the antimeridian). */
export type CropBox = readonly [number, number, number, number];

export interface CroppedPath {
  /** `[lon, lat, ...]`, degrees. */
  lonlat: Float64Array;
  /** Height above the surface per point, re-based so that a cut end is on the ground. */
  lift: Float32Array;
}

/** The longitude of `lon` seen from the frame whose reference is `ref`: the same meridian, within 180 degrees of it. */
const near = (lon: number, ref: number) => lon - 360 * Math.round((lon - ref) / 360);

/**
 * The index and the exit parameter of the path leaving `box`: the path STARTS strictly inside it, and this is the first segment `[i - 1, i]` whose end is
 * on the edge or outside. `t` is where on that segment it meets the edge (0..1). null: the start is not inside (nothing to cut), or the path never
 * leaves (`all: true`: the whole path lies in the box).
 */
function firstExit(x: ArrayLike<number>, y: ArrayLike<number>, box: CropBox): { i: number; t: number; edge: "x" | "y" | null; at: number } | "outside" | "all" {
  const [w, s, e, n] = box;
  const inside = (k: number) => x[k]! > w && x[k]! < e && y[k]! > s && y[k]! < n;
  if (!inside(0)) return "outside";
  for (let i = 1; i < x.length; i++) {
    if (inside(i)) continue;
    const px = x[i - 1]!, py = y[i - 1]!, dx = x[i]! - px, dy = y[i]! - py;
    // the smallest t at which the segment reaches an edge it is heading for
    let t = 1;
    let edge: "x" | "y" | null = null;
    let at = 0;
    if (dx > 0 && x[i]! >= e) { const u = (e - px) / dx; if (u <= t) { t = u; edge = "x"; at = e; } }
    if (dx < 0 && x[i]! <= w) { const u = (w - px) / dx; if (u <= t) { t = u; edge = "x"; at = w; } }
    if (dy > 0 && y[i]! >= n) { const u = (n - py) / dy; if (u < t) { t = u; edge = "y"; at = n; } }
    if (dy < 0 && y[i]! <= s) { const u = (s - py) / dy; if (u < t) { t = u; edge = "y"; at = s; } }
    return { i, t: Math.max(0, Math.min(1, t)), edge, at };
  }
  return "all";
}

interface Track {
  x: Float64Array;
  y: Float64Array;
  h: Float32Array;
}

/** The path without its start inside `box` (the new first point is ON the edge, exactly), or `outside` (the start is not inside) / `all` (it never leaves). */
function cutStart(t: Track, box: CropBox): Track | "outside" | "all" {
  const ex = firstExit(t.x, t.y, box);
  if (ex === "outside" || ex === "all") return ex;
  const { i, t: u, edge, at } = ex;
  // a path that leaves exactly through a vertex on the edge starts at that vertex, not at a duplicate of it
  const atVertex = u >= 1 - 1e-12;
  const extra = atVertex ? 0 : 1;
  const keep = t.x.length - i + extra;
  const out: Track = { x: new Float64Array(keep), y: new Float64Array(keep), h: new Float32Array(keep) };
  if (!atVertex) {
    const px = t.x[i - 1]!, py = t.y[i - 1]!, ph = t.h[i - 1]!;
    out.x[0] = edge === "x" ? at : px + (t.x[i]! - px) * u;
    out.y[0] = edge === "y" ? at : py + (t.y[i]! - py) * u;
    out.h[0] = ph + (t.h[i]! - ph) * u;
  }
  for (let k = i; k < t.x.length; k++) {
    out.x[k - i + extra] = t.x[k]!;
    out.y[k - i + extra] = t.y[k]!;
    out.h[k - i + extra] = t.h[k]!;
  }
  return out;
}

const flip = (t: Track): Track => ({ x: t.x.slice().reverse(), y: t.y.slice().reverse(), h: t.h.slice().reverse() });

/** Cut one end (`head` or `tail`) of the track at `box`; the longitudes are moved next to the box for the test and back after. */
function cutEnd(t: Track, box: CropBox, head: boolean): Track | "outside" | "all" {
  const end = head ? t.x[0]! : t.x[t.x.length - 1]!;
  const d = near(end, (box[0] + box[2]) / 2) - end;
  const shifted: Track = { x: t.x.map((v) => v + d), y: t.y, h: t.h };
  const r = cutStart(head ? shifted : flip(shifted), box);
  if (r === "outside" || r === "all") return r;
  const back = head ? r : flip(r);
  return { x: back.x.map((v) => v - d), y: back.y, h: back.h };
}

/**
 * The path `lonlat` (`[lon, lat, ...]`) with `lift` (one height per point, or null for a path on the ground) cropped to the outside of the box of its
 * first stop (`from`) and of its last (`to`): what is left starts and ends ON the box edge, where the path leaves the first box and enters the last.
 * A box that does not contain the end of the path leaves that end as it is (a stop whose recorded point lies outside its box, a leg that already
 * ends on the edge, a stop with no box). null: nothing is left outside (a leg that stays inside its box, or between two overlapping ones): nothing to draw.
 * A path that no box touches comes back as it was (same numbers).
 */
export function cropToBoxes(lonlat: ArrayLike<number>, lift: ArrayLike<number> | null, from?: CropBox, to?: CropBox): CroppedPath | null {
  const n = lonlat.length / 2;
  if (n < 2) return null;
  // longitudes continuous along the path (no jump over the antimeridian)
  let t: Track = { x: new Float64Array(n), y: new Float64Array(n), h: new Float32Array(n) };
  for (let k = 0; k < n; k++) {
    t.x[k] = k === 0 ? lonlat[0]! : near(lonlat[k * 2]!, t.x[k - 1]!);
    t.y[k] = lonlat[k * 2 + 1]!;
    t.h[k] = lift ? lift[k]! : 0;
  }
  let cut = false;
  for (const [box, head] of [[from, true], [to, false]] as const) {
    if (!box) continue;
    const r = cutEnd(t, box, head);
    if (r === "all") return null;
    if (r === "outside") continue;
    t = r;
    cut = true;
  }
  if (!cut) return { lonlat: Float64Array.from(lonlat), lift: Float32Array.from(lift ?? new Float32Array(n)) };
  const m = t.x.length;
  // nothing but a point is left
  let moved = false;
  for (let k = 1; k < m && !moved; k++) moved = t.x[k] !== t.x[0] || t.y[k] !== t.y[0];
  if (m < 2 || !moved) return null;
  const out = new Float64Array(m * 2);
  for (let k = 0; k < m; k++) {
    out[k * 2] = Math.abs(t.x[k]!) > 180 ? near(t.x[k]!, 0) : t.x[k]!;
    out[k * 2 + 1] = t.y[k]!;
  }
  // the lift re-based: the straight line between the two ends' heights (by distance along the ground track) is taken off, so both ends are on the ground
  const outLift = new Float32Array(m);
  if (t.h[0] !== 0 || t.h[m - 1] !== 0) {
    const dist = new Float64Array(m);
    for (let k = 1; k < m; k++) dist[k] = dist[k - 1]! + Math.hypot(t.x[k]! - t.x[k - 1]!, t.y[k]! - t.y[k - 1]!);
    const total = dist[m - 1]! || 1;
    for (let k = 0; k < m; k++) outLift[k] = Math.max(0, t.h[k]! - (t.h[0]! + (t.h[m - 1]! - t.h[0]!) * (dist[k]! / total)));
  } else {
    outLift.set(t.h);
  }
  return { lonlat: out, lift: outLift };
}
