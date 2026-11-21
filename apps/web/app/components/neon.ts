/**
 * The neon start-up of the dark theme's rods: when the picture appears the rods do not just come on, they flicker like a gas tube that is struggling to start (the blocks are divided into oval areas, each with its own
 * few stutters of light with gaps between, and then a short warm-up); with a faint low hum that dies away slowly and a few quiet bell-like dings. No file: the sound is synthesised (Web Audio), and only if the browser lets
 * the page make sound and the tab is in view (it does not before the visitor has interacted with the page; then it is silent and nothing else changes).
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
  /** `idle` is true for the flickers after the start-up (a tube that is off is then seen as a dark gap in a lit sign, not as one lit by its neighbours as in the start-up). */
  apply: (levels: Float32Array, idle?: boolean) => void;
  /** Called once all the lights are steady. */
  done: () => void;
  sound: boolean;
  /** How often the picture is updated while the start-up runs (a weak device is given fewer). */
  fps?: number;
  /** A seed, so that a run can be repeated. */
  seed?: number;
  /** Whether a flicker may be shown and heard now (the picture in view, the tab visible); the quirks of the idle neon check it each time. */
  canPlay?: () => boolean;
}

/** How many areas the rods are divided into, how many of them flicker (all of them now; a smaller number would leave the others on from the start), how long the start-up lasts, and how often the picture is updated while it does. */
const AREAS = 8;
const FLICKERING = AREAS;
const SPAN_MS = 2600;
export const NEON_FPS = 20;

interface Stutter {
  at: number;
  length: number;
  level: number;
}

/**
 * A tiny bell: a few partials that are not whole multiples of the pitch (1, 2.76, 5.4: the ratios of a small struck bar), each dying away on its own, the higher ones faster.
 */
const PARTIALS: [number, number, number][] = [[1, 1, 0.3], [2.76, 0.35, 0.14], [5.4, 0.12, 0.07]];
function bell(c: AudioContext, dest: AudioNode, when: number, f0: number, pan: number, level: number) {
  const out = c.createGain();
  out.gain.value = 0.05 * level;
  const panner = c.createStereoPanner();
  panner.pan.value = pan * 0.8;
  out.connect(panner).connect(dest);
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
}

export function createNeon({ blocks, apply, done, sound, fps = NEON_FPS, seed = 7, canPlay = () => true }: NeonOptions) {
  // (nothing to light: a controller that does nothing, rather than a search for the centres of areas among no blocks)
  if (blocks.length === 0) return { levels: new Float32Array(0), count: 0, start: () => done(), stop: () => {} };
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
  let closeTimer = 0;
  const closeSound = () => {
    window.clearTimeout(closeTimer);
    document.removeEventListener("visibilitychange", onVisibility);
    const c = ctx;
    ctx = null;
    // (a context that is closed already refuses to close again: nothing to do then)
    if (c && c.state !== "closed") c.close().catch(() => {});
  };
  // (the sound was scheduled in one go against the audio clock, and a tab that is not in view stops the picture's clock: when the tab goes out of view the sound goes too)
  const onVisibility = () => {
    if (document.hidden) closeSound();
  };
  const schedule = async () => {
    if (!sound || typeof AudioContext === "undefined" || document.hidden) return;
    let c: AudioContext;
    try {
      c = new AudioContext();
      await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 300))]);
    } catch {
      return;
    }
    if (c.state !== "running" || !running || document.hidden) {
      // (not allowed to make sound yet, or the start-up is over already, or the tab went out of view: silent, and the context is let go)
      c.close().catch(() => {});
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
    // The tick of a tube lighting: not a crackle but a tiny bell, a very high, short, quiet ding; the pitch is a little different each time.
    const click = (at: number, pan: number, level: number) => {
      if (clicks >= 110) return;
      clicks++;
      const when = Math.max(now + at / 1000, c.currentTime);
      // (some of them low, a deeper bell: about a third, from 800 to 1500 Hz; the rest high, 2300 to 3800)
      bell(c, master, when, random() < 0.35 ? 800 + random() * 700 : 2300 + random() * 1500, pan, level);
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
    closeTimer = window.setTimeout(closeSound, (stopAt - c.currentTime) * 1000 + 500);
  };


  // --- the idle neon: once everything is on, from time to time a small batch of tubes flickers, as a real sign does (one or two, a few at most, close to one another): out with a lower ding, a stutter, back on with a
  // higher one. Completely random, never the same twice, and no change to the picture once it is over. ---
  let idleTimer = 0;
  let idleRaf = 0;
  let idleCtx: AudioContext | null = null;
  let idleClose = 0;
  let idleOn = false;
  let idleSince = 0;
  const idleRandom = () => Math.random();
  // --- the faint wobble: a real tube's gas is never perfectly steady, least of all just after it has lit. For the first half minute, now and then, a few tubes lose a little of their brightness for a moment and come
  // back, several times over, less and less often. No sound; it never touches a tube that is in a flicker (`busy`). ---
  const wobbling = new Map<number, { from: number; ms: number; depth: number }>();
  const busy = new Set<number>();
  let wobbleTimer = 0;
  let wobbleRaf = 0;
  let wobbleLast = -1;
  const WOBBLE_MS = 30000;
  const ease = (x: number) => x * x * (3 - 2 * x);
  // (analog: the light does not jump, it sinks a little over a third of a second and climbs back more slowly, both eased, as a tube's gas settles)
  const dip = (u: number) => (u < 0.35 ? ease(u / 0.35) : ease(1 - (u - 0.35) / 0.65));
  const wobbleStep = (stamp: number) => {
    wobbleRaf = 0;
    if (!idleOn || wobbling.size === 0) return;
    if (wobbleLast < 0 || stamp - wobbleLast >= 1000 / fps) {
      wobbleLast = stamp;
      const now = performance.now();
      wobbling.forEach((w, i) => {
        const u = (now - w.from) / w.ms;
        if (u >= 1) {
          wobbling.delete(i);
          if (!busy.has(i)) levels[i] = 1;
        } else if (!busy.has(i)) levels[i] = 1 - w.depth * dip(Math.max(0, u));
      });
      apply(levels, true);
    }
    wobbleRaf = requestAnimationFrame(wobbleStep);
  };
  const wobble = () => {
    if (!idleOn) return;
    const age = performance.now() - idleSince;
    if (age > WOBBLE_MS) return;
    if (canPlay() && !document.hidden) {
      const n = 1 + Math.floor(idleRandom() * 3);
      for (let k = 0; k < n; k++) {
        const i = Math.floor(idleRandom() * blocks.length);
        if (busy.has(i) || wobbling.has(i)) continue;
        // (down to 55-80 % at the lowest, over 0.4 to 1.2 s in all; the picture shows a little less of it)
        wobbling.set(i, { from: performance.now() + idleRandom() * 120, ms: 400 + idleRandom() * 800, depth: 0.2 + idleRandom() * 0.25 });
      }
      if (!wobbleRaf && wobbling.size > 0) {
        wobbleLast = -1;
        wobbleRaf = requestAnimationFrame(wobbleStep);
      }
    }
    wobbleTimer = window.setTimeout(wobble, (300 + idleRandom() * 900) * (1 + age / 10000));
  };
  const stopIdle = () => {
    idleOn = false;
    window.clearTimeout(wobbleTimer);
    cancelAnimationFrame(wobbleRaf);
    wobbleRaf = 0;
    wobbling.clear();
    busy.clear();
    window.clearTimeout(idleTimer);
    window.clearTimeout(idleClose);
    cancelAnimationFrame(idleRaf);
    const c = idleCtx;
    idleCtx = null;
    if (c && c.state !== "closed") c.close().catch(() => {});
  };
  const idleSound = async (edges: { at: number; on: boolean; level: number }[], pan: number) => {
    if (!sound || typeof AudioContext === "undefined") return;
    let c: AudioContext;
    try {
      c = new AudioContext();
      await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 300))]);
    } catch {
      return;
    }
    // (not allowed to make sound yet: silent, and the picture does not wait for it)
    if (c.state !== "running" || !idleOn) {
      c.close().catch(() => {});
      return;
    }
    idleCtx = c;
    const master = c.createGain();
    master.gain.value = 0.5;
    master.connect(c.createDynamicsCompressor()).connect(c.destination);
    // (every time the tube goes out, a lower bell; every time it lights, a higher one)
    const base = c.currentTime + 0.03;
    // (one pitch for going out and one for lighting, the same each time it happens in this flicker: it is the one tube, going out and on again)
    const outHz = 650 + idleRandom() * 450;
    const onHz = 2400 + idleRandom() * 1000;
    edges.forEach((e) => bell(c, master, base + e.at / 1000, e.on ? onHz : outHz, pan, e.level));
    window.clearTimeout(idleClose);
    idleClose = window.setTimeout(() => {
      const x = idleCtx;
      idleCtx = null;
      if (x && x.state !== "closed") x.close().catch(() => {});
    }, (edges[edges.length - 1]?.at ?? 0) + 1500);
  };
  const flicker = () => {
    // (the wait to the next: from 3 to 20 s right after the start-up, more often short than long, and it stretches the longer the sign has been on, e^(t/45 s): about 7 times at 1.5 minutes, 55 times at 3: after a few minutes, hardly ever)
    const slow = Math.exp((performance.now() - idleSince) / 45000);
    idleTimer = window.setTimeout(flicker, (3000 + idleRandom() ** 1.6 * 17000) * slow);
    if (!idleOn || document.hidden || !canPlay()) return;
    // (a batch: often a whole segment of tubes next to one another, as if a stretch of the sign were failing; sometimes a few, rarely just the one)
    const r = idleRandom();
    const want = r < 0.2 ? 1 : r < 0.45 ? 2 + Math.floor(idleRandom() * 3) : r < 0.8 ? 5 + Math.floor(idleRandom() * 5) : 10 + Math.floor(idleRandom() * 9);
    const first = Math.floor(idleRandom() * blocks.length);
    const ranked = blocks
      .map((b, i) => ({ i, d: Math.hypot(b.x - blocks[first]!.x, b.z - blocks[first]!.z) }))
      .filter((o) => o.d <= 5)
      .sort((a, b) => a.d - b.d)
      .slice(0, want);
    const batch = ranked.map((o) => o.i);
    batch.forEach((i) => busy.add(i));
    // (out for a time that is short or long, from 0.12 to 2.5 s, more often short; then 0 to 3 stutters on the way back (a half-glow, and out again), then on; each tube a few ms off the others)
    const dark = 120 + idleRandom() ** 2 * 2400;
    let at = dark;
    const glows: [number, number, number][] = [];
    const stutters = idleRandom() < 0.55 ? 1 + Math.floor(idleRandom() * 3) : 0;
    for (let j = 0; j < stutters; j++) {
      const len = 40 + idleRandom() * 60;
      glows.push([at, at + len, 0.55 + idleRandom() * 0.3]);
      at += len + 40 + idleRandom() * 110;
    }
    const onAt = at;
    // (each a few ms off the others, the farther from the first the later: the failure runs along the segment)
    const shift = ranked.map((o) => o.d * 12 + idleRandom() * 30);
    const t0 = performance.now();
    const total = onAt + 40 + 40;
    // (one sound for each change: out, then each stutter lights and goes out, then the last light; the stutters a little fainter)
    const edges = [{ at: 0, on: false, level: 1 }];
    glows.forEach(([a, b, v]) => edges.push({ at: a, on: true, level: 0.5 * v + 0.2 }, { at: b, on: false, level: 0.6 }));
    edges.push({ at: onAt, on: true, level: 0.8 });
    void idleSound(edges, blocks[first]!.pan);
    let last = -1;
    const step = (stamp: number) => {
      idleRaf = 0;
      if (!idleOn) return;
      const ms = stamp - t0;
      if (last < 0 || stamp - last >= 1000 / fps) {
        last = stamp;
        batch.forEach((i, k) => {
          const m = ms - shift[k]!;
          let v = 1;
          if (m >= 0 && m < onAt) v = glows.find(([a, b]) => m >= a && m < b)?.[2] ?? 0;
          levels[i] = v;
        });
        apply(levels, true);
      }
      if (ms >= total) {
        batch.forEach((i) => {
          levels[i] = 1;
          busy.delete(i);
          wobbling.delete(i);
        });
        apply(levels, true);
        done();
        return;
      }
      idleRaf = requestAnimationFrame(step);
    };
    idleRaf = requestAnimationFrame(step);
  };
  const startIdle = () => {
    idleOn = true;
    idleSince = performance.now();
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(flicker, 2500 + idleRandom() * 3500);
    window.clearTimeout(wobbleTimer);
    wobbleTimer = window.setTimeout(wobble, 600);
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
      // (the sound's tail goes on a few seconds after the picture is done: it keeps its listener until it is let go)
      if (!ctx) document.removeEventListener("visibilitychange", onVisibility);
      plans.forEach((_, i) => (levels[i] = 1));
      apply(levels);
      done();
      startIdle();
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
      document.addEventListener("visibilitychange", onVisibility);
      void schedule();
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      plans.forEach((_, i) => (levels[i] = 1));
      closeSound();
      stopIdle();
    },
  };
}
