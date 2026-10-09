/**
 * Pure parts of the entry body renderer (`components/entry/blocks.tsx`): everything that is decided before any markup is
 * drawn. The blocks come from the published contract (docs/api-contract.md, "Body blocks"): a flat list of typed, plain-text
 * blocks. Nothing here interprets HTML or markdown, and nothing returns markup.
 */
import type { PublishedBodyBlock } from "@catalyst/schemas";

type Block = PublishedBodyBlock;

/** A paragraph's hard line breaks: the text split at each line feed (the contract allows line feeds in paragraphs, list items and quotes). */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** `"    an indented line"` -> `{ indent: 4, text: "an indented line" }`. Spaces and no-break spaces count one each; a verse line is never trimmed otherwise. */
export function leadingIndent(line: string): { indent: number; text: string } {
  const match = /^[  ]*/.exec(line);
  const indent = match ? match[0].length : 0;
  return { indent, text: line.slice(indent) };
}

/** Indentation of a verse line in `ch`, capped so that a hostile line cannot push its text out of the column (a line is 300 characters at most). */
export const MAX_VERSE_INDENT = 24;
export const verseIndent = (indent: number) => Math.min(MAX_VERSE_INDENT, Math.max(0, Math.floor(indent)));

/** Lowercase ASCII slug of a heading's text, for an anchor id: accents folded, anything else dropped; never empty. */
export function slugifyHeading(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "section";
}

/**
 * Makes a list of keys (or ids) unique while keeping them stable: the first occurrence keeps its text, the next ones get `-2`,
 * `-3`, ... in order. Inserting a block elsewhere does not rename the others (unlike an index-based key), and a repeated text
 * never collides. Pure and deterministic, so the server and the browser agree.
 */
export function dedupeKeys(bases: readonly string[], separator = "-"): string[] {
  const seen = new Map<string, number>();
  const used = new Set<string>();
  return bases.map((base) => {
    let n = (seen.get(base) ?? 0) + 1;
    let key = n === 1 ? base : `${base}${separator}${n}`;
    // A generated key can collide with a later literal one (`a-2` as text): keep counting until it is free.
    while (used.has(key)) {
      n += 1;
      key = `${base}${separator}${n}`;
    }
    seen.set(base, n);
    used.add(key);
    return key;
  });
}

export interface OutlineItem {
  /** Index of the heading block in the body. */
  index: number;
  /** The level drawn: the authored one, except that a level 3 before any level 2 is drawn as 2 (the outline never skips a level under the title's 1). */
  level: 2 | 3;
  /** `1`, `2` for a level 2; `1.1`, `1.2` for a level 3 under it. */
  number: string;
  text: string;
  /** Anchor id, unique in the body. */
  id: string;
}

/** The numbered outline of a body: one item per heading block, in order. `idPrefix` keeps the ids apart from other ids of the page. */
export function buildOutline(blocks: readonly Block[], idPrefix = "section"): OutlineItem[] {
  const headings: { index: number; authored: 2 | 3; text: string }[] = [];
  blocks.forEach((b, index) => {
    if (b.type === "heading") headings.push({ index, authored: b.level, text: b.text });
  });
  const ids = dedupeKeys(headings.map((h) => `${idPrefix}-${slugifyHeading(h.text)}`));
  let major = 0;
  let minor = 0;
  return headings.map((h, i) => {
    const level: 2 | 3 = h.authored === 3 && major > 0 ? 3 : 2;
    if (level === 2) {
      major += 1;
      minor = 0;
    } else {
      minor += 1;
    }
    return { index: h.index, level, number: level === 2 ? String(major) : `${major}.${minor}`, text: h.text, id: ids[i]! };
  });
}

/** One unit of the rendered body: a single block, or a run of consecutive link cards (drawn as one list). */
export type BlockGroup =
  | { type: "block"; key: string; index: number; block: Exclude<Block, { type: "link" }> }
  | { type: "links"; key: string; index: number; blocks: Extract<Block, { type: "link" }>[] };

/**
 * Groups a body for drawing. Consecutive link blocks become one group (a list of link cards, so a screen reader announces "list,
 * 3 items"). A divider that opens the body, closes it or repeats the previous one is dropped: a thematic break between
 * nothing and something is only noise. Keys are unique and stable (`paragraph-0`, `links-5`): the type and the index of the
 * first block of the group.
 */
export function groupBlocks(blocks: readonly Block[]): BlockGroup[] {
  const out: BlockGroup[] = [];
  blocks.forEach((block, index) => {
    if (block.type === "link") {
      const last = out[out.length - 1];
      if (last?.type === "links") last.blocks.push(block);
      else out.push({ type: "links", key: `links-${index}`, index, blocks: [block] });
      return;
    }
    if (block.type === "divider") {
      const last = out[out.length - 1];
      if (!last || (last.type === "block" && last.block.type === "divider")) return;
    }
    out.push({ type: "block", key: `${block.type}-${index}`, index, block });
  });
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    if (last.type === "block" && last.block.type === "divider") out.pop();
    else break;
  }
  return out;
}

/**
 * The media path of an image block or cover, or `null`. The contract already refuses anything but `/media/<plain file names>`,
 * and the renderer checks again (defence in depth: it must be safe with data that did not come through the schema): one leading
 * slash, no scheme, no `..`/`.` segment, no backslash, no query or fragment trick, no control character.
 */
export function safeMediaSrc(src: string): string | null {
  if (!/^\/media\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(src) || src.length > 300) return null;
  return src;
}

/** An external destination for a link block or an entry's `url`: https only, no credentials, no whitespace or control character. Returns the normalised URL, or `null`. */
export function safeExternalUrl(raw: string): string | null {
  if (raw.length > 2000 || /[\s\u0000-\u001F\u007F‪-‮⁦-⁩]/u.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hostname === "") return null;
    return url.href;
  } catch {
    return null;
  }
}

/** `https://www.example.org/a/b` -> `example.org`: the host shown on a link card, without a leading `www.`. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
