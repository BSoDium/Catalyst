/**
 * The music of the sun (docs/landing.md, "The sun's music"): "Gabriel", a slow, eerie piece (2 min 22 s), plays FAINTLY while the sun is in the picture and lets go while it is not, as the planet covers it
 * or the camera turns away from it. A PROTOTYPE, waiting for the artist's answer: the file is `public/audio/gabriel.mp3`, on this stacked PR's branch only, which switches the sun's music to it from the stand-in `cinematic-piano.mp3` (it must not reach main before the artist's answer); without it the
 * music is simply not there (`status` "failed": no sound, and no button either).
 *
 * It is one piece the sun comes back to, not a sample started again: the visitor's place in it is kept while the sun is away (`position`), and the next time the sun comes round it takes up from there
 * (the first time, from the start). Its end is joined to its beginning with a crossfade made once, when the file is decoded (`loopable`), so that the loop is a continuous sound, not a seam; a
 * buffer source that loops is gapless.
 *
 * Like the interlude's sound (engine/cinematic-sound.ts) it is played through the WEB AUDIO API and not an `<audio>` element, on purpose: an element is a MEDIA the system knows about (the media keys, the
 * Now Playing widget and the headphones' button can pause it), and this is the page's atmosphere, not a track to be controlled from outside. A buffer source in an `AudioContext` is not registered anywhere
 * (a test holds that: no element and no media session in this file).
 *
 * The visitor can turn it off (`setMuted`: the page's one choice about sound, engine/now-playing.ts, which the player in `components/now-playing-player.tsx` sets; kept in localStorage; `?mute` starts a visit muted without keeping it). It tells the pill what it is, and whether it is playing (the sun is in view) or waiting. It is on by default, but a browser lets
 * sound start only after a gesture on the page, so until the first touch it is silent, and it starts when the sun is in view and the page has been touched.
 *
 * The signal is the sun's `glare` (engine/sun-layer.ts: how much of the sun's light is in the picture, 0..1, the zoom's share times the root of what the planet leaves of the disc), read through two
 * thresholds (`glareOn`, `glareOff`) so that a sun on the edge of the planet's limb does not make the music stutter; the fades do the rest.
 */
import { TRACKS, nowPlaying, type NowPlaying } from "./now-playing";

export const SUN_MUSIC = {
  url: "/audio/gabriel.mp3",
  /** The loudness: the gain of a file that is about -11 LUFS (loud), with a range of 18 LU. 0.55 puts it near -16 LUFS, a normal level for music under a page (it was 0.18, about -26 LUFS: too faint to hear on a phone's speaker; owner, 2026-10-29). */
  volume: 0.55,
  /**
   * How much of the end is laid over the beginning to make the loop, seconds, at least (the file's last six seconds are its fade-out: the overlap is the tail dying under the head rising). The loop is a whole number of
   * `cycleSec` long (`loopSamples`), so that the beat goes on across the seam: the overlap is the least that makes it so, from this much up to one cycle more.
   */
  crossfadeSec: 8,
  /**
   * The piece's pulse, measured on the file (onset autocorrelation, 2026-10-29: 109.97 BPM, a period of 0.5456 s, steady from end to end; no published tempo was found): `beatSec` is one beat (owner, 2026-10-29: the first measure, 0.5456 s, was a pulse of eighths, "twice as fast as the bass line": the beat is TWICE that, 55 BPM; the bass is too soft an onset to tell from the file which of the two pulses it falls on, so the PHASE, `beatOffsetSec`, is still the first pulse's: by ear, if it is half a beat off, add 0.5456 to it), `cycleBeats` of them the
   * cycle the sun's pulse goes round in (four beats, 4.4 s: owner, "even slower, but still on rhythm"; the same time as the eight pulses it was before the beat was corrected: the axes' rays pulse on the first beat and the diagonals' on the third, two beats, two seconds and a bit, apart), `beatOffsetSec` where the first beat falls in the decoded file.
   */
  beatSec: 1.0912,
  cycleBeats: 4,
  beatOffsetSec: 0.055,
  /** How long a mute takes to go quiet (ms): not the fade-out of a sun that sets, but short enough not to click. */
  muteFadeMs: 120,
  /** Coming in and going out, for the whole way from silence to `volume` (a part of the way takes a part of the time). */
  fadeInMs: 3200,
  fadeOutMs: 2600,
  /** The shortest a fade takes, however little of the way is left (ms). */
  minFadeMs: 400,
  /** The sun is in view above `glareOn` and out of it under `glareOff` (between: as it was). */
  glareOn: 0.03,
  glareOff: 0.008,
  /** How loud the piece is for the picture (the energy that grows the rays): the level of the file in dBFS, from `energyLoDb` (0) to `energyHiDb` (1), smoothed over `energySmoothSec`. */
  energyLoDb: -42,
  energyHiDb: -16,
  energySmoothSec: 0.5,
} as const;

/** How far a fade has got, 0..1 in, 0..1 out: a smoothstep, so that a fade starts and ends without a corner. */
const ease = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** A fade from one gain to another as the array `setValueCurveAtTime` takes. Pure. */
export function fadeCurve(from: number, to: number, points = 64): Float32Array {
  const out = new Float32Array(points);
  for (let i = 0; i < points; i++) out[i] = from + (to - from) * ease(i / (points - 1));
  return out;
}

/**
 * The channels of a piece made so that played in a loop it has no seam: the last `fadeSamples` are laid over the first, the tail going out as the head comes in (equal power, so the level holds),
 * and the loop is that much shorter. The loop's end is the original, untouched, up to the sample before the tail begins, and its beginning is that tail, so that one follows the other as in the original.
 * Pure.
 */
export function loopable(channels: readonly Float32Array[], fadeSamples: number): Float32Array[] {
  const n = channels[0]?.length ?? 0;
  const x = Math.max(0, Math.min(Math.floor(fadeSamples), Math.floor(n / 2)));
  const len = n - x;
  return channels.map((src) => {
    const out = new Float32Array(len);
    out.set(src.subarray(0, len));
    for (let i = 0; i < x; i++) {
      const a = ((i + 0.5) / x) * (Math.PI / 2);
      out[i] = src[i]! * Math.sin(a) + src[len + i]! * Math.cos(a);
    }
    return out;
  });
}

/**
 * The length of the loop, in samples, for a piece of `n`: the longest whole number of cycles that leaves at least `crossfadeSec` to overlap, so that the beat on the loop's first sample is the beat that follows its last. Pure.
 */
export function loopSamples(n: number, sampleRate: number): number {
  const cycle = SUN_MUSIC.beatSec * SUN_MUSIC.cycleBeats * sampleRate;
  const k = Math.floor((n - SUN_MUSIC.crossfadeSec * sampleRate) / cycle);
  return k >= 1 ? Math.round(k * cycle) : n;
}

/** Whether a glare means the sun is in view, given whether it was (the two thresholds: a sun on the edge does not flicker). Pure. */
export function sunInView(glare: number, was: boolean): boolean {
  return glare >= SUN_MUSIC.glareOn || (was && glare > SUN_MUSIC.glareOff);
}

/** Where the piece is `elapsed` seconds after it was at `from`, in a loop `length` seconds long. Pure. */
export function loopPosition(from: number, elapsed: number, length: number): number {
  if (!(length > 0)) return 0;
  return (((from + elapsed) % length) + length) % length;
}

/** The parts of the Web Audio API this needs (a test gives fakes). */
export interface MusicParam {
  cancelScheduledValues(t: number): void;
  setValueAtTime(v: number, t: number): void;
  setValueCurveAtTime(values: Float32Array, t: number, duration: number): void;
}
export interface MusicGain {
  gain: MusicParam;
  connect(node: unknown): void;
  disconnect(): void;
}
export interface MusicSource {
  buffer: unknown;
  loop: boolean;
  connect(node: unknown): void;
  disconnect(): void;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}
export interface MusicAnalyser {
  fftSize: number;
  getFloatTimeDomainData(a: Float32Array<ArrayBuffer>): void;
}
export interface MusicContext {
  state: string;
  currentTime: number;
  /** How long the sound takes from the audio clock to the speaker, seconds (not in every browser). */
  outputLatency?: number;
  destination: unknown;
  onstatechange?: (() => void) | null;
  resume(): Promise<void>;
  createGain(): MusicGain;
  createBufferSource(): MusicSource;
  /** Absent in a fake that cannot tell how loud it is: the rays then grow with nothing. */
  createAnalyser?(): MusicAnalyser;
}
export interface MusicDeps {
  /** The audio context (opens the device). */
  context(): MusicContext;
  /** The file's bytes. */
  fetchBytes(url: string): Promise<ArrayBuffer>;
  /** The bytes decoded to channels, without a device. */
  decode(bytes: ArrayBuffer): Promise<{ channels: Float32Array[]; sampleRate: number }>;
  /** Channels to a buffer the context plays. */
  makeBuffer(channels: Float32Array[], sampleRate: number): unknown;
}

const browserDeps: MusicDeps = {
  context: () => {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    return new Ctor({ latencyHint: "playback" }) as unknown as MusicContext;
  },
  fetchBytes: (url) => fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`)))),
  // (an offline context decodes without opening a device; the buffer it makes plays in any context)
  decode: async (bytes) => {
    const b = await new OfflineAudioContext(2, 44100, 44100).decodeAudioData(bytes);
    return { channels: Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i)), sampleRate: b.sampleRate };
  },
  makeBuffer: (channels, sampleRate) => {
    const b = new OfflineAudioContext(1, 1, sampleRate).createBuffer(channels.length, channels[0]!.length, sampleRate);
    channels.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    return b;
  },
};

export type MusicStatus = "idle" | "loading" | "ready" | "failed";

/** What the interface reads: whether the sun has been in view this visit (the player appears then), and whether there is a music at all (the file is there and can be played). The visitor's choice is the page's (`nowPlaying`). */
export interface MusicSnapshot {
  readonly sunSeen: boolean;
  readonly status: MusicStatus;
}

export class SunMusic {
  private snapshot: MusicSnapshot = { sunSeen: false, status: "idle" };
  private listeners = new Set<() => void>();
  private ctx: MusicContext | null = null;
  private master: MusicGain | null = null;
  private src: MusicSource | null = null;
  private loopSec = 0;
  private buffer: unknown = null;
  /** Where the piece is, seconds into the loop, as of `srcAt` (the context's time) when the sound is running, or as it was left when it is not. */
  private pos = 0;
  private srcAt = 0;
  private fade: { from: number; to: number; at: number; dur: number } | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private inView = false;
  private hidden = false;
  private attached = false;
  private off: (() => void)[] = [];

  private analyser: MusicAnalyser | null = null;
  private senseBuf: Float32Array<ArrayBuffer> | null = null;
  private energy = 0;
  private energyAt = 0;

  constructor(
    private deps: MusicDeps = browserDeps,
    private prefs: NowPlaying = nowPlaying,
  ) {}

  /** The visitor has turned the page's sound off. */
  private get muted(): boolean {
    return this.prefs.getSnapshot().muted;
  }

  /* ------------------------------- what the interface reads ------------------------------- */

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getSnapshot = (): MusicSnapshot => this.snapshot;

  private set(patch: Partial<MusicSnapshot>) {
    const next = { ...this.snapshot, ...patch };
    if (next.sunSeen === this.snapshot.sunSeen && next.status === this.snapshot.status) return;
    this.snapshot = next;
    this.listeners.forEach((l) => l());
  }

  /** The piece's place in its loop now, seconds (a test reads it). */
  position(): number {
    return this.src && this.ctx ? loopPosition(this.pos, this.ctx.currentTime - this.srcAt, this.loopSec) : this.pos;
  }

  /**
   * What the picture needs to follow the music (engine/sun-pulse.ts): how audible it is, 0 (silent, or not playing) to 1 (at `volume`), where in the piece the SPEAKER is (the audio clock less the time the sound takes to get
   * there: a pair of Bluetooth headphones is a fifth of a second behind), and how loud the piece is just now, 0..1 (`energy`: it grows the rays). Null when nothing is sounding, so that nothing asks for frames.
   */
  pulse(): { amount: number; position: number; energy: number } | null {
    const c = this.ctx;
    if (!c || !this.src) return null;
    const amount = this.level(c.currentTime) / SUN_MUSIC.volume;
    if (amount < 0.002) return null;
    const lag = Math.min(0.5, c.outputLatency ?? 0);
    return { amount: Math.min(1, amount), position: loopPosition(this.pos, c.currentTime - this.srcAt - lag, this.loopSec), energy: this.sense(c.currentTime) };
  }

  /** How loud the piece is now, 0..1: the RMS of the last few milliseconds in dB between `energyLoDb` and `energyHiDb`, eased (up as it comes, down over `energySmoothSec`). */
  private sense(now: number): number {
    const a = this.analyser;
    if (!a) return 0;
    const buf = (this.senseBuf ??= new Float32Array(a.fftSize));
    a.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
    const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-6);
    const target = Math.min(1, Math.max(0, (db - SUN_MUSIC.energyLoDb) / (SUN_MUSIC.energyHiDb - SUN_MUSIC.energyLoDb)));
    const dt = this.energyAt > 0 ? Math.max(0, now - this.energyAt) : 1;
    this.energyAt = now;
    const k = 1 - Math.exp(-dt / SUN_MUSIC.energySmoothSec);
    this.energy += (target - this.energy) * k;
    return this.energy;
  }

  /* ---------------------------------------- the page's ---------------------------------------- */

  /**
   * Begin listening to the page: the visitor's choice (kept, or `?mute`), the tab going behind, and the first gesture (the context is made and run then, and run again at every one until it is running:
   * a phone's browser lets a context start only inside a touch). Once; undone by `detach`.
   */
  attach(): void {
    if (this.attached || typeof window === "undefined") return;
    this.attached = true;
    this.prefs.load();
    this.hidden = document.hidden;
    let was = this.muted;
    const offPrefs = this.prefs.subscribe(() => {
      // the visitor's choice, from the player or from another sound's: followed live (a sound that is asked for again is made ready by the gesture that asked)
      const now = this.muted;
      if (now !== was) {
        was = now;
        if (!now) this.unlock();
      }
      this.reconcile();
    });
    this.off.push(offPrefs);
    const onVisibility = () => {
      this.hidden = document.hidden;
      this.reconcile();
    };
    document.addEventListener("visibilitychange", onVisibility);
    this.off.push(() => document.removeEventListener("visibilitychange", onVisibility));
    const events = ["pointerdown", "touchend", "keydown", "click"] as const;
    const onGesture = () => this.unlock();
    events.forEach((e) => window.addEventListener(e, onGesture, { capture: true, passive: true }));
    this.off.push(() => events.forEach((e) => window.removeEventListener(e, onGesture, { capture: true })));
  }

  /** Let go of the page and of the sound (the globe is gone). The visitor's place in the piece is kept. */
  detach(): void {
    this.setGlare(0);
    if (!this.attached) return;
    this.attached = false;
    this.off.forEach((f) => f());
    this.off = [];
  }

  /**
   * Called inside a gesture of the visitor's: gets the context running (the one moment a phone's browser lets it) and, the first time, begins to fetch the piece, so that it is ready by the time the sun comes
   * round. The context is made now only if the sun is in view (a device opened for nothing stalls the main thread for 150 ms or more); else in an idle moment.
   */
  unlock(): void {
    this.load();
    if (this.ctx) return this.run();
    const make = () => this.run();
    if (this.inView && !this.muted) make();
    else if (typeof requestIdleCallback === "function") requestIdleCallback(make, { timeout: 1500 });
    else setTimeout(make, 200);
  }

  private context(): MusicContext | null {
    if (!this.ctx) {
      try {
        this.ctx = this.deps.context();
      } catch {
        return null;
      }
    }
    return this.ctx;
  }

  /** Ask the context to run (made if need be) and, when it does, see to the music. */
  private run() {
    const c = this.context();
    if (!c) return;
    if (c.state === "running") return this.reconcile();
    void c
      .resume()
      .catch(() => undefined)
      .then(() => this.reconcile());
  }

  /* --------------------------------------- the choice --------------------------------------- */

  /** The visitor's choice (the page's: see `NowPlaying.setMuted`); the music follows it. */
  setMuted(muted: boolean): void {
    this.prefs.setMuted(muted);
    this.reconcile(); // (not attached: nobody is listening)
  }

  /** The sun's glare in the picture now, 0..1 (every frame the camera moves in; nothing is done unless it crosses a threshold). */
  setGlare(glare: number): void {
    const now = sunInView(glare, this.inView);
    if (now === this.inView) return;
    this.inView = now;
    if (now) {
      this.set({ sunSeen: true });
      this.load();
    }
    this.reconcile();
  }

  /* --------------------------------------- the piece --------------------------------------- */

  /** Fetch and decode the piece (once), and make its loop. Skipped for a visitor who has turned it off, and where the connection saves data. */
  private load() {
    if (this.snapshot.status !== "idle" || this.muted) return;
    try {
      const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      if (conn?.saveData) return this.set({ status: "failed" });
    } catch {
      /* no connection info */
    }
    this.set({ status: "loading" });
    this.deps
      .fetchBytes(SUN_MUSIC.url)
      .then((bytes) => this.deps.decode(bytes))
      .then(({ channels, sampleRate }) => {
        const loop = loopable(channels, channels[0]!.length - loopSamples(channels[0]!.length, sampleRate));
        this.loopSec = loop[0]!.length / sampleRate;
        this.buffer = this.deps.makeBuffer(loop, sampleRate);
        this.set({ status: "ready" });
        this.reconcile();
      })
      .catch(() => {
        // (the file is not there, or cannot be decoded: no music, and nothing else)
        this.buffer = null;
        this.set({ status: "failed" });
      });
  }

  /** Whether the music should be sounding now. */
  private get wanted(): boolean {
    return this.inView && !this.muted && !this.hidden && this.snapshot.status === "ready";
  }

  /** The gain now, as the last fade has it (the audio param's own value is not readable while it moves, in every browser). */
  private level(t: number): number {
    const f = this.fade;
    if (!f) return 0;
    return f.from + (f.to - f.from) * ease((t - f.at) / f.dur);
  }

  /** Bring the sound to what is wanted: in if the sun is in view, out if it is not. */
  private reconcile() {
    if (this.wanted) this.rise();
    else this.fall();
    this.publish();
  }

  /** Tell the page's registry what this is doing: it is there once the sun has come into view (it would have played), playing while the sun is in view and the music is not off (blocked, if the browser has not let the page make sound yet: no gesture), waiting otherwise; and gone if there is no music. */
  private publish() {
    const s = this.snapshot;
    if (s.status === "failed") return this.prefs.end(TRACKS.sun.id);
    if (!s.sunSeen) return;
    this.prefs.set(TRACKS.sun, !this.wanted ? "paused" : this.ctx?.state === "running" ? "playing" : "blocked");
  }

  private rise() {
    const c = this.ctx;
    if (!c || c.state !== "running" || !this.buffer) return; // (the gesture that runs the context comes back here)
    if (!this.master) {
      this.master = c.createGain();
      this.master.gain.setValueAtTime(0, c.currentTime);
      this.master.connect(c.destination);
      // (how loud the piece is, for the picture: before the master, so that its fades do not show in it; an analyser is read without being connected to anything)
      this.analyser = c.createAnalyser?.() ?? null;
      if (this.analyser) this.analyser.fftSize = 512;
      c.onstatechange = () => this.reconcile();
    }
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (!this.src) {
      // from where it was left: the piece goes on, it does not begin again
      const s = c.createBufferSource();
      s.buffer = this.buffer;
      s.loop = true;
      s.connect(this.master);
      if (this.analyser) s.connect(this.analyser);
      s.start(c.currentTime, this.pos);
      this.src = s;
      this.srcAt = c.currentTime;
    }
    this.fadeTo(SUN_MUSIC.volume, SUN_MUSIC.fadeInMs);
  }

  private fall() {
    const c = this.ctx;
    if (!c || !this.src) return;
    // a mute is quick (a click on a button is not the sun setting), also when the sun is already setting: the fade in progress is replaced by the quick one
    const quick = this.muted;
    const going = this.stopTimer !== null;
    if (going && !(quick && this.fade!.dur > SUN_MUSIC.muteFadeMs / 1000 + 0.05)) return; // (already going out)
    if (going) clearTimeout(this.stopTimer!);
    const ms = this.fadeTo(0, quick ? SUN_MUSIC.muteFadeMs : SUN_MUSIC.fadeOutMs, quick ? 30 : SUN_MUSIC.minFadeMs, going);
    // the place it is left at is where the sound reaches silence, whenever the timer gets to run
    const endAt = c.currentTime + ms / 1000;
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      this.halt(endAt);
    }, ms + 60);
  }

  /**
   * Fade the master gain to `to`; the time it takes is the share of the way left, in the full time, and at least `minMs`. `again`: a fade to this gain that is on its way is replaced (a quicker one) and not left be.
   * Returns the time it takes, ms.
   */
  private fadeTo(to: number, fullMs: number, minMs: number = SUN_MUSIC.minFadeMs, again = false): number {
    const c = this.ctx!;
    const g = this.master!.gain;
    const now = c.currentTime;
    // (already on its way there, or there: leave it be)
    if (!again && this.fade?.to === to) return Math.max(0, (this.fade.at + this.fade.dur - now) * 1000);
    const from = this.level(now);
    const ms = Math.max(minMs, (fullMs * Math.abs(to - from)) / SUN_MUSIC.volume);
    g.cancelScheduledValues(now);
    g.setValueAtTime(from, now);
    g.setValueCurveAtTime(fadeCurve(from, to), now, ms / 1000);
    this.fade = { from, to, at: now, dur: ms / 1000 };
    return ms;
  }

  /** Stop the source, silent by now, keeping the place in the piece it was at when it went silent (`at`, in the context's time). */
  private halt(at: number) {
    const s = this.src;
    if (!s) return;
    this.pos = loopPosition(this.pos, at - this.srcAt, this.loopSec);
    this.src = null;
    this.fade = null;
    try {
      s.stop();
      s.disconnect();
    } catch {
      /* already stopped */
    }
  }
}

/** The page's one music. */
export const sunMusic = new SunMusic();
