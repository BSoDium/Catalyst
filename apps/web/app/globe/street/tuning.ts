/**
 * Street map constants. Everything that also exists on the globe is READ from the globe's tuning so the two never
 * diverge (art pixel size, marker/label hit slop, inset animation, latitude clamp); the rest is street specific.
 */
import { TUNING } from "../engine/tuning";

export const STREET_TUNING = {
  /** Art pixel size in CSS px: 3 on desktop, 2 below 520 px, a whole number of device px (the globe's rule). */
  pixelSize: TUNING.pixelSize,
  /** Hit slop around labels and markers in CSS px per pointer type (the globe's values). */
  labelSlop: TUNING.labelSlop,
  pickRadius: TUNING.pickRadius,
  /** Duration (ms) of the centre shift when the right inset appears or disappears (the globe's value). */
  insetMs: TUNING.insetMs,
  maxLat: TUNING.maxLat,
  /** A marker is hidden, as a whole, closer than this to the globe silhouette, in art pixels (the globe's value). */
  markerLimbClearance: TUNING.markerLimbClearance,
  /** MapLibre zoom range of the street map. 17.5 over-zooms OpenFreeMap (z14) and the fallback cleanly. */
  minZoom: 2,
  maxZoom: TUNING.streetMapMaxZoom,
  /** Zoom from which every label may show (subject to collisions); below it a priority floor applies. */
  allLabelsZoom: 8,
  /** Marker sizes in art pixels (same sizes as the globe's GL points: normal 3, focused 7, selected 9). */
  markerCells: { normal: 3, focused: 7, selected: 9 },
  /** Sharp reveal: radius is `min(revealMaxCss, revealFraction * min(width, height))`; the edge feathers by 40%. */
  revealMaxCss: 280,
  revealFraction: 0.34,
  /** Default duration (ms) of the reveal and of the animated dissolve. */
  revealMs: 700,
  dissolveMs: 900,
  /**
   * Native art-resolution render: map pixels per art cell along each axis. 3 is the smallest that keeps the line rules of
   * docs/pixel-line-rules.md (the line gate, `pnpm test:street-lines`): the classify sample is then exactly one texel, a
   * 1-cell line is 3 px wide and a dotted line keeps its dashes. 2 samples the average of a 2x2 block, which softens short
   * dashes (dotted roads lose up to a fifth of their cells and the 2x2-block check fails); 1 loses them. The frame
   * governor (engine/governor.ts) steps to 2 on slow devices. Costs 9 map pixels per cell, against 36 for the
   * device-resolution render at DPR 2.
   */
  renderScale: 3,
  /**
   * Snap the map centre to the art cell grid while the zoom is steady (a pan, its inertia), so the picture translates by
   * whole cells and thin lines do not crawl (core/snap.ts). From this map zoom up (below it the globe projection is not
   * Mercator and the snap would be off); 0 disables.
   */
  snapPanFromZoom: 12,
  /** Zoom the map is capped at when no tile source works (bundled coastline and borders only). */
  cappedMaxZoom: 6,
  /** Default camera flight duration bounds (ms). */
  flightMinMs: 900,
  flightMaxMs: 6500,
} as const;
