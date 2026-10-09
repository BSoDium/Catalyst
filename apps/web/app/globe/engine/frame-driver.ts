/**
 * The frames of something that moves on its own (a label's glide, engine/box-scene.ts) when the host has nothing to draw for it: a
 * `requestAnimationFrame` loop that runs only while `active()` and never twice in a frame. Pure and clock-injected so the loop can be tested
 * without a browser.
 *
 *  - `ride()` asks for the next frame when the thing is active and none is pending (called after every run);
 *  - `stop()` withdraws the pending frame (the host is drawing this one and will call `ride()` again after it);
 *  - a frame whose callback finds that a run already happened at or after its own start (`ran(now)` was called by the host's frame in the same
 *    display frame) does not run again, it only asks for the next one.
 */
export interface FrameDriverHost {
  request(cb: (frameStart: number) => void): number;
  cancel(id: number): void;
  /** Advance and draw one frame at `now` (ms, the clock of `frameStart`). */
  run(now: number): void;
  active(): boolean;
  now(): number;
}

export class FrameDriver {
  enabled = false;
  private pending = 0;
  private lastRun = -Infinity;
  private runs = 0;
  constructor(private host: FrameDriverHost) {}

  /** Frames this driver ran itself (not the host's). */
  get driven(): number {
    return this.runs;
  }

  /** Note that a run happened at `now` (the host's own frame). */
  ran(now: number) {
    this.lastRun = now;
  }

  ride() {
    if (!this.enabled || this.pending || !this.host.active()) return;
    this.pending = this.host.request(this.tick);
  }

  stop() {
    if (this.pending) this.host.cancel(this.pending);
    this.pending = 0;
  }

  private tick = (frameStart: number) => {
    this.pending = 0;
    if (!this.enabled || !this.host.active()) return;
    if (this.lastRun >= frameStart) {
      this.ride();
      return;
    }
    this.runs++;
    const now = this.host.now();
    this.lastRun = now;
    this.host.run(now); // the run calls `ride()` itself when it is still active
  };
}
