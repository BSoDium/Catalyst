/**
 * A delay before a state is applied, undone at once when its opposite comes first: the energy pass's hold on a window that lost focus is not
 * applied the moment the window loses it (owner, 2026-10-23: unfocusing the page stopped the animation, an interlude of 14 s included), but after
 * `ENERGY.blurGraceMs` of it, and a window that is back in front before that never stops.
 */
export interface GraceTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const browserTimers: GraceTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class Grace {
  private handle: unknown = null;
  private on = false;

  constructor(
    private readonly ms: number,
    private readonly apply: (on: boolean) => void,
    private readonly timers: GraceTimers = browserTimers,
  ) {}

  /** The state begins (the window lost focus): it is applied after the delay, unless `cancel` comes first. */
  start(): void {
    if (this.on || this.handle !== null) return;
    if (this.ms <= 0) {
      this.on = true;
      this.apply(true);
      return;
    }
    this.handle = this.timers.setTimeout(() => {
      this.handle = null;
      this.on = true;
      this.apply(true);
    }, this.ms);
  }

  /** The state ends (the window is back): a pending delay is dropped, and an applied state is undone at once. */
  cancel(): void {
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    this.handle = null;
    if (this.on) {
      this.on = false;
      this.apply(false);
    }
  }

  /** Forget everything without applying anything (the owner is going away). */
  dispose(): void {
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    this.handle = null;
  }

  get applied(): boolean {
    return this.on;
  }
}
