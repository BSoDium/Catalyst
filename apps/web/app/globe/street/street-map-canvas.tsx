/**
 * React lifecycle around the street map engine, in the pattern of globe-canvas.tsx: React owns only the lifecycle.
 * It creates the imperative engine in an effect (dynamic `import()`, so MapLibre and PMTiles are a client-only chunk
 * that never reaches the server or the globe), forwards prop changes to it and disposes it on unmount.
 *
 * Accessibility: the map, the pass canvas and the marker/label overlay are decoration plus pointer input and are
 * `aria-hidden` (the engine marks them); the only exposed text is the attribution (real links, always visible) and
 * the status message when WebGL is unavailable or the context was lost. The place list is the accessible path.
 */
import { useEffect, useRef, useState } from "react";
import type { GlobePlace, GlobeRoute } from "../types";
import type { StreetDebug, StreetMap, StreetMapOptions, StreetTileConfig, StreetView, TileStatus } from "./types";

type Status = "loading" | "ready" | "unavailable" | "lost";

declare global {
  interface Window {
    /** Set only when `?street-debug` is in the URL or sessionStorage "street-debug" is "1" (automated checks). */
    __streetDebug?: StreetDebug;
    __street?: StreetMap;
  }
}

export interface StreetMapCanvasProps {
  places: GlobePlace[];
  routes: GlobeRoute[];
  selectedSlug: string | null;
  focusedSlug: string | null;
  /** Read once, at (re)creation of the engine; afterwards the engine reports changes through `onViewChange`. */
  initialView: StreetView;
  reducedMotion: boolean;
  tiles: StreetTileConfig;
  insetRight: number;
  onSelect(slug: string): void;
  onViewChange?(view: StreetView): void;
  onTileStatus?(status: TileStatus): void;
  /** The engine handle once it exists (and null again when it is disposed): the handover drives the capabilities here. */
  onReady?(map: StreetMap | null): void;
  /** Engine options that are not props (testing and tuning); read at creation. */
  engineOptions?: Pick<StreetMapOptions, "minZoom" | "maxZoom" | "projection" | "forceSource" | "timings" | "thresholds" | "probeTimeoutMs" | "requestTimeoutMs" | "initialBlend" | "initialSharp" | "world" | "highResolution">;
}

function debugEnabled(): boolean {
  try {
    return new URLSearchParams(location.search).has("street-debug") || sessionStorage.getItem("street-debug") === "1";
  } catch {
    return false;
  }
}

const isWebGLUnavailable = (e: unknown) => e instanceof Error && e.name === "WebGLUnavailableError";

export default function StreetMapCanvasImpl({
  places,
  routes,
  selectedSlug,
  focusedSlug,
  initialView,
  reducedMotion,
  tiles,
  insetRight,
  onSelect,
  onViewChange,
  onTileStatus,
  onReady,
  engineOptions,
}: StreetMapCanvasProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<StreetMap | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [tileState, setTileState] = useState<string>("connecting");

  const viewRef = useRef(initialView);
  const appliedSelection = useRef(selectedSlug);
  const latest = useRef({ selectedSlug, focusedSlug, reducedMotion, insetRight, onSelect, onViewChange, onTileStatus, onReady, engineOptions });
  useEffect(() => {
    latest.current = { selectedSlug, focusedSlug, reducedMotion, insetRight, onSelect, onViewChange, onTileStatus, onReady, engineOptions };
  });

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let cancelled = false;
    let handle: StreetMap | null = null;

    void (async () => {
      try {
        // `import.meta.env.SSR` is replaced by `true` in the server build, which drops the import (and MapLibre) there.
        if (import.meta.env.SSR) return;
        const engine = await import("./engine");
        if (cancelled) return;
        const now = latest.current;
        handle = engine.createStreetMap(box, {
          view: viewRef.current,
          places,
          routes,
          selectedSlug: now.selectedSlug,
          focusedSlug: now.focusedSlug,
          reducedMotion: now.reducedMotion,
          tiles,
          insetRight: now.insetRight,
          ...now.engineOptions,
          onSelect: (slug) => latest.current.onSelect(slug),
          onViewChange: (view) => {
            viewRef.current = view;
            latest.current.onViewChange?.(view);
          },
          onTileStatus: (s) => {
            setTileState(s.state);
            latest.current.onTileStatus?.(s);
          },
          onContextChange: (lost) => setStatus(lost ? "lost" : "ready"),
        });
        appliedSelection.current = now.selectedSlug;
        handleRef.current = handle;
        if (debugEnabled()) {
          window.__streetDebug = handle.debug();
          window.__street = handle;
        }
        setStatus("ready");
        latest.current.onReady?.(handle);
      } catch (e) {
        if (cancelled) return;
        if (!isWebGLUnavailable(e)) console.error("Street map failed to start", e);
        setStatus("unavailable");
      }
    })();

    return () => {
      cancelled = true;
      handleRef.current = null;
      delete window.__streetDebug;
      delete window.__street;
      if (handle) latest.current.onReady?.(null);
      handle?.dispose();
    };
    // The engine is rebuilt only when what it was built from changes (the camera is kept in viewRef).
  }, [places, routes, tiles.primaryUrl, tiles.fallbackPmtilesUrl, tiles.maxFallbackZoom]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || selectedSlug === appliedSelection.current) return;
    appliedSelection.current = selectedSlug;
    handle.setSelected(selectedSlug);
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
    <div
      ref={boxRef}
      data-street="map"
      data-state={status}
      data-tile-state={tileState}
      className="relative size-full overflow-hidden select-none"
    >
      {(status === "unavailable" || status === "lost") && (
        <p
          role="status"
          style={{ right: insetRight }}
          className="pointer-events-none absolute inset-y-0 left-0 z-10 grid place-items-center px-8 text-center text-sm text-muted-foreground"
        >
          <span className="max-w-xs">
            {status === "unavailable"
              ? "The street map needs WebGL, which is not available here. Use the list of places instead."
              : "The map paused because the graphics context was lost. It will come back on its own. The places stay reachable from the keyboard."}
          </span>
        </p>
      )}
    </div>
  );
}
