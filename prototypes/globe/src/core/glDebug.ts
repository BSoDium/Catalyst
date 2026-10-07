/**
 * Counts WebGL contexts created and lost so unmount/restore cycles can be checked for leaks.
 * Installed once, before any renderer creates a canvas. Exposed as `window.__gl`.
 */
export interface GlDebug {
  created: number;
  lost: number;
  live(): number;
  liveCanvases(): number;
}

declare global {
  interface Window {
    __gl?: GlDebug;
  }
}

export function installGlDebug(): GlDebug {
  if (window.__gl) return window.__gl;
  const state = { created: 0, lost: 0 };
  const seen = new WeakSet<HTMLCanvasElement>();
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    const ctx = (orig as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    if (ctx && /webgl/.test(type) && !seen.has(this)) {
      seen.add(this);
      state.created++;
      this.addEventListener("webglcontextlost", () => {
        state.lost++;
      });
    }
    return ctx;
  } as typeof orig;
  const dbg: GlDebug = {
    get created() {
      return state.created;
    },
    get lost() {
      return state.lost;
    },
    live: () => state.created - state.lost,
    liveCanvases: () => document.querySelectorAll("canvas").length,
  };
  window.__gl = dbg;
  return dbg;
}
