import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MUTE_KEY, NowPlaying, TRACKS, pillVisible, readMuted, sunAudible } from "./now-playing";

describe("what the page is playing", () => {
  const store = new Map<string, string>();
  let search = "";
  beforeEach(() => {
    store.clear();
    search = "";
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    vi.stubGlobal("location", {
      get search() {
        return search;
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows nothing until a sound has played, and nothing again when it is done", () => {
    const np = new NowPlaying();
    expect(pillVisible(np.getSnapshot())).toBe(false);
    np.set(TRACKS.interlude, "playing");
    expect(pillVisible(np.getSnapshot())).toBe(true);
    expect(np.getSnapshot().track).toBe(TRACKS.interlude);
    np.end(TRACKS.interlude.id);
    expect(pillVisible(np.getSnapshot())).toBe(false);
  });

  it("a sound that waits (paused) is still shown, and says so", () => {
    const np = new NowPlaying();
    np.set(TRACKS.sun, "playing");
    np.set(TRACKS.sun, "paused");
    expect(np.getSnapshot()).toMatchObject({ track: TRACKS.sun, state: "paused" });
  });

  it("the interlude's sound is shown over the sun's while both are there, and the sun's comes back when it is done", () => {
    const np = new NowPlaying();
    np.set(TRACKS.sun, "paused");
    np.set(TRACKS.interlude, "playing");
    expect(np.getSnapshot().track).toBe(TRACKS.interlude);
    np.set(TRACKS.sun, "playing"); // (the later of the two, but the lower in priority)
    expect(np.getSnapshot().track).toBe(TRACKS.interlude);
    np.end(TRACKS.interlude.id);
    expect(np.getSnapshot()).toMatchObject({ track: TRACKS.sun, state: "playing" });
  });

  it("credits the sun's music to its artists, with a sleeve and links that open somewhere real (https), and the interlude's sound is credited to its composer and its arranger, each with a page, and no video", () => {
    expect(TRACKS.sun).toMatchObject({ title: "Gabriel", artist: "Felsmann & Tiley" });
    expect(TRACKS.sun.cover).toMatch(/^\/media\//);
    expect(TRACKS.sun.titleHref).toMatch(/^https:\/\//);
    expect(TRACKS.sun.titleHref).toBe("https://www.youtube.com/watch?v=mSvt09Bq0_Q");
    expect(TRACKS.sun.artists.map((a) => a.href)).toEqual(["https://felsmanntiley.com/"]);
    expect(TRACKS.interlude).not.toHaveProperty("titleHref");
    // (the sun's sleeve and audio are the stacked PR's, until the artist answers: without them there is no sun music, and no player; a missing sleeve is a plain label)
    expect(TRACKS.sun.cover).toMatch(/^\/media\/now-playing\/.+\.jpg$/);
    expect(existsSync(`public${TRACKS.interlude.cover}`), TRACKS.interlude.cover).toBe(true);
    expect(TRACKS.interlude.artist).toBe("Jerry Goldsmith & Brian Tyler");
    expect(TRACKS.interlude.artists.map((a) => a.name).join(" & ")).toBe(TRACKS.interlude.artist);
    expect(TRACKS.interlude.artists.map((a) => a.href)).toEqual(["https://en.wikipedia.org/wiki/Jerry_Goldsmith", "https://www.briantyler.com/"]);
    expect(TRACKS.interlude.note).toMatch(/Goldsmith.*1997.*Tyler.*2012/);
  });

  it("counts the sun's music as audible only while it plays and is not turned off (blocked, waiting, off, or the interlude's sound: no)", () => {
    const s = (track: typeof TRACKS.sun | typeof TRACKS.interlude, state: "playing" | "paused" | "blocked", muted = false) => ({ track, state, muted });
    expect(sunAudible(s(TRACKS.sun, "playing"))).toBe(true);
    expect(sunAudible(s(TRACKS.sun, "blocked"))).toBe(false);
    expect(sunAudible(s(TRACKS.sun, "paused"))).toBe(false);
    expect(sunAudible(s(TRACKS.sun, "playing", true))).toBe(false);
    expect(sunAudible(s(TRACKS.interlude, "playing"))).toBe(false);
    expect(sunAudible({ track: null, state: "paused", muted: false })).toBe(false);
  });

  it("keeps the visitor's choice, reads it back, and reads the old key and ?mute", () => {
    const np = new NowPlaying();
    np.load();
    expect(np.getSnapshot().muted).toBe(false);
    np.setMuted(true);
    expect(store.get(MUTE_KEY)).toBe("1");
    expect(readMuted()).toBe(true);
    np.setMuted(false);
    expect(readMuted()).toBe(false);
    store.set("sun-music-muted", "1");
    expect(readMuted()).toBe(true);
    np.setMuted(false); // (clears the old one too)
    expect(readMuted()).toBe(false);
    search = "?mute";
    expect(readMuted()).toBe(true);
    const fresh = new NowPlaying();
    fresh.load();
    expect(fresh.getSnapshot().muted).toBe(true);
    expect(store.has(MUTE_KEY)).toBe(false); // (a visit muted by ?mute does not keep it)
  });

  it("tells subscribers only when something changed", () => {
    const np = new NowPlaying();
    const seen = vi.fn();
    const off = np.subscribe(seen);
    np.set(TRACKS.sun, "playing");
    np.set(TRACKS.sun, "playing");
    np.setMuted(true);
    np.setMuted(true);
    np.end("nothing");
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    np.end(TRACKS.sun.id);
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
