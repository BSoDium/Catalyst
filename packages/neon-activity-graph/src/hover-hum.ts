/**
 * The hum of the neon under the pointer: a ballast's buzz (100 Hz, a sawtooth with its edges taken off, and a little beating against a second one a hair away) whose loudness (and brightness of tone) follows how bright the
 * neon is, 0 when nothing is selected, the most when it is at full brightness, and back to 0 as it falls back. It is made on demand (a context only when the first neon is selected, and let go a few seconds after the last hum has
 * died), only when the browser lets the page make sound (the visitor has used the page), and it is the page's own business to say when (`level`).
 */
const MAX = 0.05;
const IDLE_CLOSE_MS = 3000;

export function createHoverHum() {
  let c: AudioContext | null = null;
  let gain: GainNode | null = null;
  let lp: BiquadFilterNode | null = null;
  let panner: StereoPannerNode | null = null;
  let closeTimer = 0;
  let oscs: OscillatorNode[] = [];
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
    gain = lp = panner = null;
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
      o.connect(og).connect(lp);
      o.start();
      oscs.push(o);
    }
    lp.connect(gain).connect(panner).connect(c.destination);
    return true;
  };
  return {
    /** The hum's strength, 0 to 1 (the selected neon's brightness above its normal, as a share of the most it gets), and where it is across the picture, -1 to 1. */
    set(level: number, pan = 0) {
      const v = Math.max(0, Math.min(1, level));
      if (v < 0.01 && !c) return;
      if (!c && !open()) return;
      if (!c || !gain || !lp || !panner) return;
      const t = c.currentTime;
      if (c.state === "suspended") void c.resume().catch(() => {});
      // (a soft change: the hum swells and dies with the light, not with the frame)
      gain.gain.setTargetAtTime(MAX * v ** 1.5, t, 0.09);
      lp.frequency.setTargetAtTime(380 + 520 * v, t, 0.09);
      panner.pan.setTargetAtTime(pan * 0.7, t, 0.15);
      window.clearTimeout(closeTimer);
      if (v < 0.01) closeTimer = window.setTimeout(close, IDLE_CLOSE_MS);
    },
    /** Let the hum go at once (the picture is rebuilt or taken down). */
    stop: close,
  };
}
