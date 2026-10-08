import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "~/lib/utils";

const GAP = { 1: "gap-1", 2: "gap-2", 3: "gap-3", 4: "gap-4", 6: "gap-6", 8: "gap-8", 10: "gap-10" } as const;
type Gap = keyof typeof GAP;

interface StackProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "ul" | "ol" | "header" | "footer";
  /** Steps of the 4 px grid: 1 = 4 px, 2 = 8, 3 = 12, 4 = 16, 6 = 24, 8 = 32, 10 = 40. */
  gap?: Gap;
}

/** A vertical flow with a gap from the 4 px scale. */
export function Stack({ as: Tag = "div", gap = 4, className, ...props }: StackProps) {
  return <Tag data-slot="stack" className={cn("flex flex-col", GAP[gap], className)} {...props} />;
}

/** The panel grid: 12 columns, 16 px gutters (`--grid-gap`). Children are `Col`s (or any element that sets its own span). */
export function Grid({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="grid" className={cn("ds-grid", className)} {...props} />;
}

interface ColProps extends HTMLAttributes<HTMLDivElement> {
  /** Columns spanned below `md` (1 to 12, default 12). */
  span?: number;
  /** Columns spanned from `md` up (defaults to `span`). */
  spanMd?: number;
}

const clampSpan = (n: number) => Math.min(12, Math.max(1, Math.round(n)));

export function Col({ span = 12, spanMd, className, style, ...props }: ColProps) {
  const vars = { "--span": clampSpan(span), "--span-md": clampSpan(spanMd ?? span) } as CSSProperties;
  return <div data-slot="col" className={cn("ds-col min-w-0", className)} style={{ ...vars, ...style }} {...props} />;
}
