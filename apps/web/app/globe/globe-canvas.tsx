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
import { AttributionButton } from "~/components/attribution-button";
import { createHandover, type HandoverDebug, type HandoverHandle, type Notice } from "./handover/controller";
import { HANDOVER } from "./handover/maths";
import { casesHierarchy, stressHierarchy } from "./engine/lod-stress";
import { applyDebugLevels } from "./engine/palette";
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
  selectedSlug,
  focusedSlug,
  initialView,
  reducedMotion,
  insetRight,
  tiles,
  onSelect,
  onViewChange,
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
  const latest = useRef({ selectedSlug, focusedSlug, reducedMotion, insetRight, onSelect, onViewChange });
  useEffect(() => {
    latest.current = { selectedSlug, focusedSlug, reducedMotion, insetRight, onSelect, onViewChange };
  });

  useEffect(() => {
    const stage = stageRef.current;
    const labelsRoot = labelsRef.current;
    const streetRoot = streetRef.current;
    if (!stage || !labelsRoot || !streetRoot) return;
    let cancelled = false;
    let handle: HandoverHandle | null = null;

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
          routes,
          coastlines: geo.coastlines,
          borders: geo.borders,
          initialView: viewRef.current,
          selectedSlug: now.selectedSlug,
          focusedSlug: now.focusedSlug,
          reducedMotion: now.reducedMotion,
          insetRight: now.insetRight,
          tiles: tilesKey ? JSON.parse(tilesKey) : null,
          onNotice: setNotice,
          onSelect: (slug) => latest.current.onSelect(slug),
          onViewChange: (view) => {
            const t0 = perfStart();
            viewRef.current = view;
            latest.current.onViewChange(view);
            perfEnd("react.onViewChange", t0);
          },
          onContextChange: (lost) => setStatus(lost ? "lost" : "ready"),
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
      } catch (e) {
        if (cancelled) return;
        if (!isWebGLUnavailable(e)) console.error("Globe failed to start", e);
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

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || selectedSlug === appliedSelection.current) return;
    appliedSelection.current = selectedSlug;
    handle.setSelected(selectedSlug, true);
  }, [selectedSlug]);

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
      <AttributionButton tiles={tilesKey ? (tiles ?? null) : null} insetRight={insetRight} reducedMotion={reducedMotion} />
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
