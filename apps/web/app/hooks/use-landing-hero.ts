import { useCallback, useEffect, useMemo, useRef } from "react";
import { INTERLUDE_STATE_EVENT, RESTORE_HERO_EVENT, type CoverBlock, type InterludeStateDetail, type GlobeShowcase, type GlobeSignal, type GlobeViewState } from "~/globe";
import { createHeroMachine, HERO_IDLE_MS, isWorldView, showcaseOf, type HeroMachine } from "~/lib/hero-machine";

/**
 * The idle delay. Test-only override, in debug mode only (`?globe-debug`, what the browser checks run in; the same convention as
 * `?spin-idle`): `?hero-idle=MS` (100 to 60000). Everywhere else it is `HERO_IDLE_MS`.
 */
function idleMs(): number {
  if (typeof window === "undefined") return HERO_IDLE_MS;
  try {
    const q = new URLSearchParams(location.search);
    const debug = q.has("globe-debug") || sessionStorage.getItem("globe-debug") === "1";
    const ms = Number(q.get("hero-idle") ?? sessionStorage.getItem("hero-idle"));
    return debug && ms >= 100 && ms <= 60_000 ? ms : HERO_IDLE_MS;
  } catch {
    return HERO_IDLE_MS;
  }
}

/** Where the visitor's focus makes the hero hold still: the header (it goes away when the hero comes back) and any open dialog (the search palette). */
const HOLD_SELECTOR = '[data-slot="site-header"], dialog[open]';

/**
 * Holds the machine's idle clock while the keyboard focus is inside the header or a dialog (`HeroMachine.hold`). The way back to rest
 * removes the header, so it must not happen under a focused header link, nor under the open search palette whose way back to its opener
 * is the header's trigger. Returns the cleanup. Exported for the browser check's reading, not for use elsewhere.
 */
export function watchFocusHold(machine: HeroMachine): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sync = () => {
    const active = document.activeElement;
    machine.hold(!!active && active !== document.body && active.closest(HOLD_SELECTOR) !== null);
  };
  // `focusout` fires before the focus has moved: read it after the event has finished.
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(sync, 0);
  };
  document.addEventListener("focusin", sync);
  document.addEventListener("focusout", later);
  sync();
  return () => {
    clearTimeout(timer);
    document.removeEventListener("focusin", sync);
    document.removeEventListener("focusout", later);
    machine.hold(false);
  };
}

export interface LandingHero {
  machine: HeroMachine;
  /** `GlobeProps.onInteract`: a gesture started on the globe. Stable. */
  onInteract(): void;
  /** `GlobeProps.onViewChange`'s companion: feed it every reported view (cheap: a comparison, and a notification only when the world view is left or reached). Stable. */
  onView(view: GlobeViewState): void;
  /**
   * `GlobeProps.showcase`: the home screen is at rest (the full hero at the world view), and how much of the globe's bottom the hero's name covers
   * then. A signal the globe subscribes to: a gesture starts or ends the showcase without the shell, the globe's props or the places list
   * rendering. Stable.
   */
  showcase: GlobeSignal<GlobeShowcase>;
  /** The hero reports the height it covers at the bottom of the globe's box, CSS px (measured by the hero; a change tells the globe). Stable. */
  setCover(px: number, blocks?: readonly CoverBlock[]): void;
}

/**
 * The landing hero's state (`lib/hero-machine.ts`) wired to the shell: the globe's gestures and its reported views go in, and the
 * hero reads the machine as an external store, so only the hero re-renders when it changes (not the shell, not the globe).
 *
 * `open` is whether a place or an entry is open (the panel): the hero is not the page then, and the world view is not "the world view".
 */
export function useLandingHero(open: boolean): LandingHero {
  const machine = useMemo(() => createHeroMachine({ idleMs: idleMs() }), []);
  const zoomAtWorld = useRef(true);
  const openRef = useRef(open);

  const sync = useCallback(() => machine.setWorld(zoomAtWorld.current && !openRef.current), [machine]);
  const onInteract = useCallback(() => {
    homeWanted.current = false;
    machine.interact();
  }, [machine]);
  // The interlude was asked for from a zoomed globe: its camera goes home, and the full hero comes back as it reaches the world view (not after the idle delay).
  const homeWanted = useRef(false);
  const onView = useCallback(
    (view: GlobeViewState) => {
      const atWorld = isWorldView(view);
      if (atWorld === zoomAtWorld.current) return;
      zoomAtWorld.current = atWorld;
      sync();
      if (atWorld && homeWanted.current) {
        homeWanted.current = false;
        machine.restore();
      }
    },
    [sync, machine],
  );

  // The showcase: a signal over the machine and the measured cover. The snapshot object is replaced only when a value changes.
  const cover = useRef(0);
  const coverBlocks = useRef<readonly CoverBlock[] | undefined>(undefined);
  const coverListeners = useRef(new Set<() => void>());
  const showcase = useMemo<GlobeSignal<GlobeShowcase>>(() => {
    let snap: GlobeShowcase = { on: false, coverBottom: 0 };
    return {
      get() {
        const { on, coverBottom } = showcaseOf(machine.getSnapshot(), cover.current);
        const blocks = on ? coverBlocks.current : undefined;
        if (snap.on !== on || snap.coverBottom !== coverBottom || snap.blocks !== blocks) snap = { on, coverBottom, ...(blocks ? { blocks } : {}) };
        return snap;
      },
      subscribe(listener) {
        coverListeners.current.add(listener);
        const off = machine.subscribe(listener);
        return () => {
          coverListeners.current.delete(listener);
          off();
        };
      },
    };
  }, [machine]);
  const setCover = useCallback((px: number, blocks?: readonly CoverBlock[]) => {
    const next = Math.max(0, Math.round(px));
    const nextBlocks = blocks?.map((b) => ({ x0: Math.round(b.x0), x1: Math.round(b.x1), top: Math.round(b.top) }));
    const prev = coverBlocks.current;
    const same = (!nextBlocks && !prev) || (!!nextBlocks && !!prev && nextBlocks.length === prev.length && nextBlocks.every((b, i) => b.x0 === prev[i]!.x0 && b.x1 === prev[i]!.x1 && b.top === prev[i]!.top));
    if (next === cover.current && same) return;
    cover.current = next;
    if (!same) coverBlocks.current = nextBlocks;
    for (const l of [...coverListeners.current]) l();
  }, []);

  useEffect(() => {
    openRef.current = open;
    sync();
  }, [open, sync]);
  // (`start` too: an effect cleaned up and run again, as StrictMode does, would otherwise leave a hero born collapsed with no idle clock, and it would never come back)
  useEffect(() => {
    machine.start();
    return () => machine.stop();
  }, [machine]);
  // (the search palette's interlude is asked for while a gesture had put the hero away: the caption it plays on comes back)
  useEffect(() => {
    const restore = () => {
      machine.restore();
      // (zoomed in, but no place or entry open: the interlude takes the camera home, and the hero returns with it)
      if (!zoomAtWorld.current && !openRef.current) homeWanted.current = true;
    };
    window.addEventListener(RESTORE_HERO_EVENT, restore);
    return () => window.removeEventListener(RESTORE_HERO_EVENT, restore);
  }, [machine]);
  // (the interlude's own state, from the globe: the hero takes the collapsed look while it plays)
  useEffect(() => {
    const on = (e: Event) => machine.setInterlude((e as CustomEvent<InterludeStateDetail>).detail.active);
    window.addEventListener(INTERLUDE_STATE_EVENT, on);
    return () => {
      window.removeEventListener(INTERLUDE_STATE_EVENT, on);
      machine.setInterlude(false);
    };
  }, [machine]);
  useEffect(() => watchFocusHold(machine), [machine]);

  return useMemo(() => ({ machine, onInteract, onView, showcase, setCover }), [machine, onInteract, onView, showcase, setCover]);
}
