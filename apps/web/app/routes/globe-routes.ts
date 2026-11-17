import { getProjection } from "~/lib/content.server";
import { globeRoutesJson } from "~/lib/globe-routes";
import { STATIC_SECURITY_HEADERS } from "~/lib/security-headers";

/**
 * `/globe-routes.json` (a resource route: no UI): the routes' polylines, resolved to points, that the globe draws (172 kB: more than the rest of the shell's data together).
 * Development serves it as it is. The build prerenders it and `scripts/prerender/seal-csp.mts` moves the file to its content-named address (`lib/globe-routes.ts`), where
 * the globe fetches it from: a static file the CDN serves, not a function.
 */
export async function loader() {
  return new Response(globeRoutesJson(await getProjection()), {
    headers: { ...STATIC_SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}
