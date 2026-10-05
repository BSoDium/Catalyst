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
import type { GlobeProps } from "./types";

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

/** Test-only: `?no-street` (or sessionStorage "no-street" = "1") runs the globe alone, as before street scale existed. */
function streetDisabledForTests(): boolean {
  try {
    return new URLSearchParams(location.search).has("no-street") || sessionStorage.getItem("no-street") === "1";
  } catch {
    return false;
  }
}

const isWebGLUnavailable = (e: unknown) => e instanceof Error && e.name === "WebGLUnavailableError";

export default function GlobeCanvas({
  places,
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

    void (async () => {
      try {
        const geo = await loadGeodata();
        if (cancelled) return;
        const now = latest.current;
        handle = createHandover({
          stage,
          labelsRoot,
          streetRoot,
          places,
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
            viewRef.current = view;
            latest.current.onViewChange(view);
          },
          onContextChange: (lost) => setStatus(lost ? "lost" : "ready"),
          streetOptions: debugEnabled() ? streetDebugOptions() : undefined,
        });
        appliedSelection.current = now.selectedSlug;
        handleRef.current = handle;
        if (debugEnabled()) {
          const d = handle.debug();
          window.__handoverDebug = d;
          window.__globeDebug = d.globe;
        }
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        if (!isWebGLUnavailable(e)) console.error("Globe failed to start", e);
        setStatus("unavailable");
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
  }, [places, routes, tilesKey]);

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

  useEffect(() => {
    handleRef.current?.setInset(insetRight);
  }, [insetRight]);

  return (
    <div data-globe="three" data-state={status} className="relative size-full overflow-hidden select-none">
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
      {status === "loading" && (
        <div
          aria-hidden="true"
          style={{ right: insetRight }}
          className="pointer-events-none absolute inset-y-0 left-0 grid place-items-center"
        >
          <div className="aspect-square h-[min(72%,78vw)] rounded-full border border-border-strong" />
        </div>
      )}
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
