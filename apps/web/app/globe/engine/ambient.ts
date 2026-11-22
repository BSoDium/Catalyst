/**
 * Ambient mode: the visitor's one choice to let the globe be a screensaver (docs/web-architecture.md, "Idle rotation"). On, the idle rotation turns the earth at ANY zoom under the view the visitor framed
 * (the sun's glare, a place's surroundings), and the home screen's full hero does not come back over it; off, the page is as it was (the rotation only at the world view, the hero back after the idle delay).
 * Kept in localStorage; `?ambient` starts a visit in it without keeping it. A small external store, like `nowPlaying`: the page's toggle, the hero and the renderer all read it.
 */
export const AMBIENT_KEY = "ambient";

export class Ambient {
  private on = false;
  private readonly listeners = new Set<() => void>();

  constructor(read: () => boolean = readStored) {
    this.on = read();
  }

  getSnapshot = (): boolean => this.on;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** The visitor turns it on or off; kept. */
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    try {
      if (on) localStorage.setItem(AMBIENT_KEY, "1");
      else localStorage.removeItem(AMBIENT_KEY);
    } catch {
      /* not kept */
    }
    this.listeners.forEach((l) => l());
  }
}

function readStored(): boolean {
  try {
    return new URLSearchParams(location.search).has("ambient") || localStorage.getItem(AMBIENT_KEY) === "1";
  } catch {
    return false;
  }
}

/** The page's one switch. */
export const ambient = new Ambient();
