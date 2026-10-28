/**
 * The choreography of the hero's name travelling to the collapsed line and back (docs/landing.md, "The name's travel"), apart from the DOM so that it
 * is tested as behaviour (`name-travel.test.ts`): which transform each half holds at rest, in the corner and at every moment of a turn-around.
 *
 * A half has two resting transforms: none (the big name, in place) and `final` (the collapsed name, held at the ghost line's boxes). Its INLINE
 * transform is always the one it is heading for: set to `final` when the way is to the corner, removed when it is back. While an animation runs it
 * overrides the inline value, and when it ends (and is cancelled) the inline value is the same picture, so there is no frame between. A travel that
 * is asked for while one is running (collapse and restore within the 320 ms) starts from where the half IS (its computed transform), never from an
 * end: the animation is replaced, the inline transform follows the new direction, and the half is never left at the wrong end.
 */

/** A running animation. */
export interface TravelAnimation {
  cancel(): void;
  /** Called once when it ends by itself (not when it is cancelled). */
  onfinish: (() => void) | null;
}

/** One half of the name, as the choreography sees it. */
export interface TravelHalf {
  /** What this half IS across calls (its element): the caller may build new `TravelHalf` objects for every travel, and a running one is matched by this. Absent: the object itself. */
  id?: unknown;
  /** The transform the half holds when it is the collapsed name (measured at the ghost line). */
  final: string;
  /** Set (a string) or remove (null) the half's own inline transform. */
  setInline(value: string | null): void;
  /** The transform it has right now, animation included. */
  computed(): string;
  /** Run an animation of its transform from `from` to `to`. */
  animate(from: string, to: string): TravelAnimation;
}

const same = (a: TravelHalf, b: TravelHalf) => a === b || (a.id !== undefined && a.id === b.id);

export const IDENTITY_TRANSFORM = "translate(0px, 0px) scale(1)";

export class NameTravel {
  private running: { half: TravelHalf; animation: TravelAnimation }[] = [];

  /** `onSettled(toCorner)`: every animation of a travel has ended by itself (the caller re-measures a held name: a resize during the travel is not lost). */
  constructor(private onSettled?: (toCorner: boolean) => void) {}

  get isRunning(): boolean {
    return this.running.length > 0;
  }

  /** Stop what is running where it stands (the caller sets the halves itself). */
  cancel(): void {
    for (const r of this.running) {
      r.animation.onfinish = null;
      r.animation.cancel();
    }
    this.running = [];
  }

  /** Travel to the corner (`toCorner`) or back to the place, from wherever each half is. */
  go(halves: readonly TravelHalf[], toCorner: boolean): void {
    // where each half is now, read BEFORE anything is cancelled (a cancelled animation takes its picture with it)
    const now = new Map<TravelHalf, string>();
    for (const h of halves) if (this.running.some((r) => same(r.half, h))) now.set(h, h.computed());
    this.cancel();
    let pending = 0;
    const done = () => {
      pending--;
      if (pending === 0) this.onSettled?.(toCorner);
    };
    for (const h of halves) {
      const to = toCorner ? h.final : IDENTITY_TRANSFORM;
      const from = now.get(h) ?? (toCorner ? IDENTITY_TRANSFORM : h.final);
      h.setInline(toCorner ? h.final : null);
      if (from === to) continue;
      const animation = h.animate(from, to);
      pending++;
      const entry = { half: h, animation };
      this.running.push(entry);
      animation.onfinish = () => {
        // out of the compositor's hands the moment it is over: what is left is the inline state, which is the same picture
        animation.onfinish = null;
        animation.cancel();
        this.running = this.running.filter((r) => r !== entry);
        done();
      };
    }
    if (pending === 0) this.onSettled?.(toCorner);
  }
}
