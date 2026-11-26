import type { ReactNode } from "react";
import { markdownPath } from "~/lib/markdown-path";

/**
 * The plain-text version of the page it is on (#758): a visible link, for a person who wants the text and for the agents and the tools
 * that turn HTML into text and keep what they can see (`rel="alternate"`, as the head's `<link>`). A real document navigation to the
 * resource route (`routes/markdown.ts`), not a client-side one. Its words are its whole name (an `icon`, if given, is decoration). Its home is the site footer
 * (`components/site-footer.tsx`) of every page that has a twin; the home page has none (its head's `alternate` link and the header).
 */
export function MarkdownLink({ path, className, icon }: { path: string; className?: string; icon?: ReactNode }) {
  return (
    <a href={markdownPath(path)} rel="alternate" type="text/markdown" data-slot="markdown-link" className={className}>
      {icon}
      Read this page as Markdown
    </a>
  );
}
