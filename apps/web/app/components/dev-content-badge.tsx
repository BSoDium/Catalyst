import type { ContentMode } from "@catalyst/published";
import { devBadgeLabel } from "~/lib/dev-badge";
import { MAP_CARD } from "~/lib/map-card";
import { cn } from "~/lib/utils";

/**
 * DEV ONLY: tells the developer the page is showing preview (local, unpublished) or demo (placeholder) data.
 * `import.meta.env.DEV` is a build-time constant, so production bundles drop this component's body entirely.
 * On phones it sits above the credits line (which takes the whole bottom edge there). Decorative and non-interactive: hidden from assistive technology, never intercepts pointer events.
 */
export function DevContentBadge({ mode }: { mode: ContentMode | null | undefined }) {
  const label = devBadgeLabel(mode, import.meta.env.DEV);
  if (!label) return null;
  return (
    <div
      aria-hidden="true"
      data-dev-content-badge={mode}
      className={cn(MAP_CARD, "pointer-events-none fixed bottom-2 left-2 max-md:bottom-10 z-50 select-none text-muted-foreground")}
    >
      {label}
    </div>
  );
}
