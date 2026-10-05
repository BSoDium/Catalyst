/**
 * Pan snapping: while the zoom does not change, the map centre is moved to the nearest multiple of the art cell, in Web
 * Mercator world pixels (the unit MapLibre lays tiles out in: 512 * 2^zoom across, CSS px). The screen position of every
 * feature is then the same fraction of a cell at every frame, whatever the pan.
 *
 * Why: the art image is a sampling of the map on the cell grid. Move the map by a fraction of a cell and every line is
 * sampled at a different phase, so thin lines and dashes crawl and flicker while panning (a drag, a fling's inertia).
 * Move it by whole cells and each cell shows exactly what its neighbour showed one step before: the picture translates
 * rigidly, like a pixel-art scroll. The cost is a lag of at most half a cell (1.5 to 3 CSS px) behind the pointer.
 *
 * What cannot be snapped: a zoom change (every feature moves by a different amount: there is no common translation,
 * the picture is re-sampled whatever the centre is) and, were it enabled, a rotation. The snap therefore applies while the
 * zoom is steady; it also settles the image on the grid when a zoom ends.
 */
const TILE = 512;

export interface LonLat {
  lon: number;
  lat: number;
}

const D2R = Math.PI / 180;

/** Web Mercator world pixels (CSS px, origin top-left of the world) at `zoom`. */
export function worldPx(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const W = TILE * 2 ** zoom;
  const sin = Math.min(0.9999, Math.max(-0.9999, Math.sin(lat * D2R)));
  return { x: ((lon + 180) / 360) * W, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * W };
}

export function fromWorldPx(x: number, y: number, zoom: number): LonLat {
  const W = TILE * 2 ** zoom;
  return { lon: (x / W) * 360 - 180, lat: (2 * Math.atan(Math.exp(Math.PI * (1 - (2 * y) / W))) - Math.PI / 2) / D2R };
}

/** The centre snapped to the cell grid in world pixels (`cell` in CSS px of the map). */
export function snapCenter(lon: number, lat: number, zoom: number, cell: number): LonLat {
  if (!(cell > 0)) return { lon, lat };
  const p = worldPx(lon, lat, zoom);
  return fromWorldPx(Math.round(p.x / cell) * cell, Math.round(p.y / cell) * cell, zoom);
}
