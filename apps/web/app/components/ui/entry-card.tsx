import type { ReactNode } from "react";
import { Link } from "react-router";
import type { EntryKind } from "~/lib/entry-kind";
import { formatIndex } from "~/lib/labelling";
import { cn } from "~/lib/utils";
import { CoverArt } from "./cover-art";
import { Frame } from "./frame";
import { KindTag } from "./kind-tag";
import { MetadataStrip } from "./metadata-strip";
import { StatusTag } from "./status-tag";

interface EntryCardProps {
  kind: EntryKind;
  /** Position in the archive, shown as `KIND / 0042`. */
  index: number;
  title: string;
  summary?: string;
  /** Where the card goes. The title is the one link; the whole card is its hit area. */
  href?: string;
  /** An authored image; without one the cover is generated from `seed` (default: the title). */
  image?: { src: string; alt: string };
  seed?: string;
  meta?: readonly { label: string; value: ReactNode }[];
  status?: string;
  /** Heading level of the title; pick the one that fits the page's outline. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/**
 * A card for a list of entries (docs/design-system.md, "Entry card"): cover, kind tag and code, title, two-line summary,
 * metadata strip. One link (the title) stretched over the card by a pseudo-element, so the whole card is clickable and the
 * tab order still has a single stop per card.
 */
export function EntryCard({ kind, index, title, summary, href, image, seed, meta, status, headingLevel = 3, className }: EntryCardProps) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  const link = href ? (
    href.startsWith("/") ? (
      <Link to={href} className="outline-offset-4 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
        {title}
      </Link>
    ) : (
      <a href={href} className="outline-offset-4 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
        {title}
      </a>
    )
  ) : (
    title
  );
  return (
    <Frame as="article" data-kind={kind} interactive={!!href} padding="none" className={cn("flex min-w-0 flex-col", className)}>
      <div className="border-b border-border">
        {image ? (
          <img src={image.src} alt={image.alt} loading="lazy" decoding="async" className="aspect-video w-full object-cover" />
        ) : (
          <CoverArt seed={seed ?? title} kind={kind} />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <KindTag kind={kind} />
          <span className="ds-micro">№ {formatIndex(index)}</span>
        </div>
        <Heading className="m-0 text-xl font-semibold tracking-tight">{link}</Heading>
        {summary && <p className="m-0 line-clamp-2 text-sm text-muted-foreground">{summary}</p>}
        <div className="mt-auto flex flex-col gap-2 pt-1">
          {status && <StatusTag status={status} />}
          {meta && meta.length > 0 && <MetadataStrip items={meta} />}
        </div>
      </div>
    </Frame>
  );
}
