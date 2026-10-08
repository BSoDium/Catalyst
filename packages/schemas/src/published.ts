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

/** Entry kinds. `poem` is additive in schema version 1 (the `poems` collection defaults to `[]`). */
export const contentKindSchema = z.enum(["project", "article", "artwork", "poem"]);

/**
 * Site-relative path under /media/, shipped with the web app. Segments are plain file names: no empty segment (`//`),
 * no segment starting with a dot (so no `..` or `.` traversal and no hidden files). Used by place images, entry
 * covers and image blocks alike.
 */
export const mediaSrcSchema = z
  .string()
  .max(300)
  .regex(/^\/media\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/, "must be a /media/ path of plain file names");

/** Required: images without useful alt text are not publishable. */
const imageAltSchema = z.string().trim().min(1).max(300);

export const publishedImageSchema = z
  .object({
    src: mediaSrcSchema,
    alt: imageAltSchema,
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

// --- Entries (projects, articles, artworks, poems) ------------------------------------------------------------------------

/**
 * Plain-text safety rules shared by every entry text field. No HTML or markdown is ever interpreted, so what matters
 * here is what could confuse a reader or a renderer: control characters (a tab and a line feed are allowed only in
 * the fields that are explicitly multi-line) and the bidirectional override/isolate characters (U+202A to U+202E,
 * U+2066 to U+2069), which can make text read differently from how it is stored.
 */
// Built from strings (not regex literals) so that the escapes stay escapes, byte for byte, in the generated JSON
// Schema: no raw bidirectional character may end up in a committed file.
const BIDI = "\\u202A-\\u202E\\u2066-\\u2069";
const SINGLE_LINE = new RegExp(`^[^\\u0000-\\u001F\\u007F${BIDI}]*$`, "u");
const MULTI_LINE = new RegExp(`^[^\\u0000-\\u0008\\u000B-\\u001F\\u007F${BIDI}]*$`, "u");
const HAS_VISIBLE = /\S/u;

/** One trimmed line of plain text, 1 to `max` characters. */
const line = (max: number) => z.string().trim().min(1).max(max).regex(SINGLE_LINE, "single line of plain text, no control characters");
/** Trimmed plain text that may contain line feeds (a line feed is a hard line break), 1 to `max` characters. */
const lines = (max: number) => z.string().trim().min(1).max(max).regex(MULTI_LINE, "plain text, no control characters other than line feed and tab");

/**
 * An https URL, at most 2000 characters, without whitespace, control characters or embedded credentials. `http:`,
 * `mailto:`, `javascript:`, `data:` and relative URLs are all refused.
 */
export const httpsUrlSchema = z
  .string()
  .max(2000)
  .regex(new RegExp(`^https://[^\\s\\u0000-\\u001F\\u007F${BIDI}]+$`, "u"), "https only, no whitespace")
  .url()
  .refine((u) => {
    try {
      const parsed = new URL(u);
      return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "";
    } catch {
      return false;
    }
  }, "https only, without credentials");

const dimensions = {
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
};
const bothOrNeither = (o: { width?: number | undefined; height?: number | undefined }) => (o.width === undefined) === (o.height === undefined);
const BOTH_OR_NEITHER = "width and height go together: give both or neither";

/** Cover image of an entry: shown in lists and on top of the entry. */
export const publishedCoverSchema = z
  .object({
    src: mediaSrcSchema,
    alt: imageAltSchema,
    ...dimensions,
  })
  .strict()
  .refine(bothOrNeither, BOTH_OR_NEITHER);

/** Short, plain-kebab tag (`open-source`). Lowercase so the same tag is never spelled two ways. */
export const tagSchema = z
  .string()
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase kebab-case tag");

/**
 * One kind-specific fact shown beside an entry, as plain text: a project's stack or status, an artwork's medium, year
 * and dimensions, an article's publication, a poem's language. The label is free text (it is displayed as is); a label
 * appears once per entry. For a clickable destination use the entry's `url` or a `link` block, not a meta value.
 */
export const publishedMetaEntrySchema = z.object({ label: line(40), value: line(200) }).strict();

// --- Body blocks: a typed, flat, recursion-free list. Plain text only; no HTML and no markdown is interpreted. ---------

export const paragraphBlockSchema = z.object({ type: z.literal("paragraph"), text: lines(5000) }).strict();

export const headingBlockSchema = z
  .object({
    type: z.literal("heading"),
    /** 2 or 3: the entry's title is the page's level 1. */
    level: z.union([z.literal(2), z.literal(3)]),
    text: line(160),
  })
  .strict();

export const listBlockSchema = z
  .object({
    type: z.literal("list"),
    ordered: z.boolean(),
    items: z.array(lines(1000)).min(1).max(50),
  })
  .strict();

export const quoteBlockSchema = z
  .object({
    type: z.literal("quote"),
    text: lines(2000),
    /** Attribution, e.g. an author and a work. Plain text. */
    cite: line(200).optional(),
  })
  .strict();

export const imageBlockSchema = z
  .object({
    type: z.literal("image"),
    src: mediaSrcSchema,
    alt: imageAltSchema,
    ...dimensions,
    caption: line(300).optional(),
  })
  .strict()
  .refine(bothOrNeither, BOTH_OR_NEITHER);

/**
 * A poem's text: stanzas of lines. Line breaks and stanza breaks are the structure, and leading spaces in a line are
 * significant (indentation), so lines are NOT trimmed; each line must still contain a visible character.
 */
export const verseBlockSchema = z
  .object({
    type: z.literal("verse"),
    stanzas: z
      .array(
        z
          .array(
            z
              .string()
              .min(1)
              .max(300)
              .regex(SINGLE_LINE, "single line of plain text, no control characters")
              .regex(HAS_VISIBLE, "a verse line needs a visible character"),
          )
          .min(1)
          .max(60),
      )
      .min(1)
      .max(60),
  })
  .strict();

export const codeBlockSchema = z
  .object({
    type: z.literal("code"),
    /** Language label, e.g. `ts`, `python`, `c++`. Informational: no highlighting is implied. */
    language: z
      .string()
      .regex(/^[a-z0-9+#-]{1,20}$/, "lowercase language label")
      .optional(),
    /** Verbatim, never trimmed: leading indentation is part of the code. Line feeds and tabs allowed. */
    code: z.string().min(1).max(10000).regex(MULTI_LINE, "plain text, no control characters other than line feed and tab"),
  })
  .strict();

export const linkBlockSchema = z
  .object({
    type: z.literal("link"),
    title: line(160),
    url: httpsUrlSchema,
    description: line(300).optional(),
  })
  .strict();

export const dividerBlockSchema = z.object({ type: z.literal("divider") }).strict();

export const bodyBlockSchema = z.discriminatedUnion("type", [
  paragraphBlockSchema,
  headingBlockSchema,
  listBlockSchema,
  quoteBlockSchema,
  imageBlockSchema,
  verseBlockSchema,
  codeBlockSchema,
  linkBlockSchema,
  dividerBlockSchema,
]);

/** Most blocks in one body; with `MAX_BODY_CHARS` this bounds what one entry can add to the projection. */
export const MAX_BODY_BLOCKS = 200;
/** Most characters of text (paragraphs, headings, items, quotes, verse lines, code, link texts) in one body. */
export const MAX_BODY_CHARS = 60000;

/** Characters of text a block carries, for the body size budget. Media paths and URLs do not count. */
export function blockTextLength(b: PublishedBodyBlock): number {
  switch (b.type) {
    case "paragraph":
    case "heading":
      return b.text.length;
    case "list":
      return b.items.reduce((n, i) => n + i.length, 0);
    case "quote":
      return b.text.length + (b.cite?.length ?? 0);
    case "image":
      return b.alt.length + (b.caption?.length ?? 0);
    case "verse":
      return b.stanzas.reduce((n, st) => n + st.reduce((m, l) => m + l.length, 0), 0);
    case "code":
      return b.code.length;
    case "link":
      return b.title.length + (b.description?.length ?? 0);
    case "divider":
      return 0;
  }
}

export const publishedBodySchema = z
  .array(bodyBlockSchema)
  .max(MAX_BODY_BLOCKS)
  .refine((blocks) => blocks.reduce((n, b) => n + blockTextLength(b), 0) <= MAX_BODY_CHARS, `body text is limited to ${MAX_BODY_CHARS} characters`);

export const publishedContentItemSchema = z
  .object({
    slug: slugSchema,
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(500).optional(),
    date: isoDateSchema.optional(),
    /** Optional external destination (live demo, repository, original publication). https only. */
    url: httpsUrlSchema.optional(),
    /** Optional, additive in schema version 1. Shown in lists and on top of the entry. */
    cover: publishedCoverSchema.optional(),
    /** Optional, additive in schema version 1. Unique within the entry. */
    tags: z
      .array(tagSchema)
      .max(12)
      .refine((t) => new Set(t).size === t.length, "tags must be unique")
      .optional(),
    /** Optional, additive in schema version 1. Kind-specific facts, plain text. Labels are unique (case-insensitive). */
    meta: z
      .array(publishedMetaEntrySchema)
      .max(10)
      .refine((m) => new Set(m.map((e) => e.label.toLowerCase())).size === m.length, "meta labels must be unique")
      .optional(),
    /** Optional, additive in schema version 1. The entry's content as typed blocks; absent = the entry has no body. Detail only: list endpoints omit it. */
    body: publishedBodySchema.optional(),
    placeSlugs: z.array(slugSchema).max(100),
  })
  .strict()
  // Shared by four collections: the generated JSON Schema declares it once (`$defs`) instead of four times.
  .meta({ id: "PublishedContentItem" });

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
    /** Additive in schema version 1: absent means no poems. */
    poems: z.array(publishedContentItemSchema).default([]),
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
    poem: new Set<string>(),
  };
  (
    [
      ["projects", "project"],
      ["articles", "article"],
      ["artworks", "artwork"],
      ["poems", "poem"],
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
export type PublishedCover = z.infer<typeof publishedCoverSchema>;
export type PublishedMetaEntry = z.infer<typeof publishedMetaEntrySchema>;
export type PublishedBodyBlock = z.infer<typeof bodyBlockSchema>;
export type PublishedBodyBlockType = PublishedBodyBlock["type"];
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

/**
 * An entry without its body: what the list endpoints and the lists of the web app need (title, summary, cover, tags,
 * kind-specific meta). Derived, never stored.
 */
export type PublishedContentSummary = Omit<PublishedContentItem, "body">;

export function toContentSummary(item: PublishedContentItem): PublishedContentSummary {
  const { slug, title, summary, date, url, cover, tags, meta, placeSlugs } = item;
  return { slug, title, summary, date, url, cover, tags, meta, placeSlugs };
}

export const EMPTY_PROJECTION: PublishedProjection = {
  schemaVersion: SCHEMA_VERSION,
  places: [],
  groups: [],
  routes: [],
  projects: [],
  articles: [],
  artworks: [],
  poems: [],
};

/** Parse and validate. Throws an Error with a readable, path-annotated message. */
export function parsePublishedProjection(input: unknown): PublishedProjection {
  const result = publishedProjectionSchema.safeParse(input);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`Invalid published projection:\n${lines.join("\n")}`);
}
