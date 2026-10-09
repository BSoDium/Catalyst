/**
 * The site's identity: what the head tags, the sitemap, the robots file and the share cards say about it. Pure (no environment access):
 * `site.server.ts` reads `CATALYST_SITE_URL` and calls these. Documented in docs/web-architecture.md, "Production readiness".
 */
export const SITE_NAME = "Catalyst";
export const SITE_DESCRIPTION = "A personal archive organized around places.";
/** The home page's title: the template (`<Page> · Catalyst`) has no page to put first, so it says what the site is. */
export const SITE_TITLE = `${SITE_NAME} · A personal archive organized around places`;
/** The temporary main domain of the new site; `CATALYST_SITE_URL` overrides it (the owner's move to the final domain is that one variable). */
export const DEFAULT_SITE_URL = "https://v2.bsodium.fr";

/** The share image of every page that has no entry cover of its own (`public/og-default.png`, drawn by `scripts/brand/build.mjs`). */
export const DEFAULT_SHARE_IMAGE = {
  path: "/og-default.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "Catalyst: a wireframe globe with two places joined by a route, beside the words A personal archive organized around places.",
} as const;

/** The page colours of the two schemes (`--background` in app.css; a test keeps them equal): the browser UI's `theme-color`. */
export const THEME_COLORS = { light: "#fbfbfb", dark: "#0a0a0a" } as const;

/**
 * The origin of the site from a raw `CATALYST_SITE_URL`: trimmed, an empty value counts as unset, only `https:` (or `http:` for
 * localhost, to test a production build) is accepted, and whatever follows the origin (path, query, credentials) is dropped. A bad
 * value reports once through `warn` and the default is used: a typo must never break the pages.
 */
export function resolveSiteUrl(raw: string | undefined, warn: (message: string) => void = () => {}): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_SITE_URL;
  try {
    const u = new URL(value);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    if (u.protocol === "https:" || (u.protocol === "http:" && local)) return u.origin;
    warn(`[site] CATALYST_SITE_URL ignored (only https is accepted); using ${DEFAULT_SITE_URL}`);
  } catch {
    warn(`[site] CATALYST_SITE_URL ignored (not an absolute URL); using ${DEFAULT_SITE_URL}`);
  }
  return DEFAULT_SITE_URL;
}

/**
 * Whether search engines may index what this server answers. Only the production site itself: the request must come in on the host of
 * `siteUrl` (so the `*.vercel.app` address of the same deployment, a preview URL or localhost are all kept out) and Vercel must not say
 * the deployment is a preview or a development one.
 */
export function isIndexableHost({ siteUrl, host, vercelEnv }: { siteUrl: string; host: string | null | undefined; vercelEnv?: string | undefined }): boolean {
  if (vercelEnv === "preview" || vercelEnv === "development") return false;
  if (!host) return false;
  try {
    return host.trim().toLowerCase() === new URL(siteUrl).host.toLowerCase();
  } catch {
    return false;
  }
}

/** The host a request was addressed to: the proxy's `x-forwarded-host` (first value) when present, else `host`. */
export function requestHost(headers: Pick<Headers, "get">): string | null {
  return headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host");
}
