/** Pure camera motion: eased flights and drag inertia. No DOM, no GL; time is passed in. */
import {
  DEG,
  angularDistance,
  clamp,
  easeInOutCubic,
  flightDuration,
  shortestLonDelta,
  type ViewState,
} from "./geo";

/**
 * CSS-style `cubic-bezier(x1, y1, x2, y2)` easing: maps time progress t in [0, 1] to eased progress.
 * Newton iterations on the x curve with a bisection fallback (same approach as browsers).
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const slopeX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(u) - t;
      if (Math.abs(err) < 1e-6) return sampleY(u);
      const d = slopeX(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0;
    let hi = 1;
    u = t;
    for (let i = 0; i < 40; i++) {
      const x = sampleX(u);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sampleY(u);
  };
}

export interface Flight {
  from: ViewState;
  /** `to.lon` is unwrapped relative to `from.lon` so the flight takes the short way round. */
  to: ViewState;
  start: number;
  duration: number;
  /** Zoom-out pull-back (zoom units) at mid flight on long hops. */
  dip: number;
  /** Street-scale flight: the pull-back is exactly `dip` below the straight zoom ramp (see `sampleFlight`). */
  street: boolean;
  /** The pan runs between these fractions of the time (0 and 1 = with the zoom). Narrower on flights to or from street scale. */
  panSpan: readonly [number, number];
}

/** Zoom above which a flight is a street-scale flight (the Three.js globe's own maximum). */
const STREET_FLIGHT_FROM = 6.5;
/** Fraction of the flight in which the pan completes when it ends at street scale (the zoom keeps going). */
const STREET_PAN_BY = 0.65;

/**
 * Zoom at which `angleRad` of arc spans roughly a screen of `viewPx` px: the cruise level of a hop. Deeper than this
 * the destination is off screen, so a hop between two street-scale places must pull back at least to it.
 */
export function cruiseZoom(angleRad: number, viewPx: number): number {
  return Math.log2((viewPx * 2 * Math.PI) / (512 * Math.max(angleRad, 1e-7)));
}

export function createFlight(from: ViewState, to: ViewState, now: number, viewPx = 900): Flight {
  const angle = angularDistance(from.lon, from.lat, to.lon, to.lat);
  const street = Math.max(from.zoom, to.zoom) > STREET_FLIGHT_FROM;
  const dz = Math.abs(to.zoom - from.zoom);
  let dip = Math.min(1.4, (angle / Math.PI) * 2.2);
  if (street) dip = Math.max(dip, Math.min(from.zoom, to.zoom) - (cruiseZoom(angle, viewPx) - 0.7));
  return {
    from: { ...from },
    to: { ...to, lon: from.lon + shortestLonDelta(from.lon, to.lon) },
    start: now,
    // World-scale flights keep their duration; street scale adds time per zoom level crossed (about 5 s from the world).
    duration: street ? clamp(900 + 700 * (angle / Math.PI) + 320 * dz, 900, 6500) : flightDuration(angle, to.zoom - from.zoom),
    dip,
    street,
    // Zooming in: the pan is done early (the target stays near the centre while the scale explodes); zooming out: late.
    panSpan: !street || to.zoom === from.zoom ? [0, 1] : to.zoom > from.zoom ? [0, STREET_PAN_BY] : [1 - STREET_PAN_BY, 1],
  };
}

export function sampleFlight(f: Flight, now: number, minZoom: number): { view: ViewState; done: boolean } {
  const t = clamp((now - f.start) / f.duration, 0, 1);
  if (t >= 1) return { view: { ...f.to }, done: true };
  const e = easeInOutCubic(t);
  const [p0, p1] = f.panSpan;
  const ep = p0 === 0 && p1 === 1 ? e : easeInOutCubic(clamp((t - p0) / (p1 - p0), 0, 1));
  const mid = (f.from.zoom + f.to.zoom) / 2;
  const zoomMid = Math.max(minZoom, Math.min(f.from.zoom, f.to.zoom) - f.dip);
  // Quadratic dip towards zoomMid at t = 0.5 while the endpoints stay eased. Over a street-scale zoom range that rule
  // would undershoot far below both ends early on, so there the pull-back is just `dip` off the straight ramp.
  const bump = 4 * e * (1 - e);
  const depth = f.street ? f.dip : Math.max(0, mid - zoomMid);
  return {
    view: {
      lon: f.from.lon + (f.to.lon - f.from.lon) * ep,
      lat: f.from.lat + (f.to.lat - f.from.lat) * ep,
      zoom: f.from.zoom + (f.to.zoom - f.from.zoom) * e - bump * depth,
    },
    done: false,
  };
}

/** Degrees per millisecond. */
export interface Velocity {
  lon: number;
  lat: number;
}

export const STILL: Velocity = { lon: 0, lat: 0 };
export const isStill = (v: Velocity) => v.lon === 0 && v.lat === 0;

export interface DragSample {
  t: number;
  dx: number;
  dy: number;
}

/**
 * Release velocity from the last ~90 ms of drag samples, in degrees per ms, or null when the pointer had
 * stopped (so a slow drag that ends in a rest never "flings"). Speed is capped in px per ms.
 */
export function releaseVelocity(
  samples: readonly DragSample[],
  now: number,
  radiusPx: number,
  latDeg: number,
  capPxPerMs: number,
): Velocity | null {
  const recent = samples.filter((s) => now - s.t < 90);
  if (recent.length < 2) return null;
  const dt = Math.max(16, now - recent[0]!.t);
  const dx = recent.reduce((a, s) => a + s.dx, 0);
  const dy = recent.reduce((a, s) => a + s.dy, 0);
  const cosLat = Math.max(0.15, Math.cos(latDeg * DEG));
  const cap = (v: number) => clamp(v, -capPxPerMs, capPxPerMs);
  const v = { lon: -cap(dx / dt) / (radiusPx * cosLat) / DEG, lat: cap(dy / dt) / radiusPx / DEG };
  return Math.hypot(v.lon, v.lat) * radiusPx * DEG < 0.12 ? null : v;
}

/** Below this speed (px per ms) inertia ends exactly instead of creeping. */
const STOP_PX_PER_MS = 0.01;

export function stepInertia(
  v: Velocity,
  dtMs: number,
  radiusPx: number,
  timeConstantMs: number,
): { move: Velocity; velocity: Velocity } {
  const dt = Math.min(48, Math.max(0, dtMs));
  const move = { lon: v.lon * dt, lat: v.lat * dt };
  const decay = Math.exp(-dt / timeConstantMs);
  const next = { lon: v.lon * decay, lat: v.lat * decay };
  return {
    move,
    velocity: Math.hypot(next.lon, next.lat) * radiusPx * DEG < STOP_PX_PER_MS ? STILL : next,
  };
}
