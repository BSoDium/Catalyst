/**
 * Pure helpers that turn a validated projection into the shapes the pages need.
 * No I/O here, so everything is unit-testable and safe to import anywhere.
 */
import type {
  ContentKind,
  PlaceSummary,
  PublishedContentItem,
  PublishedImage,
  PublishedPlace,
  PublishedProjection,
} from "@catalyst/schemas";
import { toPlaceSummary } from "@catalyst/schemas";
import type { GlobePlace, GlobeRoute } from "~/globe/types";
import { formatDates, type FormattedDates } from "./dates";

const KIND_PATHS: Record<ContentKind, string> = {
  project: "/projects",
  article: "/articles",
  artwork: "/artworks",
};

export const KIND_LABELS: Record<ContentKind, string> = {
  project: "Project",
  article: "Article",
  artwork: "Artwork",
};

const COLLECTIONS = { project: "projects", article: "articles", artwork: "artworks" } as const;

export const placePath = (slug: string) => `/locations/${slug}`;
export const relatedHref = (kind: ContentKind, slug: string) => `${KIND_PATHS[kind]}#${slug}`;

/** What the globe and the place list need: summaries only. */
export interface PlaceIndex {
  places: PlaceSummary[];
  globePlaces: GlobePlace[];
  routes: GlobeRoute[];
}

function toGlobePlace(place: PlaceSummary): GlobePlace {
  return {
    slug: place.slug,
    name: place.name,
    lat: place.coordinates.lat,
    lon: place.coordinates.lon,
    labelPriority: place.labelPriority,
    ...(place.viewRadiusKm !== undefined ? { viewRadiusKm: place.viewRadiusKm } : {}),
  };
}

/** Routes become ordered points. Stops that cannot be resolved are skipped; a route needs 2+ points. */
export function resolveRoutes(projection: PublishedProjection): GlobeRoute[] {
  const bySlug = new Map(projection.places.map((p) => [p.slug, p]));
  return projection.routes.flatMap((route) => {
    const points = route.stops.flatMap((slug) => {
      const place = bySlug.get(slug);
      return place ? [{ lat: place.coordinates.lat, lon: place.coordinates.lon }] : [];
    });
    return points.length >= 2 ? [{ id: route.id, title: route.title, points }] : [];
  });
}

export function buildPlaceIndex(projection: PublishedProjection): PlaceIndex {
  const places = projection.places.map(toPlaceSummary);
  return { places, globePlaces: places.map(toGlobePlace), routes: resolveRoutes(projection) };
}

interface RelatedLink {
  kind: ContentKind;
  slug: string;
  title: string;
  href: string;
}

export interface PlaceDetailData {
  slug: string;
  name: string;
  region?: string;
  summary?: string;
  dates: FormattedDates | null;
  body: string[];
  images: PublishedImage[];
  related: RelatedLink[];
}

/** Full place with related titles resolved. Unresolvable references are dropped. */
export function getPlaceDetail(projection: PublishedProjection, slug: string): PlaceDetailData | null {
  const place: PublishedPlace | undefined = projection.places.find((p) => p.slug === slug);
  if (!place) return null;
  const related = place.related.flatMap((ref) => {
    const item = projection[COLLECTIONS[ref.kind]].find((i) => i.slug === ref.slug);
    return item ? [{ kind: ref.kind, slug: ref.slug, title: item.title, href: relatedHref(ref.kind, ref.slug) }] : [];
  });
  return {
    slug: place.slug,
    name: place.name,
    region: place.region,
    summary: place.summary,
    dates: formatDates(place.dates),
    body: place.body,
    images: place.images,
    related,
  };
}

export interface ContentListItem {
  slug: string;
  title: string;
  summary?: string;
  date?: string;
  url?: string;
  places: { slug: string; name: string; href: string }[];
}

export function listContent(projection: PublishedProjection, kind: ContentKind): ContentListItem[] {
  const names = new Map(projection.places.map((p) => [p.slug, p.name]));
  return projection[COLLECTIONS[kind]].map((item: PublishedContentItem) => ({
    slug: item.slug,
    title: item.title,
    summary: item.summary,
    date: item.date,
    url: item.url,
    places: item.placeSlugs.flatMap((slug) => {
      const name = names.get(slug);
      return name ? [{ slug, name, href: placePath(slug) }] : [];
    }),
  }));
}

/** Width/height only when authored: never invented. */
export function imageSize(image: PublishedImage): { width: number; height: number } | null {
  return image.width && image.height ? { width: image.width, height: image.height } : null;
}
