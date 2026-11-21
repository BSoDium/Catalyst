import { mountScene, type SceneHandle } from "./graph";
import { createHoverOverlay, type HoverOverlay } from "./overlay";
import { mountPlaceholder } from "./placeholder";
import { predictBounds } from "./view";
import type { ActivityGraph, ContentBounds, GraphData, GraphOptions } from "./types";

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
    onLayout,
    onReady: () => {
      holder?.fadeOut();
      o.onReady?.();
    },
    onHover: (i) => {
      overlay?.update(i);
      o.onHover?.(i);
    },
  });
  let sceneOpts: (GraphOptions & { data: GraphData }) | null = null;
  const start = (): SceneHandle => (opts.data ? mountScene(container, (sceneOpts = wrap({ ...opts, data: opts.data }) as GraphOptions & { data: GraphData }), state) : { stop() {}, rethink() {}, bounds: () => null, ready: Promise.resolve() });
  // The blocks' bounds are known at once, from the geometry alone, so a caption lined up with them (`--nag-content-left`) is placed at the first paint and does not move when the scene arrives; the scene's own bounds replace them.
  let measured = false;
  const predict = () => {
    if (measured || !container.clientWidth || !container.clientHeight) return;
    const b = predictBounds(options.weeks ?? 53, options.strips ?? 1, container.clientWidth, container.clientHeight);
    for (const [k, v] of Object.entries(b)) container.style.setProperty(`--nag-content-${k}`, `${v.toFixed(1)}px`);
  };
  predict();
  const predictObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(predict);
  predictObserver?.observe(container);
  const onLayout = (b: ContentBounds) => {
    measured = true;
    predictObserver?.disconnect();
    options.onLayout?.(b);
  };
  let handle: SceneHandle = start();
  let destroyed = false;
  let colorTimer = 0;
  return {
    get bounds() {
      return handle.bounds();
    },
    get ready() {
      return handle.ready;
    },
    update(data: GraphData) {
      if (destroyed) return;
      handle.stop();
      opts = { ...opts, data };
      handle = start();
    },
    setColors(colors) {
      if (destroyed) return;
      opts = { ...opts, colors: { top: { ...opts.colors?.top, ...colors.top }, bottom: { ...opts.colors?.bottom, ...colors.bottom } } };
      // (debounced: a colour input fires on every step of a drag; the blocks are rebuilt once it settles, without the start-up and without fetching anything)
      // (the mounted scene reads its colours from its own options object: it is given the new ones too)
      if (sceneOpts) sceneOpts.colors = opts.colors;
      window.clearTimeout(colorTimer);
      colorTimer = window.setTimeout(() => handle.rethink(true), 120);
    },
    setTheme(theme) {
      if (destroyed) return;
      state.theme = theme;
      handle.rethink();
    },
    destroy() {
      destroyed = true;
      window.clearTimeout(colorTimer);
      handle.stop();
      predictObserver?.disconnect();
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
export type { ActivityGraph, ContentBounds, GraphOptions, HoverInfo, RodContext, Startup } from "./types";
