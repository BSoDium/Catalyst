/**
 * One layout change, paid early and out of sight.
 *
 * Measured (2026-10-09, Chrome for Testing 153 on macOS, trace + native sampling of the renderer): the FIRST layout change of a renderer process
 * after the pointer position is known makes Blink recompute the hover state, which on macOS asks the system for the keyboard modifiers
 * (`GetCurrentKeyModifiers`) and that initialises the window server client of the process: one main-thread block of 30 to 35 ms, once per
 * process, with no script in it (a long animation frame with 0 ms of script and about 37 ms of render). The world view is a WebGL canvas whose
 * DOM never changes, so the first layout change after the first mouse move is the first label that appears (engine/label-dom.ts): a 33 ms
 * frame in the middle of a drag (perf budget, mobile s1). Any layout change does it, anywhere on the page, so the cost is taken here instead:
 * on the first mouse move, in an idle period, a 1 px invisible element is added and removed. Pooling the label elements does not help (showing
 * one, or changing its text, is a layout change too).
 *
 * Nothing to do for touch (no pointer position, no hover) or when the pointer never moves.
 */
export interface HoverWarmHost {
  addEventListener(type: "pointermove", fn: (e: { pointerType?: string }) => void, opts: AddEventListenerOptions): void;
  removeEventListener(type: "pointermove", fn: (e: { pointerType?: string }) => void, opts: AddEventListenerOptions): void;
}

export interface HoverWarmDoc {
  createElement(tag: "div"): { style: Partial<CSSStyleDeclaration> & Record<string, string>; setAttribute(k: string, v: string): void; getBoundingClientRect(): unknown; remove(): void };
  body: { append(el: never): void } | null;
}

/** Once per page (per renderer process): later calls do nothing. */
let done = false;

/** Reset the once-per-process flag (tests). */
export function resetHoverWarm() {
  done = false;
}

/** The layout change itself: an invisible 1 px element, added, laid out and removed. */
export function layoutProbe(doc: HoverWarmDoc): void {
  const body = doc.body;
  if (!body) return;
  const p = doc.createElement("div");
  p.setAttribute("aria-hidden", "true");
  Object.assign(p.style, { position: "fixed", left: "0", top: "0", width: "1px", height: "1px", opacity: "0", pointerEvents: "none", contain: "strict" });
  body.append(p as never);
  p.getBoundingClientRect();
  p.remove();
}

/**
 * Wait for the first mouse move on `host`, then run `layoutProbe` when `idle` says so (a `requestIdleCallback`, or a short timer where there is
 * none). Returns the function that withdraws the listener.
 */
export function warmHover(host: HoverWarmHost, doc: HoverWarmDoc, idle: (fn: () => void) => void = whenIdle): () => void {
  if (done) return () => {};
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  const onMove = (e: { pointerType?: string }) => {
    if (e.pointerType !== "mouse" || done) return;
    done = true;
    host.removeEventListener("pointermove", onMove, opts);
    idle(() => layoutProbe(doc));
  };
  host.addEventListener("pointermove", onMove, opts);
  return () => host.removeEventListener("pointermove", onMove, opts);
}

function whenIdle(fn: () => void): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 400 });
  else setTimeout(fn, 60);
}
