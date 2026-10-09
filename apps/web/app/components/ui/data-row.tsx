import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "~/lib/utils";

/** A definition list of `KEY ........ value` rows (docs/design-system.md, "Data rows"). */
export function DataList({ className, children, ...props }: HTMLAttributes<HTMLDListElement>) {
  return (
    <dl data-slot="data-list" className={cn("m-0", className)} {...props}>
      {children}
    </dl>
  );
}

interface DataRowProps {
  label: ReactNode;
  children: ReactNode;
  /** Values that are numbers, codes or dates read best in the mono face. */
  mono?: boolean;
  className?: string;
}

/** One row. The dotted leader between key and value is drawn by CSS (`.ds-data-row`), so the markup is a plain `dl > div > dt + dd`. */
export function DataRow({ label, children, mono, className }: DataRowProps) {
  return (
    <div data-slot="data-row" className={cn("ds-data-row", className)}>
      <dt className="ds-micro">{label}</dt>
      <dd className={cn("text-sm", mono && "font-mono tabular-nums")}>{children}</dd>
    </div>
  );
}
