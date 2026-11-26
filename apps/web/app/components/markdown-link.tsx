import { markdownPath } from "~/lib/markdown-path";

/**
 * The plain-text version of the page it is on (#758): a visible link, for a person who wants the text and for the agents and the tools
 * that turn HTML into text and keep what they can see (`rel="alternate"`, as the head's `<link>`). A real document navigation to the
 * resource route (`routes/markdown.ts`), not a client-side one. Its words are its whole name. Its home is the site footer
 * (`components/site-footer.tsx`) of every page that has a twin; the home page has none (its head's `alternate` link and the header).
 */
export function MarkdownLink({ path, className }: { path: string; className?: string }) {
  return (
    <a href={markdownPath(path)} rel="alternate" type="text/markdown" data-slot="markdown-link" className={className}>
      This page in Markdown
    </a>
  );
}
