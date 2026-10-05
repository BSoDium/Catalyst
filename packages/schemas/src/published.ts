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
     * Optional. Radius, in km, of the area around `coordinates` that should fit on screen when the place is shown
     * (city-wide framing: roughly the distance from the centre to the edge of the built-up area). The client fits the
     * whole circle in the free map area with a margin. Absent = the client's default (12 km).
     */
    viewRadiusKm: z.number().min(0.5).max(500).optional(),
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
export type ContentKind = z.infer<typeof contentKindSchema>;
export type PublishedImage = z.infer<typeof publishedImageSchema>;
export type PublishedDates = z.infer<typeof publishedDatesSchema>;
export type RelatedRef = z.infer<typeof relatedRefSchema>;
export type PublishedPlace = z.infer<typeof publishedPlaceSchema>;
export type PublishedRoute = z.infer<typeof publishedRouteSchema>;
export type PublishedContentItem = z.infer<typeof publishedContentItemSchema>;
export type PublishedProjection = z.infer<typeof publishedProjectionSchema>;

/** Light shape for lists and the globe. Derived, never stored. */
export type PlaceSummary = Pick<
  PublishedPlace,
  "slug" | "name" | "region" | "coordinates" | "labelPriority" | "summary" | "viewRadiusKm"
>;

export function toPlaceSummary(place: PublishedPlace): PlaceSummary {
  const { slug, name, region, coordinates, labelPriority, summary, viewRadiusKm } = place;
  return { slug, name, region, coordinates, labelPriority, summary, viewRadiusKm };
}

export const EMPTY_PROJECTION: PublishedProjection = {
  schemaVersion: SCHEMA_VERSION,
  places: [],
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
