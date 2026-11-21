import { useEffect, useRef, type CSSProperties } from "react";
import { createActivityGraph } from "./index";
import type { ActivityGraph, GraphOptions } from "./types";

export interface ActivityGraphProps extends Omit<GraphOptions, "onHover" | "onReady" | "onLit" | "startup"> {
  className?: string;
  style?: CSSProperties;
  onHover?: GraphOptions["onHover"];
  onReady?: GraphOptions["onReady"];
  onLit?: GraphOptions["onLit"];
  startup?: GraphOptions["startup"];
}

/**
 * The graph as a component: a `div` that fills with the picture (size it with `className` or `style`). The graph is rebuilt when `data`, `strips`, `weeks`, `lite`, `rodColor`'s presence or `templatesUrl` change; a new
 * `theme` only switches the theme. Callbacks and the other options are read when they are needed, so passing new closures does not rebuild anything.
 */
export function ActivityGraphView({ className, style, ...options }: ActivityGraphProps) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<ActivityGraph | null>(null);
  // (the latest options, read through stable callbacks)
  const latest = useRef(options);
  latest.current = options;
  const { data, strips, weeks, lite, templatesUrl, theme } = options;
  const custom = !!options.rodColor;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const o = latest.current;
    const g = createActivityGraph(el, {
      ...o,
      onHover: (i) => latest.current.onHover?.(i),
      onReady: () => latest.current.onReady?.(),
      onLit: (l) => latest.current.onLit?.(l),
      startup: (ctx) => latest.current.startup?.(ctx),
      rodColor: o.rodColor ? (c) => latest.current.rodColor?.(c) ?? null : undefined,
      background: o.background === undefined ? undefined : (t) => (typeof latest.current.background === "function" ? latest.current.background(t) : (latest.current.background as string)),
    });
    graph.current = g;
    return () => {
      g.destroy();
      graph.current = null;
    };
    // (`theme` is not a dependency: it is changed in place, below)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, strips, weeks, lite, templatesUrl, custom]);

  useEffect(() => {
    graph.current?.setTheme(theme ?? "auto");
  }, [theme]);

  return <div ref={host} className={className} style={style} />;
}
