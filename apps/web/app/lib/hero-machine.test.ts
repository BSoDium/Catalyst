import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHeroMachine, HERO_IDLE_MS, isWorldView, showcaseOf, WORLD_ZOOM01, type HeroMachine } from "./hero-machine";

describe("showcaseOf: when the home screen shows the caption and lifts the planet", () => {
  it("is on only for the full hero at the world view, with the measured cover; off, the planet comes back down", () => {
    expect(showcaseOf({ state: "rest", world: true }, 182)).toEqual({ on: true, coverBottom: 182 });
    expect(showcaseOf({ state: "collapsed", world: true }, 182)).toEqual({ on: false, coverBottom: 0 });
    expect(showcaseOf({ state: "rest", world: false }, 182)).toEqual({ on: false, coverBottom: 0 });
    expect(showcaseOf({ state: "collapsed", world: false }, 182)).toEqual({ on: false, coverBottom: 0 });
    expect(showcaseOf({ state: "rest", world: true }, -5)).toEqual({ on: true, coverBottom: 0 });
  });

  it("follows the machine: a gesture ends it, the idle period brings it back", () => {
    vi.useFakeTimers();
    try {
      const m = createHeroMachine();
      expect(showcaseOf(m.getSnapshot(), 100).on).toBe(true);
      m.interact();
      expect(showcaseOf(m.getSnapshot(), 100).on).toBe(false);
      vi.advanceTimersByTime(HERO_IDLE_MS);
      expect(showcaseOf(m.getSnapshot(), 100).on).toBe(true);
      m.setWorld(false);
      expect(showcaseOf(m.getSnapshot(), 100).on).toBe(false);
      m.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a hero born collapsed (the visitor came back to the home page from another)", () => {
  it("still comes back when its host's effect is cleaned up and run again (StrictMode: stop, then start)", () => {
    vi.useFakeTimers();
    try {
      const m = createHeroMachine({ initial: "collapsed" });
      m.stop();
      m.start();
      vi.advanceTimersByTime(HERO_IDLE_MS);
      expect(m.getSnapshot().state).toBe("rest");
      m.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the header, then brings the full hero back after the idle delay with no gesture", () => {
    vi.useFakeTimers();
    try {
      const m = createHeroMachine({ initial: "collapsed" });
      expect(m.getSnapshot().state).toBe("collapsed");
      expect(showcaseOf(m.getSnapshot(), 100).on).toBe(false);
      vi.advanceTimersByTime(HERO_IDLE_MS);
      expect(m.getSnapshot().state).toBe("rest");
      m.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("isWorldView", () => {
  it("is the whole globe, within the slack, and never the street map", () => {
    expect(isWorldView({ zoom: 0 })).toBe(true);
    expect(isWorldView({ zoom: WORLD_ZOOM01 })).toBe(true);
    expect(isWorldView({ zoom: WORLD_ZOOM01 + 0.01 })).toBe(false);
    expect(isWorldView({ zoom: 1 })).toBe(false);
    expect(isWorldView({ zoom: 0, street: 2 })).toBe(false);
    expect(isWorldView({ zoom: 0, street: 0 })).toBe(true);
  });
  it("counts a view that has not been reported yet as the world view (the globe starts there)", () => {
    expect(isWorldView(null)).toBe(true);
    expect(isWorldView(undefined)).toBe(true);
  });
});

describe("hero machine", () => {
  let machine: HeroMachine;
  let changes: number;
  beforeEach(() => {
    vi.useFakeTimers();
    machine = createHeroMachine();
    changes = 0;
    machine.subscribe(() => changes++);
  });
  afterEach(() => {
    machine.stop();
    vi.useRealTimers();
  });
  const state = () => machine.getSnapshot().state;

  it("starts at rest, at the world view, with no timer (a page nobody touches schedules nothing)", () => {
    expect(machine.getSnapshot()).toEqual({ state: "rest", world: true, interlude: false });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * HERO_IDLE_MS);
    expect(state()).toBe("rest");
    expect(changes).toBe(0);
  });

  it("collapses on the first interaction and comes back after the idle delay at the world view", () => {
    machine.interact();
    expect(state()).toBe("collapsed");
    vi.advanceTimersByTime(HERO_IDLE_MS - 1);
    expect(state()).toBe("collapsed");
    vi.advanceTimersByTime(1);
    expect(state()).toBe("rest");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restore brings the full hero back at once at the world view, and does nothing away from it", () => {
    machine.interact();
    machine.restore();
    expect(state()).toBe("rest");
    expect(vi.getTimerCount()).toBe(0);
    machine.setWorld(false);
    machine.restore();
    expect(state()).toBe("collapsed");
  });

  it("every further input restarts the idle clock", () => {
    machine.interact();
    vi.advanceTimersByTime(HERO_IDLE_MS - 100);
    machine.interact();
    vi.advanceTimersByTime(HERO_IDLE_MS - 100);
    expect(state()).toBe("collapsed");
    vi.advanceTimersByTime(100);
    expect(state()).toBe("rest");
  });

  it("holds one timer at most, however many inputs come in", () => {
    for (let i = 0; i < 50; i++) machine.interact();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("notifies once per change, not per input", () => {
    machine.interact();
    machine.interact();
    machine.interact();
    expect(changes).toBe(1);
    vi.advanceTimersByTime(HERO_IDLE_MS);
    expect(changes).toBe(2);
  });

  it("does not come back while zoomed in or with a place open, and counts the idle time from the return to the world view", () => {
    machine.interact();
    vi.advanceTimersByTime(2000);
    machine.setWorld(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * HERO_IDLE_MS);
    expect(state()).toBe("collapsed");
    machine.setWorld(true);
    vi.advanceTimersByTime(HERO_IDLE_MS - 1);
    expect(state()).toBe("collapsed");
    vi.advanceTimersByTime(1);
    expect(state()).toBe("rest");
  });

  it("an input away from the world view arms nothing", () => {
    machine.setWorld(false);
    machine.interact();
    machine.interact();
    expect(vi.getTimerCount()).toBe(0);
    expect(state()).toBe("collapsed");
  });

  it("leaving the world view collapses a resting hero (a deep link to a place, then Close: the landing is not shown over a zoomed map)", () => {
    machine.setWorld(false);
    expect(machine.getSnapshot()).toEqual({ state: "collapsed", world: false, interlude: false });
    machine.setWorld(true);
    // nothing was touched since: it still waits the idle delay, it does not pop back mid-gesture
    expect(state()).toBe("collapsed");
    vi.advanceTimersByTime(HERO_IDLE_MS);
    expect(state()).toBe("rest");
  });

  it("an input at the world view after a long collapse restarts the delay", () => {
    machine.interact();
    vi.advanceTimersByTime(HERO_IDLE_MS);
    expect(state()).toBe("rest");
    machine.interact();
    expect(state()).toBe("collapsed");
    vi.advanceTimersByTime(HERO_IDLE_MS);
    expect(state()).toBe("rest");
  });

  describe("hold (the focus is in the header or in a dialog)", () => {
    it("keeps a collapsed hero collapsed however long the idle time, then starts a whole idle period when released", () => {
      machine.interact();
      vi.advanceTimersByTime(2000);
      machine.hold(true);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10 * HERO_IDLE_MS);
      expect(state()).toBe("collapsed");
      machine.hold(false);
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(HERO_IDLE_MS - 1);
      expect(state()).toBe("collapsed");
      vi.advanceTimersByTime(1);
      expect(state()).toBe("rest");
    });

    it("arms nothing on an input while held, and on release only when the way back is real (collapsed, at the world view)", () => {
      machine.hold(true);
      machine.interact();
      expect(state()).toBe("collapsed");
      expect(vi.getTimerCount()).toBe(0);
      machine.setWorld(false);
      machine.hold(false);
      expect(vi.getTimerCount()).toBe(0);
      machine.setWorld(true);
      expect(vi.getTimerCount()).toBe(1);
    });

    it("releasing a hold that was never taken, or a hold at rest, owns no timer and changes nothing", () => {
      machine.hold(false);
      machine.hold(true);
      machine.hold(false);
      expect(vi.getTimerCount()).toBe(0);
      expect(changes).toBe(0);
      expect(machine.getSnapshot()).toEqual({ state: "rest", world: true, interlude: false });
    });
  });

  it("honours another idle delay and injected timers", () => {
    const timers = { setTimeout: vi.fn(() => 7), clearTimeout: vi.fn() };
    const custom = createHeroMachine({ idleMs: 250, timers });
    custom.interact();
    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 250);
    custom.interact();
    expect(timers.clearTimeout).toHaveBeenCalledWith(7);
    custom.stop();
    expect(timers.clearTimeout).toHaveBeenCalledTimes(2);
  });

  it("returns a new snapshot object only when something changed (a valid external-store snapshot)", () => {
    const a = machine.getSnapshot();
    machine.setWorld(true);
    expect(machine.getSnapshot()).toBe(a);
    machine.interact();
    const b = machine.getSnapshot();
    expect(b).not.toBe(a);
    machine.interact();
    expect(machine.getSnapshot()).toBe(b);
  });

  it("unsubscribes", () => {
    const m = createHeroMachine();
    const fn = vi.fn();
    const off = m.subscribe(fn);
    m.interact();
    off();
    m.setWorld(false);
    expect(fn).toHaveBeenCalledTimes(1);
    m.stop();
  });
});

describe("a place or an entry opens and closes: the hero never shows its resting state on the way back", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Every state the machine passes through (what a render could have shown), from a listener. */
  function watch(m: HeroMachine): string[] {
    const seen: string[] = [`${m.getSnapshot().state}/${m.getSnapshot().world}`];
    m.subscribe(() => seen.push(`${m.getSnapshot().state}/${m.getSnapshot().world}`));
    return seen;
  }

  it("opening a place from the resting hero goes straight to collapsed; closing it with the view still zoomed in stays collapsed (no rest, no timer)", () => {
    const m = createHeroMachine();
    const seen = watch(m);
    m.setWorld(false); // the panel opens: the shell says the view is not the world view
    expect(m.getSnapshot()).toEqual({ state: "collapsed", world: false, interlude: false });
    // the panel closes: the view is still the place's, so nothing changes
    m.setWorld(false);
    vi.advanceTimersByTime(HERO_IDLE_MS * 3);
    expect(m.getSnapshot()).toEqual({ state: "collapsed", world: false, interlude: false });
    expect(seen).toEqual(["rest/true", "collapsed/false"]);
    m.stop();
  });

  it("closing it with the view back at the world view returns to rest only after the idle delay, never at once", () => {
    const m = createHeroMachine();
    m.setWorld(false);
    const seen = watch(m);
    m.setWorld(true); // the view is the world view again (and the panel is closed)
    expect(m.getSnapshot().state).toBe("collapsed");
    vi.advanceTimersByTime(HERO_IDLE_MS - 1);
    expect(m.getSnapshot().state).toBe("collapsed");
    vi.advanceTimersByTime(1);
    expect(m.getSnapshot().state).toBe("rest");
    expect(seen).toEqual(["collapsed/false", "collapsed/true", "rest/true"]);
    m.stop();
  });

  it("a hero that was collapsed when the place opened comes back collapsed too", () => {
    const m = createHeroMachine();
    m.interact();
    m.setWorld(false);
    m.setWorld(false);
    expect(m.getSnapshot()).toEqual({ state: "collapsed", world: false, interlude: false });
    m.stop();
  });
});

describe("the interlude's look", () => {
  it("is a flag apart from the state: the showcase and the idle clock are not touched, and it is announced once", () => {
    const m = createHeroMachine({ idleMs: 8000, timers: { setTimeout: () => 1, clearTimeout: () => {} } });
    const seen: boolean[] = [];
    m.subscribe(() => seen.push(m.getSnapshot().interlude));
    m.setInterlude(true);
    m.setInterlude(true);
    expect(m.getSnapshot()).toEqual({ state: "rest", world: true, interlude: true });
    expect(showcaseOf(m.getSnapshot(), 100).on).toBe(true);
    m.setInterlude(false);
    expect(seen).toEqual([true, false]);
  });
});
