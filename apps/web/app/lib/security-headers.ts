/**
 * Security and caching headers of the app's own responses. Pure (no `process`, no `Response`): `entry.server.tsx` applies them to every
 * HTML document and data response, `scripts/prod/check.mjs` verifies them against a production build, and `vercel.json` repeats the
 * static ones for what Vercel serves without our code (assets, media, icons). Each choice is explained in docs/web-architecture.md,
 * "Production readiness". Everything here is a policy: change it with the doc and the test beside it.
 */

/** Headers with the same value on every response, ours or Vercel's. Mirrored in `apps/web/vercel.json` (a test keeps the two equal). */
export const STATIC_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Everything the app has no use for is denied; `fullscreen` stays for its own pages.
  "Permissions-Policy":
    "accelerometer=(), autoplay=(), bluetooth=(), browsing-topics=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), serial=(), usb=(), xr-spatial-tracking=(), fullscreen=(self)",
  // Legacy twin of `frame-ancestors 'none'` (the CSP, which only HTML documents carry).
  "X-Frame-Options": "DENY",
  // No other origin gets a window handle to a Catalyst page (and vice versa). Nothing here opens popups or is opened as one.
  "Cross-Origin-Opener-Policy": "same-origin",
} as const;

/** What a CSP host source may be made of: a plain host name or IP (the URL parser lets `;`, `,` and a few more through in a host) and a port. */
const SAFE_ORIGIN = /^https?:\/\/(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/;

/**
 * The origin (`https://host:port`) of a URL, or null when it is not one. Strict on purpose: the result is written into a header, so
 * anything that could end a directive (`;`) or add a source (a space, a comma, a quote) makes it null.
 */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && SAFE_ORIGIN.test(u.origin) ? u.origin : null;
  } catch {
    return null;
  }
}

/** Origins from a list separated by spaces or commas (`CATALYST_CSP_CONNECT_EXTRA`); anything that is not an http(s) origin is dropped. */
export function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .map((v) => originOf(v.trim()))
    .filter((v): v is string => v !== null);
}

export interface CspInput {
  /** Fresh per response: marks the inline scripts React Router writes (`<ServerRouter nonce>`). */
  nonce: string;
  /** Origins the street map fetches tiles from: the primary TileJSON host and the fallback archive host (`getTilesConfig()`), plus `CATALYST_CSP_CONNECT_EXTRA`. */
  connectOrigins: readonly string[];
  /** `upgrade-insecure-requests`: only when the page itself came over https (it would break a plain-http local run). */
  upgradeInsecure: boolean;
}

/**
 * The Content-Security-Policy of an HTML document. Nothing is allowed by default (`default-src 'none'`); each directive lists what the
 * app really loads:
 *  - script-src: our own files plus the nonce of the inline scripts React Router writes (the router state, the module loader). No
 *    `unsafe-inline`, no `unsafe-eval`.
 *  - style-src: our stylesheet only. `style-src-attr 'unsafe-inline'` is separate on purpose: React and the label overlay put `style=""`
 *    on elements (positions, sizes, CSS variables), which cannot be hashed; no inline `<style>` element is allowed.
 *  - worker-src: MapLibre's tile worker is a file of ours, and `blob:` is its documented fallback.
 *  - connect-src: this origin (route data) and the tile hosts, nothing else.
 *  - img-src: ours, `data:` and `blob:` (canvas and map rasters). font-src: ours (the type is the system stack, so this is a guard).
 */
export function buildCsp({ nonce, connectOrigins, upgradeInsecure }: CspInput): string {
  const connect = ["'self'", ...new Set(connectOrigins)];
  const directives = [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(upgradeInsecure ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

/** The CSP of files that are not pages (`/media/*`: an SVG opened directly could otherwise run script). Mirrored in `vercel.json`. */
export const MEDIA_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; sandbox";

/** 128 random bits, base64: the CSP nonce. `crypto.getRandomValues` exists on Node 22 and every runtime Vercel offers. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * HTML documents are never shared-cached: each one carries a per-request CSP nonce (a cached copy would replay it to everyone and
 * void the policy), and the bundled projection they embed is cheap to render. `private` keeps the CDN out; `no-cache` makes browsers
 * revalidate (no `no-store`: the back/forward cache stays usable).
 */
export const HTML_CACHE_CONTROL = "private, no-cache";

/**
 * Client navigations fetch `*.data` responses (JSON, no nonce): shareable for a minute at the CDN, then served stale while refreshed in
 * the background. That matches the API projection's own 60 s reuse (`content.server.ts`); a deploy replaces the CDN's copies.
 */
export const DATA_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

export interface ResponsePolicyInput {
  nonce: string;
  connectOrigins: readonly string[];
  upgradeInsecure: boolean;
  /** The request is for the production host: otherwise `X-Robots-Tag: noindex` is added. */
  indexable: boolean;
  /** Vite dev server: no CSP (its inline preamble and HMR socket are not ours) and no caching headers. */
  dev: boolean;
}

/** Set the security headers (and, for documents, the CSP, the cache policy and the robots hint) on `headers`. */
export function applyDocumentHeaders(headers: Headers, { nonce, connectOrigins, upgradeInsecure, indexable, dev }: ResponsePolicyInput): void {
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) headers.set(name, value);
  if (!indexable) headers.set("X-Robots-Tag", "noindex, nofollow");
  if (dev) return;
  headers.set("Content-Security-Policy", buildCsp({ nonce, connectOrigins, upgradeInsecure }));
  headers.set("Cache-Control", HTML_CACHE_CONTROL);
}

/** Data responses: the static headers and, when `cache` is true and the route set none, the shared cache policy. */
export function applyDataHeaders(headers: Headers, { cache }: { cache: boolean }): void {
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) headers.set(name, value);
  if (cache && !headers.has("Cache-Control")) headers.set("Cache-Control", DATA_CACHE_CONTROL);
}

/** Only answers (200) and not-founds (404) are worth sharing: a redirect, a 5xx or a mutation result never is. Never on the dev server, where the preview file changes under it. */
export const isCacheableData = (status: number, dev: boolean): boolean => !dev && (status === 200 || status === 404);
