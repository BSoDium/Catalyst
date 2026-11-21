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
  /** How often the picture is updated while the wobble runs (frames a second; the wobble's fastest drift is 0.4 of it, so that it is never faster than the updates can show). */
  wobbleFps?: number;
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
/**
 * A soft, low electrical bzz, for the tubes that do not ding: two sawtooth voices a little apart (170 to 260 Hz and the same a little above an octave up), taken through a low-pass at about 1.5 kHz so that the buzz is light, not deep and not hissy, a
 * wobble in the level (55 to 90 Hz, shallow) for the "b-z-z" texture and a trace of low-passed noise for the wiring. 130 to 240 ms, very faint: nothing hissy or crackly in it (it is not radio static).
 */
function bzz(c: AudioContext, dest: AudioNode, when: number, pan: number, level: number, length: number) {
  const f = 170 + Math.random() * 90;
  const body = c.createGain();
  body.gain.value = 1;
  for (const [ratio, gain] of [[1, 1], [2.03, 0.5]] as const) {
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f * ratio;
    const g = c.createGain();
    g.gain.value = gain;
    o.connect(g).connect(body);
    o.start(when);
    o.stop(when + length + 0.03);
  }
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1500;
  lp.Q.value = 0.7;
  // (a shallow wobble: the level swings by about a third around its mean)
  const wobble = c.createGain();
  wobble.gain.value = 0.7;
  const lfo = c.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 55 + Math.random() * 35;
  const depth = c.createGain();
  depth.gain.value = 0.3;
  lfo.connect(depth).connect(wobble.gain);
  lfo.start(when);
  lfo.stop(when + length + 0.03);
  // (a trace of low noise)
  const len = Math.floor(c.sampleRate * (length + 0.05));
  const nb = c.createBuffer(1, len, c.sampleRate);
  const d = nb.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const ns = c.createBufferSource();
  ns.buffer = nb;
  const nlp = c.createBiquadFilter();
  nlp.type = "lowpass";
  nlp.frequency.value = 1400;
  const ng = c.createGain();
  ng.gain.value = 0.05;
  ns.connect(nlp).connect(ng).connect(lp);
  ns.start(when);
  ns.stop(when + length + 0.03);
  const env = c.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(0.045 * level, when + 0.02);
  env.gain.setValueAtTime(0.045 * level, when + length * 0.55);
  env.gain.exponentialRampToValueAtTime(0.0001, when + length);
  const panner = c.createStereoPanner();
  panner.pan.value = pan * 0.8;
  body.connect(lp).connect(wobble).connect(env).connect(panner).connect(dest);
}
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

export function createNeon({ blocks, apply, done, sound, fps = NEON_FPS, wobbleFps = 40, seed = 7, canPlay = () => true }: NeonOptions) {
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
    // Not every tube dings: each has its own voice, the same every time (about half ding, a third give a soft, low electrical bzz instead, the rest are silent: in a sign of this many tubes a few are quiet).
    const voices = blocks.map(() => {
      const r = random();
      return r < 0.5 ? "ding" : r < 0.82 ? "bzz" : "quiet";
    });
    const click = (at: number, pan: number, level: number, tube: number) => {
      const voice = voices[tube] ?? "ding";
      if (voice === "quiet" || clicks >= 110) return;
      clicks++;
      const when = Math.max(now + at / 1000, c.currentTime);
      if (voice === "bzz") {
        bzz(c, master, when, pan, level, 0.13 + random() * 0.11);
        return;
      }
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
          click(st.at + random() * 60, blocks[i]!.pan, st.level, i);
          if (random() < 0.6) click(st.at + st.length + random() * 40, blocks[i]!.pan, st.level * 0.35, i);
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
  // --- the wobble: a tube's gas is never perfectly steady, least of all while the ballast hums. Every tube's brightness drifts slowly (two slow sines of its own, its own strength: a few wobble a lot, most hardly at all), and how
  // much follows the hum's own loudness: it rises as the tubes light, is at its fullest when the start-up has settled, and dies away with the hum (the same decay, 2 s). No sound of its own. Tubes that are in a flicker are left to it. ---
  const busy = new Set<number>();
  // (fast, as the hum is: the two drifts at a quarter to a half, and at a half to all, of 0.4 of the update rate: 4-8 Hz and 8-16 Hz at 40 updates a second; a faster drift than half the rate cannot be shown)
  const fMax = wobbleFps * 0.4;
  const wobbleSeed = blocks.map(() => ({ s: random() < 0.18 ? 0.4 + random() * 0.6 : 0, f1: fMax * (0.25 + random() * 0.25), f2: fMax * (0.5 + random() * 0.5), p1: random() * 6.283, p2: random() * 6.283 }));
  const rate = Math.max(fps, wobbleFps);
  const HUM_STEP = 25;
  const humEnd = end + 200;
  const humLit: number[] = [];
  for (let ms = 0; ms <= humEnd; ms += HUM_STEP) {
    let sum = 0;
    plans.forEach((p) => (sum += levelAt(p, ms)));
    humLit.push(sum / Math.max(1, plans.size));
  }
  /** The hum's loudness, 0 to 1, `ms` after the start-up began (the sound's own envelope: the share of tubes lit, then an exponential fade of time constant 2 s). */
  const humAt = (ms: number) => (ms <= humEnd ? (humLit[Math.min(humLit.length - 1, Math.floor(ms / HUM_STEP))] ?? 0) : Math.exp(-(ms - humEnd) / 2000));
  /** Down to 55 % of its brightness, at the hum's loudest, for the strongest tube; only about one tube in five wobbles at all. */
  const WOBBLE_DEPTH = 0.45;
  const wob = (i: number, ms: number, hum: number) => {
    if (hum <= 0.005) return 1;
    const w = wobbleSeed[i]!;
    const sec = ms / 1000;
    const n = 0.5 + 0.5 * (0.6 * Math.sin(6.283 * w.f1 * sec + w.p1) + 0.4 * Math.sin(6.283 * w.f2 * sec + w.p2));
    return 1 - WOBBLE_DEPTH * hum * w.s * n;
  };
  let tailing = false;
  let tailRaf = 0;
  let tailLast = -1;
  const tail = (stamp: number) => {
    tailRaf = 0;
    if (!tailing) return;
    const ms = performance.now() - t0;
    const hum = humAt(ms);
    if (tailLast < 0 || stamp - tailLast >= 1000 / rate) {
      tailLast = stamp;
      // (only while the picture is in view: out of view the wobble goes on in time, unseen)
      if (canPlay() && !document.hidden) {
        for (let i = 0; i < blocks.length; i++) if (!busy.has(i)) levels[i] = wob(i, ms, hum);
        apply(levels);
      }
    }
    if (hum < 0.015) {
      tailing = false;
      for (let i = 0; i < blocks.length; i++) if (!busy.has(i)) levels[i] = 1;
      apply(levels);
      done();
      return;
    }
    tailRaf = requestAnimationFrame(tail);
  };
  const stopIdle = () => {
    idleOn = false;
    tailing = false;
    cancelAnimationFrame(tailRaf);
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
  };

  const tick = (stamp: number) => {
    raf = 0;
    if (!running) return;
    const ms = stamp - t0;
    // (the picture is updated often enough for the wobble to be seen drifting; the tubes' own stutters are timed, so they do not depend on it)
    if (last < 0 || stamp - last >= 1000 / rate) {
      last = stamp;
      let changed = false;
      const hum = humAt(ms);
      for (let i = 0; i < blocks.length; i++) {
        const plan = plans.get(i);
        const v = (plan ? levelAt(plan, ms) : 1) * wob(i, ms, hum);
        if (Math.abs(v - levels[i]!) > 1e-3) {
          levels[i] = v;
          changed = true;
        }
      }
      if (changed) apply(levels);
    }
    if (ms >= end) {
      running = false;
      // (the sound's tail goes on a few seconds after the picture is done: it keeps its listener until it is let go)
      if (!ctx) document.removeEventListener("visibilitychange", onVisibility);
      // (the lights are all on: the page is told so; the wobble goes on with the hum, which is at its fullest now, until it has died away)
      done();
      startIdle();
      tailing = true;
      tailLast = -1;
      tailRaf = requestAnimationFrame(tail);
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
      levels.fill(1);
      closeSound();
      stopIdle();
    },
  };
}
