import { readFileSync, statSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eggMs } from "./caption";
import { CINEMATIC } from "./cinematic";
import { SOUND, forgetSound, prepareSound, startSound, unlockSound, type ContextLike, type SoundDeps } from "./cinematic-sound";

/** A fake audio context that records what is done to it; `state` and `resume` are the test's to set. */
function fakeContext(state: "running" | "suspended" = "running", resume: "ok" | "never" = "ok") {
  const log: string[] = [];
  const ramps: [number, number][] = [];
  const gainNode = {
    gain: {
      value: 0,
      cancelScheduledValues: (t: number) => log.push(`cancel ${t.toFixed(2)}`),
      setValueAtTime: (v: number, t: number) => {
        gainNode.gain.value = v;
        ramps.push([v, t]);
      },
      linearRampToValueAtTime: (v: number, t: number) => ramps.push([v, t]),
    },
    connect: () => log.push("gain.connect"),
    disconnect: () => log.push("gain.disconnect"),
  };
  const source = {
    buffer: null as unknown,
    onended: null as (() => void) | null,
    connect: () => log.push("src.connect"),
    disconnect: () => log.push("src.disconnect"),
    started: [] as [number | undefined, number | undefined][],
    stopped: [] as (number | undefined)[],
    start(when?: number, offset?: number) {
      source.started.push([when, offset]);
      log.push("start");
    },
    stop(when?: number) {
      source.stopped.push(when);
      log.push("stop");
    },
  };
  const ctx: ContextLike & { time: number } = {
    state,
    time: 10,
    get currentTime() {
      return this.time;
    },
    destination: { destination: true },
    resume: () => {
      if (resume === "never") return new Promise<void>(() => {});
      ctx.state = "running";
      return Promise.resolve();
    },
    createGain: () => gainNode,
    createBufferSource: () => source,
  };
  return { ctx, gainNode, source, log, ramps };
}

function fakeDeps(c: ContextLike = fakeContext().ctx): SoundDeps & { made: number; decoded: number; fetched: string[] } {
  const deps = {
    made: 0,
    decoded: 0,
    fetched: [] as string[],
    context: () => {
      deps.made++;
      return c;
    },
    fetchBytes: (url: string) => {
      deps.fetched.push(url);
      return Promise.resolve(new ArrayBuffer(8));
    },
    decode: () => {
      deps.decoded++;
      return Promise.resolve({ buffer: true });
    },
  };
  return deps;
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

  it("is not an element: nothing outside the page (the media keys, Now Playing, the headphones' button) can pause it", () => {
    const src = readFileSync("app/globe/engine/cinematic-sound.ts", "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"))
      .join("\n");
    expect(src).not.toMatch(/new Audio\b|HTMLAudioElement|HTMLMediaElement|createElement\(["']audio|mediaSession/);
    expect(src).toMatch(/AudioContext/);
  });

  it("is fetched and decoded when it is planned (once), with no audio device opened", async () => {
    const deps = fakeDeps();
    prepareSound(deps);
    prepareSound(deps);
    await vi.advanceTimersByTimeAsync(10);
    expect(deps.fetched).toEqual([SOUND.url]);
    expect(deps.decoded).toBe(1);
    expect(deps.made).toBe(0); // (the context is made at the first gesture, or when it starts)
  });

  it("starts where the file says, rises to its volume, and lets go as the interlude ends", async () => {
    const f = fakeContext();
    const deps = fakeDeps(f.ctx);
    prepareSound(deps);
    const handle = startSound(eggMs(CINEMATIC.shape), deps, true);
    expect(handle).not.toBeNull();
    await vi.advanceTimersByTimeAsync(10);
    expect(f.source.started.length).toBe(1);
    expect(f.source.started[0]![1]).toBeCloseTo(SOUND.fromSec, 1);
    expect(f.source.buffer).toEqual({ buffer: true });
    const volumes = f.ramps.map(([v]) => v);
    expect(Math.max(...volumes)).toBeLessThanOrEqual(SOUND.volume + 1e-9);
    expect(volumes[0]).toBe(0);
    expect(volumes).toContain(SOUND.volume);
    // the last ramp goes to 0, at the interlude's end
    const last = f.ramps.at(-1)!;
    expect(last[0]).toBe(0);
    expect(last[1] - f.ctx.time).toBeCloseTo(eggMs(CINEMATIC.shape) / 1000, 1);
    // and it stops itself a moment after
    expect(f.source.stopped.at(-1)! - f.ctx.time).toBeGreaterThan(eggMs(CINEMATIC.shape) / 1000 - 0.1);
  });

  it("makes no sound where none may be made: no context is made, nothing played", async () => {
    const f = fakeContext();
    const deps = fakeDeps(f.ctx);
    expect(startSound(8000, deps, false)).toBeNull();
    await vi.advanceTimersByTimeAsync(10);
    expect(deps.made).toBe(0);
    expect(f.source.started.length).toBe(0);
  });

  it("prepares nothing when the visitor asked for none, or the connection saves data", () => {
    const deps = fakeDeps();
    vi.stubGlobal("location", { search: "?mute" });
    prepareSound(deps);
    expect(deps.fetched.length).toBe(0);
    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    prepareSound(deps);
    expect(deps.fetched.length).toBe(0);
  });

  it("asks a suspended context to run, and starts when it does", async () => {
    const f = fakeContext("suspended", "ok");
    const deps = fakeDeps(f.ctx);
    prepareSound(deps);
    startSound(8000, deps, true);
    await vi.advanceTimersByTimeAsync(10);
    expect(f.ctx.state).toBe("running");
    expect(f.source.started.length).toBe(1);
  });

  it("makes no sound, and says nothing, when the browser does not let the context run (a page nobody has touched)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const f = fakeContext("suspended", "never");
    const deps = fakeDeps(f.ctx);
    prepareSound(deps);
    startSound(8000, deps, true);
    await vi.advanceTimersByTimeAsync(SOUND.resumeMs + 100);
    expect(f.source.started.length).toBe(0);
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("unlockSound, called in the visitor's gesture, makes the context and asks it to run at once, and fetches the file", async () => {
    const f = fakeContext("suspended");
    const resume = vi.spyOn(f.ctx, "resume");
    const deps = fakeDeps(f.ctx);
    unlockSound(deps);
    expect(deps.made).toBe(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(deps.fetched).toEqual([SOUND.url]);
    unlockSound(deps);
    expect(deps.made).toBe(1); // (one context, kept)
    await vi.advanceTimersByTimeAsync(10);
    expect(f.ctx.state).toBe("running");
  });

  it("starts where the interlude has got to when the context is slow to run, so that it stays with the picture", async () => {
    const f = fakeContext("suspended", "ok");
    const slow = f.ctx.resume;
    f.ctx.resume = () => new Promise<void>((r) => setTimeout(() => void slow().then(r), 300));
    const deps = fakeDeps(f.ctx);
    prepareSound(deps);
    startSound(8000, deps, true);
    await vi.advanceTimersByTimeAsync(350);
    expect(f.source.started[0]![1]).toBeGreaterThan(SOUND.fromSec + 0.25);
  });

  it("lets go over a fade, not a cut, when the interlude is cut short, and it does not start if it was cut before it began", async () => {
    const f = fakeContext();
    const deps = fakeDeps(f.ctx);
    prepareSound(deps);
    const handle = startSound(eggMs(CINEMATIC.shape), deps, true)!;
    await vi.advanceTimersByTimeAsync(10);
    f.gainNode.gain.value = SOUND.volume;
    handle.fade(SOUND.fadeCutMs);
    const ramp = f.ramps.at(-1)!;
    expect(ramp[0]).toBe(0);
    expect(ramp[1] - f.ctx.time).toBeCloseTo(SOUND.fadeCutMs / 1000, 2);
    expect(f.log).toContain(`cancel ${f.ctx.time.toFixed(2)}`);
    expect(f.source.stopped.at(-1)! - f.ctx.time).toBeGreaterThan(SOUND.fadeCutMs / 1000);
    // a second one: cut short before the file was decoded: it never starts
    forgetSound();
    const g = fakeContext();
    const deps2 = fakeDeps(g.ctx);
    prepareSound(deps2);
    const h2 = startSound(8000, deps2, true)!;
    h2.fade(100);
    await vi.advanceTimersByTimeAsync(2000);
    expect(g.source.started.length).toBe(0);
  });

  it("goes on playing when the tab is put behind: only the interlude's end or a gesture lets go of it", async () => {
    const listeners: (() => void)[] = [];
    const doc = { hidden: false, addEventListener: (_: string, fn: () => void) => listeners.push(fn), removeEventListener: vi.fn() };
    vi.stubGlobal("document", doc);
    const f = fakeContext();
    const deps = fakeDeps(f.ctx);
    prepareSound(deps);
    const h = startSound(eggMs(CINEMATIC.shape), deps, true)!;
    await vi.advanceTimersByTimeAsync(1000);
    const rampsBefore = f.ramps.length;
    doc.hidden = true;
    for (const fn of listeners) fn();
    await vi.advanceTimersByTimeAsync(SOUND.fadeCutMs + 400);
    expect(f.ramps.length).toBe(rampsBefore); // no fade was scheduled
    expect(f.source.stopped.length).toBe(1); // (only the one stop at the planned end)
    // the interlude ends or is cut short: then it lets go
    h.fade(300);
    expect(f.ramps.at(-1)![0]).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(doc.removeEventListener).toHaveBeenCalled();
  });

  it("asks a suspended context (a phone's, with the page behind) to run again while the interlude lasts, and stops asking when it is over", async () => {
    const listeners: (() => void)[] = [];
    const doc = { hidden: false, addEventListener: (_: string, fn: () => void) => listeners.push(fn), removeEventListener: vi.fn() };
    vi.stubGlobal("document", doc);
    const f = fakeContext();
    const resume = vi.spyOn(f.ctx, "resume");
    const deps = fakeDeps(f.ctx);
    prepareSound(deps);
    const h = startSound(eggMs(CINEMATIC.shape), deps, true)!;
    await vi.advanceTimersByTimeAsync(500);
    resume.mockClear();
    f.ctx.state = "suspended";
    f.ctx.onstatechange?.();
    expect(resume).toHaveBeenCalledTimes(1);
    f.ctx.state = "suspended";
    for (const fn of listeners) fn();
    expect(resume).toHaveBeenCalledTimes(2);
    h.fade(100);
    await vi.advanceTimersByTimeAsync(1000);
    resume.mockClear();
    f.ctx.state = "suspended";
    for (const fn of listeners) fn();
    expect(resume).not.toHaveBeenCalled();
  });

  it("the sound is over with the interlude: it never runs past it (the lockup's hold may outlast the file's decay by a few seconds)", () => {
    expect(SOUND.fileSec - SOUND.fromSec).toBeLessThanOrEqual(eggMs(CINEMATIC.shape) / 1000 + 0.6);
    expect(eggMs(CINEMATIC.shape) / 1000 - (SOUND.fileSec - SOUND.fromSec)).toBeLessThan(3);
  });
});
