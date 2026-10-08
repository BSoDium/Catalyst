/**
 * Pure helpers that turn a validated projection into the shapes the pages need.
 * No I/O here, so everything is unit-testable and safe to import anywhere.
 */
import type {
  ContentKind,
  Coordinates,
  PlaceSummary,
  PublishedGroup,
  PublishedImage,
  PublishedPlace,
  PublishedProjection,
} from "@catalyst/schemas";
import { toPlaceSummary } from "@catalyst/schemas";
import { stripCountry } from "~/globe/engine/country-names";
import { bboxExtentsKm, bboxFitRadiusKm } from "~/globe/engine/framing";
import type { GlobeEntryRef, GlobeGroup, GlobePlace, GlobeRoute } from "~/globe/types";
import { formatDates, type FormattedDates } from "./dates";
import { COLLECTIONS, entriesOfPlace, type EntryGroup } from "./entries";

// Entries (lists, one entry, the kinds' paths and labels) live in ./entries; the place helpers below re-export what callers use.
export { KIND_LABELS, placePath } from "./entries";

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
function toGlobePlace(place: PlaceSummary, entries?: readonly GlobeEntryRef[]): GlobePlace {
  const bbox = bboxExtentsKm(place.bbox) ? place.bbox : undefined;
  // With a box, the view radius is the one that frames the whole box around its centre, where the camera flies to
  // (`placeFraming`); the recorded point stays the anchor of the marker and the label (`lat`, `lon`).
  const viewRadiusKm = (bbox && bboxFitRadiusKm(bbox)) ?? place.viewRadiusKm;
  return {
    slug: place.slug,
    // The map label says the name on its first line and the country on its second: a name that already ends in its own
    // country (", United Kingdom") would say it twice. Display only, the content is not changed.
    name: stripCountry(place.name, place.countryCode),
    lat: place.coordinates.lat,
    lon: place.coordinates.lon,
    labelPriority: place.labelPriority,
    ...(viewRadiusKm !== undefined ? { viewRadiusKm } : {}),
    ...(bbox ? { bbox } : {}),
    ...(place.group !== undefined ? { groupSlug: place.group } : {}),
    ...(place.countryCode !== undefined ? { countryCode: place.countryCode } : {}),
    ...(entries && entries.length ? { entries } : {}),
  };
}

/**
 * The entries linked to every place, by place slug: the content items' `placeSlugs` and the places' own `related` refs, each (kind, slug) once
 * per place, only those that resolve to a published item. Pure. Places with none are absent from the map. (`PlaceSummary` has no `related`, so
 * this reads the full projection; the contract is unchanged.)
 */
export function placeEntries(projection: PublishedProjection): Map<string, GlobeEntryRef[]> {
  const out = new Map<string, Map<string, GlobeEntryRef>>();
  const add = (place: string, kind: ContentKind, slug: string) => {
    const refs = out.get(place) ?? new Map<string, GlobeEntryRef>();
    out.set(place, refs);
    refs.set(`${kind}\u0000${slug}`, { kind, slug });
  };
  const known = new Set(projection.places.map((p) => p.slug));
  const kinds = Object.keys(COLLECTIONS) as ContentKind[];
  for (const kind of kinds) {
    const items = projection[COLLECTIONS[kind]];
    const exists = new Set(items.map((i) => i.slug));
    for (const item of items) for (const place of item.placeSlugs) if (known.has(place)) add(place, kind, item.slug);
    for (const place of projection.places) for (const r of place.related) if (r.kind === kind && exists.has(r.slug)) add(place.slug, kind, r.slug);
  }
  return new Map([...out].map(([place, refs]) => [place, [...refs.values()]]));
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
  const entries = placeEntries(projection);
  return { places, globePlaces: places.map((p) => toGlobePlace(p, entries.get(p.slug))), groups: projection.groups, routes: resolveRoutes(projection) };
}

export interface PlaceDetailData {
  slug: string;
  name: string;
  region?: string;
  coordinates: Coordinates;
  summary?: string;
  dates: FormattedDates | null;
  body: string[];
  images: PublishedImage[];
  /** The entries linked to the place (its `related` and the entries' `placeSlugs`, each once), grouped by kind. Summaries: no body. */
  entries: EntryGroup[];
}

/** Full place with its linked entries resolved. Unresolvable references are dropped. */
export function getPlaceDetail(projection: PublishedProjection, slug: string): PlaceDetailData | null {
  const place: PublishedPlace | undefined = projection.places.find((p) => p.slug === slug);
  if (!place) return null;
  return {
    slug: place.slug,
    name: place.name,
    ...(place.region !== undefined ? { region: place.region } : {}),
    coordinates: place.coordinates,
    ...(place.summary !== undefined ? { summary: place.summary } : {}),
    dates: formatDates(place.dates),
    body: place.body,
    images: place.images,
    entries: entriesOfPlace(projection, place.slug),
  };
}

/** Width/height only when authored: never invented. */
export function imageSize(image: PublishedImage): { width: number; height: number } | null {
  return image.width && image.height ? { width: image.width, height: image.height } : null;
}
