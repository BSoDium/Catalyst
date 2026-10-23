/**
 * The sound of the cinematic interlude (engine/cinematic.ts): the studio's own intro (`public/audio/universal-intro.mp3`, 24.1 s, 112 kbps, from the
 * owner's file, which they have the rights to), played FAINTLY while the word is on the stage.
 *
 * Made so that nothing costs anything at the moment it starts: the file is fetched when the interlude is PLANNED (a few sessions in a hundred, and
 * only a returning visitor), long before it plays, into a plain audio element (no `AudioContext`: opening an audio device is a stall of 150 ms or
 * much more, on the main thread, in the frame the interlude begins in). Starting it is `play()` on an element that is already loaded.
 *
 * It plays when the browser lets it (it is asked to, quietly: a page nobody has touched is usually refused, and then it is silent), when the tab is in
 * front, and unless the visitor asked for none (`?mute`, or sessionStorage "cinematic-mute" = "1"). It rises over `fadeInMs`, runs as long as the
 * interlude, and lets go over `fadeOutMs` at its end; cut short (a gesture, the globe going away) it fades at once (`SoundHandle.fade`).
 */

import { cinematicForced } from "./cinematic";

export const SOUND = {
  url: "/audio/universal-intro.mp3",
  /** The loudness, 0 to 1 of the element's volume: faint, a sound under the page's own (the file's own level is about -17 dBFS RMS, loud). */
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
  /** How long after the interlude begins it starts, ms. */
  delayMs: 0,
  fadeInMs: 800,
  fadeOutMs: 1200,
  /** How long it takes to let go when the interlude is cut short (a gesture, the tab put behind, the globe going away): a fade, not a cut. */
  fadeCutMs: 900,
} as const;

export interface SoundHandle {
  /** Let go now, over `ms`. Safe to call twice, and after the end. */
  fade(ms?: number): void;
}

/** Whether a sound may be started now: asked for none, the tab behind, or no gesture yet are all a no. */
export function soundAllowed(): boolean {
  try {
    if (typeof document !== "undefined" && document.hidden) return false;
    if (new URLSearchParams(location.search).has("mute") || sessionStorage.getItem("cinematic-mute") === "1") return false;
    // (a page nobody has touched may be refused by the browser: it is asked all the same, `play()` says no quietly, and a site the visitor knows
    // may be let through without a touch; an earlier version did not even ask, and the owner never heard it)
    return true;
  } catch {
    return false;
  }
}

/** The part of an `HTMLAudioElement` this needs (a test gives a fake). */
export interface AudioLike {
  src: string;
  preload: string;
  volume: number;
  currentTime: number;
  readyState: number;
  load(): void;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, fn: () => void, o?: { once: boolean }): void;
}
type AudioFactory = () => AudioLike;
const browserAudio: AudioFactory = () => new Audio() as unknown as AudioLike;

let prepared: AudioLike | null = null;

/**
 * Fetch the file now (the interlude is planned): into an element that stays until it is used. Skipped where the visitor asked for none or the
 * connection saves data. Idempotent.
 */
export function prepareSound(make: AudioFactory = browserAudio): void {
  if (prepared) return;
  try {
    if (new URLSearchParams(location.search).has("mute") || sessionStorage.getItem("cinematic-mute") === "1") return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    const el = make();
    el.preload = "auto";
    el.src = SOUND.url;
    el.volume = 0;
    el.load();
    prepared = el;
  } catch {
    prepared = null;
  }
}

/** Forget the prepared element (tests). */
export function forgetSound(): void {
  prepared = null;
}

/**
 * Play it for an interlude of `durationMs`. Null when no sound is to be made (see `soundAllowed`), else the handle that lets go of it. `make`
 * and `allowed` are for a test.
 */
export function startSound(durationMs: number, make: AudioFactory = browserAudio, allowed: boolean = soundAllowed()): SoundHandle | null {
  if (!allowed) return null;
  let el = prepared;
  prepared = null; // (an element plays once: the interlude is spent after it)
  if (!el) {
    try {
      el = make();
      el.preload = "auto";
      el.src = SOUND.url;
    } catch {
      return null;
    }
  }
  const audio = el;
  let done = false;
  /** Letting go (cut short): a play() that is granted after it began must not bring the volume back up. */
  let fading = false;
  let level = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const set = (v: number) => {
    level = Math.max(0, Math.min(1, v));
    audio.volume = level;
  };
  const stop = () => {
    if (done) return;
    done = true;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onHidden);
    if (timer !== null) clearInterval(timer);
    for (const t of timers) clearTimeout(t);
    set(0);
    try {
      audio.pause();
    } catch {
      /* nothing to stop */
    }
  };
  /** Ramp the volume to `to` over `ms` (20 steps a second: a fade, not a frame loop). */
  const ramp = (to: number, ms: number, then?: () => void) => {
    if (timer !== null) clearInterval(timer);
    const from = level;
    const t0 = Date.now();
    timer = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / Math.max(1, ms));
      set(from + (to - from) * p);
      if (p >= 1) {
        if (timer !== null) clearInterval(timer);
        timer = null;
        then?.();
      }
    }, 50);
  };
  const begin = () => {
    if (done) return;
    try {
      audio.currentTime = SOUND.fromSec;
    } catch {
      /* not seekable yet: it starts from the top of the file, which is a few seconds early, not wrong */
    }
    set(0);
    // (refused, or the file is not there: silence, and nothing else)
    void audio.play().then(
      () => {
        if (!fading) ramp(SOUND.volume, SOUND.fadeInMs);
      },
      () => {
        // (refused: no touch on the page yet, or the file is not there. Silence; where the owner asks for the interlude, say why)
        if (cinematicForced()) console.info("[interlude] the browser did not let the sound play: touch the page (a click, a key) before it begins");
        stop();
      },
    );
    timers.push(setTimeout(() => ramp(0, SOUND.fadeOutMs, stop), Math.max(0, durationMs - SOUND.delayMs - SOUND.fadeOutMs)));
  };
  // (a tab put behind goes on playing in the background, and its interlude has stopped drawing: the sound lets go with it)
  const onHidden = () => {
    if (typeof document !== "undefined" && document.hidden) handle.fade(SOUND.fadeCutMs);
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onHidden);
  const go = () => {
    // seeking needs the metadata: when the element has none yet (not fetched in time), wait for it
    if (audio.readyState >= 1) begin();
    else audio.addEventListener("loadedmetadata", begin, { once: true });
  };
  timers.push(setTimeout(go, SOUND.delayMs));
  const handle: SoundHandle = {
    fade(ms = SOUND.fadeCutMs) {
      if (done) return;
      fading = true;
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
      ramp(0, ms, stop);
      timers.push(setTimeout(stop, ms + 200));
    },
  };
  return handle;
}
