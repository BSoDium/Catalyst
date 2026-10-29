import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MUTE_KEY, NowPlaying } from "./now-playing";
import { SUN_MUSIC, SunMusic, fadeCurve, loopPosition, loopable, sunInView, type MusicDeps } from "./sun-music";

const SR = 1000;
const LOOP = 100; // seconds, after the crossfade

/** A fake audio graph that records what is done to it. */
function fakes(opts: { state?: string; fail?: boolean } = {}) {
  const log: string[] = [];
  const sources: { offset: number; at: number; stopped: boolean; loop: boolean }[] = [];
  const curves: { to: number; dur: number }[] = [];
  const ctx = {
    state: opts.state ?? "running",
    currentTime: 0,
    destination: {},
    outputLatency: 0 as number | undefined,
    onstatechange: null as (() => void) | null,
    resume: vi.fn(async () => {
      ctx.state = "running";
    }),
    createGain: () => ({
      gain: {
        cancelScheduledValues: () => undefined,
        setValueAtTime: () => undefined,
        setValueCurveAtTime: (v: Float32Array, _t: number, dur: number) => curves.push({ to: v[v.length - 1]!, dur }),
      },
      connect: () => log.push("gain.connect"),
      disconnect: () => undefined,
    }),
    createBufferSource: () => {
      const rec = { offset: -1, at: -1, stopped: false, loop: false };
      sources.push(rec);
      return {
        buffer: null as unknown,
        get loop() {
          return rec.loop;
        },
        set loop(v: boolean) {
          rec.loop = v;
        },
        connect: () => undefined,
        disconnect: () => undefined,
        start: (when?: number, offset?: number) => {
          rec.at = when ?? 0;
          rec.offset = offset ?? 0;
        },
        stop: () => {
          rec.stopped = true;
        },
      };
    },
  };
  const deps: MusicDeps = {
    context: () => ctx,
    fetchBytes: async () => {
      if (opts.fail) throw new Error("404");
      return new ArrayBuffer(8);
    },
    decode: async () => ({ channels: [new Float32Array((LOOP + SUN_MUSIC.crossfadeSec) * SR)], sampleRate: SR }),
    makeBuffer: (channels) => channels,
  };
  return { ctx, deps, sources, curves, log };
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe("loopable", () => {
  it("is as long as the piece less the crossfade, and its end leads into its beginning as the original does", () => {
    const n = 1000;
    const x = 100;
    const a = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.05));
    const [out] = loopable([a], x);
    expect(out!.length).toBe(n - x);
    // the loop's end is the original untouched; the sample after it (the loop's first) is the original's next, the tail's first
    expect(out![n - x - 1]).toBe(a[n - x - 1]);
    expect(out![0]).toBeCloseTo(a[n - x]!, 2);
    // the head's first sample after the overlap is the original's
    expect(out![x]).toBe(a[x]);
  });

  it("keeps a steady level through the overlap (equal power) and has no overlap when asked for none", () => {
    const n = 4000;
    const x = 1000;
    // two uncorrelated halves of the same power: the overlap's power is theirs
    const noise = (seed: number) => {
      let s = seed;
      return Float32Array.from({ length: n }, () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1);
    };
    const a = noise(7);
    const [out] = loopable([a], x);
    const power = (v: Float32Array, from: number, to: number) => v.subarray(from, to).reduce((p, s) => p + s * s, 0) / (to - from);
    expect(power(out!, 0, x)).toBeGreaterThan(0.8 * power(a, x, n));
    expect(power(out!, 0, x)).toBeLessThan(1.2 * power(a, x, n));
    const [same] = loopable([a], 0);
    expect(same!.length).toBe(n);
  });

  it("does every channel and survives a crossfade longer than half the piece", () => {
    const out = loopable([new Float32Array(100), new Float32Array(100)], 10_000);
    expect(out).toHaveLength(2);
    expect(out[0]!.length).toBe(50);
  });
});

describe("the small pure parts", () => {
  it("a fade starts and ends at the gains asked for, and is monotone", () => {
    const c = fadeCurve(0.02, 0.12);
    expect(c[0]).toBeCloseTo(0.02);
    expect(c[c.length - 1]).toBeCloseTo(0.12);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]!);
  });

  it("the sun is in view above one threshold and out under a lower one (between: as it was)", () => {
    const mid = (SUN_MUSIC.glareOn + SUN_MUSIC.glareOff) / 2;
    expect(sunInView(SUN_MUSIC.glareOn, false)).toBe(true);
    expect(sunInView(mid, false)).toBe(false);
    expect(sunInView(mid, true)).toBe(true);
    expect(sunInView(SUN_MUSIC.glareOff, true)).toBe(false);
    expect(sunInView(0, true)).toBe(false);
  });

  it("the place in a loop wraps", () => {
    expect(loopPosition(90, 25, 100)).toBe(15);
    expect(loopPosition(0, 0, 100)).toBe(0);
    expect(loopPosition(10, 5, 0)).toBe(0);
  });
});

describe("the sun's music", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    vi.useFakeTimers();
    store.clear();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    vi.stubGlobal("document", { hidden: false, addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("requestIdleCallback", (f: () => void) => f());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const start = async (f = fakes()) => {
    const prefs = new NowPlaying();
    const m = new SunMusic(f.deps, prefs);
    m.attach();
    m.unlock(); // (the visitor's first gesture)
    await settle();
    return { m, prefs, ...f };
  };

  it("plays nothing until the sun is in view, then fades in from the start of the piece, looping", async () => {
    const { m, sources, curves } = await start();
    expect(m.getSnapshot().status).toBe("ready");
    expect(sources).toHaveLength(0);
    m.setGlare(0.5);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ offset: 0, loop: true });
    expect(curves.at(-1)!.to).toBeCloseTo(SUN_MUSIC.volume);
    expect(curves.at(-1)!.dur * 1000).toBeCloseTo(SUN_MUSIC.fadeInMs);
    expect(m.getSnapshot().sunSeen).toBe(true);
  });

  it("a mute is quick, not the slow fade of a setting sun, and it works on a fade that is already going", async () => {
    const { m, ctx, curves } = await start();
    m.setGlare(0.5);
    ctx.currentTime = 30;
    m.setMuted(true);
    expect(curves.at(-1)!.to).toBe(0);
    expect(curves.at(-1)!.dur * 1000).toBeLessThanOrEqual(SUN_MUSIC.muteFadeMs + 1);
    // the sun setting (slow), then a mute: the quick one replaces it
    store.clear();
    const f = await start();
    f.m.setGlare(0.5);
    f.ctx.currentTime = 30;
    f.m.setGlare(0);
    expect(f.curves.at(-1)!.dur * 1000).toBeGreaterThan(1000);
    f.ctx.currentTime = 30.1;
    f.m.setMuted(true);
    expect(f.curves.at(-1)!.dur * 1000).toBeLessThan(150);
  });

  it("tells the picture where the music is and how audible, only while it sounds", async () => {
    const { m, ctx } = await start();
    expect(m.pulse()).toBeNull();
    m.setGlare(0.5);
    ctx.currentTime = 10;
    const p = m.pulse()!;
    expect(p.amount).toBeCloseTo(1, 1);
    expect(p.position).toBeCloseTo(10, 1);
    ctx.outputLatency = 0.2;
    expect(m.pulse()!.position).toBeCloseTo(9.8, 1);
    m.setMuted(true);
    ctx.currentTime = 11;
    vi.advanceTimersByTime(500);
    expect(m.pulse()).toBeNull();
  });

  it("lets go softly when the sun hides, and picks up where it left off when it comes back (never from the start)", async () => {
    const { m, ctx, sources, curves } = await start();
    m.setGlare(0.5);
    ctx.currentTime = 20;
    m.setGlare(0);
    expect(curves.at(-1)!.to).toBe(0);
    expect(sources[0]!.stopped).toBe(false); // (still sounding, going out)
    ctx.currentTime = 20 + SUN_MUSIC.fadeOutMs / 1000;
    vi.advanceTimersByTime(SUN_MUSIC.fadeOutMs + 100);
    expect(sources[0]!.stopped).toBe(true);
    // 20 s of music went by before it went silent (+ the fade's length: it kept playing as it faded)
    const left = 20 + SUN_MUSIC.fadeOutMs / 1000;
    expect(m.position()).toBeCloseTo(left, 1);
    ctx.currentTime = 500; // (a long time away: the piece did not go on without us)
    m.setGlare(0.5);
    expect(sources).toHaveLength(2);
    expect(sources[1]!.offset).toBeCloseTo(left, 1);
  });

  it("a sun that comes back while the music is going out brings it back in, on the same sound", async () => {
    const { m, ctx, sources, curves } = await start();
    m.setGlare(0.5);
    ctx.currentTime = 10;
    m.setGlare(0);
    ctx.currentTime = 11;
    m.setGlare(0.5);
    expect(sources).toHaveLength(1);
    expect(curves.at(-1)!.to).toBeCloseTo(SUN_MUSIC.volume);
    vi.advanceTimersByTime(10_000);
    expect(sources[0]!.stopped).toBe(false);
  });

  it("is silent while the browser has not let the context run (no gesture yet), and starts at the gesture", async () => {
    const f = fakes({ state: "suspended" });
    f.ctx.resume = vi.fn(async () => undefined); // (refused)
    const { m, ctx, sources } = await start(f);
    m.setGlare(0.5);
    expect(sources).toHaveLength(0);
    ctx.state = "running";
    m.unlock();
    await settle();
    expect(sources).toHaveLength(1);
  });

  it("the visitor can turn it off, and on: kept, and silent while off", async () => {
    const { m, ctx, sources, curves } = await start();
    m.setGlare(0.5);
    m.setMuted(true);
    expect(store.get(MUTE_KEY)).toBe("1");
    expect(curves.at(-1)!.to).toBe(0);
    ctx.currentTime = 10;
    vi.advanceTimersByTime(5000);
    expect(sources[0]!.stopped).toBe(true);
    m.setGlare(0);
    m.setGlare(0.5);
    expect(sources).toHaveLength(1); // (still off)
    m.setMuted(false);
    expect(store.has(MUTE_KEY)).toBe(false);
    expect(sources).toHaveLength(2);
  });

  it("starts muted when the visitor chose so before (or with ?mute), and does not even fetch the file", async () => {
    store.set(MUTE_KEY, "1");
    const f = fakes();
    const fetch = vi.spyOn(f.deps, "fetchBytes");
    const { m, prefs, sources } = await start(f);
    expect(prefs.getSnapshot().muted).toBe(true);
    m.setGlare(0.5);
    expect(sources).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    m.setMuted(false);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sources).toHaveLength(1);
  });

  it("a sun on the edge of the planet's limb does not make it stutter", async () => {
    const { m, sources, curves } = await start();
    m.setGlare(0.5);
    const n = curves.length;
    for (const g of [0.02, 0.015, 0.02, 0.012, 0.02]) m.setGlare(g);
    expect(curves).toHaveLength(n);
    expect(sources).toHaveLength(1);
  });

  it("no file: no music, no switch (status failed), and nothing thrown", async () => {
    const { m, sources } = await start(fakes({ fail: true }));
    m.setGlare(0.5);
    expect(m.getSnapshot().status).toBe("failed");
    expect(sources).toHaveLength(0);
  });

  it("tells the page what it is playing: nothing before the sun, then playing while the sun is in view, waiting when it is not, and nothing if there is no file", async () => {
    const { m, prefs } = await start();
    expect(prefs.getSnapshot().track).toBeNull();
    m.setGlare(0.5);
    expect(prefs.getSnapshot()).toMatchObject({ track: { title: "Gabriel", artist: "Felsmann & Tiley" }, state: "playing" });
    m.setGlare(0);
    expect(prefs.getSnapshot()).toMatchObject({ track: { title: "Gabriel" }, state: "paused" });
    m.setGlare(0.5);
    m.setMuted(true);
    expect(prefs.getSnapshot()).toMatchObject({ state: "paused", muted: true });
    store.clear();
    const f = await start(fakes({ fail: true }));
    f.m.setGlare(0.5);
    await settle();
    expect(f.prefs.getSnapshot().track).toBeNull();
  });

  it("follows the page's choice when it is made elsewhere (the player), live", async () => {
    const { m, prefs, curves, sources } = await start();
    m.setGlare(0.5);
    prefs.setMuted(true);
    expect(curves.at(-1)!.to).toBe(0);
    prefs.setMuted(false);
    await settle();
    expect(sources.length).toBeGreaterThanOrEqual(1);
    expect(curves.at(-1)!.to).toBeCloseTo(SUN_MUSIC.volume);
  });
});

describe("the sound's source", () => {
  it("is played through Web Audio, not an element the media keys can pause", () => {
    const src = readFileSync("app/globe/engine/sun-music.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/new Audio\b|HTMLAudioElement|HTMLMediaElement|createElement\(["']audio|mediaSession|MediaElementSource/);
    expect(src).toMatch(/AudioContext/);
  });

  it("is loud enough to hear and faint: the gain is a small one", () => {
    expect(SUN_MUSIC.volume).toBeGreaterThan(0.03);
    expect(SUN_MUSIC.volume).toBeLessThanOrEqual(0.2);
    expect(SUN_MUSIC.url).toBe("/audio/gabriel.mp3");
  });
});
