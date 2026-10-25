/**
 * The production globe: the Three.js globe plus, when tiles are configured, the street map it hands over to (see
 * handover/controller.ts). React owns only the lifecycle: it creates the imperative controller in an effect,
 * forwards prop changes to it, and disposes it on unmount. Everything that touches `three` or the geodata is
 * loaded with a dynamic `import()` inside the effect, so neither is ever imported on the server nor part of the
 * main bundle. See docs/web-architecture.md ("Production globe").
 *
 * Accessibility: the canvas and the label overlay are decoration plus pointer input and are `aria-hidden`;
 * the place list is the accessible path. Neither has a tab stop. The only exposed text is the status message
 * when WebGL is unavailable or the context was lost.
 */
import { useEffect, useRef, useState } from "react";
import { createHandover, type HandoverDebug, type HandoverHandle, type Notice } from "./handover/controller";
import { HANDOVER } from "./handover/maths";
import { casesHierarchy, stressHierarchy } from "./engine/lod-stress";
import { stressRoutes } from "./paths/stress";
import { applyDebugLevels } from "./engine/palette";
import { applySpinFlags } from "./engine/idle-spin";
import { applySkyFlags } from "./engine/sky";
import { PLAY_INTERLUDE_EVENT, PREPARE_INTERLUDE_EVENT, type PlayInterludeRequest } from "./interlude";
import { applyRingFlags, ringText } from "./engine/ring";
import { applyShowcaseFlags } from "./engine/caption";
import { applyDebugArtPixel } from "./engine/tuning";
import { enablePerf, perfEnd, perfStart } from "./engine/perf";
import { startsVeiled, type GlobeProps } from "./types";

type Status = "loading" | "ready" | "unavailable" | "lost";

declare global {
  interface Window {
    /** Set only when `?globe-debug` is in the URL or sessionStorage "globe-debug" is "1" (automated checks). */
    __globeDebug?: HandoverDebug["globe"];
    /** Same condition: the handover's view of both renderers. */
    __handoverDebug?: HandoverDebug;
  }
}

async function loadGeodata() {
  const geo = await import("@catalyst/geodata");
  const [coastlines, borders] = await Promise.all([geo.loadCoastlines(), geo.loadBorders()]);
  return { coastlines, borders };
}

function debugEnabled(): boolean {
  try {
    return new URLSearchParams(location.search).has("globe-debug") || sessionStorage.getItem("globe-debug") === "1";
  } catch {
    return false;
  }
}

/** Test-only street engine options from `?street-opts=` (JSON), so drills can pin a source or shorten timings. */
function streetDebugOptions(): Record<string, unknown> | undefined {
  try {
    const raw = new URLSearchParams(location.search).get("street-opts") ?? sessionStorage.getItem("street-opts");
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Test-only: `?dissolve=1` runs the dither dissolve between the renderers instead of the default cut. */
function dissolveForTests(): boolean | undefined {
  try {
    const q = new URLSearchParams(location.search).get("dissolve") ?? sessionStorage.getItem("dissolve");
    return q === null ? undefined : q === "1";
  } catch {
    return undefined;
  }
}

/** Test-only: `?no-street` (or sessionStorage "no-street" = "1") runs the globe alone, as before street scale existed. */
function streetDisabledForTests(): boolean {
  try {
    return new URLSearchParams(location.search).has("no-street") || sessionStorage.getItem("no-street") === "1";
  } catch {
    return false;
  }
}

/** Test-only: `?no-groups` (or sessionStorage "no-groups" = "1") draws every place as a marker, as before groups existed. */
function noGroupsForTests(): boolean {
  try {
    return new URLSearchParams(location.search).has("no-groups") || sessionStorage.getItem("no-groups") === "1";
  } catch {
    return false;
  }
}
const groupsForTests = () => debugEnabled() && noGroupsForTests();

/** Test-only: `?lod-stress=N` replaces the hierarchy by a synthetic one of about N nodes (performance checks). */
/** Debug only: `?paths-stress=N` replaces the routes with N synthetic legs (paths/stress.ts), for measuring the paths layer. */
function pathsStressCount(): number {
  const v = new URLSearchParams(location.search).get("paths-stress");
  const n = v ? Number(v) : 0;
  return Number.isFinite(n) && n > 0 ? Math.min(20000, Math.floor(n)) : 0;
}

function lodStressCount(): number {
  try {
    const n = Number(new URLSearchParams(location.search).get("lod-stress"));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

const isWebGLUnavailable = (e: unknown) => e instanceof Error && e.name === "WebGLUnavailableError";

export default function GlobeCanvas({
  places,
  groups,
  routes,
  paths = true,
  selectedSlug,
  focusedSlug,
  initialView,
  reducedMotion,
  insetRight,
  tiles,
  attribution: Attribution,
  ringPhrases,
  captionPhrases,
  showcase,
  onOrbit,
  onSelect,
  onViewChange,
  onInteract,
}: GlobeProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const streetRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HandoverHandle | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [notice, setNotice] = useState<Notice | null>(null);
  // A reload or direct load (on a place, or on the home page) paints the page colour only: no placeholder, no flash of planet,
  // no unfinished frame. The stage fades in once the first pixel-art frame is drawn (handover `onReveal`; the WebGL canvas
  // itself is invisible until it has drawn, engine/renderer.ts). Only the globe coming back from the mobile slide-over with a
  // saved view shows at once. Decided on the first render, so the server-rendered shell and the hydrated one agree.
  const [veil] = useState(() => startsVeiled(initialView));
  const [revealed, setRevealed] = useState(!veil);

  // `initialView` is read once; afterwards this tracks the latest view so that re-creating the engine
  // (only when `places` or `routes` change) keeps the camera where it was.
  // The engine is rebuilt only when the tile configuration changes (compared by value).
  const tilesKey = tiles && !(debugEnabled() && streetDisabledForTests()) ? JSON.stringify(tiles) : "";
  const viewRef = useRef(initialView);
  const appliedSelection = useRef(selectedSlug);
  const latest = useRef({ paths, selectedSlug, focusedSlug, reducedMotion, insetRight, ringPhrases, captionPhrases, showcase, onOrbit, onSelect, onViewChange, onInteract });
  useEffect(() => {
    latest.current = { paths, selectedSlug, focusedSlug, reducedMotion, insetRight, ringPhrases, captionPhrases, showcase, onOrbit, onSelect, onViewChange, onInteract };
  });

  // `onInteract`: a gesture that starts ON the globe (its stage holds the canvas; the labels and the street map ignore the pointer, the
  // credits control and the app's overlays are outside the stage). Two passive listeners on the stage, nothing per frame, nothing when
  // the app does not ask. Capture phase: it must not depend on what the canvas does with the event.
  const wantsInteract = onInteract !== undefined;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !wantsInteract) return;
    const note = () => latest.current.onInteract?.();
    const options = { passive: true, capture: true } as const;
    stage.addEventListener("pointerdown", note, options);
    stage.addEventListener("wheel", note, options);
    return () => {
      stage.removeEventListener("pointerdown", note, options);
      stage.removeEventListener("wheel", note, options);
    };
  }, [wantsInteract]);

  // The visitor asks for the cinematic interlude (the search palette's "I like surprises", `lib/interlude.ts`): this globe takes the request when it is the home screen at rest
  // (the caption is there); otherwise the palette takes the visitor home first and asks again.
  useEffect(() => {
    const onPlay = (e: Event) => {
      const detail = (e as CustomEvent<PlayInterludeRequest>).detail;
      const handle = handleRef.current;
      if (!detail || !handle || !latest.current.showcase || !handle.hasOrbit()) return;
      detail.handled = true;
      handle.playInterlude();
    };
    const onPrepare = () => {
      if (latest.current.showcase) handleRef.current?.prepareInterlude();
    };
    window.addEventListener(PLAY_INTERLUDE_EVENT, onPlay);
    window.addEventListener(PREPARE_INTERLUDE_EVENT, onPrepare);
    return () => {
      window.removeEventListener(PLAY_INTERLUDE_EVENT, onPlay);
      window.removeEventListener(PREPARE_INTERLUDE_EVENT, onPrepare);
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const labelsRoot = labelsRef.current;
    const streetRoot = streetRef.current;
    if (!stage || !labelsRoot || !streetRoot) return;
    let cancelled = false;
    let handle: HandoverHandle | null = null;

    applySpinFlags(); // `?no-rotate` works on any page, `?spin-idle=MS` in debug mode
    applySkyFlags(); // `?no-sky` works on any page, `?sky` turns it on in debug mode
    applyRingFlags(); // `?no-ring` works on any page, `?ring` turns it on in debug mode
    applyShowcaseFlags(); // the showcase is on every page but a debug one, where `?showcase` turns it on
    if (debugEnabled()) {
      applyDebugLevels();
      applyDebugArtPixel();
    }
    void (async () => {
      try {
        const geo = await loadGeodata();
        if (cancelled) return;
        const now = latest.current;
        const stress = debugEnabled() ? lodStressCount() : 0;
        const synthetic = stress ? stressHierarchy(stress) : debugEnabled() && new URLSearchParams(location.search).has("lod-cases") ? casesHierarchy() : null;
        handle = createHandover({
          stage,
          labelsRoot,
          streetRoot,
          places: synthetic ? synthetic.places : places,
          groups: synthetic ? synthetic.groups : groupsForTests() ? [] : groups,
          routes: debugEnabled() && pathsStressCount() ? stressRoutes(pathsStressCount(), places[0] ? { lat: places[0].lat, lon: places[0].lon } : undefined) : routes,
          paths: now.paths,
          coastlines: geo.coastlines,
          borders: geo.borders,
          initialView: viewRef.current,
          selectedSlug: now.selectedSlug,
          focusedSlug: now.focusedSlug,
          reducedMotion: now.reducedMotion,
          insetRight: now.insetRight,
          tiles: tilesKey ? JSON.parse(tilesKey) : null,
          ringText: ringText(now.ringPhrases ?? []), // the line of the ring of type, from the identity the app hands in (the words, capitals and closing seam are the engine's)
          captionPhrases: now.captionPhrases,
          coverBottom: now.showcase?.get().coverBottom ?? 0,
          coverBlocks: now.showcase?.get().blocks,
          showcase: now.showcase?.get().on ?? false,
          onNotice: setNotice,
          onSelect: (slug) => latest.current.onSelect(slug),
          onViewChange: (view) => {
            const t0 = perfStart();
            viewRef.current = view;
            latest.current.onViewChange(view);
            perfEnd("react.onViewChange", t0);
          },
          onContextChange: (lost) => {
            setStatus(lost ? "lost" : "ready");
            // The caption's pixels are gone with the context: the hero's how-to line must be there over a dead globe, and goes again on restore.
            latest.current.onOrbit?.(lost ? false : (handleRef.current?.hasOrbit() ?? false));
          },
          onReveal: veil ? () => setRevealed(true) : undefined,
          streetOptions: debugEnabled() ? streetDebugOptions() : undefined,
          dissolve: debugEnabled() ? dissolveForTests() : undefined,
        });
        appliedSelection.current = now.selectedSlug;
        handleRef.current = handle;
        if (debugEnabled()) {
          enablePerf();
          const d = handle.debug();
          window.__handoverDebug = d;
          window.__globeDebug = d.globe;
        }
        setStatus("ready");
        latest.current.onOrbit?.(handle.hasOrbit());
      } catch (e) {
        if (cancelled) return;
        if (!isWebGLUnavailable(e)) console.error("Globe failed to start", e);
        latest.current.onOrbit?.(false);
        setStatus("unavailable");
        setRevealed(true);
      }
    })();

    return () => {
      cancelled = true;
      handleRef.current = null;
      delete window.__globeDebug;
      delete window.__handoverDebug;
      handle?.dispose();
      setNotice(null);
    };
  }, [places, groups, routes, tilesKey]);

  // The inset first: a selection that opens the panel flies to a framing computed for the panel's width, so the
  // renderer must already know the inset it is heading for (effects run in declaration order).
  useEffect(() => {
    handleRef.current?.setInset(insetRight);
  }, [insetRight]);

  // The home screen's showcase (the hero at rest): followed by subscription, so a gesture costs the app no render. Applied again when the engine
  // has just come up (`status`), which is when there is a handle to tell.
  useEffect(() => {
    if (!showcase || status !== "ready") return;
    const apply = () => {
      const v = showcase.get();
      handleRef.current?.setCover(v.coverBottom, v.blocks);
      handleRef.current?.setShowcase(v.on);
    };
    apply();
    return showcase.subscribe(apply);
  }, [showcase, status]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || selectedSlug === appliedSelection.current) return;
    appliedSelection.current = selectedSlug;
    handle.setSelected(selectedSlug, true);
  }, [selectedSlug]);

  useEffect(() => {
    handleRef.current?.setPaths(paths);
  }, [paths, status]);

  useEffect(() => {
    handleRef.current?.setFocused(focusedSlug);
  }, [focusedSlug]);

  useEffect(() => {
    handleRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  // Fade in from the page colour (the stage itself is transparent over it): opacity only, no layout. Instant when reduced.
  const fade = revealed ? (reducedMotion ? undefined : { transition: `opacity ${HANDOVER.fadeInMs}ms var(--ease-standard, cubic-bezier(0.2, 0, 0, 1))` }) : { opacity: 0 };
  return (
    <div data-globe="three" data-state={status} data-revealed={revealed ? "" : undefined} style={fade} className="relative size-full overflow-hidden select-none">
      <div ref={stageRef} aria-hidden="true" className="absolute inset-0 overflow-hidden" />
      <div ref={labelsRef} aria-hidden="true" />
      <div ref={streetRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden" />
      {/* Always in the DOM so that a change is announced; empty (and invisible) unless the street map is out. */}
      <p
        role="status"
        className="pointer-events-none absolute bottom-3 left-4 max-w-[min(20rem,calc(100%-2rem))] font-mono text-[11px] leading-snug text-muted-foreground"
      >
        {notice && status === "ready" ? "Street detail is unavailable right now." : null}
      </p>
      {Attribution && <Attribution tiles={tilesKey ? (tiles ?? null) : null} insetRight={insetRight} reducedMotion={reducedMotion} surface="globe" />}
      {(status === "unavailable" || status === "lost") && (
        <p
          role="status"
          style={{ right: insetRight }}
          className="pointer-events-none absolute inset-y-0 left-0 grid place-items-center px-8 text-center text-sm text-muted-foreground"
        >
          <span className="max-w-xs">
            {status === "unavailable"
              ? "The interactive globe needs WebGL, which is not available here. Use the list of places instead."
              : "The globe paused because the graphics context was lost. It will come back on its own. The places stay reachable from the keyboard."}
          </span>
        </p>
      )}
    </div>
  );
}
