/**
 * Sleigh bells for the `?xmas` Easter egg, synthesised (Web Audio, no file): every few seconds a faint shake of a string of bells, a handful of
 * jingles that thin out and fade, each a short burst of filtered noise (the clack of the pea) over a few ringing metal partials. It plays only if
 * the browser lets the page (not before the visitor has interacted with it: a try that is refused is silent and the next shake tries again), only
 * while `canPlay()` (the picture in view) and the tab visible. Stopped, it closes its audio context.
 */
export interface SleighBellsOptions {
  canPlay?: () => boolean;
}

/** The partials of a small bell (Hz), each of the string's bells a little detuned from them. */
const PARTIALS = [2870, 4620, 6180, 7900];

export function createSleighBells({ canPlay = () => true }: SleighBellsOptions = {}) {
  let running = false;
  let timer = 0;
  let ctx: AudioContext | null = null;
  let closeTimer = 0;

  const jingle = (c: AudioContext, dest: AudioNode, when: number, level: number, pan: number) => {
    const out = c.createGain();
    out.gain.value = level;
    const p = c.createStereoPanner();
    p.pan.value = pan;
    out.connect(p).connect(dest);
    const detune = 0.97 + Math.random() * 0.06;
    PARTIALS.forEach((f, i) => {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.value = f * detune * (1 + (Math.random() - 0.5) * 0.01);
      const g = c.createGain();
      const peak = [1, 0.7, 0.45, 0.25][i]! * 0.5;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(peak, when + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.5 - i * 0.08);
      o.connect(g).connect(out);
      o.start(when);
      o.stop(when + 0.55);
    });
    // (the clack: a few ms of noise through a band around 6 kHz)
    const len = Math.floor(c.sampleRate * 0.03);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const n = c.createBufferSource();
    n.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 6000;
    bp.Q.value = 3;
    const ng = c.createGain();
    ng.gain.value = 0.6;
    n.connect(bp).connect(ng).connect(out);
    n.start(when);
  };

  const shake = async () => {
    if (!running) return;
    // (the next shake in 5 to 11 s, whether this one plays or not)
    timer = window.setTimeout(shake, 5000 + Math.random() * 6000);
    if (document.hidden || !canPlay() || typeof AudioContext === "undefined") return;
    let c: AudioContext;
    try {
      c = new AudioContext();
      await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 300))]);
    } catch {
      return;
    }
    if (c.state !== "running" || !running) {
      c.close().catch(() => {});
      return;
    }
    ctx = c;
    const master = c.createGain();
    master.gain.value = 0.35;
    master.connect(c.createDynamicsCompressor()).connect(c.destination);
    const base = c.currentTime + 0.03;
    const count = 7 + Math.floor(Math.random() * 6);
    let t = 0;
    for (let i = 0; i < count; i++) {
      // (a shake: quick and uneven, thinning out, fading)
      const fade = 1 - i / (count + 2);
      jingle(c, master, base + t, 0.5 * fade * (0.6 + Math.random() * 0.4), (Math.random() - 0.5) * 0.8);
      t += (0.05 + Math.random() * 0.06) * (1 + i * 0.12);
    }
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      const x = ctx;
      ctx = null;
      if (x && x.state !== "closed") x.close().catch(() => {});
    }, (t + 0.9) * 1000);
  };

  return {
    start() {
      if (running) return;
      running = true;
      // (the first shake a little after the start-up begins)
      timer = window.setTimeout(shake, 2500);
    },
    stop() {
      running = false;
      window.clearTimeout(timer);
      window.clearTimeout(closeTimer);
      const x = ctx;
      ctx = null;
      if (x && x.state !== "closed") x.close().catch(() => {});
    },
  };
}
