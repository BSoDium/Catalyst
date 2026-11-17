/**
 * The projection of a trip's poster (components/trip-map.tsx, #510): not a plate carree (an equirectangular map, which stretches everything away from the equator and made a trip in the north look
 * flat and wide) but a LAMBERT AZIMUTHAL EQUAL-AREA projection centred on the middle of the trip, so the map is drawn as seen from above the trip: nothing is stretched near the middle, areas are
 * true, and the distortion grows only towards the edge of the poster, where the land is faint anyway. A trip that spreads over more than `AZIMUTHAL_LIMIT` degrees from its middle (it would
 * reach the far side of the globe) falls back to the plate carree, shrunk in longitude by the cosine of its middle latitude.
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
}

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

function plate(centre: GeoPoint): Projector {
  const k = Math.cos(centre.lat * RAD);
  return (lon, lat) => ({ x: (lon - centre.lon) * RAD * k, y: (lat - centre.lat) * RAD });
}

/** The frame that fits the trip's `points` in the box `bw` x `bh` at (`bx`, `by`) with `pad` round it, centred in it. */
export function frameOf(points: GeoPoint[], bx: number, by: number, bw: number, bh: number, pad: number): Frame {
  const lons = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
  const lon0 = Math.min(...lons);
  const lon1 = Math.max(...lons);
  const lat0 = Math.min(...lats);
  const lat1 = Math.max(...lats);
  const centre = { lon: (lon0 + lon1) / 2, lat: (lat0 + lat1) / 2 };
  const azimuthalOk = points.every((p) => arc(centre, p) <= AZIMUTHAL_LIMIT);
  const project = azimuthalOk ? azimuthal(centre) : plate(centre);
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
  return {
    at: (lon, lat) => {
      const p = project(lon, lat);
      return p ? { x: offX + (p.x - minX) * scale, y: offY + (maxY - p.y) * scale } : null;
    },
    span: Math.max(lon1 - lon0, lat1 - lat0),
    azimuthal: azimuthalOk,
  };
}
