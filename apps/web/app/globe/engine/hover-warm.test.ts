import { beforeEach, describe, expect, it } from "vitest";
import { layoutProbe, resetHoverWarm, warmHover, type HoverWarmDoc } from "./hover-warm";

type Listener = (e: { pointerType?: string }) => void;
function rig() {
  const listeners = new Set<Listener>();
  const host = {
    addEventListener: (_t: "pointermove", fn: Listener) => void listeners.add(fn),
    removeEventListener: (_t: "pointermove", fn: Listener) => void listeners.delete(fn),
  };
  const log: string[] = [];
  const doc: HoverWarmDoc = {
    createElement: () => ({ style: {}, setAttribute: () => undefined, getBoundingClientRect: () => void log.push("layout"), remove: () => void log.push("remove") }),
    body: { append: () => void log.push("append") },
  };
  const idle: (() => void)[] = [];
  const move = (pointerType: string) => [...listeners].forEach((l) => l({ pointerType }));
  return { host, doc, log, listeners, idle, move, schedule: (fn: () => void) => void idle.push(fn) };
}

beforeEach(resetHoverWarm);

describe("the early layout change that takes the first hover recompute out of the first drag", () => {
  it("the probe adds, lays out and removes an element", () => {
    const r = rig();
    layoutProbe(r.doc);
    expect(r.log).toEqual(["append", "layout", "remove"]);
  });
  it("waits for the first MOUSE move, then does the work in an idle period, once", () => {
    const r = rig();
    warmHover(r.host, r.doc, r.schedule);
    r.move("touch");
    r.move("pen");
    expect(r.idle.length).toBe(0);
    r.move("mouse");
    expect(r.idle.length).toBe(1);
    expect(r.log).toEqual([]); // nothing in the event handler itself: the idle period does it
    r.idle[0]!();
    expect(r.log).toEqual(["append", "layout", "remove"]);
    expect(r.listeners.size).toBe(0);
    r.move("mouse");
    expect(r.idle.length).toBe(1);
  });
  it("once per page: a second attach after the work is scheduled does nothing", () => {
    const a = rig();
    warmHover(a.host, a.doc, a.schedule);
    a.move("mouse");
    const b = rig();
    warmHover(b.host, b.doc, b.schedule);
    expect(b.listeners.size).toBe(0);
  });
  it("the returned function withdraws the listener", () => {
    const r = rig();
    const off = warmHover(r.host, r.doc, r.schedule);
    expect(r.listeners.size).toBe(1);
    off();
    expect(r.listeners.size).toBe(0);
  });
  it("no body, no work", () => {
    const r = rig();
    layoutProbe({ ...r.doc, body: null });
    expect(r.log).toEqual([]);
  });
});
