/**
 * The now-playing disc's wavy outline (components/now-playing-player.tsx; owner, 2026-10-29: "an outline that wouldn't rotate with the disc, and that would vibrate with the music with higher frequency undulation"): pure, no DOM.
 *
 * The outline is a circle whose radius is swung by the waves of two rings, each two STANDING waves (a fixed number of lobes round it, `lobes` and `lobes2`, that swell and dip in place at `hz` and `hz2`, each at its own rate), so that the line shivers
 * and nothing travels round it or turns. How far it swings is the music's level (`level`, 0..1: the sun's music's own loudness, `SunMusic.pulse().energy`) between `REST` of the ring's amplitude and all of it; with no
 * level to read (the interlude's sound) it holds at `REST`, still shivering.
 */
export interface WaveRing {
  lobes: number;
  lobes2: number;
  /** How fast each of the two standing waves swells and dips, in Hz. */
  hz: number;
  hz2: number;
  /** How far the line swings at most, in the outline's 100-unit box. */
  amp: number;
  /** Where the second wave's lobes start round the ring, radians (so that the rings' lobes do not line up). */
  phase: number;
}

export const WAVES: readonly WaveRing[] = [
  { lobes: 9, lobes2: 14, hz: 1.3, hz2: 2, amp: 3, phase: 0.6 },
  { lobes: 13, lobes2: 19, hz: 1.7, hz2: 2.5, amp: 2.1, phase: 2.1 },
];

/** The radius the waves swing about, in the 100-unit box (the disc is about 67 of them across: the rest is the padding the wave swings in). */
export const WAVE_RADIUS = 41;
/**
 * How far out the whole outline stands, `BASE_LOW`..`BASE_HIGH` (owner: "reach lower, nearly disappear behind the disc"): it swells out and falls back slowly (`BASE_HZ`), further out the louder the music is, and at the bottom of its
 * fall its troughs go behind the disc (the disc's edge is `DISC_EDGE`); it never goes beyond `MAX_RADIUS` (the canvas's edge).
 */
export const BASE_LOW = 34;
export const BASE_HIGH = 42;
export const BASE_HZ = 0.14;
export const DISC_EDGE = 33.3;
export const MAX_RADIUS = 49.5;
/** How much of the outline's reach is the music's level and how much the slow swell. */
const LEVEL_SHARE = 0.4;
/** The share of its amplitude a ring swings with when the music is silent or its level is not known. */
export const REST = 0.5;
/** How many points the outline is drawn with: enough that it reads as a curve at the outline's size. */
const POINTS = 72;

/**
 * How tall the waves stand at angle `a`, `t` seconds in, `ENV_MIN`..1 (owner: "more variation to the height ... slow it down ... more alive and less random"): a slow swell and fall of the height in place, region by region (two standing
 * envelopes, 3 and 5 lobes round, a third and a fifth of a hertz), so that now one side of the outline stands tall and the other lies low, and then the other way, and nothing is the same height all round. Pure.
 */
export function envelope(a: number, t: number): number {
  const e = 0.5 + 0.5 * (0.6 * Math.cos(3 * a) * Math.sin(2 * Math.PI * ENV_HZ[0] * t) + 0.4 * Math.cos(5 * a + 1) * Math.sin(2 * Math.PI * ENV_HZ[1] * t + 2));
  return ENV_MIN + (1 - ENV_MIN) * e;
}
const ENV_HZ = [0.33, 0.2] as const;
/** How low the waves lie where the envelope is at its lowest, as a share of how tall they stand where it is at its highest. */
export const ENV_MIN = 0.2;

/** The radius of `ring` at angle `a` (radians), `t` seconds in, at music level `level` (0..1). Pure. */
export function waveRadius(ring: WaveRing, a: number, t: number, level: number): number {
  const k = REST + (1 - REST) * Math.min(1, Math.max(0, level));
  const w1 = Math.sin(ring.lobes * a) * Math.cos(2 * Math.PI * ring.hz * t);
  const w2 = 0.6 * Math.sin(ring.lobes2 * a + ring.phase) * Math.cos(2 * Math.PI * ring.hz2 * t + 1.3);
  return WAVE_RADIUS + ring.amp * k * envelope(a, t) * (w1 + w2);
}

/** How far out the outline stands as a whole, `BASE_LOW`..`BASE_HIGH`: a slow swell, and the music's level. Pure. */
export function baseRadius(t: number, level: number): number {
  const swell = 0.5 + 0.5 * Math.sin(2 * Math.PI * BASE_HZ * t);
  const lv = Math.min(1, Math.max(0, level));
  return BASE_LOW + (BASE_HIGH - BASE_LOW) * ((1 - LEVEL_SHARE) * swell + LEVEL_SHARE * lv);
}

/** The radius of the whole outline at angle `a`: how far out it stands, swung by every ring's waves together, and kept between behind the disc and the canvas's edge. Pure. */
export function outlineRadius(a: number, t: number, level: number): number {
  let r = baseRadius(t, level);
  for (const ring of WAVES) r += waveRadius(ring, a, t, level) - WAVE_RADIUS;
  return Math.min(MAX_RADIUS, Math.max(DISC_EDGE - 1, r));
}

/**
 * The outline's points `t` seconds in, at music level `level`, in a box of `size` units (the ring's own 100-unit box scaled to it): a closed polyline as [x0, y0, x1, y1, ...]. Pure.
 */
export function outlinePoints(t: number, level: number, size: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < POINTS; i++) {
    const a = (i / POINTS) * 2 * Math.PI;
    const r = outlineRadius(a, t, level);
    out.push(((50 + r * Math.cos(a)) / 100) * size, ((50 + r * Math.sin(a)) / 100) * size);
  }
  return out;
}
