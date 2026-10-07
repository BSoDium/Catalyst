import { lazy, Suspense, useEffect, useState } from "react";
import type { GlobeProps } from "./types";

export { DEFAULT_VIEW_RADIUS_KM, placeFraming } from "./engine/framing";
export type { GlobeAttributionProps, GlobeFitView, GlobeGroup, GlobeGroupKind, GlobeInitialView, GlobePlace, GlobeProps, GlobeViewState } from "./types";

/**
 * The renderer implementation is loaded lazily and only on the client. It pulls `three` and the geodata in
 * through its own dynamic imports, so they stay out of the main bundle. To swap renderers, change this import.
 */
const GlobeImpl = lazy(() => import("./globe-canvas"));

/**
 * Client-only globe. Renders nothing on the server so that server and first client render match, and nothing while the
 * renderer loads: the page colour is all there is until the first pixel-art frame fades in (globe-canvas.tsx). There is no
 * placeholder: an outline of the planet at screen resolution, shown for a few frames, is the one thing that must not appear.
 */
export function Globe(props: GlobeProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <GlobeImpl {...props} />
    </Suspense>
  );
}
