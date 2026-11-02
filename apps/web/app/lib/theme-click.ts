/**
 * The sound of the theme switching (#507, second version): a small mechanical switch, synthesised (no file). A real toggle is a sharp transient (the contacts), a few
 * damped resonances of its little body, a low soft "thunk" of the lever reaching its stop, and, a few hundredths of a second later, a quieter release of the same: this is
 * those four. The light page is the switch thrown up (higher, brighter), the dark page thrown down (lower, rounder). It is dry, warm (a gentle low pass) and quiet, and it is
 * not played for a visitor who has turned the page's sound off (`muted`, engine/now-playing.ts). The context is made by the first click, inside the gesture that asks for it
 * (a browser lets a context start only then). `voice` is the pure part (what it is made of); `scheduleClick` builds it on any context, so that a test, or a listen, can
 * render it offline.
 */
export interface Mode {
  /** The resonance's pitch, Hz, how long it takes to go, s, and its loudest, linear gain. */
  hz: number;
  sec: number;
  gain: number;
}

export interface ClickVoice {
  /** The contacts: noise through a high pass at `hz`, `sec` long. */
  transient: Mode;
  /** The body's resonances. */
  modes: readonly Mode[];
  /** The lever on its stop: a low sine that falls from `hz` to `hz * fall`. */
  thunk: Mode & { fall: number };
  /** The release: the same again `delay` s later, `scale` as loud and its pitches times `shift`. */
  release: { delay: number; scale: number; shift: number };
  /** The warmth: the low pass over the whole, Hz. */
  lowpassHz: number;
}

export function voice(scheme: "light" | "dark"): ClickVoice {
  return scheme === "light"
    ? {
        transient: { hz: 2200, sec: 0.006, gain: 0.07 },
        modes: [
          { hz: 780, sec: 0.05, gain: 0.04 },
          { hz: 1850, sec: 0.035, gain: 0.05 },
          { hz: 3100, sec: 0.022, gain: 0.025 },
        ],
        thunk: { hz: 190, sec: 0.04, gain: 0.07, fall: 0.68 },
        release: { delay: 0.045, scale: 0.45, shift: 1.12 },
        lowpassHz: 6500,
      }
    : {
        transient: { hz: 1600, sec: 0.007, gain: 0.07 },
        modes: [
          { hz: 560, sec: 0.055, gain: 0.045 },
          { hz: 1350, sec: 0.04, gain: 0.05 },
          { hz: 2300, sec: 0.025, gain: 0.025 },
        ],
        thunk: { hz: 130, sec: 0.05, gain: 0.08, fall: 0.73 },
        release: { delay: 0.05, scale: 0.45, shift: 0.9 },
        lowpassHz: 5200,
      };
}

/** Build the click on `ctx` into `dest`, starting at `t` (the context's time). Returns when it is over. */
export function scheduleClick(ctx: BaseAudioContext, dest: AudioNode, t: number, v: ClickVoice): number {
  const warm = ctx.createBiquadFilter();
  warm.type = "lowpass";
  warm.frequency.value = v.lowpassHz;
  warm.Q.value = 0.5;
  warm.connect(dest);

  const noise = (sec: number) => {
    const len = Math.max(1, Math.floor(ctx.sampleRate * sec));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  };
  const envelope = (g: GainNode, at: number, peak: number, sec: number) => {
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.0012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + sec);
  };
  let end = t;
  const strike = (at: number, scale: number, shift: number) => {
    // the contacts
    const src = ctx.createBufferSource();
    src.buffer = noise(v.transient.sec);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = v.transient.hz * shift;
    const tg = ctx.createGain();
    envelope(tg, at, v.transient.gain * scale, v.transient.sec);
    src.connect(hp).connect(tg).connect(warm);
    src.start(at);
    // the body
    for (const m of v.modes) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = m.hz * shift;
      const g = ctx.createGain();
      envelope(g, at, m.gain * scale, m.sec);
      o.connect(g).connect(warm);
      o.start(at);
      o.stop(at + m.sec + 0.01);
      end = Math.max(end, at + m.sec);
    }
    // the lever on its stop
    const th = ctx.createOscillator();
    th.type = "sine";
    th.frequency.setValueAtTime(v.thunk.hz * shift, at);
    th.frequency.exponentialRampToValueAtTime(v.thunk.hz * shift * v.thunk.fall, at + v.thunk.sec);
    const tgn = ctx.createGain();
    envelope(tgn, at, v.thunk.gain * scale, v.thunk.sec);
    th.connect(tgn).connect(warm);
    th.start(at);
    th.stop(at + v.thunk.sec + 0.01);
    end = Math.max(end, at + v.thunk.sec);
  };
  strike(t, 1, 1);
  strike(t + v.release.delay, v.release.scale, v.release.shift);
  return end + 0.02;
}

let ctx: AudioContext | null = null;

export function playThemeClick(scheme: "light" | "dark", muted: boolean): void {
  if (muted || typeof window === "undefined") return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    void ctx.resume();
    scheduleClick(ctx, ctx.destination, ctx.currentTime + 0.005, voice(scheme));
  } catch {
    /* no sound: the switch is the same */
  }
}
