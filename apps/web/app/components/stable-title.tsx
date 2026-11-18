import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "~/lib/utils";

/**
 * A title whose line breaks do not change as its weight does (the carousels' titles go from the thinnest weight of the variable face to the heaviest as a card comes in, at the pace of the scroll:
 * `.place-gallery-title`, `.trip-slide [data-slot="trip-title"]` in app.css). Bricolage has no width axis, so a line is a little wider at a heavier weight, and a title near the width of its box broke at one
 * word at a weight and at another a few pixels of scroll later: the box changed height, and the card with it, while the visitor scrolled.
 *
 * The breaks are worked out ONCE, on an invisible copy at the heaviest weight (the widest, so a line that fits there fits at every weight), then the visible copy is set line by line, on those breaks,
 * and cannot wrap again. Until it is measured (the server's page, the first frame) the title is plain text, wrapping as it always did. `maxLines`: the lines past it are left out, the last one ending in an ellipsis.
 */
export function StableTitle({ text, className, maxLines, style, ...rest }: { text: string; className?: string; maxLines?: number; style?: CSSProperties } & Record<`data-${string}`, string | undefined>) {
  const ghost = useRef<HTMLSpanElement>(null);
  const [lines, setLines] = useState<string[] | null>(null);
  useLayoutEffect(() => {
    const el = ghost.current;
    const node = el?.firstChild;
    if (!el || !node || node.nodeType !== Node.TEXT_NODE) return;
    const measure = () => {
      const out: string[] = [];
      let top = Number.NaN;
      const range = document.createRange();
      for (const m of text.matchAll(/\S+\s*/g)) {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const rect = range.getClientRects()[0];
        if (!rect) continue;
        if (Number.isNaN(top) || rect.top - top > 2) {
          out.push(m[0]);
          top = rect.top;
        } else out[out.length - 1] += m[0];
      }
      const next = out.map((l) => l.trimEnd());
      setLines((prev) => (prev && prev.length === next.length && prev.every((l, i) => l === next[i]) ? prev : next));
    };
    measure();
    void document.fonts?.ready.then(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  const shown = lines && maxLines && lines.length > maxLines ? [...lines.slice(0, maxLines - 1), `${lines.slice(maxLines - 1).join(" ")}`] : lines;
  const ghostStyle: CSSProperties = { fontWeight: 800, letterSpacing: "-0.02em", opacity: 0, ...(maxLines ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: maxLines, overflow: "hidden" } : {}) };
  return (
    <span {...rest} className={cn("relative block", className)} style={style}>
      <span ref={ghost} aria-hidden="true" className={cn("pointer-events-none block", lines ? "" : "absolute inset-x-0 top-0")} style={lines ? ghostStyle : { ...ghostStyle, position: "absolute" }}>
        {text}
      </span>
      {lines ? (
        <>
        <span className="sr-only">{text}</span>
        <span aria-hidden="true" className="absolute inset-0 block overflow-hidden whitespace-pre">
          {shown!.map((l, i) => (
            <span key={i} className={cn("block", maxLines && i === maxLines - 1 && lines.length > maxLines ? "truncate" : "")}>
              {l}
            </span>
          ))}
        </span>
        </>
      ) : (
        <span className="block">{text}</span>
      )}
    </span>
  );
}
