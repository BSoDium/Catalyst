import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import type { StreetMapCanvasProps } from "./street-map-canvas";

export type { StreetMapCanvasProps } from "./street-map-canvas";
export type {
  AnimateOptions,
  FlyOptions,
  RevealOptions,
  StreetDebug,
  StreetMap,
  StreetMapOptions,
  StreetTileConfig,
  StreetView,
  TileReason,
  TileState,
  TileStatus,
} from "./types";
// Pure helpers (no MapLibre, tiny): safe to import from the main bundle.
export { globeViewToMap, mapToGlobeView, registerGlobeToMap, registerMapToGlobe, zoomCorrection } from "./core/registration";

/**
 * The implementation (MapLibre, PMTiles, the pixel pass) is its own client chunk. In the server build the lazy import
 * is replaced by a stub (`import.meta.env.SSR` is statically true there), so none of it is bundled for SSR either.
 */
const Impl = lazy<ComponentType<StreetMapCanvasProps>>(() =>
  import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import("./street-map-canvas"),
);

/** Fixed placeholder shown while the chunk loads: no layout shift. */
function StreetLoading() {
  return <div data-street="loading" className="size-full" />;
}

/**
 * Client-only street map. Renders nothing on the server so that server and first client render match; the
 * implementation chunk loads after hydration. Fills its container (`size-full`).
 */
export function StreetMapCanvas(props: StreetMapCanvasProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <Suspense fallback={<StreetLoading />}>
      <Impl {...props} />
    </Suspense>
  );
}
