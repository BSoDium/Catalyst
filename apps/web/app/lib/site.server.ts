import { isIndexableHost, requestHost, resolveSiteUrl } from "./site";

let cached: string | undefined;

/** The origin of the site, `CATALYST_SITE_URL` (default `https://v2.bsodium.fr`), read once per process. Server only: pages get it from the root loader. */
export function getSiteUrl(): string {
  cached ??= resolveSiteUrl(process.env.CATALYST_SITE_URL, (m) => console.warn(m));
  return cached;
}

/** Whether this request is for the production site (see `isIndexableHost`): robots.txt, the `X-Robots-Tag` header and the sitemap follow it. */
export function isIndexableRequest(request: Request): boolean {
  return isIndexableHost({ siteUrl: getSiteUrl(), host: requestHost(request.headers), vercelEnv: process.env.VERCEL_ENV });
}
