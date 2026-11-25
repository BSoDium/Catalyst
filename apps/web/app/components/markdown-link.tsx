import { markdownPath } from "~/lib/markdown-path";

/**
 * The plain-text version of the page it is on (#758): a visible link, for a person who wants the text and for the agents and the tools that turn HTML into text
 * and keep what they can see. A real document navigation to the resource route (`routes/markdown.ts`), not a client-side one; hidden when printed.
 */
export function MarkdownLink({ path, className }: { path: string; className?: string }) {
  return (
    <p data-slot="markdown-link" className={`type-meta text-muted-foreground print:hidden ${className ?? ""}`.trim()}>
      <a href={markdownPath(path)} rel="alternate" type="text/markdown" className="underline underline-offset-4 hover:text-foreground hover:no-underline">
        Read as Markdown
      </a>
    </p>
  );
}
