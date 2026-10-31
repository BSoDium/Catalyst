/**
 * Encoded polyline, precision 5 (the "Google polyline" algorithm): the format of `routes[].legs[].polyline`.
 *
 * Points are `[lat, lon]` pairs in degrees; each coordinate is stored as the difference to the previous point in
 * units of 1e-5 degrees (about 1.1 m), zig-zag encoded and written in 5-bit chunks from ASCII 63 (`?`) upwards.
 * The private export has its own encoder; this module is the reference decoder used by the contract's checks and by
 * the tests that pin the format (the web app carries a copy of the decoder, `apps/web/app/globe/paths/polyline.ts`).
 */

export type LatLon = readonly [lat: number, lon: number];

/** Largest magnitude a decoded coordinate may reach, in 1e-5 degrees (180 degrees; latitudes are checked separately). */
const MAX_UNITS = 180 * 1e5;

/**
 * Decodes a precision-5 polyline. Returns `null` for a string that is not one: a character outside `?`..`~`, a value
 * that does not end, an odd number of values, a coordinate out of range, or fewer than `minPoints` points.
 */
export function decodePolyline5(encoded: string, minPoints = 2): LatLon[] | null {
  const out: LatLon[] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const n = encoded.length;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (i >= n) return null;
      const c = encoded.charCodeAt(i++) - 63;
      if (c < 0 || c > 63) return null;
      result += (c & 0x1f) * 2 ** shift;
      shift += 5;
      if (shift > 35) return null;
      if (c < 0x20) break;
    }
    return result % 2 === 1 ? -(result + 1) / 2 : result / 2;
  };
  while (i < n) {
    const dLat = next();
    const dLon = next();
    if (dLat === null || dLon === null) return null;
    lat += dLat;
    lon += dLon;
    if (Math.abs(lat) > 90 * 1e5 || Math.abs(lon) > MAX_UNITS) return null;
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out.length >= minPoints ? out : null;
}

/** Encodes points as a precision-5 polyline (coordinates are rounded to 5 decimals). */
export function encodePolyline5(points: readonly LatLon[]): string {
  let out = "";
  let pLat = 0;
  let pLon = 0;
  const put = (delta: number) => {
    let v = delta < 0 ? -2 * delta - 1 : 2 * delta;
    while (v >= 0x20) {
      out += String.fromCharCode(((v % 0x20) | 0x20) + 63);
      v = Math.floor(v / 0x20);
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lat, lon] of points) {
    const a = Math.round(lat * 1e5);
    const b = Math.round(lon * 1e5);
    put(a - pLat);
    put(b - pLon);
    pLat = a;
    pLon = b;
  }
  return out;
}

/**
 * The earth's mean radius in kilometres (IUGG): the ONE value of the repository's spherical maths (this file's distance, the web app's
 * framing and lines, `lib/projection.ts`' view radii). This module has no dependency, so the browser bundle may import it
 * (`@catalyst/schemas/polyline`) without the schema library.
 */
export const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance between two points in kilometres (spherical earth, mean radius). */
export function haversineKm(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
