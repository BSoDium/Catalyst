/**
 * Adaptive frame-budget governor: watches the intervals between consecutive animation frames while the camera moves and
 * steps the render quality down when the device cannot keep up, and back up when it clearly can.
 *
 * Pure (time is passed in) so it is unit tested; the handover feeds it from the camera tick and applies the levels:
 *   level 0  full quality
 *   level 1  the street map renders 2 map pixels per art cell per axis instead of 3 (less than half the map pixels; short dashes soften)
 *   level 2  the art pixel is one CSS pixel larger (3 -> 4 on desktop, 2 -> 3 on phones): fewer pixels in both renderers
 *
 * Rules, all there to avoid visible thrash:
 *  - only intervals between consecutive moving frames count (a gap above `gapMs` is idle time, not a slow frame);
 *  - a window of `window` samples must be full, and its p95 above `slowMs`, to step down;
 *  - one change at most every `dwellMs`; stepping up needs `calmMs` of a full window with p95 below `fastMs`;
 *  - a step up that is undone by a step down within `flapMs` locks the level for `lockMs` (it was the right level).
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

export class FrameGovernor {
  level = 0;
  private buf: number[] = [];
  private last = 0;
  private changedAt = -Infinity;
  private calmSince = 0;
  private upAt = -Infinity;
  private lockedUntil = -Infinity;

  constructor(private cfg: GovernorConfig = GOVERNOR) {}

  /** Record a frame at `now` (ms). Returns the new level when it changed, else null. */
  sample(now: number): number | null {
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    if (dt <= 0 || dt > this.cfg.gapMs) {
      // Idle gap: the window is about a continuous gesture, start it afresh.
      if (dt > this.cfg.gapMs) {
        this.buf.length = 0;
        this.calmSince = 0;
      }
      return null;
    }
    this.buf.push(dt);
    if (this.buf.length > this.cfg.window) this.buf.shift();
    if (this.buf.length < this.cfg.window) return null;
    const p95 = this.p95();
    if (p95 > this.cfg.slowMs) {
      this.calmSince = 0;
      if (this.level < this.cfg.maxLevel && now - this.changedAt >= this.cfg.dwellMs) return this.move(this.level + 1, now);
      return null;
    }
    if (p95 < this.cfg.fastMs && this.level > 0) {
      if (!this.calmSince) this.calmSince = now;
      if (now - this.calmSince >= this.cfg.calmMs && now - this.changedAt >= this.cfg.dwellMs && now >= this.lockedUntil) return this.move(this.level - 1, now);
    } else this.calmSince = 0;
    return null;
  }

  private p95(): number {
    const s = [...this.buf].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
  }

  private move(level: number, now: number): number {
    if (level > this.level && now - this.upAt < this.cfg.flapMs) this.lockedUntil = now + this.cfg.lockMs;
    if (level < this.level) this.upAt = now;
    this.level = level;
    this.changedAt = now;
    this.calmSince = 0;
    this.buf.length = 0;
    return level;
  }

  /** Measurement and tests: jump to a level (and restart the window). */
  force(level: number, now = 0): void {
    this.level = Math.max(0, Math.min(this.cfg.maxLevel, level));
    this.changedAt = now;
    this.buf.length = 0;
    this.calmSince = 0;
  }
}
