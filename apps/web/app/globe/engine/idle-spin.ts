/**
 * Idle rotation of the world view: the pure decisions (no DOM, no GL, time is passed in). The renderer feeds it input and asks
 * it, once per frame, how far to turn (engine/renderer.ts); docs/web-architecture.md, "Idle rotation".
 *
 * When the globe is fully unzoomed, nothing is selected and nobody has touched anything for `SPIN.idleMs`, the earth turns
 * slowly eastward (its surface moves to the right on screen, like the planet itself, so the view's longitude decreases).
 * It has inertia: it accelerates from rest along a smoothstep over `SPIN.easeInMs`, and when it must stop for a reason that is
 * not an input (a place selected from the URL or the list, the panel opening, ...) it coasts to rest over `SPIN.stopMs` instead of
 * freezing. A direct input (pointer, wheel, key, touch) stops it at once: the user's own gesture takes over, and not one more
 * degree is applied after the event. It never runs under reduced motion, in a hidden tab, with a place selected or hovered in the
 * list, with the detail panel open, past the unzoomed view, or while the street map owns the picture.
 *
 * The velocity is part of this state machine and every step is the exact integral of the velocity profile over the elapsed
 * time, so the angle depends on the clock and not on how many frames it took (a 30, 60 or 120 Hz display turns the same).
 */
import { clamp, smoothstep } from "./geo";

export interface SpinConfig {
  /** Master switch (`applySpinFlags`): off with `?no-rotate`, and by default in debug mode, where the browser checks assert zero frames at rest. */
  enabled: boolean;
  /** Time without input or camera motion before the globe starts to turn, ms. */
  idleMs: number;
  /**
   * Cruise speed, degrees of longitude per second: 0.2 is one turn in 30 minutes. Chosen from measurements (docs/web-architecture.md, "Idle
   * rotation": label events per minute at 4, 1.2, 0.6, 0.3, 0.2 and 0.15 degrees a second): the labels stop flickering below 0.3 and the
   * globe still moves every frame, by a few dozen pixels (a pixel-art globe cannot move smoother than one art pixel per frame, so the motion
   * is spread over the frames: each one changes about 40 pixels instead of the 650 of the 4 deg/s version). At 1440x900 the disc's
   * centre moves one art pixel (2.5 css px) every 1.35 s.
   */
  degPerSec: number;
  /** Time to reach the cruise speed from rest (smoothstep velocity), ms. */
  easeInMs: number;
  /** Time to coast to rest when it must stop for a reason that is not an input, ms. */
  stopMs: number;
  /** "Fully unzoomed" = at most this many zoom levels above the whole-globe fit (a wheel at the minimum lands exactly on it; the slack absorbs rounding). */
  unzoomedSlack: number;
  /** The longest time one frame may advance the rotation and its ease, ms: a stalled frame must not make the globe jump. */
  maxStepMs: number;
  /**
   * Redraw period floor while turning, ms: 0 = a frame on every animation frame, i.e. at the display's own rate (60, 90, 120 Hz...). A floor
   * above 0 skips the frames that come sooner than that; 14 (the first version's, for 120 Hz screens) drew 60 a second there, 45 on a 90 Hz
   * one and 37 on a 75 Hz one, which is choppier than the display allows, to save a GPU cost of 0.3 ms a frame.
   */
  minFrameMs: number;
}

export const SPIN_DEFAULTS: Readonly<SpinConfig> = {
  enabled: true,
  idleMs: 8000,
  degPerSec: 0.2,
  easeInMs: 3000,
  stopMs: 1000,
  unzoomedSlack: 0.15,
  // (the largest step must exceed the paced frame period, `ENERGY.spinFrameMs` 100 and a timer's jitter: a step clipped to it would turn slower)
  maxStepMs: 250,
  minFrameMs: 0,
};

/** Live configuration (module state, like `QUALITY`): `applySpinFlags` sets it from the page's flags before the renderer is built. */
export const SPIN: SpinConfig = { ...SPIN_DEFAULTS };

/**
 * Read the page's flags (call before the renderer is built):
 *  - `?no-rotate` (or sessionStorage "no-rotate" = "1"), on any page: off.
 *  - a page in debug mode (`?globe-debug`, what the browser checks run in) has it OFF by default, because the checks assert zero
 *    frames at rest for longer than the idle delay; `?rotate` (or sessionStorage "rotate" = "1") turns it back on there, and
 *    `?spin-idle=MS` (100 to 600000, debug only) does too and shortens the delay.
 *  - `?spin-speed=DEG` (0.01 to 20 degrees a second, debug only) turns it on there with another cruise speed: the measurements that
 *    chose `degPerSec` (label slot changes per minute at each candidate speed, docs/web-architecture.md) run the real engine at them.
 */
export function applySpinFlags(): void {
  Object.assign(SPIN, SPIN_DEFAULTS);
  try {
    const q = new URLSearchParams(location.search);
    const flag = (name: string) => q.get(name) ?? sessionStorage.getItem(name);
    const debug = q.has("globe-debug") || sessionStorage.getItem("globe-debug") === "1";
    const ms = Number(flag("spin-idle"));
    const speed = Number(flag("spin-speed"));
    const wanted = !debug || q.has("rotate") || sessionStorage.getItem("rotate") === "1" || flag("spin-idle") !== null || flag("spin-speed") !== null;
    if (q.has("no-rotate") || sessionStorage.getItem("no-rotate") === "1" || !wanted) SPIN.enabled = false;
    if (debug && ms >= 100 && ms <= 600_000) SPIN.idleMs = ms;
    if (debug && speed >= 0.01 && speed <= 20) SPIN.degPerSec = speed;
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

/**
 * Reasons that stop it at once, with no coasting: the picture is not (or must not be) animated any more. Every other reason
 * (a place selected or focused, the panel, the zoom, a flight or the inset slide) lets it coast to rest over `stopMs`.
 */
const HARD_BLOCKS: ReadonlySet<SpinBlock> = new Set(["disabled", "reduced-motion", "hidden", "context-lost", "street"]);

/** Integral of `smoothstep` from 0 to u, for u in [0, 1]: the ease-in's distance in units of (cruise speed x ease time). */
const smoothstepIntegral = (u: number) => u * u * u - (u * u * u * u) / 2;

/** Speed (deg/s) `rampMs` after the start from rest: smoothstep from 0 to the cruise speed over `easeInMs`. */
export function easeInSpeed(rampMs: number, cfg: SpinConfig = SPIN): number {
  return cfg.degPerSec * smoothstep(clamp(rampMs / cfg.easeInMs, 0, 1));
}

/** Degrees turned from the start from rest until `rampMs` later (the exact integral of `easeInSpeed`; past the ease it keeps cruising). */
export function easeInAngle(rampMs: number, cfg: SpinConfig = SPIN): number {
  const u = clamp(rampMs / cfg.easeInMs, 0, 1);
  return cfg.degPerSec * (cfg.easeInMs / 1000) * smoothstepIntegral(u) + (cfg.degPerSec * Math.max(0, rampMs - cfg.easeInMs)) / 1000;
}

/** Speed (deg/s) `sinceMs` after a stop began at `v0`: a quadratic fade to exactly zero at `stopMs`, with an immediate deceleration (inertia) and a soft end. */
export function stopSpeed(v0: number, sinceMs: number, cfg: SpinConfig = SPIN): number {
  const w = 1 - clamp(sinceMs / cfg.stopMs, 0, 1);
  return v0 * w * w;
}

/** Degrees coasted from the start of the stop until `sinceMs` later (the exact integral of `stopSpeed`). */
export function stopAngle(v0: number, sinceMs: number, cfg: SpinConfig = SPIN): number {
  const w = 1 - clamp(sinceMs / cfg.stopMs, 0, 1);
  return (v0 * (cfg.stopMs / 1000) * (1 - w * w * w)) / 3;
}

/**
 * Whether the frames of the globe's loop are PACED by the idle rotation (at most one every `ENERGY.spinFrameMs`, 10 a second: the rotation moves one art
 * pixel every second or so, a frame changes nothing visible). Never while the caption animates (the cinematic interlude's pull-back and lean, an
 * entrance): those are timed pictures that need every display frame, and going through the rotation's pace made the interlude run at 5 to 10 a second.
 */
export function pacedByRotation(o: { spinning: boolean; forced: boolean; captionAnimating: boolean }): boolean {
  return o.spinning && !o.forced && !o.captionAnimating;
}

/** Whether a spin frame is due: at least `minFrameMs` since the previous drawn frame. */
export function spinFrameDue(now: number, lastDrawn: number, cfg: SpinConfig = SPIN): boolean {
  return now - lastDrawn >= cfg.minFrameMs;
}

export type SpinPhase = "idle" | "easing-in" | "cruise" | "stopping";

/**
 * The idle clock and the turning state. `activity` is every input (hard stop); `settle` is camera motion or a change of a condition
 * that is not an input (soft stop: it coasts); `wait` says when the renderer must look again (a timer, not a frame); `step` runs once
 * per frame while turning and returns the rotation to apply.
 */
export class IdleSpin {
  phase: SpinPhase = "idle";
  /** Angular speed now, degrees per second (0 at rest). */
  speed = 0;
  private lastActivity: number;
  private lastStep = 0;
  /** Time since the start from rest, ms (while easing in). */
  private ramp = 0;
  /** Speed when the stop began and time since, ms (while stopping). */
  private stopFrom = 0;
  private stopT = 0;

  constructor(now: number) {
    this.lastActivity = now;
  }

  /** Turning now (easing in, cruising or coasting to rest): the renderer keeps drawing a frame per display refresh. */
  get spinning(): boolean {
    return this.phase !== "idle";
  }

  /** Input: stop at once, with no coasting, and restart the idle clock. Not one more degree is applied afterwards. */
  activity(now: number): void {
    this.lastActivity = now;
    this.halt();
  }

  /** Camera motion or a change of a condition that is not an input: restart the idle clock; if it is turning it coasts to rest. */
  settle(now: number): void {
    this.lastActivity = now;
    if (this.phase === "easing-in" || this.phase === "cruise") this.beginStop();
  }

  /** Ms until the globe may start turning (0 = now), or null when something blocks it (nothing to wait for). */
  wait(now: number, c: SpinContext, cfg: SpinConfig = SPIN): number | null {
    if (spinBlock(c, cfg)) return null;
    return Math.max(0, this.lastActivity + cfg.idleMs - now);
  }

  /** Degrees of eastward rotation to apply for the frame at `now`: 0 while waiting, on the frame that starts the turn, and when blocked hard. */
  step(now: number, c: SpinContext, cfg: SpinConfig = SPIN): number {
    const block = spinBlock(c, cfg);
    if (this.phase === "idle") {
      if (block || now - this.lastActivity < cfg.idleMs) return 0;
      this.phase = "easing-in";
      this.ramp = 0;
      this.speed = 0;
      this.lastStep = now;
      return 0;
    }
    if (block && HARD_BLOCKS.has(block)) {
      this.halt();
      return 0;
    }
    if (block && this.phase !== "stopping") {
      this.lastActivity = now; // the idle delay counts from the moment it was told to stop, not from the last input
      this.beginStop();
    }
    const dt = clamp(now - this.lastStep, 0, cfg.maxStepMs);
    this.lastStep = now;
    return this.advance(dt, cfg);
  }

  private halt(): void {
    this.phase = "idle";
    this.speed = 0;
  }

  private beginStop(): void {
    if (this.speed <= 0) return this.halt();
    this.phase = "stopping";
    this.stopFrom = this.speed;
    this.stopT = 0;
  }

  private advance(dt: number, cfg: SpinConfig): number {
    if (this.phase === "stopping") {
      const t0 = this.stopT;
      const t1 = Math.min(cfg.stopMs, t0 + dt);
      this.stopT = t1;
      const deg = stopAngle(this.stopFrom, t1, cfg) - stopAngle(this.stopFrom, t0, cfg);
      this.speed = stopSpeed(this.stopFrom, t1, cfg);
      if (t1 >= cfg.stopMs) this.halt();
      return deg;
    }
    const t0 = this.ramp;
    const t1 = t0 + dt;
    this.ramp = Math.min(t1, cfg.easeInMs);
    this.speed = easeInSpeed(t1, cfg);
    if (t1 >= cfg.easeInMs) this.phase = "cruise";
    return easeInAngle(t1, cfg) - easeInAngle(t0, cfg);
  }
}
