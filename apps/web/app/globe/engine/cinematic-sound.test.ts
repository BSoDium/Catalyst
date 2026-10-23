import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOUND, forgetSound, prepareSound, startSound, type AudioLike } from "./cinematic-sound";
import { CINEMATIC } from "./cinematic";
import { eggMs } from "./caption";
import { readFileSync, statSync } from "node:fs";

/** An audio element that records what is done to it. */
function fakeAudio(ready = 4, playResult: "ok" | "refused" = "ok") {
  const calls: string[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  const el: AudioLike & { volumes: number[]; calls: string[]; fire(t: string): void; plays: number } = {
    src: "",
    preload: "",
    currentTime: 0,
    readyState: ready,
    volumes: [],
    calls,
    plays: 0,
    set volume(v: number) { el.volumes.push(v); },
    get volume() { return el.volumes.at(-1) ?? 1; },
    load() { calls.push("load"); },
    play() { calls.push("play"); el.plays++; return playResult === "ok" ? Promise.resolve() : Promise.reject(new Error("NotAllowedError")); },
    pause() { calls.push("pause"); },
    addEventListener(t: string, fn: () => void) { (listeners[t] ??= []).push(fn); },
    fire(t: string) { for (const f of listeners[t] ?? []) f(); },
  } as never;
  return el;
}

beforeEach(() => {
  vi.useFakeTimers();
  forgetSound();
  vi.stubGlobal("location", { search: "" });
  vi.stubGlobal("sessionStorage", { getItem: () => null });
  vi.stubGlobal("navigator", {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the interlude's sound", () => {
  it("is faint, and the file is small and there", () => {
    expect(SOUND.volume).toBeLessThanOrEqual(0.3);
    const file = "public/audio/universal-intro.mp3";
    const size = statSync(file).size;
    expect(size).toBeGreaterThan(10_000);
    expect(size).toBeLessThan(400_000); // fetched only for the few sessions that play it, but still: not megabytes
    expect(readFileSync(file).subarray(0, 3).toString("latin1")).toMatch(/ID3|\xff\xfb|\xff\xf3/); // an mp3
    expect(SOUND.url).toBe("/audio/universal-intro.mp3");
  });

  it("starts where the file says, at the volume's own fade-in, and stops by itself with the interlude", async () => {
    const el = fakeAudio();
    const handle = startSound(eggMs(CINEMATIC.shape), () => el, true);
    expect(handle).not.toBeNull();
    expect(el.plays).toBe(0); // (not before the delay)
    await vi.advanceTimersByTimeAsync(SOUND.delayMs + 1);
    expect(el.plays).toBe(1);
    expect(el.currentTime).toBe(SOUND.fromSec);
    await vi.advanceTimersByTimeAsync(SOUND.fadeInMs + 100);
    expect(Math.max(...el.volumes)).toBeLessThanOrEqual(SOUND.volume + 1e-9);
    expect(el.volume).toBeCloseTo(SOUND.volume, 6);
    await vi.advanceTimersByTimeAsync(eggMs(CINEMATIC.shape));
    expect(el.calls.at(-1)).toBe("pause");
    expect(el.volume).toBe(0);
  });

  it("lets go over a fade, not a cut, when the interlude is cut short, and a play() granted late does not bring it back", async () => {
    const el = fakeAudio();
    const handle = startSound(eggMs(CINEMATIC.shape), () => el, true)!;
    await vi.advanceTimersByTimeAsync(SOUND.fadeInMs + 2000);
    expect(el.volume).toBeCloseTo(SOUND.volume, 6);
    handle.fade(SOUND.fadeCutMs);
    await vi.advanceTimersByTimeAsync(SOUND.fadeCutMs / 2);
    expect(el.volume).toBeGreaterThan(0);
    expect(el.volume).toBeLessThan(SOUND.volume);
    expect(el.calls.at(-1)).not.toBe("pause");
    await vi.advanceTimersByTimeAsync(SOUND.fadeCutMs);
    expect(el.volume).toBe(0);
    expect(el.calls.at(-1)).toBe("pause");
    // cut short before the browser granted the play: it stays quiet
    const late = fakeAudio();
    const h2 = startSound(8000, () => late, true)!;
    await vi.advanceTimersByTimeAsync(1);
    h2.fade(100);
    await vi.advanceTimersByTimeAsync(2000);
    expect(late.volume).toBe(0);
  });

  it("lets go when the tab is put behind (a hidden tab goes on playing, and its interlude stops drawing)", async () => {
    const listeners: (() => void)[] = [];
    const doc = { hidden: false, addEventListener: (_: string, f: () => void) => listeners.push(f), removeEventListener: vi.fn() };
    vi.stubGlobal("document", doc);
    const el = fakeAudio();
    startSound(eggMs(CINEMATIC.shape), () => el, true);
    await vi.advanceTimersByTimeAsync(SOUND.fadeInMs + 1000);
    doc.hidden = true;
    for (const f of listeners) f();
    await vi.advanceTimersByTimeAsync(SOUND.fadeCutMs + 300);
    expect(el.volume).toBe(0);
    expect(el.calls.at(-1)).toBe("pause");
    expect(doc.removeEventListener).toHaveBeenCalled();
  });

  it("the sound is over with the interlude: it never runs past it", () => {
    // the part of the file that plays is `eggMs` long at most, and the file has that much after `fromSec`
    expect(SOUND.fileSec - SOUND.fromSec).toBeGreaterThanOrEqual(eggMs(CINEMATIC.shape) / 1000 - 0.6);
  });

  it("makes no sound where none may be made: nothing is created or played", () => {
    const el = fakeAudio();
    const make = vi.fn(() => el);
    expect(startSound(8000, make, false)).toBeNull();
    expect(make).not.toHaveBeenCalled();
    expect(el.plays).toBe(0);
  });

  it("takes the element that was prepared (the fetch happened long before), and prepares only once", async () => {
    const el = fakeAudio();
    const make = vi.fn(() => el);
    prepareSound(make);
    prepareSound(make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(el.src).toBe(SOUND.url);
    expect(el.preload).toBe("auto");
    expect(el.calls).toContain("load");
    const other = fakeAudio();
    startSound(8000, () => other, true);
    await vi.advanceTimersByTimeAsync(10);
    expect(el.plays).toBe(1); // the prepared one played, not a new one
    expect(other.plays).toBe(0);
  });

  it("prepares nothing when the visitor asked for none, or the connection saves data", () => {
    const make = vi.fn(() => fakeAudio());
    vi.stubGlobal("location", { search: "?mute" });
    prepareSound(make);
    expect(make).not.toHaveBeenCalled();
    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    prepareSound(make);
    expect(make).not.toHaveBeenCalled();
  });

  it("waits for the metadata when the file is not there yet (it cannot be seeked before)", async () => {
    const el = fakeAudio(0);
    startSound(8000, () => el, true);
    await vi.advanceTimersByTimeAsync(10);
    expect(el.plays).toBe(0);
    el.readyState = 1;
    el.fire("loadedmetadata");
    await vi.advanceTimersByTimeAsync(10);
    expect(el.plays).toBe(1);
    expect(el.currentTime).toBe(SOUND.fromSec);
  });

  it("asks the browser even when the page has not been touched (it decides: the owner never heard it when it did not ask)", async () => {
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: false } });
    const el = fakeAudio();
    expect(startSound(8000, () => el)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(10);
    expect(el.plays).toBe(1);
  });

  it("says why, to the console, only where the interlude was asked for and the browser refused", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("location", { search: "?cinematic" });
    startSound(8000, () => fakeAudio(4, "refused"), true);
    await vi.advanceTimersByTimeAsync(100);
    expect(info).toHaveBeenCalledTimes(1);
    info.mockClear();
    vi.stubGlobal("location", { search: "" });
    startSound(8000, () => fakeAudio(4, "refused"), true);
    await vi.advanceTimersByTimeAsync(100);
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("is silent, and throws nothing, when the browser refuses to play", async () => {
    const el = fakeAudio(4, "refused");
    expect(() => startSound(8000, () => el, true)).not.toThrow();
    await vi.advanceTimersByTimeAsync(100);
    expect(el.calls.at(-1)).toBe("pause");
    expect(el.volume).toBe(0);
  });

  it("lets go quickly when cut short, and twice is safe", async () => {
    const el = fakeAudio();
    const handle = startSound(8000, () => el, true)!;
    await vi.advanceTimersByTimeAsync(SOUND.fadeInMs + 100);
    handle.fade(400);
    await vi.advanceTimersByTimeAsync(700);
    expect(el.volume).toBe(0);
    expect(el.calls.at(-1)).toBe("pause");
    expect(() => handle.fade()).not.toThrow();
  });
});
