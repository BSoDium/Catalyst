import { z } from "zod";

/**
 * The published content contract.
 *
 * This is the ONLY shape the public website and API know about. It is
 * deliberately independent of how content is stored or edited upstream
 * (v1: files in a private repo; later: a database-backed editor). Anything
 * not listed here cannot reach the public repo: every object is `.strict()`.
 */
export const SCHEMA_VERSION = 1 as const;

export const slugSchema = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase kebab-case slug");

/** Partial ISO dates are allowed: editors may only know a year or a month. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/, "YYYY, YYYY-MM or YYYY-MM-DD");

/**
 * Publication-approved coordinates. These are chosen by a human in the
 * editorial layer (never copied from raw source coordinates), so they may be
 * deliberately coarse.
 */
export const coordinatesSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  })
  .strict();

/**
 * Bounding box of an area, `[west, south, east, north]` in WGS84 degrees (the order of GeoJSON and of MapLibre's
 * `LngLatBoundsLike`). Axis-aligned in longitude/latitude and never crossing the antimeridian: `west < east` and
 * `south < north` are enforced. The box does not have to contain a point (see `publishedPlaceSchema.bbox`).
 */
export const bboxSchema = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ])
  .refine(([west, , east]) => west < east, "bbox: west must be strictly less than east (no antimeridian crossing)")
  .refine(([, south, , north]) => south < north, "bbox: south must be strictly less than north");

export const contentKindSchema = z.enum(["project", "article", "artwork"]);

export const publishedImageSchema = z
  .object({
    /** Site-relative path under /media/, shipped with the web app. */
    src: z.string().regex(/^\/media\/[A-Za-z0-9._\-/]+$/, "must be a /media/ path"),
    /** Required: images without useful alt text are not publishable. */
    alt: z.string().trim().min(1).max(300),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    caption: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

export const publishedDatesSchema = z
  .object({
    start: isoDateSchema.optional(),
    end: isoDateSchema.optional(),
    /** Free-form authored label, e.g. "Spring 2024". Shown verbatim. */
    label: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((d) => d.start || d.end || d.label, "dates must contain at least one field");

export const relatedRefSchema = z.object({ kind: contentKindSchema, slug: slugSchema }).strict();

/**
 * Automatic place grouping. Groups are derived by the private export (never authored one by one), so the contract only
 * describes their shape. Levels, from the widest: continent, subregion (UN geoscheme), region (an informal, owner-edited
 * grouping such as the Balkans), country, area (places close together inside one country).
 */
export const groupKindSchema = z.enum(["continent", "subregion", "region", "country", "area"]);

export const publishedGroupSchema = z
  .object({
    /** Unique across groups AND distinct from every place slug (the globe addresses both by slug). */
    slug: slugSchema,
    name: z.string().trim().min(1).max(120),
    kind: groupKindSchema,
    /** The enclosing group. Absent on a root group. Chains must not cycle. */
    parent: slugSchema.optional(),
    /** Centre of the bounding circle of every place in the group. */
    coordinates: coordinatesSchema,
    /** Radius, in km, of the circle around `coordinates` that covers every descendant place (and its own view radius). */
    viewRadiusKm: z.number().min(0.5).max(20000),
    /** Higher wins when labels collide on the globe. 0 to 100. */
    labelPriority: z.number().int().min(0).max(100),
  })
  .strict();

export const publishedPlaceSchema = z
  .object({
    slug: slugSchema,
    name: z.string().trim().min(1).max(120),
    /** Optional authored context line, e.g. a country or region. */
    region: z.string().trim().min(1).max(120).optional(),
    coordinates: coordinatesSchema,
    /** Higher wins when labels collide on the globe. 0 to 100. */
    labelPriority: z.number().int().min(0).max(100),
    /**
     * Optional. The whole extent of the area the place names (for a city: the city, not the neighbourhood the author
     * happened to be in), `[west, south, east, north]` in WGS84 degrees. When present it is THE framing of the place:
     * the client fits this box, centred on the box (which is generally NOT `coordinates`). The box need not contain
     * `coordinates`; `coordinates` stays the label/marker anchor. Absent = no known extent: use `viewRadiusKm`.
     */
    bbox: bboxSchema.optional(),
    /**
     * Optional. Radius, in km, of the area that should fit on screen when the place is shown. With `bbox` present it
     * is DERIVED from the box (the radius of the circle centred on the box that covers it, i.e. half its diagonal,
     * clamped to this range) and describes that circle, not a circle around `coordinates`. Without `bbox` it is the
     * authored city-wide framing around `coordinates` (roughly the centre-to-edge distance of the built-up area).
     * Absent = the client's default (12 km).
     */
    viewRadiusKm: z.number().min(0.5).max(500).optional(),
    /**
     * Optional. Slug of the innermost group that contains the place (see `groups`). Absent when the place is not part
     * of any group (for instance the only place of its continent).
     */
    group: slugSchema.optional(),
    /**
     * Optional. ISO 3166-1 alpha-2 country code, uppercase (`XK` for Kosovo is allowed). DERIVED by the private export
     * for every published place (explicit editorial value, else the majority of its steps, else its coordinates), never
     * authored in the projection. Absent when the country is unknown.
     */
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2, uppercase")
      .optional(),
    summary: z.string().trim().min(1).max(400).optional(),
    dates: publishedDatesSchema.optional(),
    /** Plain-text paragraphs. No HTML or markdown is interpreted. */
    body: z.array(z.string().trim().min(1).max(5000)).max(60),
    images: z.array(publishedImageSchema).max(40),
    related: z.array(relatedRefSchema).max(40),
  })
  .strict();

/**
 * An explicitly curated route: an ordered list of published places. Routes are
 * never inferred; if it is not here, no line is drawn.
 */
export const publishedRouteSchema = z
  .object({
    id: slugSchema,
    title: z.string().trim().min(1).max(120),
    stops: z.array(slugSchema).min(2).max(200),
  })
  .strict();

export const publishedContentItemSchema = z
  .object({
    slug: slugSchema,
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(500).optional(),
    date: isoDateSchema.optional(),
    /** Optional external destination. https only. */
    url: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://"), "https only")
      .optional(),
    placeSlugs: z.array(slugSchema).max(100),
  })
  .strict();

const projectionShape = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    places: z.array(publishedPlaceSchema),
    /** Additive in schema version 1: absent means no groups. */
    groups: z.array(publishedGroupSchema).default([]),
    routes: z.array(publishedRouteSchema),
    projects: z.array(publishedContentItemSchema),
    articles: z.array(publishedContentItemSchema),
    artworks: z.array(publishedContentItemSchema),
  })
  .strict();

/** Structural schema only (what the generated JSON Schema describes). */
export const publishedProjectionStructureSchema = projectionShape;

/** Structural schema plus cross-reference integrity. Use this to validate. */
export const publishedProjectionSchema = projectionShape.superRefine((p, ctx) => {
  const placeSlugs = new Set<string>();
  p.places.forEach((place, i) => {
    if (placeSlugs.has(place.slug)) {
      ctx.addIssue({ code: "custom", path: ["places", i, "slug"], message: `duplicate place slug "${place.slug}"` });
    }
    placeSlugs.add(place.slug);
  });

  // --- groups: unique slugs, resolvable parents, no cycles, no empty groups ---------------------------------------------
  const groupBySlug = new Map<string, PublishedGroup>();
  p.groups.forEach((g, i) => {
    if (groupBySlug.has(g.slug)) {
      ctx.addIssue({ code: "custom", path: ["groups", i, "slug"], message: `duplicate group slug "${g.slug}"` });
    } else {
      groupBySlug.set(g.slug, g);
    }
    if (placeSlugs.has(g.slug)) {
      ctx.addIssue({ code: "custom", path: ["groups", i, "slug"], message: `group slug "${g.slug}" is also a place slug` });
    }
  });
  p.groups.forEach((g, i) => {
    if (g.parent !== undefined && !groupBySlug.has(g.parent)) {
      ctx.addIssue({ code: "custom", path: ["groups", i, "parent"], message: `unknown group "${g.parent}"` });
    }
  });
  // A group on a cycle never reaches a root: walk up with a visited set.
  p.groups.forEach((g, i) => {
    const seen = new Set<string>([g.slug]);
    for (let cur = g.parent; cur !== undefined; cur = groupBySlug.get(cur)?.parent) {
      if (seen.has(cur)) {
        ctx.addIssue({ code: "custom", path: ["groups", i, "parent"], message: `the parent chain of group "${g.slug}" contains a cycle` });
        break;
      }
      seen.add(cur);
    }
  });
  const populated = new Set<string>();
  p.places.forEach((place, i) => {
    if (place.group === undefined) return;
    if (!groupBySlug.has(place.group)) {
      ctx.addIssue({ code: "custom", path: ["places", i, "group"], message: `unknown group "${place.group}"` });
      return;
    }
    // Mark the whole chain; the visited set keeps this finite even when a cycle was reported above.
    for (let cur: string | undefined = place.group; cur !== undefined && !populated.has(cur); cur = groupBySlug.get(cur)?.parent) {
      populated.add(cur);
    }
  });
  p.groups.forEach((g, i) => {
    if (!populated.has(g.slug)) {
      ctx.addIssue({ code: "custom", path: ["groups", i], message: `group "${g.slug}" contains no place (empty groups are not allowed)` });
    }
  });

  const byKind = {
    project: new Set<string>(),
    article: new Set<string>(),
    artwork: new Set<string>(),
  };
  (
    [
      ["projects", "project"],
      ["articles", "article"],
      ["artworks", "artwork"],
    ] as const
  ).forEach(([key, kind]) => {
    p[key].forEach((item, i) => {
      if (byKind[kind].has(item.slug)) {
        ctx.addIssue({ code: "custom", path: [key, i, "slug"], message: `duplicate ${kind} slug "${item.slug}"` });
      }
      byKind[kind].add(item.slug);
      item.placeSlugs.forEach((s, j) => {
        if (!placeSlugs.has(s)) {
          ctx.addIssue({ code: "custom", path: [key, i, "placeSlugs", j], message: `unknown place "${s}"` });
        }
      });
    });
  });

  const routeIds = new Set<string>();
  p.routes.forEach((route, i) => {
    if (routeIds.has(route.id)) {
      ctx.addIssue({ code: "custom", path: ["routes", i, "id"], message: `duplicate route id "${route.id}"` });
    }
    routeIds.add(route.id);
    route.stops.forEach((s, j) => {
      if (!placeSlugs.has(s)) {
        ctx.addIssue({ code: "custom", path: ["routes", i, "stops", j], message: `unknown place "${s}"` });
      }
    });
  });

  p.places.forEach((place, i) => {
    place.related.forEach((r, j) => {
      if (!byKind[r.kind].has(r.slug)) {
        ctx.addIssue({
          code: "custom",
          path: ["places", i, "related", j],
          message: `unknown ${r.kind} "${r.slug}"`,
        });
      }
    });
  });
});

export type Coordinates = z.infer<typeof coordinatesSchema>;
/** `[west, south, east, north]`, WGS84 degrees. */
export type Bbox = z.infer<typeof bboxSchema>;
export type ContentKind = z.infer<typeof contentKindSchema>;
export type PublishedImage = z.infer<typeof publishedImageSchema>;
export type PublishedDates = z.infer<typeof publishedDatesSchema>;
export type RelatedRef = z.infer<typeof relatedRefSchema>;
export type GroupKind = z.infer<typeof groupKindSchema>;
export type PublishedGroup = z.infer<typeof publishedGroupSchema>;
export type PublishedPlace = z.infer<typeof publishedPlaceSchema>;
export type PublishedRoute = z.infer<typeof publishedRouteSchema>;
export type PublishedContentItem = z.infer<typeof publishedContentItemSchema>;
export type PublishedProjection = z.infer<typeof publishedProjectionSchema>;

/** Light shape for lists and the globe. Derived, never stored. */
export type PlaceSummary = Pick<
  PublishedPlace,
  "slug" | "name" | "region" | "coordinates" | "labelPriority" | "summary" | "bbox" | "viewRadiusKm" | "group" | "countryCode"
>;

export function toPlaceSummary(place: PublishedPlace): PlaceSummary {
  const { slug, name, region, coordinates, labelPriority, summary, bbox, viewRadiusKm, group, countryCode } = place;
  return { slug, name, region, coordinates, labelPriority, summary, bbox, viewRadiusKm, group, countryCode };
}

export const EMPTY_PROJECTION: PublishedProjection = {
  schemaVersion: SCHEMA_VERSION,
  places: [],
  groups: [],
  routes: [],
  projects: [],
  articles: [],
  artworks: [],
};

/** Parse and validate. Throws an Error with a readable, path-annotated message. */
export function parsePublishedProjection(input: unknown): PublishedProjection {
  const result = publishedProjectionSchema.safeParse(input);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`Invalid published projection:\n${lines.join("\n")}`);
}
