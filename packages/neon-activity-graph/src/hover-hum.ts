/**
 * The hum of the neon under the pointer: a ballast's buzz (100 Hz, a sawtooth with its edges taken off, and a little beating against a second one a hair away) whose loudness (and brightness of tone) follows how bright the
 * neon is, 0 when nothing is selected, the most when it is at full brightness, and back to 0 as it falls back. It is made on demand (a context only when the first neon is selected, and let go a few seconds after the last hum has
 * died), only when the browser lets the page make sound (the visitor has used the page), and it is the page's own business to say when (`level`).
 */
// (as quiet as the start-up's own hum: its ballast is 0.004 through a master of 0.5; this is three voices, so a little under)
const MAX = 0.0024;
const IDLE_CLOSE_MS = 3000;

/** Each neon has a hum of its own, the same every time: its pitch, the slow beat between the two buzzing voices, the share of the upper partial and the brightness of the tone come from the neon's number. */
function voiceOf(seed: number) {
  let a = (seed * 2654435761 + 0x9e3779b9) >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const base = 88 + rnd() * 26;
  return { base, beat: 0.3 + rnd() * 1.3, upper: 0.15 + rnd() * 0.45, upperHz: base * (2 + (rnd() < 0.5 ? 0 : 0.003)), tone: 0.8 + rnd() * 0.5 };
}

export function createHoverHum() {
  let c: AudioContext | null = null;
  let gain: GainNode | null = null;
  let lp: BiquadFilterNode | null = null;
  let panner: StereoPannerNode | null = null;
  let closeTimer = 0;
  let oscs: OscillatorNode[] = [];
  let upperGain: GainNode | null = null;
  let seeded = -1;
  let tone = 1;
  const allowed = () => (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive !== false;
  const close = () => {
    window.clearTimeout(closeTimer);
    oscs.forEach((o) => {
      try {
        o.stop();
      } catch {
        /* (stopped already) */
      }
    });
    oscs = [];
    const x = c;
    c = null;
    gain = lp = panner = upperGain = null;
    seeded = -1;
    if (x && x.state !== "closed") x.close().catch(() => {});
  };
  const open = () => {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC || !allowed()) return false;
    c = new AC();
    void c.resume().catch(() => {});
    gain = c.createGain();
    gain.gain.value = 0;
    lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380;
    lp.Q.value = 0.6;
    panner = c.createStereoPanner();
    for (const [f, g] of [[100, 1], [100.7, 0.8], [200.3, 0.35]] as const) {
      const o = c.createOscillator();
      o.type = f > 150 ? "sine" : "sawtooth";
      o.frequency.value = f;
      const og = c.createGain();
      og.gain.value = g;
      if (f > 150) upperGain = og;
      o.connect(og).connect(lp);
      o.start();
      oscs.push(o);
    }
    lp.connect(gain).connect(panner).connect(c.destination);
    return true;
  };
  return {
    /** The hum's strength, 0 to 1 (the selected neon's brightness above its normal, as a share of the most it gets), and where it is across the picture, -1 to 1. */
    set(level: number, pan = 0, seed = 0) {
      const v = Math.max(0, Math.min(1, level));
      if (v < 0.01 && !c) return;
      if (!c && !open()) return;
      if (!c || !gain || !lp || !panner) return;
      const t = c.currentTime;
      if (seed !== seeded && v >= 0.01) {
        // (another neon: its own voice; the first time the pitch is set at once, after that it glides, so that moving across the blocks does not click)
        const vc = voiceOf(seed);
        const glide = seeded < 0 ? 0.001 : 0.12;
        oscs[0]?.frequency.setTargetAtTime(vc.base, t, glide);
        oscs[1]?.frequency.setTargetAtTime(vc.base + vc.beat, t, glide);
        oscs[2]?.frequency.setTargetAtTime(vc.upperHz, t, glide);
        upperGain?.gain.setTargetAtTime(vc.upper, t, glide);
        tone = vc.tone;
        seeded = seed;
      }
      if (c.state === "suspended") void c.resume().catch(() => {});
      // (a soft change: the hum swells and dies with the light, not with the frame)
      gain.gain.setTargetAtTime(MAX * v ** 1.5, t, 0.09);
      lp.frequency.setTargetAtTime((380 + 520 * v) * tone, t, 0.09);
      panner.pan.setTargetAtTime(pan * 0.7, t, 0.15);
      window.clearTimeout(closeTimer);
      if (v < 0.01) closeTimer = window.setTimeout(close, IDLE_CLOSE_MS);
    },
    /** Let the hum go at once (the picture is rebuilt or taken down). */
    stop: close,
  };
}
