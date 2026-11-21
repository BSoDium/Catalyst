import { beforeAll, describe, expect, it, vi } from "vitest";
import { createNeon, type NeonBlock } from "./neon";

const blocks: NeonBlock[] = Array.from({ length: 60 }, (_, i) => ({ x: (i % 12) * 1.12, z: Math.floor(i / 12) * 1.12, pan: ((i % 12) / 11) * 2 - 1, t: (i % 7) / 6 }));

describe("createNeon", () => {
  // (the tests run without a browser: just what `stop` touches)
  beforeAll(() => {
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("window", { clearTimeout: () => {} });
    vi.stubGlobal("document", { removeEventListener: () => {}, addEventListener: () => {} });
  });
  it("starts with the flickering rods off, every level between 0 and 1, and the same run for the same seed", () => {
    const a = createNeon({ blocks, apply: vi.fn(), done: vi.fn(), sound: false, seed: 3 });
    const b = createNeon({ blocks, apply: vi.fn(), done: vi.fn(), sound: false, seed: 3 });
    expect(a.count).toBeGreaterThan(0);
    expect([...a.levels].every((v) => v >= 0 && v <= 1)).toBe(true);
    expect([...a.levels].filter((v) => v === 0).length).toBe(a.count);
    expect([...a.levels]).toEqual([...b.levels]);
  });
  it("puts every rod back on when it is stopped", () => {
    const n = createNeon({ blocks, apply: vi.fn(), done: vi.fn(), sound: false });
    n.stop();
    expect([...n.levels].every((v) => v === 1)).toBe(true);
  });
  it("copes with no blocks", () => {
    const n = createNeon({ blocks: [], apply: vi.fn(), done: vi.fn(), sound: false });
    expect(n.count).toBe(0);
    expect(() => n.stop()).not.toThrow();
  });
});

describe("createNeon: the sound is in step with the picture", () => {
  it("sounds go on to the last flicker, and each follows a change of the picture closely", async () => {
    let clock = 1000;
    const frames: ((t: number) => void)[] = [];
    const bells: number[] = [];
    let audioNow = 5;
    class FakeNode {
      connect(n: unknown) {
        return n;
      }
      start() {}
      stop() {}
      frequency = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} };
      gain = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} };
      pan = { value: 0 };
      Q = { value: 0 };
      type = "";
    }
    class FakeContext {
      state = "running";
      sampleRate = 8000;
      baseLatency = 0.01;
      outputLatency = 0.02;
      destination = new FakeNode();
      get currentTime() {
        return audioNow;
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
      createGain() {
        return new FakeNode();
      }
      createDynamicsCompressor() {
        return new FakeNode();
      }
      createBiquadFilter() {
        return new FakeNode();
      }
      createStereoPanner() {
        return new FakeNode();
      }
      createBuffer(_c: number, n: number) {
        return { getChannelData: () => new Float32Array(n) };
      }
      createBufferSource() {
        return new FakeNode();
      }
      createOscillator() {
        const o = new FakeNode();
        // (the first partial of a bell is the one counted: one start for each bell)
        o.start = ((when: number) => bells.push(when)) as never;
        return o;
      }
    }
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: true } });
    vi.stubGlobal("requestAnimationFrame", (f: (t: number) => void) => frames.push(f));
    vi.stubGlobal("performance", { now: () => clock });
    vi.stubGlobal("window", { clearTimeout: () => {}, setTimeout: () => 0, matchMedia: () => ({ matches: false }) });
    vi.stubGlobal("document", { hidden: false, removeEventListener: () => {}, addEventListener: () => {} });
    const jumps: number[] = [];
    let prev: number[] | null = null;
    let t0 = -1;
    let litAt = -1;
    const n = createNeon({
      blocks,
      sound: true,
      seed: 5,
      done: () => {},
      apply: (levels) => {
        if (prev && levels.some((v, i) => Math.abs(v - prev![i]!) > 0.15)) jumps.push(clock - t0);
        prev = [...levels];
        if (litAt < 0 && levels.every((v) => v >= 0.55)) litAt = clock - t0;
      },
    });
    n.start();
    await new Promise((r) => globalThis.setTimeout(r, 20));
    t0 = clock;
    for (let k = 0; k < 400 && frames.length; k++) {
      clock += 1000 / 60;
      audioNow += 1000 / 60 / 1000;
      const f = frames.shift()!;
      f(clock);
    }
    n.stop();
    // (the bell starts: three partials each, in the audio's time; the picture's time zero is audio time 5 + the first frame)
    const sounds = bells.filter((_, i) => i % 3 === 1).map((w) => (w - 5) * 1000);
    expect(sounds.length).toBeGreaterThan(5);
    expect(jumps.length).toBeGreaterThan(5);
    // the sound goes on until the last area comes on for good (the picture's last flicker), give or take a few frames
    expect(litAt).toBeGreaterThan(0);
    expect(Math.max(...sounds)).toBeGreaterThan(litAt - 150);
    // and nothing is far from a change of the picture
    for (const s of sounds) expect(Math.min(...jumps.map((j) => Math.abs(j - s)))).toBeLessThan(120);
  });
});
