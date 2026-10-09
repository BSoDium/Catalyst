import { DEFAULT_SHARE_IMAGE, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "./site";

export interface PageMeta {
  /** The page's own name; the title becomes `<title> · Catalyst`. Absent = the home title (`SITE_TITLE`). */
  title?: string;
  description?: string;
  /** `website` (default) or `article`. */
  type?: "website" | "article";
  /** An entry's authored cover (a `/media/` path). Used as the share image when scrapers can read its format, else the site's default image. */
  image?: { src: string; alt?: string; width?: number; height?: number };
  /** The site's origin (`https://v2.bsodium.fr`): every URL in the tags is made absolute with it. Without it the paths stay as they are. */
  origin?: string;
  /** The page's path (`/articles/x`, no query): the canonical URL and `og:url`. Absent = no canonical tag. */
  path?: string;
  /** Keep the page out of search engines (not-found pages). */
  noindex?: boolean;
  /** Articles: the authored date (a partial ISO date) and the tags. */
  publishedTime?: string;
  tags?: readonly string[];
  /** Structured data, one JSON-LD object (see `json-ld.ts`). */
  jsonLd?: object;
}

export type MetaDescriptor =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string }
  | { tagName: "link"; rel: string; href: string }
  | { "script:ld+json": object };

/** The absolute URL of a site path, or the path itself when the origin is unknown or unusable. */
export function absoluteUrl(path: string, origin: string | undefined): string {
  if (!origin) return path;
  try {
    return new URL(path, origin).href;
  } catch {
    return path;
  }
}

/** Formats that link-preview scrapers (Facebook, X, LinkedIn, Slack, iMessage) can read; an SVG cover shows nothing there. */
const SCRAPABLE = /\.(?:png|jpe?g|gif|webp)$/i;

export const isScrapableImage = (src: string) => SCRAPABLE.test(src);

/** The title of a page: `<Page> · Catalyst`, or the home title. */
export const pageTitle = (title?: string) => (title ? `${title} · ${SITE_NAME}` : SITE_TITLE);

/**
 * The canonical URL of a page: the origin and the path, nothing else (no query, no hash: `?view=full` is the same page). Without an
 * origin there is no canonical (a relative canonical is worse than none).
 */
export function canonicalUrl(path: string | undefined, origin: string | undefined): string | undefined {
  if (path === undefined || !origin) return undefined;
  return absoluteUrl(path.split(/[?#]/)[0] || "/", origin);
}

/**
 * Every head tag of a page: title, description, canonical, Open Graph, Twitter card and, when given, the robots hint and JSON-LD. Every
 * page has a share image: the entry's cover when it is a format scrapers read, else the default one (1200x630 PNG).
 */
export function pageMeta({ title, description = SITE_DESCRIPTION, type = "website", image, origin, path, noindex, publishedTime, tags, jsonLd }: PageMeta = {}): MetaDescriptor[] {
  const fullTitle = pageTitle(title);
  const canonical = canonicalUrl(path, origin);
  const useCover = image !== undefined && isScrapableImage(image.src);
  const share = useCover
    ? { src: image.src, alt: image.alt, width: image.width, height: image.height, type: undefined as string | undefined }
    : { src: DEFAULT_SHARE_IMAGE.path, alt: DEFAULT_SHARE_IMAGE.alt, width: DEFAULT_SHARE_IMAGE.width, height: DEFAULT_SHARE_IMAGE.height, type: DEFAULT_SHARE_IMAGE.type as string };
  const imageUrl = absoluteUrl(share.src, origin);
  return [
    { title: fullTitle },
    { name: "description", content: description },
    ...(noindex ? [{ name: "robots", content: "noindex" }] : []),
    ...(canonical ? [{ tagName: "link" as const, rel: "canonical", href: canonical }] : []),
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:type", content: type },
    { property: "og:title", content: fullTitle },
    { property: "og:description", content: description },
    { property: "og:locale", content: "en_US" },
    ...(canonical ? [{ property: "og:url", content: canonical }] : []),
    { property: "og:image", content: imageUrl },
    ...(share.type ? [{ property: "og:image:type", content: share.type }] : []),
    ...(share.width && share.height
      ? [
          { property: "og:image:width", content: String(share.width) },
          { property: "og:image:height", content: String(share.height) },
        ]
      : []),
    ...(share.alt ? [{ property: "og:image:alt", content: share.alt }] : []),
    ...(type === "article" && publishedTime ? [{ property: "article:published_time", content: publishedTime }] : []),
    ...(type === "article" ? (tags ?? []).map((t) => ({ property: "article:tag", content: t })) : []),
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: fullTitle },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: imageUrl },
    ...(share.alt ? [{ name: "twitter:image:alt", content: share.alt }] : []),
    ...(jsonLd ? [{ "script:ld+json": jsonLd }] : []),
  ];
}

interface MetaArgsLike {
  location: { pathname: string };
  matches: ReadonlyArray<{ id: string; loaderData?: unknown } | undefined>;
}

/**
 * What a route's `meta` needs from React Router's arguments: the site's origin (the root loader's `siteUrl`, so the server and the
 * client agree) and the path of the page. Spread it into `pageMeta`.
 */
export function metaBase(args: MetaArgsLike): { origin: string | undefined; path: string } {
  const root = args.matches.find((m) => m?.id === "root")?.loaderData as { siteUrl?: unknown } | undefined;
  return { origin: typeof root?.siteUrl === "string" ? root.siteUrl : undefined, path: args.location.pathname };
}
