/**
 * Reading aids of the entry view, as pure functions: the reading time computed from the body's text and the table of contents
 * taken from its headings (docs/design-system.md, "Entry view"). No markup, no I/O.
 */
import type { PublishedBodyBlock } from "@catalyst/schemas";
import { buildOutline, splitLines, type OutlineItem } from "./entry-blocks";

/** Words a minute of an adult reading prose on a screen (the usual 200 to 250). */
export const WORDS_PER_MINUTE = 220;

/** Words of one string: runs of letters or digits (an apostrophe or a hyphen inside a word does not split it). */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

/** The words a reader reads in a body: paragraphs, headings, list items, quotes (and their cite), captions of nothing: code, verse, images and links are left out. */
export function bodyWordCount(blocks: readonly PublishedBodyBlock[]): number {
  let words = 0;
  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
      case "heading":
        words += countWords(block.text);
        break;
      case "list":
        words += block.items.reduce((n, item) => n + countWords(item), 0);
        break;
      case "quote":
        words += countWords(block.text) + (block.cite ? countWords(block.cite) : 0);
        break;
      default:
        break;
    }
  }
  return words;
}

/** Whole minutes to read a body, at least 1 when there is any text to read, 0 when there is none. */
export function readingMinutes(blocks: readonly PublishedBodyBlock[], wordsPerMinute = WORDS_PER_MINUTE): number {
  const words = bodyWordCount(blocks);
  if (words === 0) return 0;
  return Math.max(1, Math.round(words / Math.max(1, wordsPerMinute)));
}

/** `6` -> `6 min read`; nothing to read gives null. */
export function formatReadingTime(minutes: number): string | null {
  return Number.isFinite(minutes) && minutes >= 1 ? `${Math.floor(minutes)} min read` : null;
}

/** The body has enough sections for a table of contents to be useful. */
export const TOC_MIN_ITEMS = 3;

/** The table of contents of a body: its numbered outline when it has at least `TOC_MIN_ITEMS` headings, else none (a short text needs no map). */
export function tocItems(blocks: readonly PublishedBodyBlock[], idPrefix = "body", min = TOC_MIN_ITEMS): OutlineItem[] {
  const outline = buildOutline(blocks, idPrefix);
  return outline.length >= min ? outline : [];
}

/**
 * The section being read: the last heading whose top has passed the reading line (`offset` px under the top of the scroller),
 * given each heading's distance from the top of the viewport. Before the first heading, the first one; no headings, null.
 */
export function activeSection(tops: readonly { id: string; top: number }[], offset: number): string | null {
  if (tops.length === 0) return null;
  let active = tops[0]!.id;
  for (const t of tops) {
    if (t.top - offset <= 0) active = t.id;
    else break;
  }
  return active;
}

/** Paragraph text with its hard breaks flattened, for any place that needs a one-line version (a share text, a title attribute). */
export function oneLine(text: string): string {
  return splitLines(text).join(" ").replace(/\s+/g, " ").trim();
}
