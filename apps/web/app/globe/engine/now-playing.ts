/**
 * What the page is playing (the "now playing" pill, components/now-playing-pill.tsx): a small registry the page's sounds tell about themselves, and the visitor's one choice about sound.
 *
 * A sound is in the registry from the moment it has played until it is done: `set` says it is playing (or waiting: paused) and `end` that it is over. The sun's music (engine/sun-music.ts) is
 * there from the first time the sun comes into view for as long as the page is, playing while the sun is in view and paused while it is not; the interlude's sound (engine/cinematic-sound.ts) is there from
 * its first note to its last, and then gone. What the pill shows is `current`: the sound with the highest `priority` (the interlude's is above the sun's: while it plays the sun's music is silent), the
 * latest of equals. Nothing is in it: no pill (`pillVisible`).
 *
 * The visitor's choice is ONE for all of the page's sound: on or off (`muted`, kept in localStorage; `?mute` starts a visit muted without keeping it). It is read by every sound, which follows it live.
 */

export interface Track {
  id: string;
  title: string;
  /** Who made it, as the credit reads. Absent: no credit line. */
  artist?: string;
  /** Which of two sounds that are both in the registry is shown: the higher. */
  priority: number;
}

/** The page's sounds: what each is called and who is credited, in one place. */
export const TRACKS = {
  sun: { id: "sun", title: "Gabriel", artist: "Felsmann & Tiley", priority: 1 },
  interlude: { id: "interlude", title: "Universal intro", priority: 2 },
} as const satisfies Record<string, Track>;

export type PlayState = "playing" | "paused";

export interface NowPlayingSnapshot {
  /** The sound to show, or null when there is none. */
  readonly track: Track | null;
  readonly state: PlayState;
  /** The visitor has turned the page's sound off. */
  readonly muted: boolean;
}

/** Whether there is a pill to show for this: a sound that has played and is not done (it is playing or paused). */
export function pillVisible(s: NowPlayingSnapshot): boolean {
  return s.track !== null;
}

export const MUTE_KEY = "sound-muted";
/** The key the sun's music kept the choice under before it was the page's (read, never written). */
const LEGACY_MUTE_KEY = "sun-music-muted";

/** Whether the visitor has turned sound off (kept, or `?mute`). Readable before the store is attached; false where there is no storage. */
export function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1" || localStorage.getItem(LEGACY_MUTE_KEY) === "1" || new URLSearchParams(location.search).has("mute");
  } catch {
    return false;
  }
}

export class NowPlaying {
  private entries = new Map<string, { track: Track; state: PlayState; at: number }>();
  private listeners = new Set<() => void>();
  private clock = 0;
  private snapshot: NowPlayingSnapshot = { track: null, state: "paused", muted: false };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getSnapshot = (): NowPlayingSnapshot => this.snapshot;

  /** Read the visitor's choice (the page is up). Idempotent. */
  load(): void {
    this.update({ muted: readMuted() });
  }

  /** A sound has played and is now playing, or paused. */
  set(track: Track, state: PlayState): void {
    const was = this.entries.get(track.id);
    if (was && was.state === state && was.track === track) return;
    this.entries.set(track.id, { track, state, at: was?.at ?? ++this.clock });
    this.update({});
  }

  /** A sound is done (the interlude's last note): it is gone from the registry. */
  end(id: string): void {
    if (this.entries.delete(id)) this.update({});
  }

  /** The visitor turns sound off, or on; kept. */
  setMuted(muted: boolean): void {
    try {
      if (muted) localStorage.setItem(MUTE_KEY, "1");
      else {
        localStorage.removeItem(MUTE_KEY);
        localStorage.removeItem(LEGACY_MUTE_KEY);
      }
    } catch {
      /* not kept */
    }
    this.update({ muted });
  }

  private update(patch: { muted?: boolean }): void {
    let best: { track: Track; state: PlayState; at: number } | null = null;
    for (const e of this.entries.values()) if (!best || e.track.priority > best.track.priority || (e.track.priority === best.track.priority && e.at > best.at)) best = e;
    const next: NowPlayingSnapshot = { track: best?.track ?? null, state: best?.state ?? "paused", muted: patch.muted ?? this.snapshot.muted };
    const s = this.snapshot;
    if (next.track === s.track && next.state === s.state && next.muted === s.muted) return;
    this.snapshot = next;
    this.listeners.forEach((l) => l());
  }
}

/** The page's one registry. */
export const nowPlaying = new NowPlaying();
