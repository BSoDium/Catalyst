/**
 * The hum of the neon under the pointer: a ballast's buzz (a sawtooth with its edges taken off, pitched by the neon's size: 112 Hz for the smallest down to 70 for the biggest) whose loudness (and brightness of tone) follows how bright the neon is, 0 when nothing is selected, the most when it is at full
 * brightness, and slowly back to 0 as it falls back. It is not one steady tone: two buzzing voices a fifth or so apart lie on top of each other and one ducks the other, as in a sidechain, at a slow rate of its own, so that the hum
 * breathes and beats as two real ballasts do. It is made on demand (a context only when the first neon is selected, and let go a few seconds after the last hum has died), only when the browser lets the page make sound (the visitor
 * has used the page), and it is the page's own business to say when (`level`).
 */
// (as quiet as the start-up's own hum: its ballast is 0.004 through a master of 0.5; this is several voices, so a little under)
const MAX = 0.0030;
const IDLE_CLOSE_MS = 4500;
/** How fast the hum swells with the light, and how slowly it dies away (time constants, seconds). */
const ATTACK = 0.09;
const RELEASE = 0.45;

/** The pitch of a neon's hum by its size (0 the smallest, 1 the biggest): a small neon hums high and a big one low, as a short string or pipe does, from 112 Hz down to 70. */
const pitchOf = (size: number) => 112 - 42 * Math.max(0, Math.min(1, size));

/** Each neon has a hum of its own, the same every time: from the neon's number come a little variety on its size's pitch (a few percent), the pitch of the second voice, the slow beat, the rate and depth of the ducking and the brightness of the tone. */
function voiceOf(seed: number, size: number) {
  let a = (seed * 2654435761 + 0x9e3779b9) >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const base = pitchOf(size) * (0.96 + rnd() * 0.08);
  const ratios = [1.5, 1.335, 1.26, 2.01];
  return {
    base,
    beat: 0.3 + rnd() * 1.1,
    second: base * ratios[Math.floor(rnd() * ratios.length)]!,
    lfo: 0.35 + rnd() * 1.3,
    depth: 0.5 + rnd() * 0.4,
    upper: 0.15 + rnd() * 0.35,
    tone: 0.85 + rnd() * 0.3,
  };
}

export function createHoverHum() {
  let c: AudioContext | null = null;
  let gain: GainNode | null = null;
  let lp: BiquadFilterNode | null = null;
  let panner: StereoPannerNode | null = null;
  let closeTimer = 0;
  let oscs: OscillatorNode[] = [];
  let upperGain: GainNode | null = null;
  let duck: GainNode | null = null;
  let swell: GainNode | null = null;
  let voiceA: GainNode | null = null;
  let voiceB: GainNode | null = null;
  let seeded = -1;
  let seededSize = -1;
  let tone = 1;
  let prev = 0;
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
    gain = lp = panner = upperGain = duck = swell = voiceA = voiceB = null;
    seeded = -1;
    seededSize = -1;
    prev = 0;
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
    const osc = (type: OscillatorType) => {
      const o = c!.createOscillator();
      o.type = type;
      o.frequency.value = 100;
      o.start();
      oscs.push(o);
      return o;
    };
    // voice A: two sawtooths a hair apart (the slow beat); voice B: a sawtooth at the second pitch; and a sine an octave above A
    voiceA = c.createGain();
    voiceA.gain.value = 0.7;
    osc("sawtooth").connect(voiceA);
    osc("sawtooth").connect(voiceA);
    voiceB = c.createGain();
    voiceB.gain.value = 0.4;
    osc("sawtooth").connect(voiceB);
    upperGain = c.createGain();
    upperGain.gain.value = 0.3;
    osc("sine").connect(upperGain);
    // the sidechain: a slow sine makes B swell as it makes A duck (the one keeps the other's level moving, never both loud or both quiet)
    const lfo = osc("sine");
    lfo.frequency.value = 0.8;
    swell = c.createGain();
    swell.gain.value = 0.3;
    duck = c.createGain();
    duck.gain.value = -0.3;
    lfo.connect(swell).connect(voiceB.gain);
    lfo.connect(duck).connect(voiceA.gain);
    voiceA.connect(lp);
    voiceB.connect(lp);
    upperGain.connect(lp);
    lp.connect(gain).connect(panner).connect(c.destination);
    return true;
  };
  return {
    /**
     * The hum's strength, 0 to 1 (the selected neon's brightness above its normal, as a share of the most it gets). `pan` (-1 to 1), `seed` (the neon's number) and `size` (0 the smallest to 1 the biggest: it sets the pitch, small high and big low) say which neon it is, or `null` when none is under the pointer:
     * then the hum is the last neon's, as it was, and only fades.
     */
    set(level: number, pan: number | null = null, seed: number | null = null, size = 0.5) {
      const v = Math.max(0, Math.min(1, level));
      if (v < 0.01 && !c) return;
      if (!c && !open()) return;
      if (!c || !gain || !lp || !panner) return;
      const t = c.currentTime;
      if (c.state === "suspended") void c.resume().catch(() => {});
      if (seed !== null && pan !== null && (seed !== seeded || size !== seededSize)) {
        // (another neon: its own voice; the first time the pitch is set at once, after that it glides, so that moving across the blocks does not click)
        const vc = voiceOf(seed, size);
        const glide = seeded < 0 ? 0.001 : 0.12;
        oscs[0]?.frequency.setTargetAtTime(vc.base, t, glide);
        oscs[1]?.frequency.setTargetAtTime(vc.base + vc.beat, t, glide);
        oscs[2]?.frequency.setTargetAtTime(vc.second, t, glide);
        oscs[3]?.frequency.setTargetAtTime(vc.base * 2, t, glide);
        oscs[4]?.frequency.setTargetAtTime(vc.lfo, t, glide);
        upperGain?.gain.setTargetAtTime(vc.upper, t, glide);
        swell?.gain.setTargetAtTime(0.4 * vc.depth, t, glide);
        duck?.gain.setTargetAtTime(-0.4 * vc.depth, t, glide);
        tone = vc.tone;
        seeded = seed;
        seededSize = size;
      }
      if (pan !== null) panner.pan.setTargetAtTime(pan * 0.7, t, 0.15);
      // (a soft change: the hum swells with the light, and dies slowly, with the light, not with the frame)
      const tc = v >= prev ? ATTACK : RELEASE;
      prev = v;
      gain.gain.setTargetAtTime(MAX * v ** 1.5, t, tc);
      lp.frequency.setTargetAtTime((380 + 520 * v) * tone, t, tc);
      window.clearTimeout(closeTimer);
      if (v < 0.01) closeTimer = window.setTimeout(close, IDLE_CLOSE_MS);
    },
    /** Let the hum go at once (the picture is rebuilt or taken down). */
    stop: close,
  };
}
