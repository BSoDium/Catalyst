import type { ContentMode } from "@catalyst/published";
import { devBadgeLabel } from "~/lib/dev-badge";

/**
 * DEV ONLY: tells the developer the page is showing preview (local, unpublished) or demo (placeholder) data.
 * `import.meta.env.DEV` is a build-time constant, so production bundles drop this component's body entirely.
 * Decorative and non-interactive: hidden from assistive technology, never intercepts pointer events.
 */
export function DevContentBadge({ mode }: { mode: ContentMode | null | undefined }) {
  const label = devBadgeLabel(mode, import.meta.env.DEV);
  if (!label) return null;
  return (
    <div
      aria-hidden="true"
      data-dev-content-badge={mode}
      className="pointer-events-none fixed bottom-2 left-2 z-50 select-none rounded-sm border border-border bg-background/80 px-1.5 py-0.5 font-mono text-[10px] leading-4 tracking-wide text-muted-foreground backdrop-blur-sm"
    >
      {label}
    </div>
  );
}
