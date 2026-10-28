/**
 * Thinning the paths so a region with many trips does not turn into a tangle (owner, 2026-10-20: "Europe is one big mess"). Pure, per zoom.
 *
 * At a zoom the legs are taken in order of importance (the selected place's first, then the longest) and a leg is DROPPED when
 *   - it is shorter on screen than `MIN_CELLS` art pixels (a blob: it reads as noise and returns as soon as it is long enough to read), or
 *   - most of its length lies on cells that kept legs already cover (the same corridor travelled again: a road two trips share, a return trip,
 *     a train and the bus beside it): one line says it.
 * The legs of the selected place are never dropped. From `OFF_ZOOM` on (a city's scale) nothing is dropped: there the lines are far enough apart.
 *
 * "Covered" is worked out on a grid `GRID` art pixels coarse in the Web Mercator pixel plane of that zoom, so lines a pixel or two apart count as one.
 */

type LonLat = readonly [number, number];

export interface ThinLeg {
  key: string;
  /** The leg's pieces (lon, lat), the antimeridian already split. */
  parts: ReadonlyArray<ReadonlyArray<LonLat>>;
  /** The leg is next to the selected place: always kept, and first. */
  lit?: boolean;
  /** The leg is a straight line or an arc (a flight, a leg without a road under it), not a path that follows the ground: `fadeStraight` quietens it up close. */
  straight?: boolean;
}

/** The key of a leg: the route and the position of the leg in it (the street map's source, its filters and the globe's layer all use it). */
export const legKey = (routeId: string, legIndex: number): string => `${routeId}:${legIndex}`;

export const MIN_CELLS = 10;
export const GRID = 4;
export const COVERED = 0.65;
/** Map zoom from which nothing is thinned. */
export const OFF_ZOOM = 9.5;
/** The zoom steps the result is worked out at (a step of the quantised zoom is one thinning). */
export const THIN_STEP = 0.25;

export const thinZoomOf = (zoom: number): number => Math.round(zoom / THIN_STEP) * THIN_STEP;
/**
 * The same, with a hysteresis: the step in force (`current`) is kept until the zoom is `THIN_HYSTERESIS` past the middle between two steps. Without it a zoom
 * hovering at a boundary (a wheel that rests there, a pinch that shakes) thinned the paths again, and put legs on and took them off, at every frame that crossed it.
 */
export const THIN_HYSTERESIS = 0.06;
export function thinZoomFor(zoom: number, current: number | null): number {
  if (current !== null && Math.abs(zoom - current) <= THIN_STEP / 2 + THIN_HYSTERESIS) return current;
  return thinZoomOf(zoom);
}

/**
 * The part of the plane the thinning looks at, in Web Mercator CSS px at the thinning zoom (`x` wraps with the world). The cells a leg covers are only
 * worked out for the segments inside it: the number of cells of a leg doubles with every zoom level (the legs are as long as ever in metres and the cell
 * is a fixed number of pixels), so at a region's scale the whole planet's legs were tens of thousands of cells each (a second of work for 1,500 legs at
 * Mercator zoom 9, on a laptop), and nobody sees but a screen of them. A leg's LENGTH is still the whole leg's, so the order of importance is the same.
 */
export interface ThinWindow {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** How far the window reaches round the view's centre, in views (the larger side of the screen), and the share of a view the centre may move before the window is recentred. */
export const WINDOW_REACH = 1.25;
export const WINDOW_STEP = 0.5;
const WINDOW_SLACK = 0.75;

export interface WindowAnchor {
  ix: number;
  iy: number;
}

/**
 * The window for a view centred at Mercator px (`cx`, `cy`) of a screen `view` px across, at `zoom`, or null when it would take in the whole world (the
 * low zooms, where the thinning is cheap anyway). The centre is a grid point of `WINDOW_STEP` views (a hysteresis: the grid point in force, `current`, stays
 * until the centre is `WINDOW_SLACK` of a step away), so panning recomputes the thinning once per half a screen and not at every frame, and a view
 * is always inside the window by at least `WINDOW_REACH - 0.5 - WINDOW_STEP * WINDOW_SLACK` views (more than a third of a screen).
 */
export function windowFor(cx: number, cy: number, view: number, zoom: number, current: WindowAnchor | null): { window: ThinWindow; anchor: WindowAnchor } | null {
  const world = 512 * 2 ** zoom;
  if (!(view > 0) || 2 * WINDOW_REACH * view >= world) return null;
  const step = WINDOW_STEP * view;
  let ix = Math.round(cx / step);
  let iy = Math.round(cy / step);
  if (current && Math.abs(cx - current.ix * step) <= WINDOW_SLACK * step) ix = current.ix;
  if (current && Math.abs(cy - current.iy * step) <= WINDOW_SLACK * step) iy = current.iy;
  const r = WINDOW_REACH * view;
  return { window: { x0: ix * step - r, y0: iy * step - r, x1: ix * step + r, y1: iy * step + r }, anchor: { ix, iy } };
}

/** The centre of a lon/lat in Web Mercator CSS px at `zoom` (what `ThinWindow` is in). */
export const mercatorPx = (lon: number, lat: number, zoom: number): [number, number] => px([lon, lat], zoom);

/** Web Mercator, CSS px at `zoom` (512 px tiles, as the street map's). */
function px(p: LonLat, zoom: number): [number, number] {
  const s = 512 * 2 ** zoom;
  const lat = Math.max(-85.0511, Math.min(85.0511, p[1]));
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((p[0] + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
}

/** Whether the box of a segment (Mercator px, x wrapping every `world`) meets the window. */
function meets(w: ThinWindow, world: number, ax: number, ay: number, bx: number, by: number, pad: number): boolean {
  if (Math.max(ay, by) < w.y0 - pad || Math.min(ay, by) > w.y1 + pad) return false;
  const lo = Math.min(ax, bx);
  const hi = Math.max(ax, bx);
  for (let k = -1; k <= 1; k++) if (hi >= w.x0 + k * world - pad && lo <= w.x1 + k * world + pad) return true;
  return false;
}

/** The coarse cells a leg passes through (inside `win`, when there is one) and its length in art pixels (the whole leg's). */
function cellsOf(leg: ThinLeg, zoom: number, cellCss: number, win: ThinWindow | null): { cells: Set<number>; length: number } {
  const g = cellCss * GRID;
  const world = 512 * 2 ** zoom;
  const cells = new Set<number>();
  let length = 0;
  for (const part of leg.parts) {
    let [ax, ay] = part.length ? px(part[0]!, zoom) : [0, 0];
    for (let i = 1; i < part.length; i++) {
      const [bx, by] = px(part[i]!, zoom);
      const d = Math.hypot(bx - ax, by - ay);
      length += d / cellCss;
      if (!win || meets(win, world, ax, ay, bx, by, g)) {
        const n = Math.max(1, Math.ceil(d / (g * 0.5)));
        for (let k = 0; k <= n; k++) {
          const cx = Math.floor((ax + ((bx - ax) * k) / n) / g);
          const cy = Math.floor((ay + ((by - ay) * k) / n) / g);
          cells.add(cx * 1_000_003 + cy);
        }
      }
      ax = bx;
      ay = by;
    }
  }
  return { cells, length };
}

/** The keys of the legs that stay at `zoom` (null: all of them). `cellCss` is the art pixel in CSS px; `win`: the part of the plane that is worked out (a leg with no cell in it is kept: it is not on the screen). */
export function thinLegs(legs: readonly ThinLeg[], zoom: number, cellCss: number, win: ThinWindow | null = null): Set<string> | null {
  if (zoom >= OFF_ZOOM || !(cellCss > 0)) return null;
  const measured = legs.map((leg) => ({ leg, ...cellsOf(leg, zoom, cellCss, win) }));
  measured.sort((a, b) => Number(!!b.leg.lit) - Number(!!a.leg.lit) || b.length - a.length);
  const kept = new Set<string>();
  const covered = new Set<number>();
  for (const m of measured) {
    if (!m.leg.lit) {
      if (m.length < MIN_CELLS) continue;
      let on = 0;
      for (const c of m.cells) if (covered.has(c)) on++;
      if (m.cells.size > 0 && on / m.cells.size >= COVERED) continue;
    }
    kept.add(m.leg.key);
    for (const c of m.cells) covered.add(c);
  }
  return kept;
}

/**
 * Straight lines (a flight, an arc: nothing under them) are a feature of the far view; up close they cut across every road and every box (owner,
 * 2026-10-21). So they quieten with how much of the screen they take, not with the zoom alone: a leg whose endpoints are up to `STRAIGHT_FADE_FROM`
 * screens apart is drawn as it is (a short flight, Minsk to Moscow, stays readable at the zoom that fits it), from there to `STRAIGHT_FADE_TO` screens it
 * steps through `STRAIGHT_FADE_STEPS` tones toward the page colour (solid, never an opacity), the last `STRAIGHT_FADE_MIX` of the way.
 * The legs of the selected place (`lit`) are never quietened.
 */
export const STRAIGHT_FADE_FROM = 1;
export const STRAIGHT_FADE_TO = 3;
export const STRAIGHT_FADE_STEPS = 3;
export const STRAIGHT_FADE_MIX = 0.8;

/** The step (0 as it is .. `STRAIGHT_FADE_STEPS`) of a straight leg `span` CSS px between its ends in a view `view` CSS px across (its larger side). */
export function straightFadeLevel(span: number, view: number): number {
  if (!(view > 0)) return 0;
  const t = (span / view - STRAIGHT_FADE_FROM) / (STRAIGHT_FADE_TO - STRAIGHT_FADE_FROM);
  return t <= 0 ? 0 : Math.min(STRAIGHT_FADE_STEPS, Math.ceil(t * STRAIGHT_FADE_STEPS - 1e-9));
}

/** The quietened straight legs at a Web Mercator `zoom`, by key, with their step; null when none is. `view` is the larger side of the view in CSS px. */
export function fadeStraight(legs: readonly ThinLeg[], zoom: number, view: number): Map<string, number> | null {
  let out: Map<string, number> | null = null;
  const world = 512 * 2 ** zoom;
  for (const leg of legs) {
    if (!leg.straight || leg.lit) continue;
    const first = leg.parts[0]?.[0];
    const lastPart = leg.parts[leg.parts.length - 1];
    const last = lastPart?.[lastPart.length - 1];
    if (!first || !last) continue;
    const [ax, ay] = px(first, zoom);
    const [bx, by] = px(last, zoom);
    const dx = Math.abs(bx - ax);
    const level = straightFadeLevel(Math.hypot(Math.min(dx, world - dx), by - ay), view);
    if (level > 0) (out ??= new Map()).set(leg.key, level);
  }
  return out;
}
