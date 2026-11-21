import { mountScene, type SceneHandle } from "./graph";
import { createHoverOverlay, type HoverOverlay } from "./overlay";
import { mountPlaceholder } from "./placeholder";
import type { ActivityGraph, GraphData, GraphOptions } from "./types";

/**
 * Draws the graph into `container` (give it a size: the picture fills it; with `strips: 4`, an aspect of about 0.8). three.js is loaded on demand from the host's dependencies.
 *
 * ```ts
 * const graph = createActivityGraph(el, { data: { top: { days: [...] }, bottom: { days: [...] } } });
 * graph.update(newData);
 * graph.destroy();
 * ```
 */
export function createActivityGraph(container: HTMLElement, options: GraphOptions): ActivityGraph {
  const state = { theme: options.theme ?? "auto" };
  let opts = options;
  const holder = options.placeholder === false ? null : mountPlaceholder(container, { weeks: options.weeks, strips: options.strips });
  const overlay: HoverOverlay | null = options.overlay ? createHoverOverlay(container, options.overlay === true ? {} : options.overlay, () => ({ top: opts.data?.top, bottom: opts.data?.bottom })) : null;
  // (what the scene is given: the caller's callbacks, plus the place-holder's fade and the overlay's updates)
  const wrap = (o: GraphOptions): GraphOptions => ({
    ...o,
    onReady: () => {
      holder?.fadeOut();
      o.onReady?.();
    },
    onHover: (i) => {
      overlay?.update(i);
      o.onHover?.(i);
    },
  });
  const start = (): SceneHandle => (opts.data ? mountScene(container, wrap({ ...opts, data: opts.data }) as GraphOptions & { data: GraphData }, state) : { stop() {}, rethink() {}, ready: Promise.resolve() });
  let handle: SceneHandle = start();
  let destroyed = false;
  return {
    get ready() {
      return handle.ready;
    },
    update(data: GraphData) {
      if (destroyed) return;
      handle.stop();
      opts = { ...opts, data };
      handle = start();
    },
    setTheme(theme) {
      if (destroyed) return;
      state.theme = theme;
      handle.rethink();
    },
    destroy() {
      destroyed = true;
      handle.stop();
      holder?.remove();
      overlay?.destroy();
    },
  };
}

export * from "./pure";
export { createHoverOverlay } from "./overlay";
export type { HoverOverlay, OverlayOptions } from "./overlay";
export { cardPosition, formatDay, outlinePath } from "./overlay-math";
export { renderSize } from "./size";
export { DEFAULT_COLORS } from "./graph";
export type { ActivityGraph, GraphOptions, HoverInfo, RodContext, Startup } from "./types";
