import { Icon } from "~/components/ui/icon";
import { markdownPath } from "~/lib/markdown-path";

/**
 * Where the link stands. The label is always the same (the tile and the words, at the right edge of the column, closing the page); the
 * rule is where it can only be read as the page's own: `foot` (an entry under its notice, a place's panel) is a line of its own, a
 * hairline from the left edge that stops at the label, as the career page's "Updated" does; `inline` is the label only, laid into a row
 * that already has its rule (the career page's "Updated" line); `end` is the label only, at the end of a section list, whose rows are
 * already cut by hairlines: one more would read as an empty row under the last one, not as the page's closing line.
 */
export type MarkdownLinkPlacement = "foot" | "inline" | "end";

/**
 * The plain-text version of the page it is on (#758): a visible link, for a person who wants the text and for the agents and the tools that turn HTML into text
 * and keep what they can see. A real document navigation to the resource route (`routes/markdown.ts`), not a client-side one; hidden when printed.
 * The label is a small tile (a page's icon and ".md", the file it opens) and the words "Read as Markdown" in the meta capitals (app.css,
 * `.markdown-link`). The tile is decoration (`aria-hidden`): the words are the link's whole name, as they are its text.
 */
export function MarkdownLink({ path, placement = "foot", className }: { path: string; placement?: MarkdownLinkPlacement; className?: string }) {
  const Tag = placement === "inline" ? "span" : "p";
  return (
    <Tag data-slot="markdown-link" data-placement={placement} className={`markdown-link print:hidden ${className ?? ""}`.trim()}>
      <a href={markdownPath(path)} rel="alternate" type="text/markdown" className="markdown-link-anchor">
        <span aria-hidden="true" className="markdown-link-file">
          <Icon name="article" size="inline" />
          .md
        </span>
        <span className="type-meta">Read as Markdown</span>
      </a>
    </Tag>
  );
}
