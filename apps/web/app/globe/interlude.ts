/**
 * The cinematic interlude on request (engine/cinematic.ts): the app's search palette has a hidden entry that plays it, and the palette and the globe are two islands of the
 * page that know nothing of each other, so the request is a window event. Whoever holds the home globe (`globe-canvas.tsx`) answers it by marking the request handled.
 */
export const PLAY_INTERLUDE_EVENT = "site:play-interlude";
export const PREPARE_INTERLUDE_EVENT = "site:prepare-interlude";

/** The interlude needs the full hero (the caption), which a gesture on the globe put away: whoever holds the hero brings it back. */
export const RESTORE_HERO_EVENT = "site:restore-hero";

/** The interlude was asked for from a zoomed or turned globe: the globe goes home now (the hero brings the full home screen back when it is there). */
export const GO_HOME_EVENT = "site:go-home";

export interface PlayInterludeRequest {
  /** Set by the globe that took the request. */
  handled: boolean;
}

/** Ask the home globe to play the interlude now. True when a globe took the request (it may still be a moment before it can start). */
export function requestInterlude(): boolean {
  if (typeof window === "undefined") return false;
  const detail: PlayInterludeRequest = { handled: false };
  window.dispatchEvent(new CustomEvent<PlayInterludeRequest>(PLAY_INTERLUDE_EVENT, { detail }));
  if (!detail.handled) window.dispatchEvent(new Event(RESTORE_HERO_EVENT));
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

/**
 * The interlude begins and ends, from the globe's own frame loop (`detail.active`): the page's hero shrinks to its small name for the length of it (`HeroMachine.setInterlude`)
 * and grows back at the end. The same island split as above, so the same kind of channel: a window event.
 */
export const INTERLUDE_STATE_EVENT = "site:interlude-state";
export interface InterludeStateDetail {
  active: boolean;
}

/**
 * Whether the page's hero should have its interlude look, from the land's amount now (`land`, 0..1) and the last one (`prev`) and the state it has (`on`). On as the land comes in
 * (over 0.01 and rising); off once it is on its way out and below 0.4, and then it stays off until the land comes in again: while the land falls from 0.4 to 0 it is still over 0.01,
 * and a rule that looked only at the amount turned the state back on, frame after frame (the name flickered between its sizes). Pure.
 */
export function interludeLook(on: boolean, land: number, prev: number): boolean {
  return on ? !(land < 0.4 && land < prev) && land > 0 : land > 0.01 && land > prev;
}
