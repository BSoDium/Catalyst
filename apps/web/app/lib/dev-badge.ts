import type { ContentMode } from "@catalyst/published";

/** Text of the dev-only content badge, or null when no badge applies (published content, or not a dev build). */
export function devBadgeLabel(mode: ContentMode | null | undefined, isDev: boolean): string | null {
  if (!isDev) return null;
  if (mode === "preview") return "PREVIEW · local data · not published";
  if (mode === "demo") return "DEMO · placeholder data";
  return null;
}
