/**
 * Timed on/off transitions (pure, unit tested): the one animation primitive of the map overlay.
 *
 * A thing on the map (a box, a label, an interior mask, a dim) is either ON or OFF. The camera only decides the TARGET, with a
 * hysteresis where it matters (engine/lod-tree.ts), and the opacity runs towards that target by TIME: a fixed duration (`FADE_MS`)
 * and a symmetric ease, whatever the camera does meanwhile. So a camera that comes to rest between two states cannot leave
 * anything half transparent: every transition that has started runs to its end, and the resting frame is always fully on or fully
 * off. A reversal mid-way turns around from where the value is (no jump) and takes the time the remaining distance needs.
 *
 * The ease is a smoothstep of a LINEAR progress, so two things that swap (a group's box and the boxes of its places) and start
 * together keep an opacity sum of exactly 1 along the way. `step` reports whether anything is still moving, which is what keeps the
 * on-demand frame loop alive until the last transition has finished (no frozen half-faded frame). Reduced motion: `step(.., true)` is
 * an instant switch.
 */

/** Duration of a full off-to-on (or on-to-off) transition, ms. */
export const FADE_MS = 200;
/** A gap between two clock readings longer than this is a pause (idle, a hidden tab), not time that fades should consume. */
export const MAX_STEP_MS = 64;
/** What a frame counts for after such a pause, ms. */
export const FRAME_MS = 1000 / 60;

/** Opacity from a linear progress: a smoothstep (symmetric, flat at both ends so a fade starts and ends softly). */
export const easeFade = (p: number): number => {
  const x = p < 0 ? 0 : p > 1 ? 1 : p;
  return x * x * (3 - 2 * x);
};

/** Milliseconds a clock step stands for: the gap since the last reading, a pause counting as one frame; 0 on the first reading. */
export const clockStep = (last: number, now: number): number => {
  if (!(last > 0)) return 0;
  const gap = now - last;
  if (!(gap > 0)) return 0;
  return gap > MAX_STEP_MS ? FRAME_MS : gap;
};

/** A hysteresis switch: `on` at or above `high`, `off` at or below `low`, `was` in between. */
export const hysteresis = (was: boolean, value: number, low: number, high: number): boolean => (value >= high ? true : value <= low ? false : was);

/** One timed on/off value per index. `target` is what the camera decided, `p` the linear progress towards it. */
export class FadeArray {
  readonly target: Uint8Array;
  /** Linear progress, 0 = off, 1 = on. */
  readonly p: Float32Array;
  /** Whether some value is not at its target (set by `set` and `step`): the frame loop must keep running while true. */
  moving = false;

  constructor(
    readonly size: number,
    readonly ms: number = FADE_MS,
  ) {
    this.target = new Uint8Array(size);
    this.p = new Float32Array(size);
  }

  /** Where the value is heading. */
  set(i: number, on: boolean): void {
    const t = on ? 1 : 0;
    this.target[i] = t;
    if (this.p[i] !== t) this.moving = true;
  }

  /** Jump to a state (a thing that has just appeared starts in its state, it does not fade towards it). */
  snap(i: number, on: boolean): void {
    this.target[i] = this.p[i] = on ? 1 : 0;
  }

  /** The opacity now (0..1). */
  value(i: number): number {
    return easeFade(this.p[i]!);
  }

  /** Advance every value by `dtMs` towards its target (`instant`: reduced motion, all the way). Returns whether any is still moving. */
  step(dtMs: number, instant = false): boolean {
    const d = instant ? 1 : dtMs / this.ms;
    let moving = false;
    const p = this.p;
    const target = this.target;
    for (let i = 0; i < this.size; i++) {
      const t = target[i]!;
      const v = p[i]!;
      if (v === t) continue;
      if (t === 1) {
        const nv = v + d;
        if (nv >= 1) p[i] = 1;
        else {
          p[i] = nv;
          moving = true;
        }
      } else {
        const nv = v - d;
        if (nv <= 0) p[i] = 0;
        else {
          p[i] = nv;
          moving = true;
        }
      }
    }
    this.moving = moving;
    return moving;
  }

  /** Run every transition to its end now. */
  settle(): void {
    this.p.set(this.target);
    this.moving = false;
  }
}
