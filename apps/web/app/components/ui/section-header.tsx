import type { ReactNode } from "react";
import { formatIndex } from "~/lib/labelling";
import { cn } from "~/lib/utils";

interface SectionHeaderProps {
  /** The section's number (1-based), set as `01`. */
  index: number;
  title: string;
  /** The heading level; pick the one that fits the outline of the page or panel. */
  as?: "h2" | "h3" | "h4";
  id?: string;
  /** Right-aligned annotation: a count, a range, a control. */
  meta?: ReactNode;
  className?: string;
}

/** `01 OVERVIEW ------------ 3 ITEMS`: an index number, a heading in micro type, a rule that fills the row, an annotation. */
export function SectionHeader({ index, title, as: Heading = "h2", id, meta, className }: SectionHeaderProps) {
  return (
    <header data-slot="section-header" className={cn("flex items-center gap-3", className)}>
      <span aria-hidden="true" className="ds-micro" data-tone="signal">
        {formatIndex(index, 2)}
      </span>
      <Heading id={id} className="ds-micro m-0 font-normal" data-tone="strong">
        {title}
      </Heading>
      <span aria-hidden="true" className="ds-divider min-w-4 flex-1" />
      {meta && <span className="ds-micro">{meta}</span>}
    </header>
  );
}
