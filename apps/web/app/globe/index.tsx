import { lazy, Suspense, useEffect, useState } from "react";
import type { GlobeProps } from "./types";

export type { GlobeProps, GlobeViewState } from "./types";

/**
 * The renderer implementation is loaded lazily and only on the client. It pulls `three` and the geodata in
 * through its own dynamic imports, so they stay out of the main bundle. To swap renderers, change this import.
 */
const GlobeImpl = lazy(() => import("./globe-canvas"));

/** Fixed-aspect disc outline: shown until the renderer has loaded. No layout shift. */
function GlobeLoading({ insetRight }: { insetRight: number }) {
  return (
    <div data-globe="loading" style={{ paddingRight: insetRight }} className="grid size-full place-items-center">
      <div className="aspect-square h-[min(72%,78vw)] rounded-full border border-border-strong" />
    </div>
  );
}

/**
 * Client-only globe. Renders nothing on the server so that server and first
 * client render match; the placeholder disc outline appears right after hydration.
 */
export function Globe(props: GlobeProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <Suspense fallback={<GlobeLoading insetRight={props.insetRight} />}>
      <GlobeImpl {...props} />
    </Suspense>
  );
}
