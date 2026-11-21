/**
 * The neon start-up of the dark theme's rods: when the picture appears some of the rods do not just come on, they flicker like a gas tube that is struggling to start, a few stutters of
 * light with gaps between, and then stay on after a short warm-up; with a faint click and buzz for each stutter. No file: the sound is synthesised (Web Audio), very quiet, and only if the browser lets the page make sound
 * (it does not before the visitor has interacted with the page; then it is silent and nothing else changes).
 *
 * This module only decides the levels (0 to 1, one per block, as a function of time) and the sound; what a level does to the picture is the scene's business (`apply`).
 */
export interface NeonBlock {
  /** Where the block is on the ground (world units, x across, z in depth), to put it in an area. */
  x: number;
  z: number;
  /** Where the block is across the picture, -1 (left) to 1 (right), for the sound's stereo place. */
  pan: number;
  /** 0..1, how busy the day was (a busier rod is likelier to be one of the flickering ones). */
  t: number;
}

export interface NeonOptions {
  blocks: NeonBlock[];
  /** Called with the levels whenever any of them changed. */
  apply: (levels: Float32Array) => void;
  /** Called once all the lights are steady. */
  done: () => void;
  sound: boolean;
  /** How often the picture is updated while the start-up runs (a weak device is given fewer). */
  fps?: number;
  /** A seed, so that a run can be repeated. */
  seed?: number;
}

/** How many areas the rods are divided into, how many of them flicker (the rest are on from the start), how long the start-up lasts, and how often the picture is updated while it does. */
const AREAS = 8;
const FLICKERING = AREAS;
const SPAN_MS = 2600;
export const NEON_FPS = 20;

interface Stutter {
  at: number;
  length: number;
  level: number;
}

export function createNeon({ blocks, apply, done, sound, fps = NEON_FPS, seed = 7 }: NeonOptions) {
  let s = seed;
  const random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const levels = new Float32Array(blocks.length).fill(1);
  // The rods are divided into areas, not square ones: each area is the blocks nearest to a centre by a distance that is stretched along its own direction (an oval, turned a random way), and the centres are spread out. A few
  // of the areas flicker (all of them, now), as one: a stuttering of its own, the same for all its blocks, each a few milliseconds off the others and not quite as bright, so that it reads as a patch of tubes on one circuit.
  const centres: { x: number; z: number; ax: number; cos: number; sin: number }[] = [];
  const picks = blocks.map((_, i) => i);
  const first = Math.floor(random() * blocks.length);
  const spread = (i: number) => Math.min(...centres.map((c) => Math.hypot(blocks[i]!.x - c.x, blocks[i]!.z - c.z)));
  centres.push({ x: blocks[first]!.x, z: blocks[first]!.z, ax: 1, cos: 1, sin: 0 });
  while (centres.length < Math.min(AREAS, blocks.length)) {
    // (the farthest block of a few tried: spread, but not in a regular pattern)
    let best = -1;
    let bestD = -1;
    for (let k = 0; k < 6; k++) {
      const i = picks[Math.floor(random() * picks.length)]!;
      const d = spread(i);
      if (d > bestD) {
        best = i;
        bestD = d;
      }
    }
    const angle = random() * Math.PI;
    centres.push({ x: blocks[best]!.x, z: blocks[best]!.z, ax: 0.55 + random() * 1.1, cos: Math.cos(angle), sin: Math.sin(angle) });
  }
  const areaOf = blocks.map((b) => {
    let best = 0;
    let bestD = Infinity;
    centres.forEach((c, k) => {
      const dx = b.x - c.x;
      const dz = b.z - c.z;
      const u = (dx * c.cos + dz * c.sin) * c.ax;
      const v = (-dx * c.sin + dz * c.cos) / c.ax;
      const d = Math.hypot(u, v);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    return best;
  });
  const flickering = new Set([...centres.keys()].sort(() => random() - 0.5).slice(0, FLICKERING));
  const areaPlans = new Map<number, { start: number; stutters: Stutter[]; steady: number }>();
  flickering.forEach((k) => {
    const start = random() * (SPAN_MS - 1100);
    const count = 4 + Math.floor(random() * 5);
    const stutters: Stutter[] = [];
    let at = start;
    for (let j = 0; j < count; j++) {
      const length = 30 + random() * 110;
      stutters.push({ at, length, level: 0.4 + random() * 0.6 });
      // (the gaps get shorter: the tubes are catching)
      at += length + (50 + random() * 240) * (1 - (j / count) * 0.6);
    }
    areaPlans.set(k, { start, stutters, steady: at + 60 });
  });
  const plans = new Map<number, { start: number; stutters: Stutter[]; steady: number; shift: number; scale: number; area: number }>();
  blocks.forEach((_, i) => {
    const base = areaPlans.get(areaOf[i]!);
    if (base) plans.set(i, { ...base, shift: random() * 70, scale: 0.8 + random() * 0.2, area: areaOf[i]! });
  });
  const end = Math.max(0, ...[...areaPlans.values()].map((p) => p.steady + 380 + 70));
  const levelAt = (plan: { start: number; stutters: Stutter[]; steady: number; shift: number; scale: number }, at: number) => {
    const ms = at - plan.shift;
    if (ms < plan.start) return 0;
    if (ms >= plan.steady + 380) return 1;
    if (ms >= plan.steady) return 0.6 + 0.4 * ((ms - plan.steady) / 380);
    for (const st of plan.stutters) if (ms >= st.at && ms < st.at + st.length) return st.level * plan.scale;
    return 0;
  };
  // (the rods that flicker are off until their turn)
  plans.forEach((_, i) => (levels[i] = 0));
  let raf = 0;
  let t0 = 0;
  let last = -1;
  let running = false;

  // --- the sound ---
  let ctx: AudioContext | null = null;
  const schedule = async () => {
    if (!sound || typeof AudioContext === "undefined") return;
    let c: AudioContext;
    try {
      c = new AudioContext();
      await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 300))]);
    } catch {
      return;
    }
    if (c.state !== "running" || !running) {
      // (not allowed to make sound yet, or the start-up is over already: silent, and the context is let go)
      void c.close();
      return;
    }
    ctx = c;
    // (the sound's clock starts a little after the picture's: the difference is taken off)
    const now = c.currentTime + 0.05 - (performance.now() - t0) / 1000;
    const master = c.createGain();
    master.gain.value = 0.5;
    const limiter = c.createDynamicsCompressor();
    master.connect(limiter).connect(c.destination);
    // The ballast's hum: one low tone (100 Hz, the mains' second harmonic, a sawtooth with its edges taken off) that follows how much of the tubes are lit, and that dies away slowly once the last one has settled.
    const lit: number[] = [];
    for (let ms = 0; ms <= end + 200; ms += 25) {
      let sum = 0;
      plans.forEach((p) => (sum += levelAt(p, ms)));
      lit.push(sum / Math.max(1, plans.size));
    }
    const settled = now + (end + 200) / 1000;
    const FADE = 6;
    const hum = c.createOscillator();
    hum.type = "sawtooth";
    hum.frequency.value = 100;
    const lowpass = c.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 520;
    const humGain = c.createGain();
    humGain.gain.setValueAtTime(0, c.currentTime);
    lit.forEach((v, i) => humGain.gain.linearRampToValueAtTime(0.004 * v, Math.max(now + (i * 25) / 1000, c.currentTime + 0.001)));
    // (the tail: an exponential, which is what a fading hum does; its time constant a third of its length)
    humGain.gain.setTargetAtTime(0, Math.max(settled, c.currentTime), FADE / 3);
    hum.connect(lowpass).connect(humGain).connect(master);
    hum.start(Math.max(now, c.currentTime));
    const stopAt = settled + FADE * 1.6;
    hum.stop(stopAt);
    let clicks = 0;
    const members = new Map<number, number[]>();
    plans.forEach((p, i) => (members.get(p.area) ?? members.set(p.area, []).get(p.area)!).push(i));
    // The tick of a tube lighting: not a crackle but a tiny bell, a very high, short, quiet ding. A bell is a few partials that are not whole multiples of its pitch (1, 2.76, 5.4: the ratios of a small struck bar), each dying
    // away on its own, the higher ones faster; the pitch is a little different each time.
    const PARTIALS: [number, number, number][] = [[1, 1, 0.3], [2.76, 0.35, 0.14], [5.4, 0.12, 0.07]];
    const click = (at: number, pan: number, level: number) => {
      if (clicks >= 110) return;
      clicks++;
      const when = Math.max(now + at / 1000, c.currentTime);
      // (some of them low, a deeper bell: about a third, from 800 to 1500 Hz; the rest high, 2300 to 3800)
      const f0 = random() < 0.35 ? 800 + random() * 700 : 2300 + random() * 1500;
      const out = c.createGain();
      out.gain.value = 0.05 * level;
      const panner = c.createStereoPanner();
      panner.pan.value = pan * 0.8;
      out.connect(panner).connect(master);
      for (const [ratio, gain, decay] of PARTIALS) {
        const f = f0 * ratio;
        if (f > 16000) continue;
        const o = c.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        const g = c.createGain();
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(gain, when + 0.001);
        g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
        o.connect(g).connect(out);
        o.start(when);
        o.stop(when + decay + 0.02);
      }
    };
    // (a few clicks for each stutter of an area, from some of its tubes, a few milliseconds apart: the tubes switching on, and off again)
    areaPlans.forEach((plan, area) => {
      const own = members.get(area) ?? [];
      if (!own.length) return;
      plan.stutters.forEach((st) => {
        const n = 1 + Math.floor(random() * 3);
        for (let k = 0; k < n; k++) {
          const i = own[Math.floor(random() * own.length)]!;
          click(st.at + random() * 60, blocks[i]!.pan, st.level);
          if (random() < 0.6) click(st.at + st.length + random() * 40, blocks[i]!.pan, st.level * 0.35);
        }
      });
    });
    window.setTimeout(() => void c.close(), (stopAt - c.currentTime) * 1000 + 500);
  };

  const tick = (stamp: number) => {
    raf = 0;
    if (!running) return;
    const ms = stamp - t0;
    // (the picture is updated at a low rate, as a flicker looks like one: a few steps, not a smooth fade)
    if (last < 0 || stamp - last >= 1000 / fps) {
      last = stamp;
      let changed = false;
      plans.forEach((plan, i) => {
        const v = levelAt(plan, ms);
        if (Math.abs(v - levels[i]!) > 1e-3) {
          levels[i] = v;
          changed = true;
        }
      });
      if (changed) apply(levels);
    }
    if (ms >= end) {
      running = false;
      plans.forEach((_, i) => (levels[i] = 1));
      apply(levels);
      done();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  return {
    /** The levels as they stand (the scene reads them at once, to build the first frame with the flickering rods off). */
    levels,
    /** How many rods flicker. */
    count: plans.size,
    start() {
      if (running) return;
      running = true;
      last = -1;
      t0 = performance.now();
      apply(levels);
      void schedule();
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      plans.forEach((_, i) => (levels[i] = 1));
      if (ctx) void ctx.close();
    },
  };
}
