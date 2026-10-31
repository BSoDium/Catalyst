import type { ReactNode } from "react";
import { Link } from "react-router";
import type { EntryKind } from "~/lib/entry-kind";
import { cn } from "~/lib/utils";
import { CoverArt } from "./cover-art";
import { KindTag } from "./kind-tag";
import { MetadataStrip } from "./metadata-strip";
import { SensitiveMedia } from "./sensitive-media";
import { StatusTag } from "./status-tag";
import { TagList } from "./tag-list";

interface EntryCardProps {
  kind: EntryKind;
  /** Say the kind ("Article") above the title: only where kinds are mixed (the related entries); a list of articles does not repeat it on every card. */
  showKind?: boolean;
  title: string;
  summary?: string;
  /** Where the card goes. The title is the one link; the whole card is its hit area. */
  href?: string;
  /** An authored image; without one the cover is generated from `seed` (default: the title). */
  image?: { src: string; alt: string; srcSet?: string; sizes?: string };
  /** Mature content: the image is blurred for good and the card says why (no control: the visitor opens the entry to reveal). */
  sensitive?: boolean;
  seed?: string;
  meta?: readonly { label: string; value: ReactNode }[];
  /** Plain tags under the metadata (not links: the card is one link). */
  tags?: readonly string[];
  status?: string;
  /** Router state handed to the link (the place panel sets where the visitor came from). */
  linkState?: unknown;
  /** An anchor id for the card (the list pages use the entry's slug). */
  id?: string;
  /** Heading level of the title; pick the one that fits the page's outline. */
  headingLevel?: 2 | 3 | 4;
  /**
   * `horizontal`: the cover beside the text once the nearest `@container` ancestor is 28 rem wide (the place panel's rows); it stacks
   * below that. Default `vertical`: the cover on top (the grids).
   */
  orientation?: "vertical" | "horizontal";
  /** The first cards of a page: the image loads at once instead of lazily. */
  priority?: boolean;
  className?: string;
}

/** Tags shown on a card: the entry's page has them all, and they are links there. */
const CARD_TAGS = 3;

/**
 * A card for a list of entries (docs/design-system.md, "Entry card"): no box. A cover (authored image, or generated; blurred and labelled
 * "Mature content" when the entry is sensitive), the title, a
 * short summary, then the date and place as two plain lines and the first tags as muted text. One link (the title) stretched over the
 * card by a pseudo-element, so the whole card is clickable and the tab order still has a single stop per card.
 */
export function EntryCard({ kind, showKind, title, summary, href, image, sensitive, seed, meta, tags, status, linkState, id, headingLevel = 3, orientation = "vertical", priority, className }: EntryCardProps) {
  const horizontal = orientation === "horizontal";
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  const link = href ? (
    href.startsWith("/") ? (
      <Link to={href} state={linkState} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
        {title}
      </Link>
    ) : (
      <a href={href} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
        {title}
      </a>
    )
  ) : (
    title
  );
  const shownTags = tags?.slice(0, CARD_TAGS) ?? [];
  return (
    <article id={id} data-slot="entry-card" data-kind={kind} data-orientation={orientation} className={cn("ds-card flex min-w-0 flex-col gap-4", horizontal && "@md:flex-row", className)}>
      <div className={cn("overflow-hidden outline outline-1 -outline-offset-1 outline-border", horizontal && "@md:w-[38%] @md:shrink-0")}>
        {image && sensitive ? (
          // The frame is its own size container, so the `@md` of the place panel's card is applied to the frame, outside it.
          <SensitiveMedia className={horizontal ? "@md:h-full" : undefined}>
            <img src={image.src} srcSet={image.srcSet} sizes={image.sizes} alt={image.alt} loading={priority ? "eager" : "lazy"} decoding="async" className="aspect-video size-full object-cover" />
          </SensitiveMedia>
        ) : image ? (
          <img
            src={image.src}
            srcSet={image.srcSet}
            sizes={image.sizes}
            alt={image.alt}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            className={cn("aspect-video w-full object-cover", horizontal && "@md:h-full @md:min-h-full")}
          />
        ) : (
          <CoverArt seed={seed ?? title} kind={kind} cols={48} rows={27} className={horizontal ? "@md:h-full" : undefined} />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {showKind && <KindTag kind={kind} />}
        <Heading data-slot="entry-card-title" className="m-0 font-display text-xl leading-[1.1] font-bold tracking-[-0.02em] text-balance">
          {link}
        </Heading>
        {summary && <p className="m-0 line-clamp-3 text-base text-pretty text-muted-foreground">{summary}</p>}
        <div className="mt-auto flex flex-col gap-1 pt-1">
          {status && <StatusTag status={status} />}
          {meta && meta.length > 0 && <MetadataStrip items={meta} />}
          {shownTags.length > 0 && <TagList label="Tags" tags={shownTags.map((label) => ({ label }))} />}
        </div>
      </div>
    </article>
  );
}
