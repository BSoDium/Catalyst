/**
 * The projection of a trip's poster (components/trip-map.tsx, #510): not a plate carree (an equirectangular map, which stretches everything away from the equator and made a trip in the north look
 * flat and wide) but a LAMBERT AZIMUTHAL EQUAL-AREA projection centred on the middle of the trip, so the map is drawn as seen from above the trip: nothing is stretched near the middle, areas are
 * true, and the distortion grows only towards the edge of the poster, where the land is faint anyway. That map is a disc, though: a trip that is a good part of the globe (Paris to Patagonia) is fitted
 * so small in it that the poster shows the disc's own edge, the whole globe floating on the field. For such a trip (the disc's edge would show, or it reaches the far side of the globe) the map is an
 * EQUAL EARTH world map instead (equal-area too, its edge is the poles', far from any trip), turned to the trip's own longitude so that the seam of the world is at the other side of the globe.
 */
export interface GeoPoint {
  lon: number;
  lat: number;
}

export interface Frame {
  /** The poster's point (CSS px) of a place, or null when it is on the far side of the globe (azimuthal only). */
  at: (lon: number, lat: number) => { x: number; y: number } | null;
  /** The larger side of the trip's box, degrees: how close the map is. */
  span: number;
  azimuthal: boolean;
  /** How many px a degree is on the poster near the middle of the trip: how close the map is (a continent is a few, a country a dozen or more). */
  pxPerDeg: number;
  /** True when the segment between two places crosses the world map's seam (never in the azimuthal one): a line is broken there, not drawn across the map. */
  cuts: (lonA: number, lonB: number) => boolean;
}

/** A trip within this many degrees keeps the azimuthal map (see `frameOf`). */
export const REGION_SPAN = 60;

/** The farthest a trip's point may be from its middle for the azimuthal projection to be used (degrees of arc). */
export const AZIMUTHAL_LIMIT = 100;

const RAD = Math.PI / 180;

/** Great-circle distance in degrees. */
function arc(a: GeoPoint, b: GeoPoint): number {
  const c = Math.sin(a.lat * RAD) * Math.sin(b.lat * RAD) + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
  return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
}

/** A projection of the sphere onto a plane (unit sphere radii), y up; null where it is not defined. */
type Projector = (lon: number, lat: number) => { x: number; y: number } | null;

function azimuthal(centre: GeoPoint): Projector {
  const sin0 = Math.sin(centre.lat * RAD);
  const cos0 = Math.cos(centre.lat * RAD);
  return (lon, lat) => {
    const dl = (lon - centre.lon) * RAD;
    const sin = Math.sin(lat * RAD);
    const cos = Math.cos(lat * RAD);
    const d = 1 + sin0 * sin + cos0 * cos * Math.cos(dl);
    if (d < 0.1) return null;
    const k = Math.sqrt(2 / d);
    return { x: k * cos * Math.sin(dl), y: k * (cos0 * sin - sin0 * cos * Math.cos(dl)) };
  };
}

/** The longitude, in [-180, 180), that puts the trip in the middle of a world map: the middle of the largest stretch of longitudes the trip does NOT cover (so a trip over the antimeridian is whole). */
function middleLon(lons: number[]): number {
  const sorted = [...new Set(lons.map((l) => ((((l + 180) % 360) + 360) % 360) - 180))].sort((a, b) => a - b);
  if (sorted.length < 2) return sorted[0] ?? 0;
  let gap = -1;
  let at = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]! + 360;
    if (next - sorted[i]! > gap) {
      gap = next - sorted[i]!;
      at = i;
    }
  }
  // the trip runs from the point after the gap to the point before it
  const from = at + 1 < sorted.length ? sorted[at + 1]! : sorted[0]! + 360;
  const to = sorted[at]! + 360;
  const mid = (from + to) / 2;
  return ((((mid + 180) % 360) + 360) % 360) - 180;
}

const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Equal Earth (Šavrič, Patterson, Jenny 2018), turned to `lon0`. */
function equalEarth(lon0: number): Projector {
  const A1 = 1.340264;
  const A2 = -0.081106;
  const A3 = 0.000893;
  const A4 = 0.003796;
  const M = Math.sqrt(3) / 2;
  return (lon, lat) => {
    const l = wrap(lon - lon0) * RAD;
    const t = Math.asin(M * Math.sin(lat * RAD));
    const t2 = t * t;
    const t6 = t2 * t2 * t2;
    return { x: (2 * Math.sqrt(3) * l * Math.cos(t)) / (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1)), y: t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) };
  };
}

/**
 * The frame that fits the trip's `points` in the box `bw` x `bh` at (`bx`, `by`) with `pad` round it, centred in it. `view` is the whole poster (the map runs on beyond the box, under the word and the
 * photograph): when the azimuthal map's edge would show in it, the world map is used.
 */
export function frameOf(points: GeoPoint[], bx: number, by: number, bw: number, bh: number, pad: number, view: { w: number; h: number } = { w: bx + bw, h: by + bh }): Frame {
  const lon0 = middleLon(points.map((p) => p.lon));
  const rel = points.map((p) => ({ lon: wrap(p.lon - lon0), lat: p.lat }));
  const lons = rel.map((p) => p.lon);
  const lats = rel.map((p) => p.lat);
  const lonMin = Math.min(...lons);
  const lonMax = Math.max(...lons);
  const lat0 = Math.min(...lats);
  const lat1 = Math.max(...lats);
  const centre = { lon: lon0 + (lonMin + lonMax) / 2, lat: (lat0 + lat1) / 2 };
  const span = Math.max(lonMax - lonMin, lat1 - lat0);

  const fit = (project: Projector) => {
    const projected = points.map((p) => project(p.lon, p.lat)).filter((p): p is { x: number; y: number } => p !== null);
    let minX = Math.min(...projected.map((p) => p.x));
    let maxX = Math.max(...projected.map((p) => p.x));
    let minY = Math.min(...projected.map((p) => p.y));
    let maxY = Math.max(...projected.map((p) => p.y));
    // never a degenerate box: a trip within one city still gets a map of a few kilometres
    const min = 0.08 * RAD;
    if (maxX - minX < min) { const c = (minX + maxX) / 2; minX = c - min / 2; maxX = c + min / 2; }
    if (maxY - minY < min) { const c = (minY + maxY) / 2; minY = c - min / 2; maxY = c + min / 2; }
    const scale = Math.max(1e-9, Math.min((bw - 2 * pad) / (maxX - minX), (bh - 2 * pad) / (maxY - minY)));
    const offX = bx + (bw - (maxX - minX) * scale) / 2;
    const offY = by + (bh - (maxY - minY) * scale) / 2;
    const at = (lon: number, lat: number) => {
      const p = project(lon, lat);
      // (rounded to a hundredth of a px: the trigonometry of the server's JavaScript and the browser's differ in the last digits, and the page the server drew would not match the one the browser draws, a hydration error)
      return p ? { x: Math.round((offX + (p.x - minX) * scale) * 100) / 100, y: Math.round((offY + (maxY - p.y) * scale) * 100) / 100 } : null;
    };
    return { at, scale };
  };

  if (points.every((p) => arc(centre, p) <= AZIMUTHAL_LIMIT)) {
    const f = fit(azimuthal(centre));
    // The disc (radius 2 on the unit sphere) shows its edge when a corner of the poster is beyond it.
    const origin = f.at(centre.lon, centre.lat);
    const reach = origin ? Math.max(...[0, view.w].flatMap((x) => [0, view.h].map((y) => Math.hypot(x - origin.x, y - origin.y)))) : Infinity;
    // A trip that is a region of the globe (a continent, `REGION_SPAN` degrees or less) keeps the azimuthal map whatever the shape of the poster: the world map would draw its land sheared and stretched at that latitude, and the disc's far side is ocean or the other side of the world, far from the trip.
    if (span <= REGION_SPAN || reach <= 1.9 * f.scale) return { at: f.at, span, azimuthal: true, pxPerDeg: f.scale * RAD, cuts: () => false };
  }
  const project = equalEarth(lon0);
  const f = fit(project);
  return { at: f.at, span, azimuthal: false, pxPerDeg: f.scale * RAD, cuts: (a, b) => Math.abs(wrap(a - lon0) - wrap(b - lon0)) > 180 };
}
