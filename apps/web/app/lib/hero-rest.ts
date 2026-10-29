import { useSyncExternalStore } from "react";

/**
 * Whether the landing hero is at rest (the whole hero showing). The hero's four rows ARE the home page's section links, so the header
 * leaves its own out while the hero shows them, and takes them back when the hero steps back (after a gesture on the globe, or zoomed
 * in: the rows are hidden then and the visitor must not be left without a way to the lists). The hero publishes here; the header (a
 * sibling in the root layout, not a child of the shell) reads. The server and the first client render say "at rest", which is also
 * what the hero's server markup is.
 */
let resting = true;
const listeners = new Set<() => void>();

export function setHeroResting(value: boolean): void {
  if (resting === value) return;
  resting = value;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function useHeroResting(): boolean {
  return useSyncExternalStore(subscribe, () => resting, () => true);
}

/**
 * Whether the hero's small corner line, with the search button under it, is showing (the hero stepped back and is on screen: not at rest, not away behind
 * a panel). From 48 rem the header leaves its own search trigger out then (owner, 2026-10-29: "no need to have it next to the nav items"): the
 * corner has it. Published by the hero, read by the header.
 */
let corner = false;
const cornerListeners = new Set<() => void>();

export function setHeroCorner(value: boolean): void {
  if (corner === value) return;
  corner = value;
  for (const l of cornerListeners) l();
}

export function useHeroCorner(): boolean {
  return useSyncExternalStore(
    (l) => {
      cornerListeners.add(l);
      return () => void cornerListeners.delete(l);
    },
    () => corner,
    () => false,
  );
}

/**
 * Whether the visitor has been on another page of the site in this session. The landing hero is born at rest (the full presentation, no header),
 * which is right for a visit that begins on the home page and wrong for one that comes back to it from a list: someone who clicked "Globe" in the
 * header expects the header to stay (owner, 2026-10-21), and the presentation to return by itself after the idle delay. The header reports the
 * pages it is on; the hero reads this when it is created.
 */
let leftHome = false;
export function markLeftHome(): void {
  leftHome = true;
}
export function cameBackHome(): boolean {
  return leftHome;
}
