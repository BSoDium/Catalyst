import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

interface DividerProps {
  /** Hang a tick scale under the line (minor every 8 px, major every 40 px). */
  ticks?: boolean;
  /** A micro-label set into the line: `-- LABEL ----------`. */
  label?: ReactNode;
  /** Purely visual (default): hidden from assistive technology. Pass `false` where the rule separates content semantically. */
  decorative?: boolean;
  className?: string;
}

export function Divider({ ticks, label, decorative = true, className }: DividerProps) {
  if (label) {
    return (
      <div data-slot="divider" role={decorative ? undefined : "separator"} aria-hidden={decorative || undefined} className={cn("flex items-center gap-3", className)}>
        <span className="ds-micro">{label}</span>
        <span className="ds-divider flex-1" data-ticks={ticks ? "" : undefined} />
      </div>
    );
  }
  return decorative ? (
    <div data-slot="divider" aria-hidden="true" className={cn("ds-divider", className)} data-ticks={ticks ? "" : undefined} />
  ) : (
    <hr data-slot="divider" className={cn("ds-divider", className)} data-ticks={ticks ? "" : undefined} />
  );
}
