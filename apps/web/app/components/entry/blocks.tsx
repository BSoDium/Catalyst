import { Fragment, useMemo } from "react";
import type { PublishedBodyBlock } from "@catalyst/schemas";
import { CopyButton, Divider, Frame, Icon, SensitiveImage } from "~/components/ui";
import {
  buildOutline,
  dedupeKeys,
  displayHost,
  groupBlocks,
  leadingIndent,
  safeExternalUrl,
  safeMediaSrc,
  splitLines,
  verseIndent,
  type OutlineItem,
} from "~/lib/entry-blocks";
import { dropCapIndex, dropCapKind } from "~/lib/entry-typography";
import { figureId, figureInfo, linkableNumbers, linkFigureMentions, type FigureInfo } from "~/lib/figures";
import { FlowFigure } from "~/components/entry/figure";
import { cn } from "~/lib/utils";

type Block = PublishedBodyBlock;

/**
 * The renderer of an entry's body (docs/design-system.md, "Entry view"): the contract's typed blocks as semantic, accessible
 * markup in the HUD style. Everything is plain text: React escapes it, no HTML or markdown is interpreted and nothing here
 * sets inner HTML. Media paths and external URLs are checked again before use (`safeMediaSrc`, `safeExternalUrl`): a block
 * that fails the check is left out (image) or drawn as plain text (link), never as a live link. Pure decisions (grouping,
 * outline numbering, ids) are in `lib/entry-blocks.ts` and tested there.
 *
 * Headings are level 2 and 3 under the entry's own level 1 (the view's title); a `lang` (the poem's `Language` fact) is set on the body.
 * The type is the reading role's (`.ds-prose`, app.css): the markup carries no size, weight or measure of its own, so the entry
 * pages can set the body at the board's scale. `dropCap` opens the body's first paragraph with a drop cap when it is long enough
 * (`dropCapIndex`); images are numbered in the order they appear (`Fig. N` before a caption). `figures` (an article, a project) sets the images
 * as figures in the flow of the text (`FlowFigure`: wide, captioned, zoomable) and turns the text's own mentions of a captioned figure
 * ("Fig. 3") into links to it (`lib/figures.ts`).
 */
export function BlockRenderer({
  blocks,
  lang,
  idPrefix = "body",
  className,
  dropCap = false,
  figures = false,
}: {
  blocks: readonly Block[];
  lang?: string;
  idPrefix?: string;
  className?: string;
  dropCap?: boolean;
  figures?: boolean;
}) {
  const groups = useMemo(() => groupBlocks(blocks), [blocks]);
  const outline = useMemo(() => new Map(buildOutline(blocks, idPrefix).map((o) => [o.index, o])), [blocks, idPrefix]);
  const figureNumbers = useMemo(() => figureInfo(blocks), [blocks]);
  const linkable = useMemo(() => (figures ? linkableNumbers(figureNumbers) : new Set<number>()), [figures, figureNumbers]);
  const capped = dropCap ? dropCapIndex(blocks) : -1;
  if (groups.length === 0) return null;
  return (
    <div data-slot="entry-body" lang={lang} className={cn("ds-prose flex min-w-0 flex-col gap-6", className)}>
      {groups.map((group) =>
        group.type === "links" ? (
          <ul key={group.key} className="m-0 flex list-none flex-col gap-3 p-0">
            {group.blocks.map((block, i) => (
              <li key={`${group.key}-${i}`}>
                <LinkCard block={block} />
              </li>
            ))}
          </ul>
        ) : (
          <BlockView key={group.key} block={group.block} heading={outline.get(group.index)} dropCap={group.index === capped} figure={figureNumbers.get(group.index)} flow={figures} linkable={linkable} />
        ),
      )}
    </div>
  );
}

/** Text with its hard line breaks as `<br>`. With `linkable`, the mentions of those figures ("Fig. 3") are links to them (text unchanged). */
function Lines({ text, linkable }: { text: string; linkable?: ReadonlySet<number> }) {
  const lines = splitLines(text);
  const keys = dedupeKeys(lines, "-");
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={keys[i]}>
          {i > 0 && <br />}
          {linkable && linkable.size > 0 ? <FigureMentions text={line} linkable={linkable} /> : line}
        </Fragment>
      ))}
    </>
  );
}

/** A run of text with its mentions of a figure as in-page links: the link text is the mention as written, the target is the figure (`#fig-N`). */
function FigureMentions({ text, linkable }: { text: string; linkable: ReadonlySet<number> }) {
  return (
    <>
      {linkFigureMentions(text, linkable).map((run, i) =>
        run.figure === undefined ? (
          <Fragment key={i}>{run.text}</Fragment>
        ) : (
          <a key={i} href={`#${figureId(run.figure)}`} data-slot="figure-mention" className="entry-figref">
            {run.text}
          </a>
        ),
      )}
    </>
  );
}

function BlockView({
  block,
  heading,
  dropCap,
  figure,
  flow,
  linkable,
}: {
  block: Exclude<Block, { type: "link" }>;
  heading: OutlineItem | undefined;
  dropCap: boolean;
  figure: FigureInfo | undefined;
  flow: boolean;
  linkable: ReadonlySet<number>;
}) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className={cn("m-0", dropCap && "drop-cap")} data-drop-cap={dropCap ? (dropCapKind(block.text) ?? "plain") : undefined}>
          <Lines text={block.text} linkable={linkable} />
        </p>
      );
    case "heading":
      return heading ? <HeadingView item={heading} /> : null;
    case "list":
      return <ListView ordered={block.ordered} items={block.items} linkable={linkable} />;
    case "quote":
      return (
        <figure className="type-pullquote my-[0.4em]">
          <blockquote className="m-0">
            <p className="m-0">
              <Lines text={block.text} linkable={linkable} />
            </p>
          </blockquote>
          {block.cite && <figcaption className="ds-caption mt-3 not-italic">&mdash; {block.cite}</figcaption>}
        </figure>
      );
    case "image":
      return flow ? <FlowFigure block={block} number={figure?.number} /> : <ImageView block={block} number={figure?.number} />;
    case "verse":
      return <VerseView stanzas={block.stanzas} />;
    case "code":
      return <CodeView block={block} />;
    case "divider":
      return <Divider decorative={false} className="my-2" />;
    default: {
      const unreachable: never = block;
      return unreachable;
    }
  }
}

function HeadingView({ item }: { item: OutlineItem }) {
  const Tag = item.level === 2 ? "h2" : "h3";
  return (
    <Tag
      id={item.id}
      className={cn(
        "ds-heading group m-0 flex scroll-mt-24 items-baseline gap-2",
        item.level === 2 ? "mt-6" : "mt-3",
      )}
    >
      <span className="min-w-0">{item.text}</span>
      {/* A link to the section, for sharing and for the keyboard: always there for assistive tech, drawn on hover and focus (always on touch screens). */}
      <a href={`#${item.id}`} aria-label={`Link to section: ${item.text}`} className="ds-anchor print:hidden">
        <Icon name="hash" size="control" />
      </a>
    </Tag>
  );
}

function ListView({ ordered, items, linkable }: { ordered: boolean; items: readonly string[]; linkable: ReadonlySet<number> }) {
  const Tag = ordered ? "ol" : "ul";
  const keys = dedupeKeys(items);
  return (
    <Tag className={cn("m-0 flex flex-col gap-2 pl-6", ordered ? "list-decimal" : "list-[square]", "marker:text-muted-foreground")}>
      {items.map((item, i) => (
        <li key={keys[i]} className="pl-1">
          <Lines text={item} linkable={linkable} />
        </li>
      ))}
    </Tag>
  );
}

/** An image in the body of an artwork or a poem: a rule, the picture, a mono caption that starts with its number. (An article's and a project's are `FlowFigure`.) */
export function ImageView({ block, number }: { block: Extract<Block, { type: "image" }>; number?: number | undefined }) {
  const src = safeMediaSrc(block.src);
  if (!src) return null;
  const sized = block.width !== undefined && block.height !== undefined;
  return (
    <figure data-slot="entry-figure" className="entry-figure m-0 flex min-w-0 flex-col gap-2.5">
      <div className={cn("overflow-hidden", !sized && "aspect-4/3 bg-accent")}>
        {/* Inside a sensitive entry the image is blurred until the visitor asks (`SensitiveMediaScope` in the entry view); else it is just the image. */}
        <SensitiveImage className={sized ? undefined : "size-full"}>
          <img
            src={src}
            alt={block.alt}
            width={block.width}
            height={block.height}
            loading="lazy"
            decoding="async"
            className={cn("block w-full", sized ? "h-auto" : "size-full object-contain")}
          />
        </SensitiveImage>
      </div>
      {block.caption && (
        <figcaption className="ds-caption">
          {number !== undefined && <span className="text-foreground">Fig. {number} </span>}
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Stanzas of lines, in the page's own face (a poem is read, not coded): each stanza is a paragraph, each line a block of its own with its
 * authored leading spaces as a left offset in `ch` (capped) and a hanging indent of 2ch for a line that wraps on a narrow screen.
 */
function VerseView({ stanzas }: { stanzas: readonly (readonly string[])[] }) {
  return (
    <div data-slot="verse" className="flex flex-col gap-[1.4em]">
      {stanzas.map((stanza, si) => {
        const keys = dedupeKeys(stanza);
        return (
          <p key={`stanza-${si}`} className="m-0 flex flex-col">
            {stanza.map((line, li) => {
              const { indent, text } = leadingIndent(line);
              return (
                <span key={keys[li]} className="block text-pretty" style={{ paddingLeft: `${verseIndent(indent) + 2}ch`, textIndent: "-2ch" }}>
                  {text}
                </span>
              );
            })}
          </p>
        );
      })}
    </div>
  );
}

function CodeView({ block }: { block: Extract<Block, { type: "code" }> }) {
  return (
    <Frame role="figure" aria-label={block.language ? `Code, ${block.language}` : "Code"} padding="none" className="min-w-0">
      <div className="flex min-h-9 items-center justify-between gap-3 border-b border-border pr-1 pl-3 md:min-h-10">
        <span className="font-mono text-xs text-muted-foreground">{block.language ?? "code"}</span>
        <CopyButton text={block.code} label="Copy code" announcement="Code copied to the clipboard">
          Copy
        </CopyButton>
      </div>
      {/* Focusable so that the keyboard can scroll a line wider than the column. */}
      <pre tabIndex={0} className="m-0 overflow-x-auto p-4 font-mono text-[0.8125rem] leading-5">
        <code>{block.code}</code>
      </pre>
    </Frame>
  );
}

/** A block-level link card. The destination must pass `safeExternalUrl`; otherwise the card is plain text (no link). */
function LinkCard({ block }: { block: Extract<Block, { type: "link" }> }) {
  const href = safeExternalUrl(block.url);
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium">{block.title}</span>
        {block.description && <span className="text-sm text-muted-foreground">{block.description}</span>}
        {href && <span className="text-sm text-muted-foreground">{displayHost(href)}</span>}
      </span>
      {href && <Icon name="arrow-up-right" size="control" className="mt-0.5 shrink-0" />}
    </>
  );
  return (
    <Frame interactive={!!href} padding="none" className="min-w-0">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-start gap-3 p-4 no-underline focus-visible:outline-offset-4">
          {body}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        <div className="flex items-start gap-3 p-4">{body}</div>
      )}
    </Frame>
  );
}
