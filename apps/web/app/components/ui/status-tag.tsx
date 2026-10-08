import { statusText, type Status } from "~/lib/labelling";
import { cn } from "~/lib/utils";

type StatusTone = "default" | "muted" | "signal" | "solid" | "signal-solid";

const DEFAULT_TONE: Record<Status, StatusTone> = {
  published: "default",
  draft: "muted",
  live: "signal",
  archived: "muted",
  pending: "muted",
  error: "solid",
};

interface StatusTagProps {
  status: Status | (string & {});
  tone?: StatusTone;
  className?: string;
}

/**
 * `[ PUBLISHED ]`: the status as bracketed micro text. The WORD is the state; the tone (muted, signal, solid) only adds.
 * The brackets are decoration (`aria-hidden`), so a screen reader hears "Published".
 */
export function StatusTag({ status, tone, className }: StatusTagProps) {
  const resolved = tone ?? DEFAULT_TONE[status as Status] ?? "default";
  const solid = resolved === "solid" || resolved === "signal-solid";
  return (
    <span data-slot="status-tag" data-status={status} data-tone={resolved === "default" ? undefined : resolved} className={cn("ds-micro ds-status", className)}>
      <span aria-hidden="true">{solid ? "" : "["}</span>
      {status === "live" && <span aria-hidden="true" className="size-1.5 bg-current" />}
      {statusText(status)}
      <span aria-hidden="true">{solid ? "" : "]"}</span>
    </span>
  );
}
