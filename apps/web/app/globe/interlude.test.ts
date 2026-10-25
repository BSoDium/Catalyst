import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAY_INTERLUDE_EVENT, PREPARE_INTERLUDE_EVENT, prepareInterlude, requestInterlude, type PlayInterludeRequest } from "./interlude";

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
