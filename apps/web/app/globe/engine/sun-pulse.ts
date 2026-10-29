/**
 * The sun's pulse (docs/landing.md, "The sun's music"): while the music plays, the sun's rays and halo move with it, very faintly. The music's tempo is 110 beats a minute (`SUN_MUSIC.beatSec`, measured on the file), and the
 * pulse comes every TWO beats (a hair over a second: owner, "slower, happening less often, but still in rhythm"), in a cycle of four: on the first beat of the cycle the rays along the axes (up, down, left, right) reach a
 * little further, on the third the diagonal ones, and the halo and its ring swell and brighten on both. Each pulse is a quick rise and a slow fall (`beatEnvelope`), so that it is felt as a pulse and not as a wobble.
 *
 * The rays also GROW and SHIFT with the sound (owner: "their seed evolves with the sound"): they reach further as the piece gets louder (`grow`, from the music's own level: `SunMusic.pulse().energy`), and the grain of
 * their dither is drawn again at every pulse (`seed`, `jitter`: the fixed pattern of the rays at rest is mixed with a noise that is a new one each time), so that a ray is never the same twice. At rest, with no music, they are as
 * they always were.
 *
 * All of it goes with how audible the music is (`amount`: it comes in with the fade-in and goes with the fade-out), and none of it is there without the music, or under reduced motion. It is a function of the music's own
 * clock (`SunMusic.pulse`: the speaker's place in the piece), so it cannot drift from the sound, and the loop is made a whole number of cycles long so that it does not skip at the seam. The sun is otherwise static and
 * asks for no frames of its own: the pulse asks for them, but only while it is there (`GlobeRenderer.sunPulsing`).
 */
import { SUN_MUSIC } from "./sun-music";

export const PULSE = {
  /** How many beats between one pulse and the next. */
  beatsPerPulse: 2,
  /** How much longer the rays reach at a pulse's peak, as a share of their length. */
  rays: 0.09,
  /** How much longer they reach when the piece is at its loudest, as a share of their length (they grow with the sound). */
  grow: 0.14,
  /** How much of the rays' dither is noise (a new one at every pulse) rather than the fixed pattern, at full music. */
  jitter: 0.5,
  /** How much the halo's (and its ring's) reach grows at a pulse's peak. */
  halo: 0.04,
  /** How much brighter the halo is at a pulse's peak, as a share of its light. */
  glow: 0.08,
  /** The share of a pulse's lift the rays that are NOT its own get (the axes' pulse lifts the diagonals a little, and the other way round). */
  other: 0.3,
  /** How fast a pulse rises and how fast it falls, in units of a pulse (the two beats). */
  rise: 30,
  fall: 3.2,
} as const;

/** The shape of one pulse, 0 to 1: a quick rise and a slow fall, `phase` being the share of the pulse gone (0..1). Pure. */
export function beatEnvelope(phase: number): number {
  const raw = (ph: number) => (1 - Math.exp(-PULSE.rise * ph)) * Math.exp(-PULSE.fall * ph);
  return raw(Math.min(1, Math.max(0, phase))) / PEAK;
}
// (the pulse's highest point, found once, so that the envelope's top is 1)
const PEAK = (() => {
  let m = 0;
  for (let i = 0; i <= 200; i++) m = Math.max(m, (1 - Math.exp(-PULSE.rise * (i / 200))) * Math.exp(-PULSE.fall * (i / 200)));
  return m;
})();

export interface SunPulse {
  /** The halo's swell, and the light's, 0..1: at every pulse. */
  breath: number;
  /** The rays along the axes, and the diagonal ones, 0..1: the first pulse of the cycle is the axes', the second the diagonals'. */
  axis: number;
  diag: number;
  /** How far the piece's loudness has grown the rays, 0..1. */
  grow: number;
  /** A number that is a new one at every pulse (the grain of the rays is drawn from it), and how much of the grain it is (0..1: the music's audibility). */
  seed: number;
  jitter: number;
}

export const NO_PULSE: SunPulse = { breath: 0, axis: 0, diag: 0, grow: 0, seed: 0, jitter: 0 };

/** The pulse at `position` seconds into the piece, as audible as `amount` (0..1), the piece as loud as `energy` (0..1). Pure. */
export function sunPulse(position: number, amount: number, energy = 0): SunPulse {
  const a = Math.min(1, Math.max(0, amount));
  const pulses = (position - SUN_MUSIC.beatOffsetSec) / (SUN_MUSIC.beatSec * PULSE.beatsPerPulse);
  const index = Math.floor(pulses);
  const env = beatEnvelope(pulses - index) * a;
  const cycle = SUN_MUSIC.cycleBeats / PULSE.beatsPerPulse;
  const first = (((index % cycle) + cycle) % cycle) === 0;
  return {
    breath: env,
    axis: env * (first ? 1 : PULSE.other),
    diag: env * (first ? PULSE.other : 1),
    grow: Math.min(1, Math.max(0, energy)) * a,
    seed: ((index % 1024) + 1024) % 1024,
    jitter: PULSE.jitter * a,
  };
}
