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

/** GLSL's `smoothstep`: 0 at or below `e0`, 1 at or above `e1`, smooth between. */
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const MOON = {
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

/** The tones of the sprite, in the order of the cells' values below. */
export type MoonTone = "outline" | "lit" | "shade" | "crater";
export const TONES: readonly (MoonTone | null)[] = [null, "outline", "lit", "shade", "crater"];

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** The light: from the upper left, a little in front. */
const LIGHT = (() => {
  const v = [-0.55, 0.5, 0.67];
  const l = Math.hypot(...v);
  return v.map((n) => n / l) as [number, number, number];
})();
/** The maria and craters, in the disc's own unit coordinates (x right, y up) and radii: fixed (the moon shows the planet one face). */
const CRATERS: readonly [number, number, number][] = [
  [0.28, 0.3, 0.2],
  [-0.12, 0.52, 0.12],
  [0.5, -0.1, 0.14],
  [0.05, -0.38, 0.22],
  [-0.4, -0.12, 0.11],
];

/**
 * The sprite: `cells` x `cells` art pixels (odd, so there is a middle one), 0 for nothing and 1 to 4 for the tones above. A one-pixel outline, the lit side
 * as plain page colour (the planet's lines do not show through the body), the shaded side dithered into it by a 4x4 Bayer matrix like everything the globe draws.
 */
export function moonSprite(cells: number): Uint8Array {
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
      if (d2 > edge * edge) {
        out[j * cells + i] = 1;
        continue;
      }
      const nz = Math.sqrt(1 - d2);
      const lit = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
      let tone = 2;
      if (lit < 0.42) tone = (lit + 0.25) / 0.67 > (BAYER4[(j & 3) * 4 + (i & 3)]! + 0.5) / 16 ? 2 : 3;
      for (const [kx, ky, kr] of CRATERS) {
        if (Math.hypot(nx - kx, ny - ky) < kr) tone = tone === 3 ? 3 : 4;
      }
      out[j * cells + i] = tone;
    }
  }
  return out;
}

/** The sprite's width in cells for a diameter in CSS px on an art grid of `cell` px: odd, at least 9. */
export function spriteCells(diameter: number, cell: number): number {
  const n = Math.max(9, Math.round(diameter / Math.max(1, cell)));
  return n % 2 === 0 ? n + 1 : n;
}
