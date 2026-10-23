import { describe, expect, it } from "vitest";
import { Grace, type GraceTimers } from "./grace";

/** Timers that run by hand. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: GraceTimers = {
    setTimeout: (fn, ms) => { const id = next++; pending.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (h) => { pending.delete(h as number); },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...pending]) if (t.at <= now) { pending.delete(id); t.fn(); }
  };
  return { timers, advance, size: () => pending.size };
}

describe("Grace: a state applied after a delay, undone at once", () => {
  it("applies the state only after the delay", () => {
    const f = fakeTimers();
    const seen: boolean[] = [];
    const g = new Grace(20000, (on) => seen.push(on), f.timers);
    g.start();
    f.advance(19999);
    expect(seen).toEqual([]);
    expect(g.applied).toBe(false);
    f.advance(1);
    expect(seen).toEqual([true]);
    expect(g.applied).toBe(true);
  });
  it("never applies it to a window that is back in front before the delay", () => {
    const f = fakeTimers();
    const seen: boolean[] = [];
    const g = new Grace(20000, (on) => seen.push(on), f.timers);
    g.start();
    f.advance(5000);
    g.cancel();
    f.advance(60000);
    expect(seen).toEqual([]);
    expect(f.size()).toBe(0);
  });
  it("undoes an applied state at once, and starts afresh the next time", () => {
    const f = fakeTimers();
    const seen: boolean[] = [];
    const g = new Grace(1000, (on) => seen.push(on), f.timers);
    g.start();
    f.advance(1000);
    g.cancel();
    expect(seen).toEqual([true, false]);
    g.start();
    f.advance(500);
    expect(seen).toEqual([true, false]);
    f.advance(500);
    expect(seen).toEqual([true, false, true]);
  });
  it("starting twice is one timer; no delay applies at once; dispose applies nothing", () => {
    const f = fakeTimers();
    const seen: boolean[] = [];
    const g = new Grace(1000, (on) => seen.push(on), f.timers);
    g.start();
    g.start();
    expect(f.size()).toBe(1);
    g.dispose();
    f.advance(5000);
    expect(seen).toEqual([]);
    const now = new Grace(0, (on) => seen.push(on), f.timers);
    now.start();
    expect(seen).toEqual([true]);
  });
});
