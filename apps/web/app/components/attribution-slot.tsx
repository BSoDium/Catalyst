import { lazy, Suspense } from "react";
import type { GlobeAttributionProps } from "~/globe";

// The credits button pulls in the pixel font and the dialog. It is passed to the globe as a slot (`GlobeProps.attribution`,
// the globe never imports app code), and loaded lazily here so that, as before, none of it is in the main bundle.
const AttributionButton = lazy(() => import("./attribution-button").then((m) => ({ default: m.AttributionButton })));

/** `GlobeProps.attribution` / `StreetMapCanvasProps.attribution` for this app: the pixel-art credits button. */
export function AttributionSlot(props: GlobeAttributionProps) {
  // Its own boundary: the globe's Suspense must not hide the globe while this small chunk loads.
  return (
    <Suspense fallback={null}>
      <AttributionButton {...props} />
    </Suspense>
  );
}
