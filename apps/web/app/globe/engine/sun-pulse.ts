/**
 * The sun's pulse (docs/landing.md, "The sun's music"): while the music plays, the sun's rays and halo breathe with its beat, very faintly. The music's tempo is 110 beats a minute (`SUN_MUSIC.beatSec`, measured on the file),
 * and the pulse goes round in a cycle of two beats (a hair over a second): on the first the rays along the axes (up, down, left, right) reach a little further, on the second the diagonal ones, and the halo and its ring swell
 * and the light brightens a little on both. Each beat is a quick rise and a slow fall (`beatEnvelope`), so that it is felt as a pulse and not as a wobble. All of it goes with how audible the music is (`amount`: it comes in with
 * the fade-in and goes with the fade-out), and none of it is there without the music, or under reduced motion.
 *
 * It is a function of the music's own clock (`SunMusic.pulse`: the speaker's place in the piece), so it cannot drift from the sound, and the loop is made a whole number of cycles long so that it does not skip at the seam.
 * The sun is otherwise static and asks for no frames of its own: the pulse asks for them, but only while it is there (`GlobeRenderer.sunPulsing`).
 */
import { SUN_MUSIC } from "./sun-music";

export const PULSE = {
  /** How much longer the rays reach at a beat's peak, as a share of their length. */
  rays: 0.09,
  /** How much the halo's (and its ring's) reach grows at a beat's peak. */
  halo: 0.04,
  /** How much brighter the halo is at a beat's peak, as a share of its light. */
  glow: 0.08,
  /** The share of a beat's lift the rays that are NOT its own get (the axes' beat lifts the diagonals a little, and the other way round). */
  other: 0.3,
  /** How fast a beat rises and how fast it falls, 1 over seconds-ish (in units of a beat). */
  rise: 30,
  fall: 3.2,
} as const;

/** The shape of one beat, 0 to 1: a quick rise and a slow fall, `phase` being the share of the beat gone (0..1). Pure. */
export function beatEnvelope(phase: number): number {
  const raw = (ph: number) => (1 - Math.exp(-PULSE.rise * ph)) * Math.exp(-PULSE.fall * ph);
  return raw(Math.min(1, Math.max(0, phase))) / PEAK;
}
// (the beat's highest point, found once, so that the envelope's top is 1)
const PEAK = (() => {
  let m = 0;
  for (let i = 0; i <= 200; i++) m = Math.max(m, (1 - Math.exp(-PULSE.rise * (i / 200))) * Math.exp(-PULSE.fall * (i / 200)));
  return m;
})();

export interface SunPulse {
  /** The halo's swell, and the light's, 0..1: on every beat. */
  breath: number;
  /** The rays along the axes, and the diagonal ones, 0..1: the first beat of the cycle is the axes', the second the diagonals'. */
  axis: number;
  diag: number;
}

export const NO_PULSE: SunPulse = { breath: 0, axis: 0, diag: 0 };

/** The pulse at `position` seconds into the piece, as audible as `amount` (0..1). Pure. */
export function sunPulse(position: number, amount: number): SunPulse {
  const beats = (position - SUN_MUSIC.beatOffsetSec) / SUN_MUSIC.beatSec;
  const index = Math.floor(beats);
  const env = beatEnvelope(beats - index) * Math.min(1, Math.max(0, amount));
  const first = (((index % SUN_MUSIC.cycleBeats) + SUN_MUSIC.cycleBeats) % SUN_MUSIC.cycleBeats) === 0;
  return { breath: env, axis: env * (first ? 1 : PULSE.other), diag: env * (first ? PULSE.other : 1) };
}
