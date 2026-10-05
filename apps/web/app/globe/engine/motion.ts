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
}

export function createFlight(from: ViewState, to: ViewState, now: number): Flight {
  const angle = angularDistance(from.lon, from.lat, to.lon, to.lat);
  return {
    from: { ...from },
    to: { ...to, lon: from.lon + shortestLonDelta(from.lon, to.lon) },
    start: now,
    duration: flightDuration(angle, to.zoom - from.zoom),
    dip: Math.min(1.4, (angle / Math.PI) * 2.2),
  };
}

export function sampleFlight(f: Flight, now: number, minZoom: number): { view: ViewState; done: boolean } {
  const t = clamp((now - f.start) / f.duration, 0, 1);
  if (t >= 1) return { view: { ...f.to }, done: true };
  const e = easeInOutCubic(t);
  const mid = (f.from.zoom + f.to.zoom) / 2;
  const zoomMid = Math.max(minZoom, Math.min(f.from.zoom, f.to.zoom) - f.dip);
  // Quadratic dip towards zoomMid at t = 0.5 while the endpoints stay eased.
  const bump = 4 * e * (1 - e);
  return {
    view: {
      lon: f.from.lon + (f.to.lon - f.from.lon) * e,
      lat: f.from.lat + (f.to.lat - f.from.lat) * e,
      zoom: f.from.zoom + (f.to.zoom - f.from.zoom) * e - bump * Math.max(0, mid - zoomMid),
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
