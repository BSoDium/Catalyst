import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interludeLook, PLAY_INTERLUDE_EVENT, PREPARE_INTERLUDE_EVENT, prepareInterlude, requestInterlude, type PlayInterludeRequest } from "./interlude";

describe("asking for the interlude", () => {
  beforeEach(() => vi.stubGlobal("window", new EventTarget()));
  afterEach(() => vi.unstubAllGlobals());
  it("is taken when a globe answers, and not when none does", () => {
    expect(requestInterlude()).toBe(false);
    const on = (e: Event) => {
      (e as CustomEvent<PlayInterludeRequest>).detail.handled = true;
    };
    window.addEventListener(PLAY_INTERLUDE_EVENT, on);
    expect(requestInterlude()).toBe(true);
    window.removeEventListener(PLAY_INTERLUDE_EVENT, on);
    expect(requestInterlude()).toBe(false);
  });
  it("announces that the visitor can ask for it, to whoever listens, and is a no-op without a window", () => {
    let heard = 0;
    const on = () => heard++;
    window.addEventListener(PREPARE_INTERLUDE_EVENT, on);
    prepareInterlude();
    expect(heard).toBe(1);
    window.removeEventListener(PREPARE_INTERLUDE_EVENT, on);
    vi.unstubAllGlobals();
    expect(() => prepareInterlude()).not.toThrow();
  });
});

describe("interludeLook", () => {
  /** Runs a land curve through the rule, one frame a step, and counts the changes of state. */
  const run = (lands: number[]) => {
    let on = false;
    let prev = 0;
    let changes = 0;
    for (const land of lands) {
      const next = interludeLook(on, land, prev);
      if (next !== on) changes++;
      on = next;
      prev = land;
    }
    return { on, changes };
  };
  const ramp = (from: number, to: number, n: number) => Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
  it("goes on once as the land comes in and off once as it goes out, with no flicker on the way out", () => {
    const r = run([...ramp(0, 1, 40), ...Array(30).fill(1), ...ramp(1, 0, 60)]);
    expect(r.changes).toBe(2);
    expect(r.on).toBe(false);
  });
  it("stays on through the middle and off while the land falls from 0.4 to 0", () => {
    expect(interludeLook(true, 0.7, 0.72)).toBe(true);
    expect(interludeLook(true, 0.3, 0.32)).toBe(false);
    expect(interludeLook(false, 0.2, 0.22)).toBe(false);
    expect(interludeLook(false, 0.02, 0.04)).toBe(false);
  });
  it("comes on again when the land comes in again", () => {
    expect(interludeLook(false, 0.05, 0.02)).toBe(true);
  });
});
