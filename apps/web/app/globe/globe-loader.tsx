import { useEffect, useRef, useState } from "react";

/** How long the globe may take before the loader shows at all (a fast load never flashes it: the delay is CSS, `.globe-loader`) and its fade out, ms. */
export const LOADER = { delayMs: 450, leaveMs: 320 } as const;

type Phase = "show" | "leaving" | "gone";

/**
 * The world view's loader (owner, 2026-11-02, #545: "so slower devices don't see half-loaded stuff nor lag"): a 3 by 3 ring of square pixels, one lit and a trail behind it going round (the globe's own art pixels, whole
 * pixels, no rotation: a spinner that is part of the page's look), and a line of text under it, "Loading world view", on a soft backdrop of the page's colour (a blurred, feathered plate, as the desktop bar's scrim) so that it
 * reads over a half-drawn globe. It is in the server's HTML, hidden, and CSS shows it after `delayMs` (so it is there while the script is still on its way, which is the slow part on a slow device, and a quick load never shows it).
 * The moment the globe says it is loaded (`done`) it goes: at once if it has not shown yet, else it fades out from the opacity it has reached, over `leaveMs` (owner, 2026-11-03: it stayed on screen after the globe was there).
 * Laid over the globe's own area (`insetRight` is the panel's share), under the page's controls, out of the pointer's way. Reduced motion: the ring does not turn, it appears at once after the delay and goes without a fade.
 * The text is a polite status for assistive technology.
 */
export function GlobeLoader({ done, insetRight = 0 }: { done: boolean; insetRight?: number }) {
  const [phase, setPhase] = useState<Phase>("show");
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!done || phase !== "show") return;
    const node = el.current;
    const reached = node ? Number(getComputedStyle(node).opacity) : 0;
    if (!node || !(reached > 0.04)) {
      setPhase("gone"); // not shown yet: it never will be
      return;
    }
    // fade out from where the fade in had got to (a CSS animation's value cannot be the start of a transition: it is pinned by hand)
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.style.animation = "none";
    node.style.opacity = String(reached);
    if (reduced) {
      setPhase("gone");
      return;
    }
    // (the style is flushed with the pinned opacity BEFORE the transition is set: with no flush the browser saw one change, from the animation's value to 0, and the loader popped out; owner, 2026-11-03)
    void node.offsetWidth;
    node.style.transition = `opacity ${LOADER.leaveMs}ms var(--ease-standard, cubic-bezier(0.2, 0, 0, 1))`;
    node.style.opacity = "0";
    setPhase("leaving");
  }, [done, phase]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const id = window.setTimeout(() => setPhase("gone"), LOADER.leaveMs + 40);
    return () => window.clearTimeout(id);
  }, [phase]);

  if (phase === "gone") return null;
  return (
    <div ref={el} data-slot="globe-loader" data-phase={phase} style={{ right: insetRight }} className="globe-loader">
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
