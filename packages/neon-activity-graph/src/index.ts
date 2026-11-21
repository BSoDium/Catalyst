import { mountScene, type SceneHandle } from "./graph";
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
  let handle: SceneHandle = mountScene(container, opts, state);
  let destroyed = false;
  return {
    get ready() {
      return handle.ready;
    },
    update(data: GraphData) {
      if (destroyed) return;
      handle.stop();
      opts = { ...opts, data };
      handle = mountScene(container, opts, state);
    },
    setTheme(theme) {
      if (destroyed) return;
      state.theme = theme;
      handle.rethink();
    },
    destroy() {
      destroyed = true;
      handle.stop();
    },
  };
}

export * from "./pure";
export { DEFAULT_COLORS } from "./graph";
export type { ActivityGraph, GraphOptions, HoverInfo, RodContext, Startup } from "./types";
