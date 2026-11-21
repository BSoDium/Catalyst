import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createActivityGraph } from "./index";
import { placeholderMarkup } from "./placeholder";
import type { ActivityGraph, GraphOptions } from "./types";

export interface ActivityGraphProps extends Omit<GraphOptions, "onHover" | "onReady" | "onLit" | "startup"> {
  className?: string;
  style?: CSSProperties;
  /** The aspect (width / height) the place-holder is drawn for, which is also the box's: default 3.97 for one strip, 0.8 for several. Known before the page has a size, so the server-rendered place-holder is the right shape. */
  aspect?: number;
  onHover?: GraphOptions["onHover"];
  onReady?: GraphOptions["onReady"];
  onLit?: GraphOptions["onLit"];
  startup?: GraphOptions["startup"];
}

/**
 * The graph as a component (with its place-holder, which is also rendered on the server): a `div` that fills with the picture (size it with `className` or `style`). The graph is rebuilt when `data`, `strips`, `weeks`, `lite`, `rodColor`'s presence or `templatesUrl` change; a new
 * `theme` only switches the theme. Callbacks and the other options are read when they are needed, so passing new closures does not rebuild anything.
 */
export function ActivityGraphView({ className, style, aspect, placeholder = true, ...options }: ActivityGraphProps) {
  // (the place-holder is rendered here, not by the core, so that it is in the server-rendered page; it fades out when the first picture is on screen)
  const [placeholderState, setPlaceholder] = useState<"shown" | "fading" | "gone">(placeholder ? "shown" : "gone");
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
    // (the place-holder, the canvas and the overlay are laid over one another in the box: it must be a positioned one)
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    const g = createActivityGraph(el, {
      ...o,
      onHover: (i) => latest.current.onHover?.(i),
      placeholder: false,
      onReady: () => {
        setPlaceholder((p) => (p === "shown" ? "fading" : p));
        latest.current.onReady?.();
      },
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

  useEffect(() => {
    if (placeholderState !== "fading") return;
    const t = window.setTimeout(() => setPlaceholder("gone"), 450);
    return () => window.clearTimeout(t);
  }, [placeholderState]);

  return (
    <div ref={host} className={className} style={style}>
      {placeholderState !== "gone" && (
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: placeholderState === "fading" ? 0 : 1, transition: "opacity .4s ease" }} dangerouslySetInnerHTML={{ __html: placeholderMarkup({ weeks: options.weeks, strips: options.strips, aspect }) }} />
      )}
    </div>
  );
}
