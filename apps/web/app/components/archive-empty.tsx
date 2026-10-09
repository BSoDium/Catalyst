import { Link } from "react-router";
import { Divider, Frame, Glyph, KindTag, MicroLabel, StatusTag } from "~/components/ui";
import { CONTENT_KINDS, KIND_PATHS, KIND_PLURALS } from "~/lib/entries";
import { formatIndex } from "~/lib/labelling";
import type { ContentKind } from "@catalyst/schemas";

/**
 * The home page when no place is published: the globe stays (sky, slow rotation, nothing marked) and this card, in the HUD
 * language of docs/design-system.md, says so and opens the four lists (which may hold entries even without places). It carries the
 * archive's real size (`counts`), so it never claims an emptiness that is not there. Bottom left, clear of the map's credits line.
 */
export function ArchiveEmpty({ counts }: { counts: Record<ContentKind, number> }) {
  const total = CONTENT_KINDS.reduce((n, kind) => n + counts[kind], 0);
  return (
    <aside
      aria-labelledby="archive-empty-title"
      data-slot="archive-empty"
      className="pointer-events-auto absolute bottom-24 left-4 z-10 w-[min(20rem,calc(100%-2rem))] max-md:w-[calc(100%-2rem)] md:bottom-14 md:left-6"
    >
      <Frame padding="md" className="bg-surface/90 backdrop-blur-sm">
        <div className="flex flex-col gap-3">
          <StatusTag status={`Archive / ${formatIndex(total, 3)} ${total === 1 ? "entry" : "entries"}`} tone="signal" />
          <Divider ticks />
          <h2 id="archive-empty-title" className="m-0 text-lg font-medium tracking-tight">
            Nothing on the globe yet
          </h2>
          <p className="m-0 text-sm text-muted-foreground max-md:hidden">
            {total > 0
              ? "No place is published yet, so the globe has no markers. The entries can already be read in their lists."
              : "Places appear here as markers as soon as they are published. The lists open as soon as there is something in them."}
          </p>
          <ul className="m-0 flex list-none flex-col p-0 max-md:grid max-md:grid-cols-2 max-md:gap-x-4">
            {CONTENT_KINDS.map((kind) => (
              <li key={kind} className="border-t border-border">
                <Link to={KIND_PATHS[kind]} className="ds-row flex min-h-11 items-center gap-3 py-2 text-sm no-underline">
                  <KindTag kind={kind} iconOnly />
                  <span className="min-w-0 flex-1 truncate">{KIND_PLURALS[kind]}</span>
                  <MicroLabel>{formatIndex(counts[kind], 3)}</MicroLabel>
                  <Glyph name="arrow-right" size={12} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Frame>
    </aside>
  );
}
