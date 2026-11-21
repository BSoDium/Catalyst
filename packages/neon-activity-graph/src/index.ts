import { mountScene, type SceneHandle } from "./graph";
import { createHoverOverlay, type HoverOverlay } from "./overlay";
import { mountPlaceholder } from "./placeholder";
import { cling } from "./sound";
import { layoutGraph } from "./layout";
import { predictBounds, shiftsFromLayers, tallestOfLayers } from "./view";
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
  // (the strips of a narrow page are moved by the weight of their days, which the scene knows from the data: the place-holder and the predicted bounds are given the same, when the data is there, so that they are where the scene will be)
  const strips0 = options.strips ?? 1;
  const geometryOf = (data: GraphData | null | undefined) => {
    const known = data ? layoutGraph(data, options.weeks ?? 53) : null;
    return { shifts: known && strips0 > 1 ? shiftsFromLayers([known.top, known.bottom], strips0) : undefined, tallest: known ? tallestOfLayers(known.top, known.bottom) : undefined };
  };
  let { shifts, tallest } = geometryOf(options.data);
  // (is the theme dark: the place-holder's tiles are faint grey squares in the dark theme only; `undefined` while it is the system's and there is no way to ask, as in a prerender)
  const isDarkTheme = (): boolean | undefined => (state.theme === "auto" ? (typeof matchMedia === "undefined" ? undefined : matchMedia("(prefers-color-scheme: dark)").matches) : state.theme === "dark");
  const holder = options.placeholder === false ? null : mountPlaceholder(container, { weeks: options.weeks, strips: options.strips, shifts, tallest, dark: isDarkTheme() });
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
    const b = predictBounds(options.weeks ?? 53, options.strips ?? 1, container.clientWidth, container.clientHeight, tallest, shifts);
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
  let colorDirty = false;
  return {
    get bounds() {
      return handle.bounds();
    },
    get ready() {
      return handle.ready;
    },
    update(data: GraphData) {
      if (destroyed) return;
      // (the place-holder, if it is still there, and the predicted bounds follow the new data: they are where the scene will be)
      ({ shifts, tallest } = geometryOf(data));
      holder?.setGeometry({ shifts, tallest });
      predict();
      handle.stop();
      opts = { ...opts, data };
      handle = start();
    },
    cling(size) {
      // (the bells belong to the neon: in the light theme the tubes are off, so there is nothing to ring)
      if (!destroyed && options.sound !== false && isDarkTheme()) cling(size);
    },
    setColors(colors) {
      if (destroyed) return;
      opts = { ...opts, colors: { top: { ...opts.colors?.top, ...colors.top }, bottom: { ...opts.colors?.bottom, ...colors.bottom } } };
      // (the mounted scene reads its colours from its own options object: it is given the new ones too)
      if (sceneOpts) sceneOpts.colors = opts.colors;
      // The first change in a quiet moment is applied at once (a click on a preset), the ones that follow within 120 ms (a drag on a colour input fires on every step) are folded into one more rebuild at the end of that window.
      if (colorTimer) {
        colorDirty = true;
        return;
      }
      handle.rethink(true);
      const settle = () => {
        colorTimer = 0;
        if (!colorDirty || destroyed) return;
        colorDirty = false;
        handle.rethink(true);
        colorTimer = window.setTimeout(settle, 120);
      };
      colorTimer = window.setTimeout(settle, 120);
    },
    setTheme(theme) {
      if (destroyed) return;
      state.theme = theme;
      holder?.setDark(isDarkTheme());
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
