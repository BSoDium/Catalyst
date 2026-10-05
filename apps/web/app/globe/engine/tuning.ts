/** Tuned constants (see docs/renderer-decision.md for how they were chosen). */
/** Runtime quality state moved by the frame governor (engine/governor.ts): extra CSS px per art pixel. */
export const QUALITY = { cellBoost: 0 };

export const TUNING = {
  /** Size of one art pixel in CSS px, as a function of the smaller viewport side (+1 when the frame governor stepped down). */
  pixelSize(minSide: number, dpr: number): number {
    const base = (minSide < 520 ? 2 : 3) + QUALITY.cellBoost;
    // One art pixel must be a whole number of device pixels, otherwise nearest-neighbour upscaling shimmers
    // on fractional DPRs (Android 2.625, some Windows scales).
    return Math.max(1, Math.round(base * dpr)) / dpr;
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
  /** Zoom used when rotating to a selected place (never zooms out). */
  selectZoom: 3.2,
  /** Zoom from which every label may show (subject to collisions). */
  allLabelsZoom: 3.0,
  /** Route draw-on animation duration, ms. */
  routeDrawMs: 2200,
  /**
   * A marker is hidden, as a whole, once its centre is closer than this to the globe's silhouette, in art pixels
   * (the half-size of the largest marker, so a drawn marker never overhangs the limb).
   */
  markerLimbClearance: 4,
  /** Pick radius in CSS px per pointer type. */
  pickRadius: { mouse: 12, touch: 22 },
  /** Extra hit area around a label in CSS px per pointer type (touch targets reach about 44 px). */
  labelSlop: { mouse: 2, touch: 12 },
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
