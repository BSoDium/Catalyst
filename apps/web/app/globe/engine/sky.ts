/**
 * The sky behind the earth: the pure parts (no DOM, no GL, no clock), shared by the layer that draws it (engine/sky-layer.ts) and the
 * tests. docs/web-architecture.md, "Skybox"; the tuned numbers are `SKY` in engine/tuning.ts.
 *
 * THE CONVENTION. The sky lives in an INERTIAL frame, the celestial equatorial one: north up is celestial north, and a point of the
 * sky has a right ascension and a declination. The app's earth-fixed axes (engine/geo.ts: lon 0 / lat 0 is +Z, lon +90 is +X, north is
 * +Y) are the same axes turned about the polar axis by the earth rotation angle (ERA, the GMST): a direction of right ascension `ra`
 * and declination `dec` has the earth-fixed longitude `ra - ERA`. So, with `lonLatToVec3` as the one handedness of the whole app, a
 * sky that is not mirrored needs nothing more than that rotation.
 *
 *   what moves what
 *   - a camera ORBIT (drag, inertia, flights, the list) changes the view's longitude and latitude and leaves ERA alone: the camera
 *     moves in space, the stars behind the earth turn on the screen with the view, exactly as for a spacecraft going round the planet;
 *   - the earth's own rotation (the idle rotation) turns the earth under a camera that stays where it is: the renderer adds the same
 *     angle to ERA as it takes off the view's longitude, so the sky does not move on the screen at all (the stars are not dragged);
 *   - ERA starts at `SKY.eraDeg`, a constant: the sky is the same on every visit. The camera's orientation is the whole story.
 *
 * The band is a map in GALACTIC coordinates baked once (a few thousand noise evaluations, deterministic), the stars are a fixed list of
 * directions in the same frame; the shader turns each pixel's ray into galactic coordinates with the matrix `viewToGalactic`.
 */
import { DEG, clamp, focalPx, smoothstep, type Vec3, type ViewBasis } from "./geo";
import { hysteresis } from "./fade";
import { roleLevel } from "./palette";
import { SKY } from "./tuning";

/** A 3x3 matrix, row-major. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

/**
 * ICRS to galactic: its rows are the galactic x (the centre), y (l = 90) and z (the north galactic pole) axes in equatorial components.
 * ESA, "The Hipparcos and Tycho Catalogues" (1997), vol. 1, section 1.5.3 (the transformation matrix A_G'). Published constants.
 */
export const EQ_TO_GAL: Mat3 = [-0.0548755604, -0.8734370902, -0.4838350155, 0.4941094279, -0.44482963, 0.7469822445, -0.867666149, -0.1980763734, 0.4559837762];

/** The angle between the earth's equator and the galactic plane (the angle of the north galactic pole to the celestial pole's complement: 90 - 27.13), degrees. */
export const GALACTIC_INCLINATION_DEG = 62.8717;

/* ------------------------------------------------------------------ matrices */

export function mulMat3(a: Mat3, b: Mat3): Mat3 {
  const o: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!);
  return o as unknown as Mat3;
}

export const mulVec3 = (m: Mat3, v: Vec3): [number, number, number] => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

export const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/** The equatorial components (x to RA 0, y to RA 90, z to the pole) of a vector in the app's axes, as a matrix: eq = (app.z, app.x, app.y). */
const APP_TO_EQ: Mat3 = [0, 0, 1, 1, 0, 0, 0, 1, 0];
/** Galactic components of a vector in the app's inertial axes. */
export const GAL_FROM_APP: Mat3 = mulMat3(EQ_TO_GAL, APP_TO_EQ);

/** Turn a vector in the app's axes about the polar axis (+Y) by `deg`: a point of longitude `lon` ends at `lon + deg`. */
export function rotateLon(deg: number): Mat3 {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

/**
 * The matrix that takes a direction in VIEW space (x right = east, y up = north, z toward the camera, the three.js camera's axes) to
 * galactic components. Earth-fixed from view: `x * east + y * north + z * c`; inertial from earth-fixed: the longitude turned by the
 * earth rotation angle `eraDeg`; galactic from inertial: `GAL_FROM_APP`.
 */
export function viewToGalactic(basis: Pick<ViewBasis, "c" | "east" | "north">, eraDeg: number): Mat3 {
  const { east: e, north: n, c } = basis;
  const world: Mat3 = [e[0], n[0], c[0], e[1], n[1], c[1], e[2], n[2], c[2]];
  return mulMat3(GAL_FROM_APP, mulMat3(rotateLon(eraDeg), world));
}

/* ------------------------------------------------------------------ coordinates */

/** Unit vector in galactic components of galactic longitude `l` and latitude `b`, degrees. */
export function galacticVec(l: number, b: number): [number, number, number] {
  const cb = Math.cos(b * DEG);
  return [cb * Math.cos(l * DEG), cb * Math.sin(l * DEG), Math.sin(b * DEG)];
}

export function galacticLonLat(v: Vec3): { l: number; b: number } {
  return { l: Math.atan2(v[1], v[0]) / DEG, b: Math.asin(clamp(v[2], -1, 1)) / DEG };
}

/** Right ascension (0..360) and declination of a point given in galactic coordinates. */
export function galacticToEquatorial(l: number, b: number): { ra: number; dec: number } {
  const g = galacticVec(l, b);
  const eq = mulVec3(transpose(EQ_TO_GAL), g);
  return { ra: (((Math.atan2(eq[1], eq[0]) / DEG) % 360) + 360) % 360, dec: Math.asin(clamp(eq[2], -1, 1)) / DEG };
}

/** Galactic coordinates of a point given by right ascension and declination. */
export function equatorialToGalactic(ra: number, dec: number): { l: number; b: number } {
  const cd = Math.cos(dec * DEG);
  return galacticLonLat(mulVec3(EQ_TO_GAL, [cd * Math.cos(ra * DEG), cd * Math.sin(ra * DEG), Math.sin(dec * DEG)]));
}

/* ------------------------------------------------------------------ noise (deterministic) */

/** A well-mixed 32-bit integer hash of a lattice point and a seed, 0..1. */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x85ebca6b) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Value noise on the integer lattice of 3-space, 0..1, smooth (a smoothstep between lattice values). */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = smoothstep(x - x0), fy = smoothstep(y - y0), fz = smoothstep(z - z0);
  const h = (i: number, j: number, k: number) => hash3(x0 + i, y0 + j, z0 + k, seed);
  return mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), fx), mix(h(0, 1, 0), h(1, 1, 0), fx), fy),
    mix(mix(h(0, 0, 1), h(1, 0, 1), fx), mix(h(0, 1, 1), h(1, 1, 1), fx), fy),
    fz,
  );
}

/** Fractal value noise of a unit vector (octaves of frequency per radian and weight), 0..1. The same direction always gives the same value. */
export function fbm(v: Vec3, seed: number, octaves: readonly (readonly [number, number])[] = SKY.band.noise.octaves): number {
  let sum = 0;
  let total = 0;
  octaves.forEach(([freq, weight], i) => {
    sum += weight * valueNoise3(v[0] * freq, v[1] * freq, v[2] * freq, seed + i * 101);
    total += weight;
  });
  return sum / total;
}

/** mulberry32: a tiny seeded generator, 0..1. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ the band */

const wrapDeg = (l: number) => ((((l + 180) % 360) + 360) % 360) - 180;
const edge01 = (x: number) => smoothstep(clamp(x, 0, 1));

/**
 * Brightness (0..1 of the top tone) of the Milky Way at galactic longitude `l` and latitude `b`, given the noise `n` (0..1) of that
 * direction: a band along the galactic equator, brighter and thicker toward the galactic centre (l = 0) with a bulge on it, the Great
 * Rift (a thin wavy dust lane down the middle on the centre side), coarse mottling and breaks where the noise dips. Zero beyond
 * `map.bMaxDeg`.
 */
export function bandValue(l: number, b: number, n: number): number {
  const c = SKY.band;
  const ll = wrapDeg(l);
  const w = Math.exp(-((ll / c.centreSpreadDeg) ** 2));
  const sigma = mix(c.thicknessDeg.edge, c.thicknessDeg.core, w);
  const body = mix(c.brightness.edge, c.brightness.core, w) * Math.exp(-0.5 * (b / sigma) ** 2);
  const bulge = c.bulge.share * Math.exp(-0.5 * (ll * ll + (b * 1.4) ** 2) / c.bulge.sigmaDeg ** 2);
  const r = c.rift;
  const inRift = edge01((ll - r.fromDeg) / 12) * (1 - edge01((ll - r.toDeg) / 12));
  const laneB = r.waveDeg * Math.sin((2 * Math.PI * ll) / r.wavePeriodDeg);
  const lane = r.depth * inRift * Math.exp(-0.5 * ((b - laneB) / r.widthDeg) ** 2);
  const k = c.noise;
  const mottle = mix(k.floor, 1, edge01((n - 0.1) / 0.8));
  const breaks = 1 - k.breakDepth * (1 - edge01((n - (k.breakBelow - 0.12)) / 0.12));
  const taper = 1 - edge01((Math.abs(b) - (SKY.map.bMaxDeg - 9)) / 8);
  return clamp((body + bulge) * (1 - lane) * mottle * breaks * taper * c.gain, 0, 1);
}

let baked: Uint8Array | null = null;

/** The band map: `rows` x `cols` bytes, row j at latitude `-bMax + (j + 0.5) * 2 bMax / rows`, column i at longitude `(i + 0.5) * 360 / cols - 180`. Baked once. */
export function bakeBand(): Uint8Array {
  if (baked) return baked;
  const { cols, rows, bMaxDeg } = SKY.map;
  const out = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const b = -bMaxDeg + ((j + 0.5) * 2 * bMaxDeg) / rows;
    for (let i = 0; i < cols; i++) {
      const l = ((i + 0.5) * 360) / cols - 180;
      out[j * cols + i] = Math.round(bandValue(l, b, fbm(galacticVec(l, b), SKY.seed)) * 255);
    }
  }
  baked = out;
  return out;
}

/** The GPU's bilinear lookup of the band map (repeat in longitude, clamp in latitude), 0..1: what the shader reads at (l, b). */
export function sampleBand(map: Uint8Array, l: number, b: number): number {
  const { cols, rows, bMaxDeg } = SKY.map;
  const x = ((wrapDeg(l) + 180) / 360) * cols - 0.5;
  const y = clamp((b + bMaxDeg) / (2 * bMaxDeg), 0, 1) * rows - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const at = (i: number, j: number) => map[clamp(j, 0, rows - 1) * cols + (((i % cols) + cols) % cols)]! / 255;
  return mix(mix(at(x0, y0), at(x0 + 1, y0), fx), mix(at(x0, y0 + 1), at(x0 + 1, y0 + 1), fx), fy);
}

/* ------------------------------------------------------------------ the stars */

export interface Stars {
  count: number;
  /** Unit vectors in galactic components, xyz per star. */
  position: Float32Array;
  /** 0 = the dimmer tone, 1 = the brighter. */
  tier: Float32Array;
  /** A fixed rank 0..1: the star is drawn while the fade exceeds it, so the fade thins the field out at random instead of dimming it. */
  keep: Float32Array;
}

/**
 * The star field: `SKY.stars.count` uniform directions on the sphere, thinned so that the density is `bandBoost` times higher
 * where the band map is at its brightest (and dust lanes cut it too). Same seed, same stars, on every machine.
 */
export function makeStars(map: Uint8Array = bakeBand(), cfg: { count: number; bandBoost: number; brightShare: number } = SKY.stars, seed: number = SKY.seed): Stars {
  const rand = mulberry32(seed ^ 0x51ed270b);
  const position = new Float32Array(cfg.count * 3);
  const tier = new Float32Array(cfg.count);
  const keep = new Float32Array(cfg.count);
  let n = 0;
  while (n < cfg.count) {
    const z = rand() * 2 - 1;
    const phi = rand() * 2 * Math.PI;
    const r = Math.sqrt(1 - z * z);
    const x = r * Math.cos(phi), y = r * Math.sin(phi);
    const { l, b } = galacticLonLat([x, y, z]);
    const density = 1 + (cfg.bandBoost - 1) * Math.min(1, sampleBand(map, l, b) / SKY.band.gain);
    const gate = rand();
    const bright = rand();
    const rank = rand();
    if (gate * cfg.bandBoost > density) continue;
    position.set([x, y, z], n * 3);
    tier[n] = bright < cfg.brightShare ? 1 : 0;
    keep[n] = rank;
    n++;
  }
  return { count: cfg.count, position, tier, keep };
}

/* ------------------------------------------------------------------ fade, tones, dither */

/** Share of the sky kept at `rho` earth radii from the globe's centre: 0 up to `fade.from`, 1 from `fade.to`, a smoothstep between. */
export function skyFade(rho: number, fade: { from: number; to: number } = SKY.fade): number {
  return smoothstep(clamp((rho - fade.from) / (fade.to - fade.from), 0, 1));
}

/** The 4x4 Bayer matrix (ordered dither), row-major. */
export const BAYER4: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Threshold 0..1 of the Bayer matrix at an art cell (`x`, `y` whole numbers, any sign): sixteen distinct values, evenly spread. */
export function bayerThreshold(x: number, y: number): number {
  return (BAYER4[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
}

/**
 * The tone of one art cell: a brightness `v` (0..1) quantised to the integers 0..`top` with an ordered dither between the two nearest
 * (a fraction `f` of the cells of a flat area take the upper one). 0 = the page colour. Never a value in between: this is the pixel-art
 * quantisation of the whole sky.
 */
export function toneAt(v: number, threshold: number, top = 2): number {
  const u = clamp(v, 0, 1) * top;
  const k = Math.floor(u);
  return k + (u - k > threshold ? 1 : 0);
}

/**
 * The highest palette level the sky may use: one below the graticule's (`faint`), so everything in it is dimmer than the globe's lines
 * (never below 1: level 0 is the page colour). With the default 12 levels the sky uses levels 1 and 2, the graticule is 3.
 */
export const skyTop = (levels: number): number => Math.max(1, roleLevel("faint", levels) - 1);

/** The two tones of the sky as colours of the ramp: the dim one (level 1) and the bright one (`skyTop`). */
export const skyTones = <T>(ramp: readonly T[]): [T, T] => {
  const top = skyTop(ramp.length);
  return [ramp[Math.min(1, top)]!, ramp[top]!];
};

/* ------------------------------------------------------------------ geometry on the screen */

export interface SkyGeometry {
  /** The centre of the earth's disc in buffer pixels (y up, like `gl_FragCoord`) and its apparent radius. */
  cx: number;
  cy: number;
  radius: number;
  /** The farthest corner of the picture, in earth radii from the centre. */
  rhoMax: number;
}

/** Where the earth's silhouette is in the drawing buffer: a camera at distance `d` (globe radius 1), the picture `bufW` x `bufH`, the projection centre shifted left by `shiftBuf`. */
export function skyGeometry(d: number, bufW: number, bufH: number, shiftBuf: number): SkyGeometry {
  const radius = focalPx(bufH) / Math.sqrt(Math.max(1e-9, d * d - 1));
  const cx = bufW / 2 - shiftBuf;
  const cy = bufH / 2;
  const far = Math.hypot(Math.max(cx, bufW - cx), Math.max(cy, bufH - cy));
  return { cx, cy, radius, rhoMax: far / radius };
}

/** Whether the sky is on: a hysteresis on how far from the globe the picture reaches (`SKY.onRho`). */
export const skyWanted = (was: boolean, rhoMax: number): boolean => hysteresis(was, rhoMax, SKY.onRho.rho - SKY.onRho.band, SKY.onRho.rho + SKY.onRho.band);

/* ------------------------------------------------------------------ page flags */

/** Live switch (module state, like `SPIN`): `applySkyFlags` sets it from the page before the renderer is built. */
export const SKY_STATE = { enabled: true };

/**
 * `?no-sky` (or sessionStorage "no-sky" = "1") switches the sky off on any page. A page in debug mode (`?globe-debug`, what the browser
 * checks run in) has it OFF by default, because their pixel assertions (palette colours only, nothing outside the boxes) predate it;
 * `?sky` (or sessionStorage "sky" = "1") turns it on there.
 */
export function applySkyFlags(): void {
  SKY_STATE.enabled = true;
  try {
    const q = new URLSearchParams(location.search);
    const debug = q.has("globe-debug") || sessionStorage.getItem("globe-debug") === "1";
    const wanted = !debug || q.has("sky") || sessionStorage.getItem("sky") === "1";
    if (q.has("no-sky") || sessionStorage.getItem("no-sky") === "1" || !wanted) SKY_STATE.enabled = false;
  } catch {
    // no storage: keep the default
  }
}
