/**
 * Idle rotation of the world view: the pure decisions (no DOM, no GL, time is passed in). The renderer feeds it input and asks
 * it, once per tick, how far to turn (engine/renderer.ts); docs/web-architecture.md, "Idle rotation".
 *
 * When the globe is fully unzoomed, nothing is selected and nobody has touched anything for `SPIN.idleMs`, the earth turns
 * slowly eastward (its surface moves to the right on screen, like the planet itself, so the view's longitude decreases).
 * Any input stops it at once. It never runs under reduced motion, in a hidden tab, with a place selected or hovered in the
 * list, with the detail panel open, past the unzoomed view, or while the street map owns the picture.
 */
import { DEG, clamp } from "./geo";

export interface SpinConfig {
  /** Master switch (`applySpinFlags`): off with `?no-rotate`, and by default in debug mode, where the browser checks assert zero frames at rest. */
  enabled: boolean;
  /** Time without input or camera motion before the globe starts to turn, ms. */
  idleMs: number;
  /** Rotation speed, degrees of longitude per second: 1.2 is one turn in five minutes. */
  degPerSec: number;
  /** "Fully unzoomed" = at most this many zoom levels above the whole-globe fit (a wheel at the minimum lands exactly on it; the slack absorbs rounding). */
  unzoomedSlack: number;
  /** The longest time one frame may advance the rotation, ms: a throttled timer must not make the globe jump. */
  maxStepMs: number;
  /** Bounds of the redraw period, ms. */
  minFrameMs: number;
  maxFrameMs: number;
}

export const SPIN_DEFAULTS: Readonly<SpinConfig> = {
  enabled: true,
  idleMs: 8000,
  degPerSec: 1.2,
  unzoomedSlack: 0.15,
  maxStepMs: 1000,
  minFrameMs: 50,
  maxFrameMs: 500,
};

/** Live configuration (module state, like `QUALITY`): `applySpinFlags` sets it from the page's flags before the renderer is built. */
export const SPIN: SpinConfig = { ...SPIN_DEFAULTS };

/**
 * Read the page's flags (call before the renderer is built):
 *  - `?no-rotate` (or sessionStorage "no-rotate" = "1"), on any page: off.
 *  - a page in debug mode (`?globe-debug`, what the browser checks run in) has it OFF by default, because the checks assert zero
 *    frames at rest for longer than the idle delay; `?rotate` (or sessionStorage "rotate" = "1") turns it back on there, and
 *    `?spin-idle=MS` (100 to 600000, debug only) does too and shortens the delay.
 */
export function applySpinFlags(): void {
  Object.assign(SPIN, SPIN_DEFAULTS);
  try {
    const q = new URLSearchParams(location.search);
    const flag = (name: string) => q.get(name) ?? sessionStorage.getItem(name);
    const debug = q.has("globe-debug") || sessionStorage.getItem("globe-debug") === "1";
    const ms = Number(flag("spin-idle"));
    const wanted = !debug || q.has("rotate") || sessionStorage.getItem("rotate") === "1" || flag("spin-idle") !== null;
    if (q.has("no-rotate") || sessionStorage.getItem("no-rotate") === "1" || !wanted) SPIN.enabled = false;
    if (debug && ms >= 100 && ms <= 600_000) SPIN.idleMs = ms;
  } catch {
    // no storage: keep the defaults
  }
}

/** What the decision depends on, read from the renderer when asked. */
export interface SpinContext {
  reduced: boolean;
  /** The tab is hidden. */
  hidden: boolean;
  /** The GL context is lost. */
  lost: boolean;
  /** The street map owns the picture (the globe is suspended). */
  suspended: boolean;
  /** A place is selected, or the places list is hovering / focusing one. */
  selected: boolean;
  focused: boolean;
  /** CSS px covered by the detail panel (the inset it is heading for). */
  inset: number;
  zoom: number;
  /** Zoom at which the whole globe fits the free area. */
  minZoom: number;
  /** A drag or press, a flight, inertia or the inset slide is under way. */
  busy: boolean;
}

export type SpinBlock =
  | "disabled"
  | "reduced-motion"
  | "hidden"
  | "context-lost"
  | "street"
  | "place-selected"
  | "place-focused"
  | "panel-open"
  | "zoomed-in"
  | "camera-busy";

/** Why the globe must not turn now, or null when it may. The first reason in this order wins. */
export function spinBlock(c: SpinContext, cfg: SpinConfig = SPIN): SpinBlock | null {
  if (!cfg.enabled) return "disabled";
  if (c.reduced) return "reduced-motion";
  if (c.hidden) return "hidden";
  if (c.lost) return "context-lost";
  if (c.suspended) return "street";
  if (c.selected) return "place-selected";
  if (c.focused) return "place-focused";
  if (c.inset > 0) return "panel-open";
  if (c.zoom > c.minZoom + cfg.unzoomedSlack) return "zoomed-in";
  if (c.busy) return "camera-busy";
  return null;
}

/** Degrees of eastward rotation over `dtMs` (capped at `maxStepMs`). */
export function yawStepDeg(dtMs: number, cfg: SpinConfig = SPIN): number {
  return (clamp(dtMs, 0, cfg.maxStepMs) / 1000) * cfg.degPerSec;
}

/**
 * Period between redraws while turning, ms: the time the disc's fastest point (its centre, at the equator) takes to move one art
 * pixel, within bounds. A redraw that moves nothing is not worth a frame: at a 1440 px wide screen this is about 3 frames a second.
 */
export function spinFrameMs(artPixelCss: number, radiusCss: number, cfg: SpinConfig = SPIN): number {
  const pxPerSec = cfg.degPerSec * DEG * radiusCss;
  return pxPerSec > 0 ? clamp((1000 * artPixelCss) / pxPerSec, cfg.minFrameMs, cfg.maxFrameMs) : cfg.maxFrameMs;
}

/**
 * The idle clock and the turning state. `activity` is every input and every camera motion; `wait` says when the renderer must
 * look again (a timer, not a frame); `step` runs once per tick and returns the rotation to apply.
 */
export class IdleSpin {
  /** Turning now: the renderer keeps scheduling frames at `spinFrameMs`. */
  spinning = false;
  private lastActivity: number;
  private lastStep = 0;

  constructor(now: number) {
    this.lastActivity = now;
  }

  /** Input or camera motion (or a change of any condition): stop at once and restart the idle clock. */
  activity(now: number): void {
    this.lastActivity = now;
    this.spinning = false;
  }

  /** Ms until the globe may start turning (0 = now), or null when something blocks it (nothing to wait for). */
  wait(now: number, c: SpinContext, cfg: SpinConfig = SPIN): number | null {
    if (spinBlock(c, cfg)) return null;
    return Math.max(0, this.lastActivity + cfg.idleMs - now);
  }

  /** Degrees of eastward rotation to apply for the frame at `now`: 0 while waiting, on the frame that starts the turn, and when blocked. */
  step(now: number, c: SpinContext, cfg: SpinConfig = SPIN): number {
    if (spinBlock(c, cfg)) {
      this.spinning = false;
      return 0;
    }
    if (!this.spinning) {
      if (now - this.lastActivity < cfg.idleMs) return 0;
      this.spinning = true;
      this.lastStep = now;
      return 0;
    }
    const dt = now - this.lastStep;
    this.lastStep = now;
    return yawStepDeg(dt, cfg);
  }
}
