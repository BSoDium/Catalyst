/**
 * Adaptive frame-budget governor: watches how long frames cost while the camera moves and steps the render quality down
 * when the device cannot keep up, and back up when it clearly can.
 *
 * Pure (time is passed in) so it is unit tested; the handover feeds it from the camera tick and applies the levels:
 *   level 0  full quality
 *   level 1  the street map renders 2 map pixels per art cell per axis instead of 3 (less than half the map pixels; short dashes soften)
 *   level 2  the art pixel is one CSS pixel larger (2.5 -> 3.5 on desktop, 2 -> 3 on phones): fewer pixels in both renderers
 *
 * What a frame COSTS (`FrameClock`, written by the renderer; see engine/renderer.ts `tick`):
 *  - a frame that is part of a running animation (a flight, inertia, the inset slide: the rAF chain continues) costs the
 *    interval since the previous frame, or its own main-thread work when that is longer;
 *  - any other frame (driven by a wheel tick, a drag event, a resize) costs its own main-thread work only. Its INTERVAL is set
 *    by whoever produced the input (a wheel notch every 50 to 100 ms), not by the device: reading it as the frame time was the
 *    root cause of the "pixels suddenly double in size and stay" bug (see the regression tests).
 * Without a renderer feeding the clock (`live` false: tests) the interval is the cost.
 *
 * Rules, all there to avoid visible thrash:
 *  - only frames between consecutive moving frames count (a gap above `gapMs` is idle time, not a slow frame);
 *  - a window of `window` samples must be full, its p95 above `slowMs` AND its median above `fastMs` to step down: a few
 *    hitches (a tile decode, a shader compile, the street map mounting) do not degrade, a device that is slow does;
 *  - one change at most every `dwellMs`;
 *  - stepping up needs a full window with p95 below `fastMs` and `calmMs` since the last slow evidence or change. Idle time
 *    counts as calm (the old rule needed `calmMs` of UNINTERRUPTED motion, which a real gesture never lasts, so a degrade
 *    could not be undone): the camera comes to rest, and the first calm gesture afterwards restores the level;
 *  - a step up that is undone by a step down within `flapMs` locks the level for `lockMs` (it was the right level), twice as
 *    long each time that happens again (up to 8x): a device that is really slow settles instead of oscillating.
 * Every change is logged (`console.info`) and kept in `history`, so a quality change is never silent.
 */
export interface GovernorConfig {
  window: number;
  slowMs: number;
  fastMs: number;
  gapMs: number;
  dwellMs: number;
  calmMs: number;
  flapMs: number;
  lockMs: number;
  maxLevel: number;
}

export const GOVERNOR: GovernorConfig = {
  window: 90,
  slowMs: 26, // p95 above this: below ~40 fps on a 60 Hz screen, a missed vsync every 20 frames or worse on a 120 Hz one
  fastMs: 18.5,
  gapMs: 100,
  dwellMs: 4000,
  calmMs: 10_000,
  flapMs: 20_000,
  lockMs: 90_000,
  maxLevel: 2,
};

/**
 * What the renderer tells the governor about the frame being drawn. One shared object (the renderer and the governor live in
 * different modules and the handover owns the governor): `renderer.tick` writes it before it draws.
 */
export interface FrameClock {
  /** A renderer is feeding this clock; false = every frame costs its interval (tests, legacy). */
  live: boolean;
  /** This frame continues a running animation (the previous tick asked for another frame). */
  continuous: boolean;
  /** Main-thread time of the previous frame (render, overlays, callbacks), ms. */
  workMs: number;
}

export const FRAME_CLOCK: FrameClock = { live: false, continuous: false, workMs: 0 };

export interface GovernorChange {
  at: number;
  from: number;
  to: number;
  p95: number;
  p50: number;
}

export class FrameGovernor {
  level = 0;
  /** The level changes so far (checks, and the answer to "why did the resolution change?"). */
  readonly history: GovernorChange[] = [];
  private buf: number[] = [];
  private last = 0;
  private changedAt = -Infinity;
  /** Time of the last evidence of slowness (a slow window) or change: calm is measured from here. */
  private slowAt = -Infinity;
  private upAt = -Infinity;
  private lockedUntil = -Infinity;
  private flaps = 0;

  constructor(
    private cfg: GovernorConfig = GOVERNOR,
    private clock: FrameClock = FRAME_CLOCK,
  ) {}

  /** What the frame at `dt` ms after the previous one cost (see the header). */
  private cost(dt: number): number {
    const c = this.clock;
    if (!c.live) return dt;
    return c.continuous ? Math.max(dt, c.workMs) : c.workMs;
  }

  /** Record a frame at `now` (ms). Returns the new level when it changed, else null. */
  sample(now: number): number | null {
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    if (dt <= 0 || dt > this.cfg.gapMs) {
      // Idle gap: the window is about a continuous gesture, start it afresh (idle time is calm: `slowAt` stays).
      if (dt > this.cfg.gapMs) this.buf.length = 0;
      return null;
    }
    this.buf.push(this.cost(dt));
    if (this.buf.length > this.cfg.window) this.buf.shift();
    if (this.buf.length < this.cfg.window) return null;
    const sorted = [...this.buf].sort((a, b) => a - b);
    const p95 = quantile(sorted, 0.95);
    const p50 = quantile(sorted, 0.5);
    if (p95 > this.cfg.slowMs && p50 > this.cfg.fastMs) {
      this.slowAt = now;
      if (this.level < this.cfg.maxLevel && now - this.changedAt >= this.cfg.dwellMs) return this.move(this.level + 1, now, p95, p50);
      return null;
    }
    if (p95 >= this.cfg.fastMs) {
      this.slowAt = now; // not calm: neither slow enough to degrade nor fast enough to recover
      return null;
    }
    if (this.level > 0 && now - this.slowAt >= this.cfg.calmMs && now - this.changedAt >= this.cfg.dwellMs && now >= this.lockedUntil) return this.move(this.level - 1, now, p95, p50);
    return null;
  }

  private move(level: number, now: number, p95: number, p50: number): number {
    if (level > this.level) {
      if (now - this.upAt < this.cfg.flapMs) this.lockedUntil = now + this.cfg.lockMs * 2 ** Math.min(this.flaps++, 3); // it was the right level: stay, longer each time it is proven
      else this.flaps = 0;
    }
    if (level < this.level) this.upAt = now;
    this.history.push({ at: now, from: this.level, to: level, p95, p50 });
    if (this.history.length > 32) this.history.shift();
    // A quality change is visible (the art pixel or the street resolution changes): never silent.
    if (typeof console !== "undefined") console.info(`[globe] render quality level ${this.level} -> ${level} (frame p95 ${p95.toFixed(1)} ms, median ${p50.toFixed(1)} ms)`);
    this.level = level;
    this.changedAt = now;
    this.slowAt = now;
    this.buf.length = 0;
    return level;
  }

  /** Measurement and tests: jump to a level (and restart the window). */
  force(level: number, now = 0): void {
    this.level = Math.max(0, Math.min(this.cfg.maxLevel, level));
    this.changedAt = now;
    this.slowAt = now;
    this.buf.length = 0;
  }
}

/** The `q` quantile (0..1) of an ascending array, nearest rank. */
function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
}
