import type { ShouldRevalidateFunctionArgs } from "react-router";

/**
 * The entry (its body included) is reloaded when the path changes, never when only the query does: toggling the container
 * (`?view=full`) must not fetch the same entry again.
 */
export function entryShouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs): boolean {
  if (currentUrl.pathname === nextUrl.pathname) return false;
  return defaultShouldRevalidate;
}
