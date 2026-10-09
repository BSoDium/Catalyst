import { Fragment, useMemo } from "react";
import type { PublishedBodyBlock } from "@catalyst/schemas";
import { CopyButton, Divider, Frame, Glyph, MicroLabel } from "~/components/ui";
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
 */
export function BlockRenderer({ blocks, lang, idPrefix = "body", className }: { blocks: readonly Block[]; lang?: string; idPrefix?: string; className?: string }) {
  const groups = useMemo(() => groupBlocks(blocks), [blocks]);
  const outline = useMemo(() => new Map(buildOutline(blocks, idPrefix).map((o) => [o.index, o])), [blocks, idPrefix]);
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
          <BlockView key={group.key} block={group.block} heading={outline.get(group.index)} />
        ),
      )}
    </div>
  );
}

/** Text with its hard line breaks as `<br>`. */
function Lines({ text }: { text: string }) {
  const lines = splitLines(text);
  const keys = dedupeKeys(lines, "-");
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={keys[i]}>
          {i > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </>
  );
}

function BlockView({ block, heading }: { block: Exclude<Block, { type: "link" }>; heading: OutlineItem | undefined }) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className="m-0 max-w-[48ch]">
          <Lines text={block.text} />
        </p>
      );
    case "heading":
      return heading ? <HeadingView item={heading} /> : null;
    case "list":
      return <ListView ordered={block.ordered} items={block.items} />;
    case "quote":
      return (
        <figure className="m-0 max-w-[48ch] border-l border-border-strong pl-4">
          <blockquote className="m-0 text-xl/8">
            <p className="m-0">
              <Lines text={block.text} />
            </p>
          </blockquote>
          {block.cite && <figcaption className="ds-micro mt-2">&mdash; {block.cite}</figcaption>}
        </figure>
      );
    case "image":
      return <ImageView block={block} />;
    case "verse":
      return <VerseView stanzas={block.stanzas} />;
    case "code":
      return <CodeView block={block} />;
    case "divider":
      return <Divider ticks decorative={false} className="my-1" />;
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
        "ds-heading group m-0 flex max-w-[48ch] scroll-mt-24 items-baseline gap-3 font-semibold tracking-tight text-balance",
        item.level === 2 ? "mt-4 border-t border-border pt-5 text-xl" : "mt-2 text-base",
      )}
    >
      <span aria-hidden="true" className="ds-micro shrink-0" data-tone="signal">
        &sect;&nbsp;{item.number}
      </span>
      <span className="min-w-0">{item.text}</span>
      {/* A link to the section, for sharing and for the keyboard: always there for assistive tech, drawn on hover and focus (always on touch screens). */}
      <a href={`#${item.id}`} aria-label={`Link to section: ${item.text}`} className="ds-anchor print:hidden">
        <Glyph name="hash" size={12} />
      </a>
    </Tag>
  );
}

function ListView({ ordered, items }: { ordered: boolean; items: readonly string[] }) {
  const Tag = ordered ? "ol" : "ul";
  const keys = dedupeKeys(items);
  return (
    <Tag className={cn("m-0 flex max-w-[48ch] flex-col gap-2 pl-6", ordered ? "list-decimal marker:font-mono marker:text-sm" : "list-[square]", "marker:text-muted-foreground")}>
      {items.map((item, i) => (
        <li key={keys[i]} className="pl-1">
          <Lines text={item} />
        </li>
      ))}
    </Tag>
  );
}

function ImageView({ block }: { block: Extract<Block, { type: "image" }> }) {
  const src = safeMediaSrc(block.src);
  if (!src) return null;
  const sized = block.width !== undefined && block.height !== undefined;
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      <div className={cn("overflow-hidden border border-border bg-accent", !sized && "aspect-4/3")}>
        <img
          src={src}
          alt={block.alt}
          width={block.width}
          height={block.height}
          loading="lazy"
          decoding="async"
          className={cn("block w-full", sized ? "h-auto" : "size-full object-contain")}
        />
      </div>
      {block.caption && <figcaption className="ds-micro">{block.caption}</figcaption>}
    </figure>
  );
}

/**
 * Stanzas of lines, in the mono face so that indentation lines up: each stanza is a paragraph, each line a block of its own with its
 * authored leading spaces as a left offset in `ch` (capped) and a hanging indent of 2ch for a line that wraps on a narrow screen.
 */
function VerseView({ stanzas }: { stanzas: readonly (readonly string[])[] }) {
  return (
    <div data-slot="verse" className="flex flex-col gap-6 font-mono text-[0.9375rem] leading-[1.7]">
      {stanzas.map((stanza, si) => {
        const keys = dedupeKeys(stanza);
        return (
          <p key={`stanza-${si}`} className="m-0 flex flex-col">
            {stanza.map((line, li) => {
              const { indent, text } = leadingIndent(line);
              return (
                <span key={keys[li]} className="block" style={{ paddingLeft: `${verseIndent(indent) + 2}ch`, textIndent: "-2ch" }}>
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
        <MicroLabel tone="strong">{block.language ?? "code"}</MicroLabel>
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
        {href && <MicroLabel>{displayHost(href)}</MicroLabel>}
      </span>
      {href && <Glyph name="arrow-up-right" size={16} className="mt-1 shrink-0" />}
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
