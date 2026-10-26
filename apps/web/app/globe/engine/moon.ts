/**
 * The moon (docs/landing.md, "The moon"): a small pixel-art body that circles the planet on the home screen and is a link to the archived
 * first version of the site. The maths here is pure (no DOM, no three): where it is on the screen for a given time, whether the planet hides
 * it, what it is drawn as. `moon-overlay.ts` puts it on the page.
 *
 * It is drawn on the screen, not in the scene: an ellipse about the planet's centre, sized from the silhouette's radius in px, so it holds at
 * every window shape (the bounding box of the ellipse is kept inside the window) and the planet's own zoom is the only thing that sends it away.
 * One half of the orbit is "in front" (it is a little larger, and over the planet) and the other "behind" (the planet hides it, softly at the limb).
 */
import { clamp } from "./geo";
import { SURFACE } from "./surface";

/** GLSL's `smoothstep`: 0 at or below `e0`, 1 at or above `e1`, smooth between. */
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const MOON = {
  /** The Earth's tone steps (`SURFACE.tones`) times this: a ground that is a whole planet can be a faint wash, a thing 30 px across that is a link must still show its maria. */
  toneBoost: 3.4,
  /** The Moon's picture: grey, 256 x 128, baked from a map of the near side (scripts/moon/bake-moon.py, public/media/moon-grey.NOTICE.txt). */
  mapUrl: "/media/moon-grey.png",
  /** One turn, ms: slow enough to be a calm thing at the edge of the picture, fast enough to be seen to move. */
  periodMs: 90_000,
  /** Where it is when it does not move (reduced motion, a frozen page), degrees: in front, to the right of the planet. */
  restDeg: 38,
  /** Where a fresh page starts it, degrees: coming round the left of the planet. */
  startDeg: 205,
  /** The orbit's semi-axes in silhouette radii, and its lean on the screen (degrees, counter-clockwise). */
  a: 1.34,
  b: 0.36,
  leanDeg: 14,
  /** The ellipse's centre above the planet's, in silhouette radii: the near half passes over the planet's north (clear of the caption's rows) and the far half goes behind it. */
  lift: 0.42,
  /** The nearest the orbit's far ends may come to the limb, in silhouette radii (a narrow window shrinks the ellipse to this and no further). */
  minA: 1.12,
  /** Size: a fraction of the silhouette's radius, between these two (CSS px); the front half is this much larger than the back half. */
  size: 0.19,
  minPx: 30,
  maxPx: 54,
  frontScale: 0.2,
  /** Zoom (above the fit, in the globe's zoom units) where the moon starts to leave and where it is gone: it is the world view's. */
  fadeFrom: 0.25,
  fadeTo: 0.9,
  /** The window's edge margin and the distance (CSS px) over which a block of the hero's text takes the moon away. */
  edge: 6,
  coverFade: 18,
} as const;

/** What the overlay needs to know of the globe for one frame. All in the container's CSS px. */
export interface MoonGeometry {
  /** The planet's centre and the radius of its silhouette. */
  cx: number;
  cy: number;
  s: number;
  /** The container's size. */
  width: number;
  height: number;
  /** The hero's text blocks the moon must not pass under (`CoverBlock`: left, right, top; they run to the bottom). */
  blocks: readonly { x0: number; x1: number; top: number }[];
}

export interface MoonPlace {
  /** Centre, CSS px. */
  x: number;
  y: number;
  /** Diameter, CSS px. */
  size: number;
  /** In front of the planet (the near half of the orbit). */
  front: boolean;
  /** 0..1: how much of it shows (the planet hides the far half, the hero's text takes it, a narrow window...). */
  alpha: number;
}

export const toRad = (deg: number) => (deg * Math.PI) / 180;

/** The orbit's angle for `activeMs` of running, radians (0 is the right-hand end of the ellipse; `sin > 0` is the near half). */
export function orbitAngle(activeMs: number): number {
  return toRad(MOON.startDeg) + (2 * Math.PI * activeMs) / MOON.periodMs;
}

/** The diameter in CSS px for a planet whose silhouette has radius `s`. */
export function moonDiameter(s: number): number {
  return Math.round(clamp(MOON.size * s, MOON.minPx, MOON.maxPx));
}

/** The semi-major axis in px: the tuned one, but within the window, and never nearer the limb than `MOON.minA`. */
export function semiMajor(g: MoonGeometry, diameter: number): number {
  const room = Math.min(g.cx, g.width - g.cx) - diameter * (1 + MOON.frontScale) * 0.5 - MOON.edge;
  return clamp(Math.min(MOON.a * g.s, room / Math.cos(toRad(MOON.leanDeg))), MOON.minA * g.s, MOON.a * g.s);
}

/** Where the moon is at `angle`, how big, and how much of it shows. */
export function moonPlace(g: MoonGeometry, angle: number): MoonPlace {
  const base = moonDiameter(g.s);
  const a = semiMajor(g, base);
  const b = MOON.b * g.s;
  const phi = toRad(MOON.leanDeg);
  const ex = a * Math.cos(angle);
  const ey = b * Math.sin(angle);
  const up = ex * Math.sin(phi) + ey * Math.cos(phi) + MOON.lift * g.s;
  const x = g.cx + ex * Math.cos(phi) - ey * Math.sin(phi);
  const y = g.cy - up;
  const near = Math.sin(angle);
  const front = near > 0;
  const size = Math.round(base * (1 + MOON.frontScale * near));
  const r = size / 2;
  let alpha = 1;
  if (!front) {
    // The far half: the planet hides it while its centre is inside the silhouette, and gives it back over the moon's own radius at the limb.
    alpha *= smoothstep(g.s - r, g.s + r, Math.hypot(x - g.cx, y - g.cy));
  }
  for (const k of g.blocks) {
    if (x + r < k.x0 || x - r > k.x1) continue;
    alpha *= 1 - smoothstep(0, MOON.coverFade, y + r - k.top);
  }
  return { x, y, size, front, alpha };
}

/** 0..1: how much of the moon the camera's zoom lets through (the world view's, gone before the first places show their names). */
export function moonAmount(zoom: number, fit: number): number {
  return 1 - smoothstep(fit + MOON.fadeFrom, fit + MOON.fadeTo, zoom);
}

/** What a sprite cell is: nothing, the outline, the body (the page's colour: the sea of the Earth's picture), and the three tones of the ground, darkest first. */
export const CELL = { none: 0, outline: 1, body: 2, tone0: 3, tone1: 4, tone2: 5 } as const;

/** The Moon's picture (`public/media/moon-grey.png`, baked by `scripts/moon/bake-moon.py`): grey 0..255, equirectangular, longitude 0 (the near side) in the middle. */
export interface MoonMap {
  width: number;
  height: number;
  data: Uint8Array;
}

const fract = (x: number) => x - Math.floor(x);
const dither2 = (x: number, y: number) => fract(x * 0.5 + y * y * 0.75);

/** The globe's ordered dither (engine/materials.ts `dither4`, the same function): 0..1 for a buffer pixel (`x` from the left, `y` from the BOTTOM, like `gl_FragCoord`). Period 8. */
export function dither4(x: number, y: number): number {
  return dither2(0.5 * x, 0.5 * y) * 0.25 + dither2(x, y);
}

/** The picture's brightness (0..1) at a direction on the Moon's near side: `nx` right, `ny` up, `nz` toward us; bilinear, wrapped in longitude. */
export function sampleMoon(map: MoonMap, nx: number, ny: number, nz: number): number {
  const u = (Math.atan2(nx, nz) / (2 * Math.PI) + 0.5) * map.width - 0.5;
  const v = (0.5 - Math.asin(clamp(ny, -1, 1)) / Math.PI) * map.height - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const at = (x: number, y: number) => map.data[clamp(y, 0, map.height - 1) * map.width + ((x % map.width) + map.width) % map.width]!;
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return (top * (1 - fy) + bottom * fy) / 255;
}

/**
 * The sprite: `cells` x `cells` art pixels (odd, so there is a middle one), of the `CELL` values. It is drawn the way the globe draws the Earth's picture
 * (engine/materials.ts `surfaceMaterial`): the body is the page's colour, and the ground is one of three flat tones by how bright the picture is (the same cuts,
 * `SURFACE.cuts`), kept in only a share of the pixels (`SURFACE.cover`) chosen by the globe's own ordered dither, which gives the same checkered stipple. No light and
 * no shade: the Earth has none at rest. Outlined in one pixel, as the coastlines are. Without the picture (not loaded yet, or never) it is the outlined body alone.
 *
 * `gx0` and `gy0` are the buffer pixel of the sprite's top-left cell, `gx` from the left and `gy` from the bottom (the buffer's own, as `gl_FragCoord` has it), so that
 * the stipple falls on the same pixels as the Earth's wherever the moon is.
 */
export function moonSprite(cells: number, map: MoonMap | null, gx0: number, gy0: number): Uint8Array {
  const out = new Uint8Array(cells * cells);
  const c = (cells - 1) / 2;
  const R = cells / 2;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const nx = (i - c) / R;
      const ny = (c - j) / R;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const edge = 1 - 1.15 / R;
      let cell: number = CELL.body;
      if (d2 > edge * edge) cell = CELL.outline;
      else if (map && dither4(gx0 + i, gy0 - j) < SURFACE.cover) {
        const v = sampleMoon(map, nx, ny, Math.sqrt(1 - d2));
        cell = v < SURFACE.cuts[0] ? CELL.tone0 : v < SURFACE.cuts[1] ? CELL.tone1 : CELL.tone2;
      }
      out[j * cells + i] = cell;
    }
  }
  return out;
}

/** The sprite's width in cells for a diameter in CSS px on an art grid of `cell` px: odd, at least 9. */
export function spriteCells(diameter: number, cell: number): number {
  const n = Math.max(9, Math.round(diameter / Math.max(1, cell)));
  return n % 2 === 0 ? n + 1 : n;
}
