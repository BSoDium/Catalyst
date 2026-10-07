const SITE_NAME = "Catalyst";
const SITE_DESCRIPTION = "A personal archive organized around places.";

interface PageMeta {
  title?: string;
  description?: string;
}

type MetaDescriptor = { title: string } | { name: string; content: string } | { property: string; content: string };

/** Title, description and Open Graph text tags. No images, by design. */
export function pageMeta({ title, description = SITE_DESCRIPTION }: PageMeta = {}): MetaDescriptor[] {
  const fullTitle = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
  return [
    { title: fullTitle },
    { name: "description", content: description },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:type", content: "website" },
    { property: "og:title", content: fullTitle },
    { property: "og:description", content: description },
  ];
}
