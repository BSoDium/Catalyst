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
   * Country borders are ON from `on` (internal globe zoom) and OFF below, with a hysteresis of `band` each side; the fade between the two
   * states is a timed tone ramp through the palette's grey levels (`FADE_MS`), not a function of zoom. The middle of the old ramp (3.0 to
   * 3.5); the street cut is at 3.7, so the borders are at their peak level well before it.
   */
  borderZoom: { on: 3.25, band: 0.05 },
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

/**
 * The skybox (engine/sky.ts, engine/sky-layer.ts; docs/web-architecture.md "Skybox", docs/design-tokens.md "Sky"): the Milky Way and a sparse
 * star field behind the earth, a few palette levels BELOW the graticule (`faint`), faded to the page colour towards the earth's silhouette.
 * Angles in degrees, radii in earth radii on screen (1 = the silhouette), tones as palette levels (`skyTop`), densities as fractions.
 */
export const SKY = {
  /**
   * The earth rotation angle at load (GMST, degrees): the right ascension of the Greenwich meridian. It is a fixed number so the sky is the
   * same on every visit; it is the ONLY thing that places the sky relative to the earth. The idle rotation adds to it (renderer `era`), a
   * camera orbit does not. Chosen so the opening view (lon 15, lat 28) has the band crossing the wings of the globe on a slant.
   */
  eraDeg: 70,
  /** Seed of every random choice of the sky (noise lattice, star positions, tiers and keep ranks). */
  seed: 0x5ca1ab1e,
  /** The baked band map in galactic coordinates: `cols` over longitude 0..360, `rows` over latitude +-`bMaxDeg` (zero beyond). */
  map: { cols: 256, rows: 64, bMaxDeg: 45 },
  band: {
    /** Brightest value the map reaches (0..1 of the top tone): the galactic centre. */
    gain: 0.9,
    /** The band's brightness and thickness fall off from the galactic centre with this width (degrees of galactic longitude). */
    centreSpreadDeg: 55,
    /** Half-thickness (1 sigma, degrees of galactic latitude) at the anticentre and at the galactic centre. */
    thicknessDeg: { edge: 5.5, core: 10 },
    /** Brightness at the anticentre and at the galactic centre (0..1 of `gain`). */
    brightness: { edge: 0.5, core: 1 },
    /** The nuclear bulge: an extra blob on the galactic centre. */
    bulge: { sigmaDeg: 7, share: 0.5 },
    /** The Great Rift: a dust lane along the band, wavy, from galactic longitude `fromDeg` to `toDeg`. */
    rift: { fromDeg: -25, toDeg: 80, widthDeg: 2.6, depth: 0.8, waveDeg: 1.8, wavePeriodDeg: 55 },
    /** Coarse value noise (octaves: frequency per radian, weight): mottling, and dust breaks where it dips below `breakBelow`. */
    noise: { octaves: [[7, 0.6], [15, 0.3], [34, 0.1]] as const, floor: 0.5, breakBelow: 0.34, breakDepth: 0.75 },
  },
  stars: {
    count: 20000,
    /** Star density along the band relative to the sky away from it (1 = no preference): "slightly more of them along the band". */
    bandBoost: 1.8,
    /**
     * The shares of the stars at the three star tones, faintest first: palette levels 1 and `skyTop` (the band's two tones) and the
     * graticule's `faint` level, the brightest anything in the sky gets (`starTop`, a cap: the boxes, labels and the graticule's own
     * dots are never outshone). A heavy tail: many faint, some middling, a few brighter (each tier about 2 times rarer than the one
     * below). Sums to 1. Owner (2026-10-08): "not super bright, just a bit brighter", to add noise to the band and to the open sky.
     */
    tierShares: [0.6, 0.28, 0.12] as const,
  },
  /**
   * The sky is dimmed, never removed, towards the earth: it is drawn right up to the silhouette (`from` 1) at `limb` of its strength (a
   * slight dimming, enough that the horizon outline, a quiet ring of its own, keeps its contrast) and eases up to its full
   * strength at `to` earth radii from the centre of the globe (smoothstep). The band's brightness is scaled by it before the dither, and
   * a star is kept while the factor exceeds its fixed random rank (a thinning of the field, never a dimmer star).
   */
  fade: { from: 1, to: 1.55, limb: 0.55 },
  /** The sky is on while the farthest corner of the picture is more than `rho` radii from the globe's centre (off when it comes within `rho - band`, on again at `rho + band`): a binary state with a hysteresis, its fade runs by time. */
  onRho: { rho: 1.75, band: 0.05 },
} as const;

/** `cubic-bezier` control points of the app's standard easing (`--ease-standard`). */
export const INSET_EASE = [0.2, 0, 0, 1] as const;
