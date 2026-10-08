const SITE_NAME = "Catalyst";
const SITE_DESCRIPTION = "A personal archive organized around places.";

interface PageMeta {
  title?: string;
  description?: string;
  /** `website` (default) or `article`. */
  type?: "website" | "article";
  /** A share image, only ever an entry's authored cover (a `/media/` path). Absent = no image tags at all. */
  image?: { src: string; alt?: string };
  /** The site's origin (`https://v2.bsodium.fr`), to make the image URL absolute, as Open Graph wants. Without it the path is given as is. */
  origin?: string;
}

type MetaDescriptor = { title: string } | { name: string; content: string } | { property: string; content: string };

/** The absolute URL of a site path, or the path itself when the origin is unknown or unusable. */
export function absoluteUrl(path: string, origin: string | undefined): string {
  if (!origin) return path;
  try {
    return new URL(path, origin).href;
  } catch {
    return path;
  }
}

/** Title, description and Open Graph text tags; an image tag only when the page has an authored cover. */
export function pageMeta({ title, description = SITE_DESCRIPTION, type = "website", image, origin }: PageMeta = {}): MetaDescriptor[] {
  const fullTitle = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
  return [
    { title: fullTitle },
    { name: "description", content: description },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:type", content: type },
    { property: "og:title", content: fullTitle },
    { property: "og:description", content: description },
    ...(image
      ? [
          { property: "og:image", content: absoluteUrl(image.src, origin) },
          ...(image.alt ? [{ property: "og:image:alt", content: image.alt }] : []),
          { name: "twitter:card", content: "summary_large_image" },
        ]
      : []),
  ];
}
