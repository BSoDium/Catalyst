import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

interface MetadataItem {
  label: string;
  value: ReactNode;
}

/**
 * A strip of `LABEL / value` pairs between two hairlines: date, place, status, coordinates. A definition list, so a screen
 * reader hears the pairs; the items wrap on narrow screens. Values are text, not controls.
 */
export function MetadataStrip({ items, className }: { items: readonly MetadataItem[]; className?: string }) {
  return (
    <dl data-slot="metadata-strip" className={cn("ds-strip", className)}>
      {items.map((item) => (
        <div key={item.label}>
          <dt className="ds-micro">{item.label}</dt>
          <dd className="font-mono text-xs tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
