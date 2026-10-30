import { useContext } from "react";
import { UNSAFE_DataRouterStateContext } from "react-router";
import { contactRedirect } from "./contact";

/**
 * What the contact form needs from the router: where a plain HTML post returns to (the site's origin is the root loader's `siteUrl`),
 * and whether the visitor has just come back from one (`?sent=1`). Read from the data router's state, which is absent (no redirect,
 * not sent) where there is no data router: a component rendered alone in a test.
 */
export function useContactContext(): { redirect: string | undefined; sent: boolean } {
  const state = useContext(UNSAFE_DataRouterStateContext);
  const root = state?.loaderData?.root as { siteUrl?: unknown } | undefined;
  const siteUrl = typeof root?.siteUrl === "string" ? root.siteUrl : undefined;
  return { redirect: contactRedirect(siteUrl), sent: new URLSearchParams(state?.location.search ?? "").get("sent") === "1" };
}
