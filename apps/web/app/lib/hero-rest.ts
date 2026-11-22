import { useEffect, useState, useSyncExternalStore } from "react";

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
 * How the landing hero is born, by the pages the visitor has been on (the header reports every page it is on; the hero reads this when it is created).
 *
 *  - `first`: the visit begins on the home page. The full presentation, no header.
 *  - `back`: the visitor saw the home page and comes back to it from a list. Born collapsed, the header stays (someone who clicked "Globe" expects
 *    it to, owner 2026-10-21), the presentation returns after the usual idle delay.
 *  - `handover`: the visit began on another page (the software list, say), so the presentation has not been seen. Born collapsed too: the header link
 *    just clicked must not vanish the instant the page arrives (owner, 2026-11-22: the visitor gets lost). The presentation follows after a short
 *    beat, the header fading as it comes in.
 */
export type Arrival = "first" | "back" | "handover";

let seenHome = false;
let seenElsewhere = false;
let leftHome = false;
export function markPage(onHome: boolean): void {
  if (onHome) seenHome = true;
  else {
    seenElsewhere = true;
    if (seenHome) leftHome = true;
  }
}
export function arrival(): Arrival {
  if (leftHome) return "back";
  return seenElsewhere && !seenHome ? "handover" : "first";
}
/** Test hook: a fresh session. */
export function resetHeroRest(): void {
  seenHome = false;
  seenElsewhere = false;
  leftHome = false;
}

/**
 * Keeps the header mounted for `ms` after it is asked to go, so it can fade out (`data-leaving`, app.css) as the hero's rows fade in, rather than
 * vanish. It comes back at once when it is asked for again. The server and the first render say what they are told.
 */
export function useLingering(wanted: boolean, ms: number): { mounted: boolean; leaving: boolean } {
  const [lingering, setLingering] = useState(false);
  const [prev, setPrev] = useState(wanted);
  // (adjusted during the render, not in an effect: an effect would unmount the header for a frame and bring it back already faded)
  if (prev !== wanted) {
    setPrev(wanted);
    setLingering(prev && !wanted);
  }
  useEffect(() => {
    if (!lingering) return;
    const t = setTimeout(() => setLingering(false), ms);
    return () => clearTimeout(t);
  }, [lingering, ms]);
  return { mounted: wanted || lingering, leaving: !wanted && lingering };
}
