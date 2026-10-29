/**
 * The sun's breathing (docs/landing.md, "The sun's music"): while the music plays, the sun's rays, halo and lens flare breathe, very faintly, in time with it. Not a beat visualiser (owner: "softer, more like a breathing
 * motion"): one slow cycle of eight beats (`SUN_MUSIC.cycleBeats`, 4.36 s at the piece's 110 BPM, measured on the file), every part of it a cosine, so that nothing in it has an edge. The cycle begins on the music's first beat:
 *  - the rays along the axes (up, down, left, right) breathe OUT over the first half of the cycle and in over the second, and the diagonal ones do the opposite, so the sun seems to turn its shape rather than to throb;
 *  - the halo and its ring swell and brighten (its tone dips and comes back through the dither, a pixel at a time) a quarter of a cycle behind, so that the three never peak together;
 *  - the lens flare's ghosts (their opacity) breathe in and out a little, `PULSE.flare` of it.
 *
 * The rays also GROW and SHIFT with the sound (owner: "their seed evolves with the sound"): they reach further as the piece gets louder (`grow`, from the music's own level: `SunMusic.pulse().energy`), and the grain of their
 * dither is drawn again at every cycle (`seed`, `jitter`: the fixed pattern of the rays at rest is mixed with a noise that is a new one each time), so that a ray is never the same twice. At rest, with no music, they are as they were.
 *
 * No two breaths are as strong (`PULSE.gainMin`..1: `gain`, drawn at every cycle and eased from one to the next).
 *
 * All of it goes with how audible the music is (`amount`: it comes in with the fade-in and goes with the fade-out), and none of it is there without the music, or under reduced motion. It is a function of the music's own
 * clock (`SunMusic.pulse`: the speaker's place in the piece), so it cannot drift from the sound, and the loop is made a whole number of cycles long so that it does not skip at the seam. The sun is otherwise static and
 * asks for no frames of its own: the breathing asks for them, but only while it is there (`GlobeRenderer.sunPulsing`).
 */
import { SUN_MUSIC } from "./sun-music";

export const PULSE = {
  /** How much longer the rays reach at the top of a breath, as a share of their length. */
  rays: 0.012,
  /** How much longer they reach when the piece is at its loudest, as a share of their length (they grow with the sound). */
  grow: 0.025,
  /** How much of the rays' dither is noise (a new one at every cycle) rather than the fixed pattern, at full music. */
  jitter: 0.1,
  /** How much the halo's (and its ring's) reach grows at the top of a breath. */
  halo: 0.006,
  /**
   * How far the halo's tone is taken down at the bottom of a breath, in steps of its tone (the halo is cut into `SUN.haloSteps` and dithered): 1.5 steps takes the flat zone round the disc through a step and a half of the
   * dither, a pixel at a time. (It was a multiple of the whole tone, which flipped that zone between two colours of the ramp all at once: "binary".)
   */
  dip: 0.3,
  /** How much the lens flare's ghosts dim at the bottom of a breath, as a share of their opacity. */
  flare: 0.04,
  /** How far behind the rays' breath the halo's is, in cycles. */
  haloLag: 0.25,
  /**
   * How strong the weakest breath is, as a share of the strongest (owner: "waaay more subtle", "a bit of randomness, not always the same strength"). Every cycle has its own strength, drawn between this and 1, and the
   * strength moves from one cycle's to the next's over the cycle (a cosine), so there is no step at the seam.
   */
  gainMin: 0.35,
} as const;

/**
 * The beat (the player's halo pulses once to each: owner, 2026-10-29): 1 on a beat, 0 half way to the next, as a cosine (no edge), for the music at `position` seconds into the piece. Pure.
 */
export function beatPulse(position: number): number {
  const beats = (position - SUN_MUSIC.beatOffsetSec) / SUN_MUSIC.beatSec;
  return 0.5 + 0.5 * Math.cos(2 * Math.PI * (beats - Math.floor(beats)));
}

/** A breath: 0 at the start of the cycle, up to 1 half way, and back, as a cosine (`phase` in cycles). Pure. */
export function breath(phase: number): number {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
}

export interface SunPulse {
  /** How audible the music is, 0..1 (the others are this much of what they are). */
  amount: number;
  /** The halo's swell, and the light's, 0..1. */
  breath: number;
  /** The rays along the axes, and the diagonal ones, 0..1: one goes out as the other comes in. */
  axis: number;
  diag: number;
  /** How far the lens flare has dimmed, 0..1 (of `PULSE.flare`). */
  lens: number;
  /** How far the piece's loudness has grown the rays, 0..1. */
  grow: number;
  /** How strong this breath is, `PULSE.gainMin`..1 (a different one each cycle, drawn from the cycle's number): every breath's travel is this much of what it is. */
  gain: number;
  /** A number that is a new one at every cycle (the grain of the rays is drawn from it), and how much of the grain it is (0..1: the music's audibility). */
  seed: number;
  jitter: number;
}

export const NO_PULSE: SunPulse = { amount: 0, breath: 0, axis: 0, diag: 0, lens: 0, grow: 0, gain: 1, seed: 0, jitter: 0 };

/** A number 0..1 that is the same for the same cycle and unlike its neighbours' (a hash of the cycle's number). Pure. */
function draw(index: number): number {
  const x = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** The strength of the breath at `phase` cycles into cycle `index`: this cycle's draw eased into the next's, so that it is never stepped. Pure. */
export function strength(index: number, phase: number): number {
  const k = 0.5 - 0.5 * Math.cos(Math.PI * phase);
  const g = (i: number) => PULSE.gainMin + (1 - PULSE.gainMin) * draw(i);
  return g(index) + (g(index + 1) - g(index)) * k;
}

/** The breathing at `position` seconds into the piece, as audible as `amount` (0..1), the piece as loud as `energy` (0..1). Pure. */
export function sunPulse(position: number, amount: number, energy = 0): SunPulse {
  const a = Math.min(1, Math.max(0, amount));
  const cycles = (position - SUN_MUSIC.beatOffsetSec) / (SUN_MUSIC.beatSec * SUN_MUSIC.cycleBeats);
  const index = Math.floor(cycles);
  const phase = cycles - index;
  return {
    amount: a,
    breath: breath(phase - PULSE.haloLag) * a,
    axis: breath(phase) * a,
    diag: breath(phase + 0.5) * a,
    lens: (1 - breath(phase)) * a,
    grow: Math.min(1, Math.max(0, energy)) * a,
    gain: strength(index, phase),
    seed: ((index % 1024) + 1024) % 1024,
    jitter: PULSE.jitter * a,
  };
}
