import { Link } from "react-router";
import type { ContentKind } from "@catalyst/schemas";
import { EntryListCard } from "~/components/entry/entry-list-card";
import { Button, Glyph, Grid, KindTag, MicroLabel, StatePanel } from "~/components/ui";
import { KIND_LABELS, KIND_PLURALS, type EntrySummary } from "~/lib/entries";

/**
 * `/projects`, `/articles`, `/artworks`, `/poems`: a grid of entry cards (cover, kind, code, date, summary, tags), each linking to the
 * entry's route (which opens in the shell's side panel); an intentional empty state when the collection has nothing yet. Each card
 * keeps the entry's slug as its anchor id (`/articles#slug`).
 */
export function EntryListPage({ kind, items }: { kind: ContentKind; items: EntrySummary[] }) {
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-6 pt-[calc(var(--navbar-height)+3rem)] pb-24 outline-none">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <KindTag kind={kind} iconOnly />
          <MicroLabel tone="strong">{KIND_LABELS[kind]} / Index</MicroLabel>
        </div>
        <h1 className="m-0 text-3xl font-semibold tracking-tight md:text-4xl">{KIND_PLURALS[kind]}</h1>
        <MicroLabel>
          {String(items.length).padStart(3, "0")} {items.length === 1 ? "entry" : "entries"}
        </MicroLabel>
      </header>
      <div className="mt-10">
        {items.length === 0 ? (
          <StatePanel
            state="empty"
            headingLevel={2}
            code={`${KIND_LABELS[kind]} / 000`.toUpperCase()}
            title="Nothing here yet"
            description={`No ${KIND_PLURALS[kind].toLowerCase()} are published. They appear here as soon as there are some.`}
            action={
              <Button asChild variant="secondary">
                <Link to="/">
                  <Glyph name="arrow-left" size={16} />
                  Back to the globe
                </Link>
              </Button>
            }
            className="max-w-xl"
          />
        ) : (
          <Grid role="list" aria-label={KIND_PLURALS[kind]}>
            {items.map((entry) => (
              <div key={entry.slug} role="listitem" className="ds-col min-w-0 scroll-mt-24" style={{ "--span": 12, "--span-md": 6 } as React.CSSProperties}>
                <EntryListCard entry={entry} />
              </div>
            ))}
          </Grid>
        )}
      </div>
    </main>
  );
}
