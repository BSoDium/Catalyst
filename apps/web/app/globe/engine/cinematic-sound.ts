/**
 * The sound of the cinematic interlude (engine/cinematic.ts): the studio's own intro (`public/audio/universal-intro.mp3`, 24.1 s, 112 kbps, from the
 * owner's file, which they have the rights to), played FAINTLY while the word is on the stage.
 *
 * It is played through the WEB AUDIO API, not an `<audio>` element, on purpose: an element is a MEDIA the system knows about (the media keys, the
 * Now Playing widget and the headphones' button can pause it and play it again), and this is a sound effect of a page, not music. A buffer source in an
 * `AudioContext` is not registered anywhere, so nothing outside the page can stop it (a test holds that: no element in this file).
 *
 * Made so that nothing costs anything at the moment it starts: the file is fetched and DECODED when the interlude is PLANNED (a few sessions in a
 * hundred, and only a returning visitor), long before it plays, by an `OfflineAudioContext` (no audio device is opened for that); the real
 * `AudioContext` (opening a device is a stall of 150 ms or more, on the main thread) is made in an idle moment after the visitor's first gesture, which
 * is also what lets the browser start it. Starting is then a source and a gain on a context that is already running.
 *
 * It plays when the browser lets it (a page nobody has touched is refused, and then it is silent), when the tab is in front, and unless the visitor
 * asked for none (`?mute`, or sessionStorage "cinematic-mute" = "1"). It rises over `fadeInMs`, runs as long as the interlude, and lets go over
 * `fadeOutMs` at its end; cut short (a gesture, the tab put behind, the globe going away) it fades at once (`SoundHandle.fade`).
 */

import { cinematicForced } from "./cinematic";

export const SOUND = {
  url: "/audio/universal-intro.mp3",
  /** The loudness, 0 to 1 of the gain: faint, a sound under the page's own (the file's own level is about -17 dBFS RMS, loud). */
  volume: 0.22,
  /** The file's length, seconds: the interlude is made to it (`CINEMATIC.shape`, `eggMs`). */
  fileSec: 24.1,
  /**
   * The moment the file is loudest, seconds into it (its climax: a long crescendo, then the final chord at 20.25 s and a decay of about three seconds):
   * the word lands on it, 20.25 s into the interlude (0.5 + 0.4 + 19.35).
   */
  hitSec: 20.25,
  /** Where in the file it starts playing, seconds (the whole file: it begins quietly, which the fade-in covers). */
  fromSec: 0,
  fadeInMs: 800,
  fadeOutMs: 1200,
  /** How long it takes to let go when the interlude is cut short (a gesture, the tab put behind, the globe going away): a fade, not a cut. */
  fadeCutMs: 900,
  /** How long the browser may take to start the context (it is asked to, and may not answer when the page has not been touched) before there is no sound. */
  resumeMs: 400,
} as const;

export interface SoundHandle {
  /** Let go now, over `ms`. Safe to call twice, and after the end. */
  fade(ms?: number): void;
}

/** Whether a sound may be started now: asked for none, or the tab behind, are a no (no gesture yet is the browser's: it is asked all the same). */
export function soundAllowed(): boolean {
  try {
    if (typeof document !== "undefined" && document.hidden) return false;
    if (new URLSearchParams(location.search).has("mute") || sessionStorage.getItem("cinematic-mute") === "1") return false;
    return true;
  } catch {
    return false;
  }
}

/** The parts of the Web Audio API this needs (a test gives fakes). */
export interface GainLike {
  gain: { value: number; cancelScheduledValues(t: number): void; setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void };
  connect(node: unknown): void;
  disconnect(): void;
}
export interface SourceLike {
  buffer: unknown;
  onended: (() => void) | null;
  connect(node: unknown): void;
  disconnect(): void;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}
export interface ContextLike {
  state: string;
  currentTime: number;
  destination: unknown;
  resume(): Promise<void>;
  createGain(): GainLike;
  createBufferSource(): SourceLike;
}
export interface SoundDeps {
  /** The audio context (opens the device). */
  context(): ContextLike;
  /** The file's bytes. */
  fetchBytes(url: string): Promise<ArrayBuffer>;
  /** The bytes decoded to a buffer, without a device. */
  decode(bytes: ArrayBuffer): Promise<unknown>;
}

const browserDeps: SoundDeps = {
  context: () => {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    return new Ctor({ latencyHint: "playback" }) as unknown as ContextLike;
  },
  fetchBytes: (url) => fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`)))),
  // (an offline context decodes without opening a device; its buffer plays in any context)
  decode: (bytes) => new OfflineAudioContext(2, 44100, 44100).decodeAudioData(bytes),
};

let buffer: unknown = null;
let loading: Promise<void> | null = null;
let ctx: ContextLike | null = null;
let armed = false;

/** The audio context, made on first use (and kept: a page has few). */
function context(deps: SoundDeps): ContextLike | null {
  if (!ctx) {
    try {
      ctx = deps.context();
    } catch {
      return null;
    }
  }
  return ctx;
}

/**
 * Make the context in an idle moment after the visitor's first gesture (a click, a key, a touch): the browser lets a context made then run, and the stall
 * of opening the device is not in the frame the interlude begins in. Once.
 */
function armContext(deps: SoundDeps): void {
  if (armed || ctx || typeof window === "undefined") return;
  armed = true;
  const events = ["pointerdown", "keydown", "touchend"] as const;
  const off = () => events.forEach((e) => window.removeEventListener(e, onGesture, true));
  const onGesture = () => {
    off();
    const make = () => void context(deps);
    if (typeof requestIdleCallback === "function") requestIdleCallback(make, { timeout: 1500 });
    else window.setTimeout(make, 200);
  };
  events.forEach((e) => window.addEventListener(e, onGesture, { capture: true, passive: true }));
}

/**
 * Fetch and decode the file now (the interlude is planned) and get ready to make the context at the first gesture. Skipped where the visitor asked for
 * none or the connection saves data. Idempotent.
 */
export function prepareSound(deps: SoundDeps = browserDeps): void {
  if (loading) return;
  try {
    if (new URLSearchParams(location.search).has("mute") || sessionStorage.getItem("cinematic-mute") === "1") return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
  } catch {
    return;
  }
  loading = deps
    .fetchBytes(SOUND.url)
    .then((bytes) => deps.decode(bytes))
    .then((b) => {
      buffer = b;
    })
    .catch(() => {
      buffer = null; // (the file is not there, or cannot be decoded: no sound, and nothing else)
    });
  armContext(deps);
}

/** Forget what was prepared (tests). */
export function forgetSound(): void {
  buffer = null;
  loading = null;
  ctx = null;
  armed = false;
}

/**
 * Play it for an interlude of `durationMs`. Null when no sound is to be made (see `soundAllowed`), else the handle that lets go of it. The context is
 * asked to run (`resume`); a browser that does not let it within `SOUND.resumeMs` (a page nobody has touched) leaves no sound, and a sound that starts
 * late starts where the interlude has got to, so that it stays with the picture. `deps` and `allowed` are for a test.
 */
export function startSound(durationMs: number, deps: SoundDeps = browserDeps, allowed: boolean = soundAllowed()): SoundHandle | null {
  if (!allowed) return null;
  const t0 = Date.now();
  let done = false;
  let gain: GainLike | null = null;
  let src: SourceLike | null = null;
  let c: ContextLike | null = null;
  let guard: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (done) return;
    done = true;
    if (guard !== null) clearTimeout(guard);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onHidden);
    try {
      if (src) {
        src.onended = null;
        src.stop();
        src.disconnect();
      }
      gain?.disconnect();
    } catch {
      /* already stopped */
    }
  };
  const fade = (ms: number = SOUND.fadeCutMs) => {
    if (done) return;
    if (!gain || !src || !c) return stop(); // (not begun: it never will)
    const now = c.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + ms / 1000);
    src.stop(now + ms / 1000 + 0.05);
    if (guard !== null) clearTimeout(guard);
    guard = setTimeout(stop, ms + 250);
  };
  // (a tab put behind goes on playing in the background, and its interlude has stopped drawing: the sound lets go with it)
  const onHidden = () => {
    if (typeof document !== "undefined" && document.hidden) fade(SOUND.fadeCutMs);
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onHidden);
  const begin = async () => {
    try {
      if (!buffer && loading) await loading;
      if (done) return;
      c = context(deps);
      if (!buffer || !c) return stop();
      if (c.state !== "running") await Promise.race([c.resume().catch(() => undefined), new Promise((r) => setTimeout(r, SOUND.resumeMs))]);
      if (done) return;
      if (c.state !== "running") {
        // (refused: no touch on the page yet. Silence; where the owner asks for the interlude, say why)
        if (cinematicForced()) console.info("[interlude] the browser did not let the sound play: touch the page (a click, a key) before it begins");
        return stop();
      }
      const lag = (Date.now() - t0) / 1000;
      const remain = durationMs / 1000 - lag;
      if (remain <= 0.2) return stop();
      gain = c.createGain();
      src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      gain.connect(c.destination);
      const now = c.currentTime;
      const fin = SOUND.fadeInMs / 1000;
      const fout = SOUND.fadeOutMs / 1000;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(SOUND.volume, now + fin);
      gain.gain.setValueAtTime(SOUND.volume, now + Math.max(fin, remain - fout));
      gain.gain.linearRampToValueAtTime(0, now + remain);
      src.onended = stop;
      src.start(now, SOUND.fromSec + lag);
      src.stop(now + remain + 0.05);
      guard = setTimeout(stop, remain * 1000 + 500);
    } catch {
      stop();
    }
  };
  void begin();
  return { fade };
}
