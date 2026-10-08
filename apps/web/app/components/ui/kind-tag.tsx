import { ENTRY_KIND_LABEL, type EntryKind } from "~/lib/entry-kind";
import { cn } from "~/lib/utils";
import { Glyph } from "./glyphs";

interface KindTagProps {
  kind: EntryKind;
  /** Glyph only; the word stays in the accessibility tree. For dense rows and the map's second line. */
  iconOnly?: boolean;
  /** Fill the glyph cell (the selected row). */
  solid?: boolean;
  className?: string;
}

/**
 * Kind coding: a square glyph cell and the kind's word. The glyph and the word say the kind; the faint hue behind the glyph
 * only repeats it, so nothing depends on colour (docs/design-system.md, "Kind coding").
 */
export function KindTag({ kind, iconOnly, solid, className }: KindTagProps) {
  return (
    <span data-slot="kind-tag" data-kind={kind} className={cn("inline-flex items-center gap-2", className)}>
      <span className="ds-kind-glyph" data-solid={solid ? "" : undefined}>
        <Glyph name={kind} />
      </span>
      <span className={iconOnly ? "sr-only" : "ds-micro"} data-tone={iconOnly ? undefined : "strong"}>
        {ENTRY_KIND_LABEL[kind]}
      </span>
    </span>
  );
}
