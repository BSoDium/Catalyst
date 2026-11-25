import type { Route } from "./+types/home";
import { DISPLAY_FONT_URL } from "~/lib/fonts";
import { websiteJsonLd } from "~/lib/json-ld";
import { metaBase, pageMeta } from "~/lib/meta";

export function meta(args: Route.MetaArgs) {
  const base = metaBase(args);
  return pageMeta({ ...base, markdown: true, jsonLd: base.origin ? websiteJsonLd(base.origin) : undefined });
}

/**
 * The display face is the only font preloaded, and only here: the home page is where the wordmark and the navigation are the
 * first text, and it is the page whose critical path has the least else on it. `crossOrigin` is required for a font even from the
 * same origin (the font fetch is anonymous CORS, a preload without it is fetched twice). The globe's chunks are not touched.
 */
export const links: Route.LinksFunction = () => [{ rel: "preload", href: DISPLAY_FONT_URL, as: "font", type: "font/woff2", crossOrigin: "anonymous" }];

/** The landing page is the shell itself (globe + place list); nothing renders in the panel slot. */
export default function Home() {
  return null;
}
