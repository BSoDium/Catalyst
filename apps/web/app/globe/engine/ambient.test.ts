import { describe, expect, it, vi } from "vitest";
import { Ambient, type AudibleSource } from "./ambient";

function source(initial = false) {
  let v = initial;
  const listeners = new Set<() => void>();
  const s: AudibleSource & { set(next: boolean): void } = {
    getSnapshot: () => v,
    subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)),
    set(next) {
      v = next;
      listeners.forEach((l) => l());
    },
  };
  return s;
}

describe("Ambient: automatic by default, the visitor's choice wins", () => {
  it("is off with no choice and no music", () => {
    const a = new Ambient(() => null, source(false));
    expect(a.getSnapshot()).toBe(false);
    expect(a.isAuto()).toBe(true);
  });

  it("turns itself on while the sun's music is audible, and off when it stops (and says so)", () => {
    const src = source(false);
    const a = new Ambient(() => null, src);
    const seen = vi.fn();
    a.subscribe(seen);
    src.set(true);
    expect(a.getSnapshot()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    src.set(true);
    expect(seen).toHaveBeenCalledTimes(1);
    src.set(false);
    expect(a.getSnapshot()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("starts on when the music is already audible", () => {
    expect(new Ambient(() => null, source(true)).getSnapshot()).toBe(true);
  });

  it("an explicit off beats the music; an explicit on outlasts it", () => {
    const src = source(true);
    const off = new Ambient(() => false, src);
    expect(off.getSnapshot()).toBe(false);
    const on = new Ambient(() => null, source(false));
    on.set(true);
    expect(on.isAuto()).toBe(false);
    expect(on.getSnapshot()).toBe(true);
  });

  it("pressing the toggle while Auto is on turns it off, and the music then does not bring it back", () => {
    const src = source(true);
    const a = new Ambient(() => null, src);
    expect(a.getSnapshot()).toBe(true);
    a.set(false);
    expect(a.getSnapshot()).toBe(false);
    src.set(false);
    src.set(true);
    expect(a.getSnapshot()).toBe(false);
  });
});

describe("Ambient: whether the globe is at full pace", () => {
  it("is false until the renderer says so, and its changes do not reach the switch's listeners", () => {
    const a = new Ambient(() => true);
    const sw = vi.fn();
    const turning = vi.fn();
    a.subscribe(sw);
    a.subscribeTurning(turning);
    expect(a.getTurning()).toBe(false);
    a.setTurning(true);
    a.setTurning(true);
    expect(a.getTurning()).toBe(true);
    expect(turning).toHaveBeenCalledTimes(1);
    expect(sw).not.toHaveBeenCalled();
  });

  it("says when the globe cannot turn for a lasting reason", () => {
    const a = new Ambient(() => true);
    const fired = vi.fn();
    a.subscribeTurning(fired);
    expect(a.getBlocked()).toBeNull();
    a.setTurning(false, "street");
    expect(a.getBlocked()).toBe("street");
    a.setTurning(false, "street");
    expect(fired).toHaveBeenCalledTimes(1);
    a.setTurning(false, null);
    expect(a.getBlocked()).toBeNull();
  });
});
