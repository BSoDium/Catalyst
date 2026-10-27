/**
 * The satellite ground of the street map: NASA's Blue Marble (GIBS, `BlueMarble_ShadedRelief_Bathymetry`, public domain), read through the palette like every
 * other fill. The tile is never shown as a picture: each of its pixels is classified here into the style's FILL encoding (core/palette.ts: R = G = 0, B = level), the
 * sea to the page colour and the land to one of three flat tones by how bright the ground is, the same cuts-and-tones idea as the globe's picture
 * (`surfaceMaterial`, engine/materials.ts), so the ground stays as it was while the camera goes from the globe to the map. MapLibre draws the tile
 * with nearest resampling (style/street-style.ts), so the codes reach the pixel pass exactly; the pass then lights its art cells like any flat fill.
 */
import { roleLevel } from "./palette";

/** The GIBS tile URL template of the layer (Web Mercator, 256 px tiles, levels 0..8: past that the map over-zooms them, into the big flat patches of the art). */
export const SATELLITE_TILES = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg";
export const SATELLITE_MAXZOOM = 8;
export const SATELLITE_TILE_SIZE = 256;

/** Brightness (0..1, Rec. 601) cuts of the land: darker ground under the first, middle under the second, lighter above. The shaded relief is dark, so they sit low. */
export const SATELLITE_CUTS = [0.16, 0.25] as const;

/** The level of each tone, darkest ground first: dark ground is the louder step, the lightest is the page's colour (the palette has no room under `wash`). */
export function satelliteLevels(): readonly [number, number, number] {
  const wash = roleLevel("wash");
  return [wash + 1, wash, 0];
}

/** Whether a pixel is sea: blue over red and green, and not bright (ice and cloud are bluish white). */
export function isSea(r: number, g: number, b: number): boolean {
  return b > r * 1.15 && b > g * 1.05 && 0.299 * r + 0.587 * g + 0.114 * b < 190;
}

/** The level of a pixel: 0 (the page's colour) for the sea, else its tone's. */
export function satelliteLevel(r: number, g: number, b: number, levels: readonly number[] = satelliteLevels()): number {
  if (isSea(r, g, b)) return 0;
  const v = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return v < SATELLITE_CUTS[0] ? levels[0]! : v < SATELLITE_CUTS[1] ? levels[1]! : levels[2]!;
}

/** Rewrite RGBA pixels in place into the fill encoding (`fillColor`: R = G = 0, B = level, opaque). */
export function classifySatellite(rgba: Uint8ClampedArray, levels: readonly number[] = satelliteLevels()): void {
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const level = satelliteLevel(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!, levels);
    rgba[i] = 0;
    rgba[i + 1] = 0;
    rgba[i + 2] = level;
    rgba[i + 3] = 255;
  }
}
