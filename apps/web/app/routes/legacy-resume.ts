import { redirect } from "react-router";
import { LEGACY_REDIRECT_STATUS, legacyResumeTarget } from "~/lib/legacy-paths";
import { STATIC_SECURITY_HEADERS } from "~/lib/security-headers";

/**
 * `/resume`, the first version's address of the CV, now the career page (`/career`): a permanent redirect answered by the server before any
 * page is built, same shape and cache policy as `legacy-projects.ts` (issue #423).
 */
export function loader({ request }: { request: Request }) {
  const { pathname, search } = new URL(request.url);
  const target = legacyResumeTarget(pathname, search);
  if (!target) throw new Response("Not Found", { status: 404 });
  return redirect(target, {
    status: LEGACY_REDIRECT_STATUS,
    headers: { ...STATIC_SECURITY_HEADERS, "Cache-Control": "public, max-age=3600, s-maxage=86400" },
  });
}
