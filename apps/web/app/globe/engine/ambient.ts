import { nowPlaying, sunAudible } from "./now-playing";

/**
 * Ambient mode: letting the globe be a screensaver (docs/web-architecture.md, "Idle rotation"). On, the idle rotation turns the earth at ANY zoom under the view the visitor framed
 * (the sun's glare, a place's surroundings), and the home screen's full hero does not come back over it; off, the page is as it was (the rotation only at the world view, the hero back after the idle delay).
 *
 * Three-way (owner, 2026-11-23): AUTO is the default, and means "on while the sun's music is audible, off otherwise" (the moment the screensaver is for: the sun in view, the sound
 * on, nobody wants the globe to stop). The visitor's own press of the toggle is an explicit choice that beats it, for the session (sessionStorage), after which the next visit is automatic again.
 * `?ambient` starts a visit in an explicit "on" without keeping it. The snapshot is the EFFECTIVE state, a boolean: the toggle, the hero, the hint and the renderer all read it, as one small external store.
 */
export const AMBIENT_KEY = "ambient-choice";

/** What the automatic mode follows: whether the sun's music is audible now. */
export interface AudibleSource {
  getSnapshot(): boolean;
  subscribe(listener: () => void): () => void;
}

export class Ambient {
  private choice: boolean | null;
  private audible = false;
  private effective = false;
  private readonly listeners = new Set<() => void>();
  private turning = false;
  private blocked: string | null = null;
  private readonly turningListeners = new Set<() => void>();

  constructor(read: () => boolean | null = readChoice, source?: AudibleSource) {
    this.choice = read();
    if (source) {
      this.audible = source.getSnapshot();
      source.subscribe(() => {
        this.audible = source.getSnapshot();
        this.refresh();
      });
    }
    this.effective = this.compute();
  }

  private compute = (): boolean => this.choice ?? this.audible;

  private refresh(): void {
    const next = this.compute();
    if (next === this.effective) return;
    this.effective = next;
    this.listeners.forEach((l) => l());
  }

  /** The effective state: the visitor's choice, else whether the sun's music is audible. */
  getSnapshot = (): boolean => this.effective;

  /** Whether the state is the automatic one (the visitor has not pressed the toggle). */
  isAuto = (): boolean => this.choice === null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /**
   * Whether the globe is turning at full pace (the idle rotation's cruise): on, it waits for the idle delay (a moment after the switch, the full delay after a touch) and eases in over 3 s, so
   * the switch is on well before anything visibly moves. The renderer says it (`setTurning`); the toggle reads it to say "Starting" in between. A separate store from the switch itself,
   * so that its changes do not re-run what the switch drives (the hurry, the hero's hold).
   */
  getTurning = (): boolean => this.turning;

  /** The reason (a `SpinBlock`) the globe cannot turn for a lasting while, or null: the globe cannot turn for a lasting reason (the street map owns the picture, reduced motion, a place or the panel open...), as the engine says it: the toggle reads "Paused", not "Starting" forever. */
  getBlocked = (): string | null => this.blocked;

  subscribeTurning = (listener: () => void): (() => void) => {
    this.turningListeners.add(listener);
    return () => void this.turningListeners.delete(listener);
  };

  setTurning(turning: boolean, blocked: string | null = null): void {
    if (turning === this.turning && blocked === this.blocked) return;
    this.turning = turning;
    this.blocked = blocked;
    this.turningListeners.forEach((l) => l());
  }

  /** The visitor turns it on or off: an explicit choice, kept for the session. */
  set(on: boolean): void {
    this.choice = on;
    try {
      sessionStorage.setItem(AMBIENT_KEY, on ? "1" : "0");
    } catch {
      /* not kept */
    }
    this.refresh();
  }
}

function readChoice(): boolean | null {
  try {
    if (new URLSearchParams(location.search).has("ambient")) return true;
    const kept = sessionStorage.getItem(AMBIENT_KEY);
    return kept === "1" ? true : kept === "0" ? false : null;
  } catch {
    return null;
  }
}

/** The sun's music, as a source for the automatic mode (the browser only: a server render has no sound). */
const sunMusic: AudibleSource = {
  getSnapshot: () => sunAudible(nowPlaying.getSnapshot()),
  subscribe: (l) => nowPlaying.subscribe(l),
};

/** The page's one switch. */
export const ambient = new Ambient(readChoice, typeof window === "undefined" ? undefined : sunMusic);
