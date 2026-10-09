import type { HTMLAttributes } from "react";
import { cn } from "~/lib/utils";

interface MicroLabelProps extends HTMLAttributes<HTMLElement> {
  as?: "span" | "p" | "div" | "dt" | "dd" | "h2" | "h3" | "h4" | "li" | "time";
  /** `muted` (default) for annotation, `strong` for the label that names the thing, `signal` for the one live accent. */
  tone?: "muted" | "strong" | "signal";
  dateTime?: string;
}

/**
 * The unit of the annotation language: mono, uppercase, tracked, tabular (`.ds-micro`). Codes ("ARTICLE / 0042"), coordinates,
 * timestamps, keys. 11 px is the floor; never use it for sentences (docs/design-system.md, "Micro-labels").
 */
export function MicroLabel({ as: Tag = "span", tone = "muted", className, ...props }: MicroLabelProps) {
  return <Tag data-slot="micro-label" data-tone={tone === "muted" ? undefined : tone} className={cn("ds-micro", className)} {...props} />;
}
