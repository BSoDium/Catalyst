import { afterEach, describe, expect, it, vi } from "vitest";
import { watchDevicePixelRatio } from "./dpr";

type Listener = () => void;

/** Minimal matchMedia: each query keeps its listeners; `fire` simulates the browser reporting a change. */
function fakeWindow() {
  const queries: { media: string; listeners: Map<Listener, boolean> }[] = [];
  const win = {
    devicePixelRatio: 2,
    matchMedia(media: string) {
      const q = { media, listeners: new Map<Listener, boolean>() };
      queries.push(q);
      return {
        media,
        addEventListener: (_: string, fn: Listener, opts?: { once?: boolean }) => q.listeners.set(fn, !!opts?.once),
        removeEventListener: (_: string, fn: Listener) => q.listeners.delete(fn),
      };
    },
  };
  const fire = (i: number) => {
    const q = queries[i]!;
    for (const [fn, once] of [...q.listeners]) {
      if (once) q.listeners.delete(fn);
      fn();
    }
  };
  return { win, queries, fire };
}

afterEach(() => vi.unstubAllGlobals());

describe("watchDevicePixelRatio", () => {
  it("watches the current ratio, notifies on change and re-arms for the new ratio", () => {
    const { win, queries, fire } = fakeWindow();
    vi.stubGlobal("window", win);
    const onChange = vi.fn();
    watchDevicePixelRatio(onChange);
    expect(queries[0]!.media).toBe("(resolution: 2dppx)");
    win.devicePixelRatio = 1.25;
    fire(0);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(queries[1]!.media).toBe("(resolution: 1.25dppx)");
    fire(1);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("stops notifying after cleanup", () => {
    const { win, fire } = fakeWindow();
    vi.stubGlobal("window", win);
    const onChange = vi.fn();
    const stop = watchDevicePixelRatio(onChange);
    stop();
    fire(0);
    expect(onChange).not.toHaveBeenCalled();
  });
});
