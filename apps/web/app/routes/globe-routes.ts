import { getProjection } from "~/lib/content.server";
import { resolveRoutes } from "~/lib/projection";
import { STATIC_SECURITY_HEADERS } from "~/lib/security-headers";

/**
 * `/globe-routes.json` (a resource route: no UI): the routes' polylines, resolved to points, that the globe draws (172 kB: more than the rest of the shell's data together).
 * Prerendered at build (`react-router.config.ts`), so it is a static file; in development and on a build without prerendering it is rendered per request.
 */
export async function loader() {
  return new Response(JSON.stringify(resolveRoutes(await getProjection())), {
    headers: { ...STATIC_SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}
