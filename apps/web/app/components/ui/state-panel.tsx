import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { Frame } from "./frame";
import { Glyph } from "./glyphs";
import { StatusTag } from "./status-tag";

/** A grey block with a slow scan sweep (`.ds-skeleton`). Sized by `className`. Decorative: the parent announces the loading. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" data-slot="skeleton" className={cn("ds-skeleton h-4", className)} />;
}

interface StatePanelProps {
  state: "loading" | "empty" | "error";
  /** The headline. Required for empty and error; loading defaults to "Loading". */
  title?: string;
  /** One calm sentence: what happened and what to do. */
  description?: ReactNode;
  /** The micro code line, e.g. `ERR / 500` or `NO DATA / 000`. */
  code?: string;
  /** A recovery action (a retry button, a link home). */
  action?: ReactNode;
  /** The headline's level (default 3); pick the one that fits the page's outline, so a page whose h1 is followed by this panel uses 2, and a panel that is the page's content uses 1. */
  headingLevel?: 1 | 2 | 3 | 4;
  /** Gives the headline an id and makes it focusable by script (`tabIndex -1`), for a panel whose focus goes to its heading. */
  titleId?: string;
  className?: string;
}

/**
 * The three non-content states of a data view (docs/design-system.md, "States"). Loading is a polite live region with a
 * skeleton of the content's shape; empty says what is missing; error is an alert with a code, a plain sentence and a way out.
 * None of them blames the user, and none relies on colour.
 */
export function StatePanel({ state, title, description, code, action, headingLevel = 3, titleId, className }: StatePanelProps) {
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3" | "h4";
  if (state === "loading") {
    return (
      <Frame role="status" aria-busy="true" data-state="loading" className={cn("flex flex-col gap-3", className)}>
        <span className="ds-micro">{code ?? "LOADING / ----"}</span>
        <span className="sr-only">{title ?? "Loading"}</span>
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-6 w-4/5" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-3/5" />
      </Frame>
    );
  }
  const isError = state === "error";
  return (
    <Frame role={isError ? "alert" : undefined} data-state={state} variant={isError ? "active" : "plain"} className={cn("flex flex-col items-start gap-3", className)}>
      <div className="flex w-full items-center justify-between gap-3">
        <span className="ds-micro">{code ?? (isError ? "ERR / ---" : "NO DATA / 000")}</span>
        {isError && <StatusTag status="error" />}
      </div>
      <div className="ds-grid-bg flex h-16 w-full items-center justify-center border border-border text-muted-foreground">
        <Glyph name={isError ? "close" : "place"} size={24} />
      </div>
      <Heading id={titleId} tabIndex={titleId ? -1 : undefined} className="m-0 text-lg font-medium tracking-tight outline-offset-4">
        {title}
      </Heading>
      {description && <p className="m-0 text-sm text-muted-foreground">{description}</p>}
      {action}
    </Frame>
  );
}
