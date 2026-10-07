/**
 * Pure helpers that turn a validated projection into the shapes the pages need.
 * No I/O here, so everything is unit-testable and safe to import anywhere.
 */
import type {
  ContentKind,
  PlaceSummary,
  PublishedContentItem,
  PublishedGroup,
  PublishedImage,
  PublishedPlace,
  PublishedProjection,
} from "@catalyst/schemas";
import { toPlaceSummary } from "@catalyst/schemas";
import { bboxExtentsKm, bboxFitRadiusKm } from "~/globe/engine/framing";
import type { GlobeGroup, GlobePlace, GlobeRoute } from "~/globe/types";
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
  /** The automatic place hierarchy as published (flat; `parent` links it into a tree). Empty when there are no groups. */
  groups: PublishedGroup[];
  routes: GlobeRoute[];
}

/**
 * `bbox` is the contract's optional extent of the area the place names (`[west, south, east, north]`, WGS84 degrees). It is
 * passed on when it is a plain box and becomes the place's rectangle on the map; otherwise it is dropped and the radius applies.
 */
function toGlobePlace(place: PlaceSummary): GlobePlace {
  const bbox = bboxExtentsKm(place.bbox) ? place.bbox : undefined;
  // With a box, the view radius is the one that frames the whole box seen from the recorded point the camera flies to (the
  // published `viewRadiusKm` then describes the circle around the box's centre, not around the point).
  const viewRadiusKm = (bbox && bboxFitRadiusKm(bbox, place.coordinates)) ?? place.viewRadiusKm;
  return {
    slug: place.slug,
    name: place.name,
    lat: place.coordinates.lat,
    lon: place.coordinates.lon,
    labelPriority: place.labelPriority,
    ...(viewRadiusKm !== undefined ? { viewRadiusKm } : {}),
    ...(bbox ? { bbox } : {}),
    ...(place.group !== undefined ? { groupSlug: place.group } : {}),
    ...(place.countryCode !== undefined ? { countryCode: place.countryCode } : {}),
  };
}

/** The published hierarchy as the globe's groups (coordinates flattened, optional parent kept only when present). */
export function toGlobeGroups(groups: readonly PublishedGroup[]): GlobeGroup[] {
  return groups.map((g) => ({
    slug: g.slug,
    name: g.name,
    kind: g.kind,
    ...(g.parent !== undefined ? { parent: g.parent } : {}),
    lat: g.coordinates.lat,
    lon: g.coordinates.lon,
    viewRadiusKm: g.viewRadiusKm,
    labelPriority: g.labelPriority,
  }));
}

/** A node of the places list: a group with its contents, or a place. */
export type PlaceTreeNode = { kind: "group"; group: PublishedGroup; children: PlaceTreeNode[] } | { kind: "place"; place: PlaceSummary };

/**
 * The places list as the hierarchy: groups (subgroups first, in the order given) with the places in them (in the order
 * given), then the places that are in no group. Without groups it is the flat list, as before. A place whose group is
 * unknown is listed at the top level; a cycle in `parent` links cannot loop (each group is placed once).
 */
export function buildPlaceTree(places: readonly PlaceSummary[], groups: readonly PublishedGroup[]): PlaceTreeNode[] {
  const bySlug = new Map(groups.map((g) => [g.slug, g]));
  const childGroups = new Map<string | undefined, PublishedGroup[]>();
  for (const g of groups) {
    const parent = g.parent !== undefined && bySlug.has(g.parent) && g.parent !== g.slug ? g.parent : undefined;
    childGroups.set(parent, [...(childGroups.get(parent) ?? []), g]);
  }
  const placesIn = new Map<string | undefined, PlaceSummary[]>();
  for (const p of places) {
    const group = p.group !== undefined && bySlug.has(p.group) ? p.group : undefined;
    placesIn.set(group, [...(placesIn.get(group) ?? []), p]);
  }
  const placed = new Set<string>();
  const build = (parent: string | undefined): PlaceTreeNode[] => [
    ...(childGroups.get(parent) ?? []).flatMap((group): PlaceTreeNode[] => {
      if (placed.has(group.slug)) return [];
      placed.add(group.slug);
      return [{ kind: "group", group, children: build(group.slug) }];
    }),
    ...(placesIn.get(parent) ?? []).map((place): PlaceTreeNode => ({ kind: "place", place })),
  ];
  return build(undefined);
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
  return { places, globePlaces: places.map(toGlobePlace), groups: projection.groups, routes: resolveRoutes(projection) };
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
