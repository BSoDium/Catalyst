/**
 * How flat the view is (pure, unit tested): the one measure the street map uses to decide between the graticule and the sea texture.
 *
 * The street map is a MapLibre GLOBE until its zoom 12, so for a long stretch of zoom the earth is visibly curved on screen. The sea
 * texture (short horizontal dashes in rows, anchored to the screen) only reads as water on a flat picture; on a curved earth it flattens
 * it ("a weird flat look"), and the parallels and meridians are what say "this is a sphere". So the graticule stays until the view is
 * close to flat and only then gives way to the sea texture, in one binary switch (a timed cross-fade by the temporal ease, not a ramp
 * over zoom). The graticule gives way exactly when the texture comes (`style/layer-switch.ts`): where the tiles do not reach the texture yet (the Protomaps fallback hands over at 8.5, so the texture comes at 9.2) a flat view keeps its graticule.
 *
 * "Close to flat" is measured on the screen, not as a bare zoom number: the BULGE is the height in CSS px by which the surface at the
 * top or bottom edge of the view falls away from the plane through the centre, `(h / 2)^2 / (2 R)` for a view `h` px high and a globe of
 * apparent radius `R` px (`zoomToRadiusPx` of the unified zoom, which already folds the latitude in: the same number on the globe and
 * on the map). It halves with every zoom level (so the switch is sharp in zoom terms) and it scales with the viewport (a tall screen
 * sees more curvature at the same zoom, a phone less). The switch has a hysteresis band: flat below `FLAT.flatPx`, curved again above
 * `FLAT.curvedPx`.
 */
import { zoomToRadiusPx } from "../../engine/geo";
import { hysteresis } from "../../engine/fade";

/** Bulge thresholds in CSS px: the view becomes flat at or below `flatPx` and curved again at or above `curvedPx`. */
export const FLAT = { flatPx: 4, curvedPx: 6 } as const;

/** The bulge in CSS px of a view `viewHeightPx` high at a unified (globe) zoom (`registerMapToGlobe`: a MapLibre zoom plus `-log2 cos(lat)`). */
export const bulgePx = (unifiedZoom: number, viewHeightPx: number): number => {
  const half = viewHeightPx / 2;
  return (half * half) / (2 * zoomToRadiusPx(unifiedZoom));
};

/** Whether the view is flat now, given whether it was: a hysteresis on the bulge. */
export const isFlat = (wasFlat: boolean, unifiedZoom: number, viewHeightPx: number): boolean =>
  // `hysteresis(was, value, low, high)` is on at or above `high`: here "curved" is on above `curvedPx` and off below `flatPx`
  !hysteresis(!wasFlat, bulgePx(unifiedZoom, viewHeightPx), FLAT.flatPx, FLAT.curvedPx);

/** The unified zoom at which a view `viewHeightPx` high becomes flat (the bulge falls to `FLAT.flatPx`). */
export const flatZoom = (viewHeightPx: number): number => {
  const half = viewHeightPx / 2;
  const radius = (half * half) / (2 * FLAT.flatPx);
  return Math.log2((radius * 2 * Math.PI) / 512);
};
