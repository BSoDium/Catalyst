/**
 * The neon start-up of the dark theme's rods: when the picture appears the rods do not just come on, they flicker like a gas tube that is struggling to start (the blocks are divided into rectangular areas, each with its own
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
const AREAS = 5;
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
export function bell(c: AudioContext, dest: AudioNode, when: number, f0: number, pan: number, level: number) {
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
  // The rods are divided into areas that are rectangles: the picture is cut in two across its longer side, then the biggest piece again (each cut at a random place near the middle, by the number of blocks), until there are `AREAS` pieces. So the
  // blocks of an area are next to each other and the areas are of different sizes; the pieces flicker each as one: a stuttering of its own, the same for all its blocks, each a few milliseconds off the others and not quite as bright, so that it reads as a patch of tubes on one circuit.
  const pieces: number[][] = [blocks.map((_, i) => i)];
  while (pieces.length < Math.min(AREAS, blocks.length)) {
    pieces.sort((p, q) => q.length - p.length);
    const piece = pieces.shift()!;
    if (piece.length < 2) {
      pieces.push(piece);
      break;
    }
    const xs = piece.map((i) => blocks[i]!.x);
    const zs = piece.map((i) => blocks[i]!.z);
    const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
    const sorted = [...piece].sort((i, j) => (alongX ? blocks[i]!.x - blocks[j]!.x : blocks[i]!.z - blocks[j]!.z));
    const cut = Math.min(sorted.length - 1, Math.max(1, Math.round(sorted.length * (0.35 + random() * 0.3))));
    pieces.push(sorted.slice(0, cut), sorted.slice(cut));
  }
  const centres = pieces;
  const areaOf = new Array<number>(blocks.length).fill(0);
  pieces.forEach((p, k) => p.forEach((i) => (areaOf[i] = k)));
  const flickering = new Set([...centres.keys()].sort(() => random() - 0.5).slice(0, FLICKERING));
  const areaPlans = new Map<number, { start: number; stutters: Stutter[]; steady: number }>();
  flickering.forEach((k) => {
    const start = random() * (SPAN_MS - 1100);
    // (few stutters: the picture is not to be a nervous flicker; fewer, bigger circuits, each one with a few)
    const count = 2 + Math.floor(random() * 3);
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
  let dirty = false;
  let running = false;

  // --- the sound ---
  // In step with the picture: a light changed at time P (the picture's clock) is on the screen about a frame and a half later (the next frame is drawn, then shown), and a sound scheduled for the audio clock's time T is heard
  // `outputLatency` later (the speakers, the Bluetooth link). So a sound for P is scheduled at P + the frame's delay - the output latency, on the audio clock (the two clocks are tied at the moment of scheduling).
  const FRAME_LAG = 25;
  const audioTime = (c: AudioContext, perfStart: number) => c.currentTime - (performance.now() - perfStart) / 1000 + FRAME_LAG / 1000 - (c.outputLatency || c.baseLatency || 0);
  // (a browser that has not let the page make sound yet leaves the context suspended for ever: then nothing waits for it)
  const mayWait = () => (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive !== false;
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
  // The context, ready before the start-up's clock starts (so that no sound of the first moments is late): null when there is to be no sound, or the browser does not let the page make one yet.
  const prepare = async (): Promise<AudioContext | null> => {
    if (!sound || typeof AudioContext === "undefined" || document.hidden || !mayWait()) return null;
    let c: AudioContext;
    try {
      c = new AudioContext();
      await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 300))]);
    } catch {
      return null;
    }
    if (c.state !== "running" || document.hidden) {
      c.close().catch(() => {});
      return null;
    }
    return c;
  };
  const schedule = (c: AudioContext) => {
    ctx = c;
    const now = audioTime(c, t0);
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
    const FADE = 10;
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
    const members = new Map<number, number[]>();
    plans.forEach((p, i) => (members.get(p.area) ?? members.set(p.area, []).get(p.area)!).push(i));
    // The tick of a tube lighting: not a crackle but a tiny bell, a very high, short, quiet ding; the pitch is a little different each time.
    // Not every tube dings, and no two dings are alike: each tube has its own voice, the same every time (most ding, a few are silent: in a sign of this many tubes some are quiet), its own band of pitch (some low, most high, some very high) and its own
    // loudness, and each ding is a little different again (pitch and volume).
    const voices = blocks.map(() => {
      const r = random();
      const band = random();
      const hz = band < 0.15 ? 1300 + random() * 250 : 2700 + random() * 650;
      return { quiet: r >= 0.85, hz, gain: 0.45 + random() * 0.95 };
    });
    // (the clicks are first collected, then thinned out evenly over the whole start-up if there are more than 40: a cap met in the order they are made would silence the last areas, and the sound would end before the last flicker)
    const heard: { at: number; pan: number; level: number; tube: number }[] = [];
    const click = (at: number, pan: number, level: number, tube: number) => {
      const voice = voices[tube];
      // (at the tube's own moment: its picture is a few ms off the others', and its sound goes with it)
      if (voice && !voice.quiet) heard.push({ at: at + (plans.get(tube)?.shift ?? 0), pan, level, tube });
    };
    // (a few clicks for each stutter of an area, from some of its tubes, a few milliseconds apart: the tubes switching on, and off again)
    areaPlans.forEach((plan, area) => {
      const own = members.get(area) ?? [];
      if (!own.length) return;
      plan.stutters.forEach((st) => {
        const n = 1 + Math.floor(random() * 3);
        for (let k = 0; k < n; k++) {
          const i = own[Math.floor(random() * own.length)]!;
          click(st.at, blocks[i]!.pan, st.level, i);
          if (random() < 0.6) click(st.at + st.length, blocks[i]!.pan, st.level * 0.35, i);
        }
      });
      // (the last light of the area, when it comes on for good: a few of its tubes say so, the stronger ones, at the moment the picture does it)
      const settle = 2 + Math.floor(random() * 3);
      for (let k = 0; k < settle; k++) {
        const i = own[Math.floor(random() * own.length)]!;
        click(plan.steady, blocks[i]!.pan, 0.85, i);
      }
    });
    const keep = Math.min(1, 40 / Math.max(1, heard.length));
    heard.forEach((h) => {
      if (random() > keep) return;
      const voice = voices[h.tube]!;
      const when = Math.max(now + h.at / 1000, c.currentTime);
      bell(c, master, when, voice.hz * (0.98 + random() * 0.04), h.pan, h.level * voice.gain * (0.6 + random() * 0.6));
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
  const humAt = (ms: number) => (ms <= humEnd ? (humLit[Math.min(humLit.length - 1, Math.floor(ms / HUM_STEP))] ?? 0) : Math.exp(-(ms - humEnd) / 3333));
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
  // (the context first, and the flicker's picture only starts when it is ready, so that the first sound is not late; null: silent, and the picture does not wait)
  const idleContext = async (): Promise<AudioContext | null> => {
    if (!sound || typeof AudioContext === "undefined" || !mayWait()) return null;
    let c: AudioContext;
    try {
      c = new AudioContext();
      await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 300))]);
    } catch {
      return null;
    }
    // (not allowed to make sound yet)
    if (c.state !== "running" || !idleOn) {
      c.close().catch(() => {});
      return null;
    }
    return c;
  };
  const idleSound = (c: AudioContext, edges: { at: number; on: boolean; level: number }[], pan: number, perfStart: number) => {
    idleCtx = c;
    const master = c.createGain();
    master.gain.value = 0.5;
    master.connect(c.createDynamicsCompressor()).connect(c.destination);
    // (every time the tube goes out, a lower bell; every time it lights, a higher one)
    const base = audioTime(c, perfStart);
    // (one pitch for going out and one for lighting, the same each time it happens in this flicker: it is the one tube, going out and on again)
    const outHz = 800 + idleRandom() * 150;
    const onHz = 2700 + idleRandom() * 350;
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
    const total = onAt + 40 + 40;
    // (one sound for each change: out, then each stutter lights and goes out, then the last light; the stutters a little fainter)
    const edges = [{ at: 0, on: false, level: 1 }];
    glows.forEach(([a, b, v]) => edges.push({ at: a, on: true, level: 0.5 * v + 0.2 }, { at: b, on: false, level: 0.6 }));
    edges.push({ at: onAt, on: true, level: 0.8 });
    const play = async () => {
    const c = await idleContext();
    if (!idleOn) {
      c?.close().catch(() => {});
      return;
    }
    const t0 = performance.now();
    if (c) idleSound(c, edges, blocks[first]!.pan, t0);
    let last = -1;
    const step = (stamp: number) => {
      idleRaf = 0;
      if (!idleOn) return;
      const ms = stamp - t0;
      // (drawn only when a light changed, and at once: the changes are the sound's, so they are not held to the update rate)
      let changed = false;
      batch.forEach((i, k) => {
        const m = ms - shift[k]!;
        let v = 1;
        if (m >= 0 && m < onAt) v = glows.find(([a, b]) => m >= a && m < b)?.[2] ?? 0;
        if (v !== levels[i] || last < 0) changed = true;
        levels[i] = v;
      });
      last = stamp;
      if (changed) apply(levels, true);
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
    void play();
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
    // (the levels are worked out at every frame; a jump of a tube (the light going out, coming on) is drawn at once, so that it falls on the sound's moment, and the slow drift only at the update rate)
    let jump = false;
    const hum = humAt(ms);
    for (let i = 0; i < blocks.length; i++) {
      const plan = plans.get(i);
      const v = (plan ? levelAt(plan, ms) : 1) * wob(i, ms, hum);
      const d = Math.abs(v - levels[i]!);
      if (d > 1e-3) {
        if (d > 0.15) jump = true;
        levels[i] = v;
        dirty = true;
      }
    }
    if (dirty && (jump || last < 0 || stamp - last >= 1000 / rate)) {
      last = stamp;
      dirty = false;
      apply(levels);
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
      dirty = false;
      apply(levels);
      document.addEventListener("visibilitychange", onVisibility);
      // (the clock starts when the sound is ready, a few ms later at most: the picture and the sound start together)
      void prepare().then((c) => {
        if (!running || raf) {
          c?.close().catch(() => {});
          return;
        }
        last = -1;
        t0 = performance.now();
        if (c) schedule(c);
        raf = requestAnimationFrame(tick);
      });
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
