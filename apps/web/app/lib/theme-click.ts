/**
 * The soft click of the theme switching (#507): a tick of filtered noise and a short low "tock", synthesised (no file), quiet, a little higher for the light page and lower for the dark
 * one. It is not played for a visitor who has turned the page's sound off (`muted`, engine/now-playing.ts). The context is made by the first click, inside the gesture that asks for it (a
 * browser lets a context start only then). `voice` is the pure part: what the click is made of.
 */
export interface ClickVoice {
  /** The tock's pitch, Hz, and how long it takes to go, s. */
  tockHz: number;
  tockSec: number;
  /** The tick's band, Hz, and its length, s. */
  tickHz: number;
  tickSec: number;
  /** The loudest each part gets (linear gain; the whole is well under the music's). */
  tockGain: number;
  tickGain: number;
}

export function voice(scheme: "light" | "dark"): ClickVoice {
  return scheme === "light"
    ? { tockHz: 1100, tockSec: 0.05, tickHz: 3800, tickSec: 0.014, tockGain: 0.022, tickGain: 0.05 }
    : { tockHz: 720, tockSec: 0.06, tickHz: 2600, tickSec: 0.016, tockGain: 0.026, tickGain: 0.045 };
}

let ctx: AudioContext | null = null;

export function playThemeClick(scheme: "light" | "dark", muted: boolean): void {
  if (muted || typeof window === "undefined") return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    void ctx.resume();
    const c = ctx;
    const v = voice(scheme);
    const t = c.currentTime + 0.005;
    const out = c.createGain();
    out.gain.value = 1;
    out.connect(c.destination);

    // the tick: a few ms of noise through a band, a sharp attack and a quick fall
    const len = Math.max(1, Math.floor(c.sampleRate * v.tickSec));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const tick = c.createBufferSource();
    tick.buffer = buf;
    const band = c.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = v.tickHz;
    band.Q.value = 1.1;
    const tickGain = c.createGain();
    tickGain.gain.setValueAtTime(0.0001, t);
    tickGain.gain.exponentialRampToValueAtTime(v.tickGain, t + 0.0015);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, t + v.tickSec);
    tick.connect(band).connect(tickGain).connect(out);
    tick.start(t);

    // the tock: a sine that falls a little in pitch as it goes out
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(v.tockHz, t);
    osc.frequency.exponentialRampToValueAtTime(v.tockHz * 0.8, t + v.tockSec);
    const tockGain = c.createGain();
    tockGain.gain.setValueAtTime(0.0001, t);
    tockGain.gain.exponentialRampToValueAtTime(v.tockGain, t + 0.002);
    tockGain.gain.exponentialRampToValueAtTime(0.0001, t + v.tockSec);
    osc.connect(tockGain).connect(out);
    osc.start(t);
    osc.stop(t + v.tockSec + 0.01);
    tick.stop(t + v.tickSec + 0.01);
  } catch {
    /* no sound: the switch is the same */
  }
}
