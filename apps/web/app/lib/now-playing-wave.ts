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
  { lobes: 9, lobes2: 14, hz: 2.4, hz2: 3.7, amp: 1.5, phase: 0.6 },
  { lobes: 13, lobes2: 19, hz: 3.1, hz2: 4.6, amp: 1.1, phase: 2.1 },
];

/** The outline's mean radius, in the 100-unit box (the disc is about 67 of them across: the rest is the padding the wave swings in). */
export const WAVE_RADIUS = 45;
/** The share of its amplitude a ring swings with when the music is silent or its level is not known. */
export const REST = 0.5;
/** How many points the outline is drawn with: enough that it reads as a curve at the outline's size. */
const POINTS = 72;

/** The radius of `ring` at angle `a` (radians), `t` seconds in, at music level `level` (0..1). Pure. */
export function waveRadius(ring: WaveRing, a: number, t: number, level: number): number {
  const k = REST + (1 - REST) * Math.min(1, Math.max(0, level));
  const w1 = Math.sin(ring.lobes * a) * Math.cos(2 * Math.PI * ring.hz * t);
  const w2 = 0.6 * Math.sin(ring.lobes2 * a + ring.phase) * Math.cos(2 * Math.PI * ring.hz2 * t + 1.3);
  return WAVE_RADIUS + ring.amp * k * (w1 + w2);
}

/** The radius of the whole outline at angle `a`: the mean radius, swung by every ring's waves together. Pure. */
export function outlineRadius(a: number, t: number, level: number): number {
  let r = WAVE_RADIUS;
  for (const ring of WAVES) r += waveRadius(ring, a, t, level) - WAVE_RADIUS;
  return r;
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
