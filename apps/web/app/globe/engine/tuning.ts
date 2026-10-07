/** Tuned constants (see docs/renderer-decision.md for how they were chosen). */
/** Runtime quality state moved by the frame governor (engine/governor.ts): extra CSS px per art pixel. */
export const QUALITY = { cellBoost: 0 };

/**
 * THE art pixel: the size in CSS px of one cell of the pixel grid that the globe, the street map and the pixel text all
 * draw on (one constant, shared by both renderers and the labels). Desktop 2.5 (was 3), phones 2: a modest increase in
 * resolution, so the pixel effect is a little less visible and the type has more rows (docs/web-architecture.md, "Art
 * pixel size"). Change THIS to tune it; `pixelSize` below keeps it a whole number of device pixels.
 */
export const ART_PIXEL: { desktop: number; phone: number; phoneBelow: number } = { desktop: 2.5, phone: 2, phoneBelow: 520 };

/** Checks only: `?art-px=N` (or sessionStorage "art-px") overrides the desktop art pixel, on pages in debug mode. Call before the renderers are built. */
export function applyDebugArtPixel(): void {
  try {
    const debug = new URLSearchParams(location.search).has("globe-debug") || sessionStorage.getItem("globe-debug") === "1";
    if (!debug) return;
    const q = new URLSearchParams(location.search).get("art-px") ?? sessionStorage.getItem("art-px");
    const n = Number(q);
    if (q && Number.isFinite(n) && n >= 1 && n <= 6) {
      ART_PIXEL.desktop = n;
      ART_PIXEL.phone = Math.min(ART_PIXEL.phone, n);
    }
  } catch {
    // no storage: keep the default
  }
}

export const TUNING = {
  /**
   * Size of one art pixel in CSS px, as a function of the smaller viewport side (+1 when the frame governor stepped
   * down): `ART_PIXEL`, rounded to a whole number of device pixels, because otherwise nearest-neighbour upscaling shimmers
   * (2.5 is 5 device px at DPR 2 but 2.5 at DPR 1: ties go DOWN, so DPR 1 gets 2 CSS px, never a coarser 3; Android's
   * 2.625 and Windows' 1.25 and 1.5 get the nearest whole device size).
   */
  pixelSize(minSide: number, dpr: number): number {
    const base = (minSide < ART_PIXEL.phoneBelow ? ART_PIXEL.phone : ART_PIXEL.desktop) + QUALITY.cellBoost;
    return Math.max(1, Math.round(base * dpr - 1e-9)) / dpr;
  },
  /**
   * Borders fade in with zoom through the palette's grey levels: not drawn below `start`, the faintest level just above
   * it, one level more every (end - start) / levels of zoom, full ink from `end` (both ways). Zoom = internal globe zoom.
   */
  borderZoom: { start: 3.0, end: 3.5 },
  maxZoom: 6.5,
  /** Street map's maximum MapLibre zoom (STREET_TUNING.maxZoom); the unified camera's range ends there. */
  streetMapMaxZoom: 17.5,
  /** Latitude clamp for the view centre. */
  maxLat: 82,
  /** The globe's lifted route arcs flatten onto the ground between these (internal) zooms, ahead of the handover's dissolve (`routeLift`). */
  routeFlat: { start: 2.5, end: 3.3 },
  /** Zoom used when rotating to a selected place (never zooms out). */
  selectZoom: 3.2,
  /** Route draw-on animation duration, ms. */
  routeDrawMs: 2200,
  /**
   * A marker is hidden, as a whole, once its centre is closer than this to the globe's silhouette, in art pixels
   * (the half-size of the largest marker, so a drawn marker never overhangs the limb).
   */
  markerLimbClearance: 4,
  /** Pick radius in CSS px per pointer type. */
  pickRadius: { mouse: 12, touch: 22 },
  /**
   * Duration (ms) of the globe's re-centring when the right inset appears or disappears. Mirrors `--duration-slow`
   * (the detail panel's slide), together with `INSET_EASE`; `app/lib/tokens.test.ts` keeps them in sync.
   */
  insetMs: 360,
  /** Fraction of the smaller side left empty around the whole globe at minimum zoom. */
  fitMargin: 0.12,
  /** Inertia time constant in ms and the fling speed cap in px per ms. */
  inertiaMs: 320,
  maxFlingPxPerMs: 2.2,
} as const;

/** `cubic-bezier` control points of the app's standard easing (`--ease-standard`). */
export const INSET_EASE = [0.2, 0, 0, 1] as const;
