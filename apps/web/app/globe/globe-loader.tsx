import { useEffect, useState } from "react";

/** How long the globe may take before the loader shows at all (a fast load never flashes it), the least time it stays once it has shown (it does not blink), and its fade out, ms. */
export const LOADER = { delayMs: 450, minShownMs: 900, leaveMs: 320 } as const;

type Phase = "show" | "leaving" | "gone";

/** The first loader of a page load counts its delay from the navigation's start (the document is on the screen long before the script is: the delay runs in CSS from the first paint, `.globe-loader`); a later one (the globe coming back from the mobile slide-over) from its own first render. */
let first = true;

/**
 * The world view's loader (owner, 2026-11-02, #545: "so slower devices don't see half-loaded stuff nor lag"): a 3 by 3 ring of square pixels, one lit and a trail behind it going round (the globe's own art pixels, whole
 * pixels, no rotation: a spinner that is part of the page's look), and a line of text under it, "Loading world view". It is in the server's HTML, hidden, and CSS shows it after `delayMs` (so it is there while the
 * script is still on its way, which is the slow part on a slow device, and a quick load never shows it); once the globe says it is loaded the loader is taken away at once if it has not shown yet, else it stays until
 * `minShownMs` of being shown have gone and fades out over `leaveMs` as the globe fades in. Laid over the globe's own area (`insetRight` is the panel's share), under the page's controls, out of the pointer's way. Reduced
 * motion: the ring does not turn, it is lit whole, and it does not fade. The text is a polite status for assistive technology.
 */
export function GlobeLoader({ done, insetRight = 0 }: { done: boolean; insetRight?: number }) {
  const [phase, setPhase] = useState<Phase>("show");
  // when it is (or was) due to be on the screen: ms on the page's clock
  const [due] = useState(() => {
    const at = first || typeof performance === "undefined" ? 0 : performance.now();
    first = false;
    return at + LOADER.delayMs;
  });

  useEffect(() => {
    if (!done || phase !== "show") return;
    const now = performance.now();
    if (now < due) {
      setPhase("gone");
      return;
    }
    const id = window.setTimeout(() => setPhase("leaving"), Math.max(0, due + LOADER.minShownMs - now));
    return () => window.clearTimeout(id);
  }, [done, phase, due]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const id = window.setTimeout(() => setPhase("gone"), LOADER.leaveMs);
    return () => window.clearTimeout(id);
  }, [phase]);

  if (phase === "gone") return null;
  return (
    <div data-slot="globe-loader" data-phase={phase} style={{ right: insetRight }} className="globe-loader">
      <span className="globe-loader-ring" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} style={{ "--i": i } as React.CSSProperties} />
        ))}
      </span>
      <span role="status" className="globe-loader-text">
        Loading world view
      </span>
    </div>
  );
}
