/**
 * The cinematic interlude on request (engine/cinematic.ts): the app's search palette has a hidden entry that plays it, and the palette and the globe are two islands of the
 * page that know nothing of each other, so the request is a window event. Whoever holds the home globe (`globe-canvas.tsx`) answers it by marking the request handled.
 */
export const PLAY_INTERLUDE_EVENT = "site:play-interlude";
export const PREPARE_INTERLUDE_EVENT = "site:prepare-interlude";

export interface PlayInterludeRequest {
  /** Set by the globe that took the request. */
  handled: boolean;
}

/** Ask the home globe to play the interlude now. True when a globe took the request (it may still be a moment before it can start). */
export function requestInterlude(): boolean {
  if (typeof window === "undefined") return false;
  const detail: PlayInterludeRequest = { handled: false };
  window.dispatchEvent(new CustomEvent<PlayInterludeRequest>(PLAY_INTERLUDE_EVENT, { detail }));
  return detail.handled;
}

/**
 * The visitor is about to be able to ask for it (the palette lists the entry): the home globe makes what it needs now, the word's mesh and the sound's file, so that asking
 * does not cost a stall of a quarter of a second at the first frame. Nothing is played or planned.
 */
export function prepareInterlude(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PREPARE_INTERLUDE_EVENT));
}
