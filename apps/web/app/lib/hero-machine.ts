/**
 * The landing hero's state machine (docs/landing.md): pure, no DOM, no React, time and timers are injected.
 *
 *   rest  --interact (a gesture on the globe)-->  collapsed
 *   rest  --the view leaves the world view----->  collapsed   (zoomed in, or a place opened: the landing is behind the visitor)
 *   collapsed --`idleMs` without input, AT the world view-->  rest
 *
 * "At the world view" is `isWorldView` (the whole globe, no street map) with no place or panel open: the shell tells the machine through
 * `setWorld`. The idle clock only runs while that holds and restarts on every input; zooming in, or opening a place, stops it, and it is
 * restarted from that moment when the world view comes back (a visitor who zooms out is not interrupted by the hero a second later).
 *
 * The machine owns one timer at most, armed only by an interaction or by the world view coming back: a page at rest (nobody touching the
 * globe) owns none and a collapsed hero away from the world view owns none. It never polls and never reads the clock.
 *
 * The clock is also held while the visitor is working in the header or in a dialog (`hold`, fed by the keyboard focus): the way back
 * takes the header away (the hero's rows are the sections then), so a hero that came back under a focused header link, or under the open
 * search palette, would leave the focus on nothing. Releasing the hold starts a whole idle period, like any other input.
 */
import type { GlobeViewState } from "~/globe";

/** Idle time at the world view after which the full hero comes back, ms. The same delay as the globe's own idle rotation (engine/idle-spin.ts). */
export const HERO_IDLE_MS = 8000;

/**
 * Largest `GlobeViewState.zoom` ([0, 1] from the whole globe to the closest the world-scale globe goes) still counted as the world view.
 * The idle rotation's own slack is 0.15 zoom levels over a range of about 5.3 (`TUNING.maxZoom` 6.5 less the whole-globe fit), that is
 * 0.03: a wheel at the minimum zoom lands exactly on 0, the slack absorbs rounding.
 */
export const WORLD_ZOOM01 = 0.03;

/** Whether a reported view is the world view: the whole globe (within the slack), never the street map. */
export function isWorldView(view: Pick<GlobeViewState, "zoom" | "street" | "world"> | null | undefined): boolean {
  if (!view) return true;
  // (on a narrow screen the world view is the closer zoom the planet takes when it is taken: the renderer says so, `GlobeViewState.world`)
  return (view.zoom <= WORLD_ZOOM01 || view.world === true) && (view.street ?? 0) === 0;
}

export type HeroState = "rest" | "collapsed";

/**
 * What the globe is told about the home screen (`GlobeProps.showcase`): the showcase (the caption in, the boxes and labels out, the planet
 * lifted clear of the name) is ON while the full hero is at rest AT the world view, and only then; `coverBottom` is the height the name covers at
 * the bottom of the page then (0 when the showcase is off: the planet comes back down). Pure.
 */
export function showcaseOf(snapshot: { state: HeroState; world: boolean }, coverPx: number): { on: boolean; coverBottom: number } {
  const on = snapshot.state === "rest" && snapshot.world;
  return { on, coverBottom: on ? Math.max(0, coverPx) : 0 };
}

/** What a renderer of the hero reads. Replaced (never mutated) on every change, so it is a valid external-store snapshot. */
export interface HeroSnapshot {
  readonly state: HeroState;
  /** The view is the world view with nothing open: the full hero is allowed to come back (the "back to start" hint is true). */
  readonly world: boolean;
  /** The cinematic interlude is under way: the hero takes the collapsed look (the small name, no rows) for its length, whatever its state (`setInterlude`). */
  readonly interlude: boolean;
}

export interface HeroTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface HeroMachine {
  getSnapshot(): HeroSnapshot;
  subscribe(listener: () => void): () => void;
  /** The visitor started a gesture on the globe (pointer down, wheel, pinch). Collapses a resting hero; restarts the idle clock. */
  interact(): void;
  /** Whether the view is the world view with nothing open. Leaving it collapses the hero and stops the clock; coming back restarts it. */
  setWorld(world: boolean): void;
  /** The visitor's focus is in the header or in a dialog: the hero stays as it is (no way back) until it is released, then the idle period starts anew. */
  hold(held: boolean): void;
  /**
   * The cinematic interlude begins or ends (the globe says so). Only the LOOK changes, not the state: the showcase stays on (the interlude plays on its caption)
   * and the idle clock is not touched; the hero shrinks to its small name while it plays and grows back after it, if it is still at rest.
   */
  setInterlude(active: boolean): void;
  /** The visitor asked for something only the full hero shows (the cinematic interlude): bring it back now if the view is the world view. */
  restore(): void;
  /** Cancel the timer (the host is going away). The machine stays usable. */
  stop(): void;
  /** The host is (back) in place: restart the idle clock a `stop` cancelled, as an effect that is cleaned up and run again (React StrictMode) needs. */
  start(): void;
}

const browserTimers: HeroTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createHeroMachine({ idleMs = HERO_IDLE_MS, timers = browserTimers, initial = "rest" }: { idleMs?: number; timers?: HeroTimers; initial?: HeroState } = {}): HeroMachine {
  let snapshot: HeroSnapshot = { state: initial, world: true, interlude: false };
  let timer: unknown = null;
  let held = false;
  const listeners = new Set<() => void>();

  const set = (next: Partial<HeroSnapshot>) => {
    const merged = { ...snapshot, ...next };
    if (merged.state === snapshot.state && merged.world === snapshot.world && merged.interlude === snapshot.interlude) return;
    snapshot = merged;
    for (const listener of [...listeners]) listener();
  };
  const clear = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  /** (Re)start the idle clock; it only runs for a collapsed hero at the world view, and not while the focus is held in the header or a dialog. */
  const arm = () => {
    clear();
    if (held || snapshot.state !== "collapsed" || !snapshot.world) return;
    timer = timers.setTimeout(() => {
      timer = null;
      if (snapshot.state === "collapsed" && snapshot.world) set({ state: "rest" });
    }, idleMs);
  };

  // Born collapsed (the visitor came back to the home page from another): the full hero returns after the idle delay, as after a gesture.
  arm();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    interact() {
      set({ state: "collapsed" });
      arm();
    },
    setWorld(world) {
      if (world === snapshot.world) return;
      // Leaving the world view (zooming in, a place opening) is leaving the landing: the hero does not wait for a gesture to step back.
      set(world ? { world } : { world, state: "collapsed" });
      arm();
    },
    setInterlude(active) {
      set({ interlude: active });
    },
    hold(next) {
      if (next === held) return;
      held = next;
      arm();
    },
    restore() {
      if (!snapshot.world) return;
      clear();
      set({ state: "rest" });
    },
    stop: clear,
    start: arm,
  };
}
