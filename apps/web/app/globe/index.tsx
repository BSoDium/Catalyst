import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { GlobeLoader } from "./globe-loader";
import type { GlobeProps } from "./types";

export { DEFAULT_VIEW_RADIUS_KM, placeFraming } from "./engine/framing";
export { noteVisit } from "./engine/visit";
export { INTERLUDE_STATE_EVENT, prepareInterlude, requestInterlude, requestWorldView, RESTORE_HERO_EVENT, type InterludeStateDetail } from "./interlude";
export { unlockSound } from "./engine/cinematic-sound";
export { SCHEME_EVENT, currentScheme, onSchemeChange } from "./engine/scheme";
export { sunMusic } from "./engine/sun-music";
export { beatPulse } from "./engine/sun-pulse";
export { TRACKS, nowPlaying, pillVisible, readMuted, sunAudible, type NowPlayingSnapshot, type Track } from "./engine/now-playing";
export { ringPhrases, type RingIdentity } from "./ring-text";
export type {
  GlobeAttributionProps,
  CoverBlock,
  GlobeFitView,
  GlobeGroup,
  GlobeGroupKind,
  GlobeInitialView,
  GlobeMoon,
  GlobePlace,
  GlobeProps,
  GlobeShowcase,
  GlobeSignal,
  GlobeViewState,
} from "./types";

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
  const [loaded, setLoaded] = useState(false);
  const { onLoaded } = props;
  const settled = useCallback(() => {
    setLoaded(true);
    onLoaded?.();
  }, [onLoaded]);
  useEffect(() => setMounted(true), []);
  // (the loader is in the server's HTML, hidden: CSS shows it after a moment, while the script is still coming; the globe itself is client only)
  if (!mounted) return <GlobeLoader done={false} insetRight={props.insetRight} />;
  return (
    <>
      <Suspense fallback={null}>
        <GlobeImpl {...props} onLoaded={settled} />
      </Suspense>
      {/* While the renderer's code loads and the first frame is drawn (and only if that takes a moment): a loader, so a slow device shows neither nothing nor a half-built scene (#545). */}
      <GlobeLoader done={loaded} insetRight={props.insetRight} />
    </>
  );
}
