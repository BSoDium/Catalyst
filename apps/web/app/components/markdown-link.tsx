import type { ReactNode } from "react";
import { Icon } from "~/components/ui/icon";
import { markdownPath } from "~/lib/markdown-path";

/**
 * A link to a plain-text file of the site, drawn as the file and what it is for: a small tile (a page's icon and the file's name or
 * extension, `.md`, `llms.txt`) and the words in the meta capitals (app.css, `.file-link`). The tile is decoration (`aria-hidden`): the
 * words are the link's whole name, as they are its text. A real document navigation (the files are resource routes, not pages of the
 * app), hidden when printed. The site footer (`components/site-footer.tsx`) is its one home.
 */
export function FileLink({ href, type, file, rel, slot, children }: { href: string; type: string; file: string; rel?: string; slot?: string; children: ReactNode }) {
  return (
    <a href={href} rel={rel} type={type} data-slot={slot} className="file-link print:hidden">
      <span aria-hidden="true" className="file-link-tile">
        <Icon name="article" size="inline" />
        {file}
      </span>
      <span className="type-meta">{children}</span>
    </a>
  );
}

/**
 * The plain-text version of the page it is on (#758): a visible link, for a person who wants the text and for the agents and the tools
 * that turn HTML into text and keep what they can see (`rel="alternate"`, as the head's `<link>`). In the site footer of every page that
 * has a twin (the lists, the career page, an entry, a place); the home page has none (its head's `alternate` link and the header).
 */
export function MarkdownLink({ path }: { path: string }) {
  return (
    <FileLink href={markdownPath(path)} rel="alternate" type="text/markdown" file=".md" slot="markdown-link">
      Read as Markdown
    </FileLink>
  );
}
