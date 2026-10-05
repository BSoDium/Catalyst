/**
 * The production globe (Three.js). React owns only the lifecycle: it creates the imperative engine in an effect,
 * forwards prop changes to it, and disposes it on unmount. Everything that touches `three` or the geodata is
 * loaded with a dynamic `import()` inside the effect, so neither is ever imported on the server nor part of the
 * main bundle. See docs/web-architecture.md ("Production globe").
 *
 * Accessibility: the canvas and the label overlay are decoration plus pointer input and are `aria-hidden`;
 * the place list is the accessible path. Neither has a tab stop. The only exposed text is the status message
 * when WebGL is unavailable or the context was lost.
 */
import { useEffect, useRef, useState } from "react";
import type { GlobeHandle, GlobeDebug } from "./engine";
import type { GlobeProps } from "./types";

type Status = "loading" | "ready" | "unavailable" | "lost";

declare global {
  interface Window {
    /** Set only when `?globe-debug` is in the URL or sessionStorage "globe-debug" is "1" (automated checks). */
    __globeDebug?: GlobeDebug;
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

const isWebGLUnavailable = (e: unknown) => e instanceof Error && e.name === "WebGLUnavailableError";

export default function GlobeCanvas({
  places,
  routes,
  selectedSlug,
  focusedSlug,
  initialView,
  reducedMotion,
  insetRight,
  onSelect,
  onViewChange,
}: GlobeProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<GlobeHandle | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  // `initialView` is read once; afterwards this tracks the latest view so that re-creating the engine
  // (only when `places` or `routes` change) keeps the camera where it was.
  const viewRef = useRef(initialView);
  const appliedSelection = useRef(selectedSlug);
  const latest = useRef({ selectedSlug, focusedSlug, reducedMotion, insetRight, onSelect, onViewChange });
  useEffect(() => {
    latest.current = { selectedSlug, focusedSlug, reducedMotion, insetRight, onSelect, onViewChange };
  });

  useEffect(() => {
    const stage = stageRef.current;
    const labelsRoot = labelsRef.current;
    if (!stage || !labelsRoot) return;
    let cancelled = false;
    let handle: GlobeHandle | null = null;

    void (async () => {
      try {
        const [engine, geo] = await Promise.all([import("./engine"), loadGeodata()]);
        if (cancelled) return;
        const now = latest.current;
        handle = engine.createGlobe({
          stage,
          labelsRoot,
          places,
          routes,
          coastlines: geo.coastlines,
          borders: geo.borders,
          initialView: viewRef.current,
          selectedSlug: now.selectedSlug,
          reducedMotion: now.reducedMotion,
          insetRight: now.insetRight,
          onSelect: (slug) => latest.current.onSelect(slug),
          onViewChange: (view) => {
            viewRef.current = view;
            latest.current.onViewChange(view);
          },
          onContextChange: (lost) => setStatus(lost ? "lost" : "ready"),
        });
        appliedSelection.current = now.selectedSlug;
        handle.setFocused(now.focusedSlug);
        handleRef.current = handle;
        if (debugEnabled()) window.__globeDebug = handle.debug();
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
      handle?.dispose();
    };
  }, [places, routes]);

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
