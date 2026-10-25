import { useContext } from "react";
import { UNSAFE_DataRouterStateContext } from "react-router";
import type { ContentKind } from "@catalyst/schemas";

/**
 * How many entries each section holds (the root loader's `counts`), for the header's Sections sheet. Read from the data router's state, which
 * is absent (null, not an error) where there is no data router: a component rendered alone in a test, or an error boundary. A section whose
 * count is not a number is simply absent: the sheet then lists it without one.
 */
export function useSectionCounts(): Partial<Record<ContentKind, number>> | null {
  const state = useContext(UNSAFE_DataRouterStateContext);
  const counts = (state?.loaderData?.root as { counts?: unknown } | undefined)?.counts;
  return counts && typeof counts === "object" ? (counts as Partial<Record<ContentKind, number>>) : null;
}
