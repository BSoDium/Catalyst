import { z } from "zod";
import { decodePolyline5, haversineKm } from "./polyline";

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

/** Entry kinds. `poem` and `photograph` are additive in schema version 1 (the `poems` and `photographs` collections default to `[]`). */
export const contentKindSchema = z.enum(["project", "article", "artwork", "poem", "photograph"]);

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
 * How a leg of a route is travelled. It only picks the line style of the map (a solid line, a dashed rail, a dotted
 * ferry, a lifted dotted flight, fine dots for a walk); `unknown` is drawn as the geodesic arc.
 */
export const legModeSchema = z.enum(["road", "rail", "ferry", "flight", "walk", "unknown"]);

/**
 * Limits of the optional per-leg geometry of a route. Exported for the private repo's validator, which must enforce the
 * very same numbers (the schema copy there is byte-identical: `published.schema.json`).
 *
 * Sizing: the spike's pre-baked legs simplified at 50 m average about 145 points (about 0.9 points per km) and
 * 5 to 7 characters per point, so a typical leg is 1 KB and the whole archive 75 to 110 KB gzipped; the limits leave
 * room for about 4 times that and keep the TRUE worst case (every leg at its limit) below 0.5 MB.
 */
export const ROUTE_LEG_LIMITS = {
  /** A route has at most 200 stops, so at most 199 legs. */
  legsPerRoute: 199,
  /** Decoded points of one leg. */
  pointsPerLeg: 2_000,
  /** Characters of one leg's polyline: 8 per point is the worst case of a coordinate step of up to 200 km. */
  charsPerLeg: 16_000,
  /** Decoded points of one route (all legs). */
  pointsPerRoute: 12_000,
  /** Decoded points of the whole projection (all routes). */
  pointsTotal: 60_000,
  /** The first and last point of a leg lie within this distance of the leg's stops, or on the edge of the stop's `bbox` (see `boxEdgeSlackDeg`). */
  endpointToleranceKm: 3,
  /** A path cut at a stop's box ends one polyline unit (1e-5 degree) outside it: the slack, in degrees, of the "on the box edge" test. */
  boxEdgeSlackDeg: 2e-5,
  /** No two consecutive points of a leg are farther apart than this. */
  maxJumpKm: 200,
} as const;

const polylineCharsSchema = z
  .string()
  .min(1)
  .max(ROUTE_LEG_LIMITS.charsPerLeg)
  .regex(/^[?-~]+$/, "an encoded polyline (precision 5): characters from ? to ~ only");

/** One leg between two consecutive stops. Without a polyline the leg is drawn as the geodesic arc between its stops. */
export const publishedLegSchema = z
  .object({
    mode: legModeSchema,
    /**
     * Encoded polyline, precision 5, `[lat, lon]` deltas (docs/api-contract.md, "Route legs"). Never on a `flight`
     * (an arc costs nothing). The first and last point are within `ROUTE_LEG_LIMITS.endpointToleranceKm` of the stops, or on the edge of a stop's `bbox`.
     */
    polyline: polylineCharsSchema.optional(),
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
    /** Additive in schema version 1. A line or two about the trip, as the owner wrote it for the trip. */
    summary: z.string().trim().min(1).max(400).optional(),
    /** Additive in schema version 1. When the trip happened (a month or a year is enough). */
    dates: publishedDatesSchema.optional(),
    stops: z.array(slugSchema).min(2).max(200),
    /**
     * Additive in schema version 1. One entry per consecutive pair of stops, so `stops.length - 1` entries; absent
     * means every leg is a geodesic arc. Order is positional only: no timestamps, no durations.
     */
    legs: z.array(publishedLegSchema).max(ROUTE_LEG_LIMITS.legsPerRoute).optional(),
  })
  .strict()
  .superRefine((route, ctx) => {
    if (!route.legs) return;
    if (route.legs.length !== route.stops.length - 1) {
      ctx.addIssue({ code: "custom", path: ["legs"], message: `legs must have one entry per consecutive pair of stops (${route.stops.length - 1}), got ${route.legs.length}` });
    }
    let total = 0;
    route.legs.forEach((leg, i) => {
      if (leg.polyline === undefined) return;
      if (leg.mode === "flight") {
        ctx.addIssue({ code: "custom", path: ["legs", i, "polyline"], message: "a flight is drawn as an arc and carries no polyline" });
        return;
      }
      const pts = decodePolyline5(leg.polyline);
      if (!pts) {
        ctx.addIssue({ code: "custom", path: ["legs", i, "polyline"], message: "not a valid precision-5 polyline of at least 2 points" });
        return;
      }
      total += pts.length;
      if (pts.length > ROUTE_LEG_LIMITS.pointsPerLeg) {
        ctx.addIssue({ code: "custom", path: ["legs", i, "polyline"], message: `at most ${ROUTE_LEG_LIMITS.pointsPerLeg} points per leg, got ${pts.length}` });
      }
      for (let k = 1; k < pts.length; k++) {
        if (haversineKm(pts[k - 1]!, pts[k]!) > ROUTE_LEG_LIMITS.maxJumpKm) {
          ctx.addIssue({ code: "custom", path: ["legs", i, "polyline"], message: `consecutive points ${ROUTE_LEG_LIMITS.maxJumpKm} km apart or more (point ${k})` });
          break;
        }
      }
    });
    if (total > ROUTE_LEG_LIMITS.pointsPerRoute) {
      ctx.addIssue({ code: "custom", path: ["legs"], message: `at most ${ROUTE_LEG_LIMITS.pointsPerRoute} points per route, got ${total}` });
    }
  });

// --- Entries (projects, articles, artworks, poems, photographs) ------------------------------------------------------------------------

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
    /**
     * Optional, additive in schema version 1. `true` marks mature content: the web app draws the entry's images (cover and image
     * blocks) blurred until the visitor asks to see them, and never uses the cover as a share or structured-data image. Only
     * artworks use it today, but every kind accepts it. The exporter OMITS it when false (absent and `false` mean the same to
     * readers); it only makes sense on an entry that has a cover or an image block.
     */
    sensitive: z.boolean().optional(),
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
    /**
     * Optional, additive in schema version 1. Where the entry is, when only the country is known (a photograph without a geotag that
     * the owner remembers only as "somewhere on the Amazon in Brazil"): ISO 3166-1 alpha-2, uppercase. A country, never a point: the
     * web app names it and frames it on the globe, and no place lists the entry. It is authored (unlike a place's derived
     * `countryCode`) and independent of the automatic group hierarchy, whose slugs can change.
     */
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2, uppercase")
      .optional(),
  })
  .strict()
  // Shared by every collection: the generated JSON Schema declares it once (`$defs`) instead of four times.
  .meta({ id: "PublishedContentItem" });

// --- Career (a singleton document, additive in schema version 1) -----------------------------------------------------------

/**
 * The career document: a curriculum vitae as data, for the page recruiters read. It is ONE optional top-level object of the
 * projection (`career`), not an entry kind: there is at most one, and it is absent while the owner has not published it.
 *
 * Privacy by construction: there is no field for an email address, a phone number or a street address, and every object is
 * `.strict()`, so none of them can be served by accident. `location` of a role is a free-text city and country ("Paris, France"),
 * the place of the work, never where the owner lives. Every text goes through the same plain-text rules as an entry's.
 */

/**
 * Sizes. Every list and every text of the career document has a limit, chosen so that the TRUE maximum (every list full, every
 * text at its limit, each character counted at its worst UTF-8 width) stays under about 60 KB: the size of one entry's body cap.
 * A test builds that maximum from these numbers. The owner's real document is about 5 KB.
 */
export const CAREER_LIMITS = {
  roles: 8,
  highlights: 5,
  roleSkills: 8,
  education: 4,
  languages: 6,
  skillGroups: 6,
  skillItems: 16,
  links: 6,
} as const;

/** Maximum length of every career text, in characters. */
export const CAREER_TEXT = {
  id: 40,
  title: 40,
  summary: 500,
  availability: 120,
  roleTitle: 60,
  org: 50,
  url: 100,
  location: 40,
  employment: 30,
  highlight: 180,
  roleSkill: 30,
  institution: 60,
  programme: 60,
  level: 20,
  note: 80,
  languageName: 30,
  languageLevel: 12,
  languageLabel: 30,
  group: 30,
  item: 36,
  linkLabel: 30,
  portraitAlt: 200,
} as const;

// --- Contact details are not published ----------------------------------------------------------------------------------------
// The schema has no field for an e-mail address, a phone number or a street address. These value checks close the other door:
// a contact detail typed into a free-text field ("Reach me at ...") or into a link. They are heuristics with a clear message, and
// the private export applies the same rules (`src/vault/model/career.ts`) so that it fails closed before anything is published.

const EMAIL_LIKE = /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[^\s@<>()[\]]+/;
const EMAIL_SPELLED = /[[({<]\s*(?:at|dot)\s*[\])}>]|\b\w+\s+(?:at|\[at\])\s+\w+\s+(?:dot|\[dot\])\s+\w+/i;
const PHONE_INTERNATIONAL = /\+\s*\(?\d[\d\s().-]{5,}\d/;
const PHONE_PREFIX_00 = /(?<![\d])00[\s.-]?\d{1,3}(?:[\s.-]?\d){7,}/;
const PHONE_PAREN_AREA = /\(\d{1,4}\)[\s.-]?\d{2,4}(?:[\s.-]?\d{2,4})+/;
const PHONE_NATIONAL_0X = /(?<![\d.-])0\d(?:[\s.-]?\d{2}){4}(?![\d])/;
const PHONE_GROUPED = /(?<![\d.-])\d{3}[\s.-]\d{3}[\s.-]\d{3,4}(?![\d])|(?<![\d.-])\d{3}[\s.-]\d{4}(?![\d])/;
const PHONE_LONG_DIGITS = /(?<![\d.-])\d{9,}(?![\d])/;
const DIGIT_CHAIN = /(?<![\d.-])\d{2,4}(?:[\s.-]\d{2,4}){3,}(?![\d])/g;

/** Why a free text looks like a contact detail, or null. Dates, year ranges, percentages and versions are not phone numbers. */
export function contactTextProblem(text: string): string | null {
  if (EMAIL_LIKE.test(text) || EMAIL_SPELLED.test(text)) return "looks like an e-mail address: contact details are never published";
  if (PHONE_INTERNATIONAL.test(text) || PHONE_PREFIX_00.test(text) || PHONE_PAREN_AREA.test(text) || PHONE_NATIONAL_0X.test(text) || PHONE_GROUPED.test(text) || PHONE_LONG_DIGITS.test(text)) {
    return "looks like a phone number: contact details are never published";
  }
  for (const chain of text.match(DIGIT_CHAIN) ?? []) {
    const groups = chain.split(/[\s.-]/);
    const digits = groups.reduce((n, g) => n + g.length, 0);
    const dateLike = groups.some((g) => /^(?:19|20)\d{2}$/.test(g)) && groups.every((g) => g.length <= 2 || /^(?:19|20)\d{2}$/.test(g));
    if (digits >= 9 && !dateLike) return "looks like a phone number: contact details are never published";
  }
  return null;
}

const CONTACT_SCHEMES = /^(?:mailto|tel|sms|skype|callto|facetime|whatsapp|tg|signal):/i;
const CONTACT_HOSTS = ["wa.me", "whatsapp.com", "t.me", "telegram.me", "telegram.dog", "signal.me", "signal.group", "m.me", "skype.com"];

/** Why a URL is a contact channel (mail, phone, messenger) or carries an e-mail address, or null. */
export function contactUrlProblem(url: string): string | null {
  if (CONTACT_SCHEMES.test(url)) return "is a contact-channel address (mailto:, tel:, sms:, skype:...): contact details are never published";
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    /* not a URL: the https schema reports it */
  }
  if (CONTACT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return "is a messenger or contact-channel link (wa.me, t.me, signal.me...): contact details are never published";
  if (EMAIL_LIKE.test(decodeURIComponentSafe(url))) return "contains an e-mail address: contact details are never published";
  return null;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** A career text: one line of plain text, and not a contact detail. */
const careerText = (max: number) =>
  line(max).superRefine((t, ctx) => {
    const problem = contactTextProblem(t);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });
/** A career URL: https, short, and not a contact channel. */
const careerUrl = httpsUrlSchema.max(CAREER_TEXT.url).superRefine((u, ctx) => {
  const problem = contactUrlProblem(u);
  if (problem) ctx.addIssue({ code: "custom", message: `the address ${problem}` });
});
/** A career id: a short kebab-case slug. */
const careerId = slugSchema.max(CAREER_TEXT.id);

/** `YYYY` or `YYYY-MM`, years 1900 to 2099. No day: a career is dated by the month at best. */
export const careerDateSchema = z.string().regex(/^(?:19|20)\d{2}(?:-(?:0[1-9]|1[0-2]))?$/, "YYYY or YYYY-MM");
/** A date or `present`: where the role or the programme is still going on. A role may also have no end at all. */
export const careerEndSchema = z.string().regex(/^(?:(?:19|20)\d{2}(?:-(?:0[1-9]|1[0-2]))?|present)$/, "YYYY, YYYY-MM or present");

/** Months since year 0 of a career date: a year alone is its first month as a start and its last month as an end. */
function careerMonth(date: string, bound: "start" | "end"): number {
  const year = Number(date.slice(0, 4));
  const month = date.length >= 7 ? Number(date.slice(5, 7)) : bound === "start" ? 1 : 12;
  return year * 12 + month;
}

/** `end` is never before `start`; a missing end and `present` are always fine. */
function endsAfterStart(o: { start: string; end?: string | undefined }): boolean {
  return o.end === undefined || o.end === "present" || careerMonth(o.end, "end") >= careerMonth(o.start, "start");
}
const ENDS_AFTER_START = "end must not be before start";

export const careerRoleSchema = z
  .object({
    /** Unique within the career; kebab-case, so the page can use it as an anchor. */
    id: careerId,
    title: careerText(CAREER_TEXT.roleTitle),
    org: careerText(CAREER_TEXT.org),
    orgUrl: careerUrl.optional(),
    /** Free text, the place of the work ("Paris, France"). Never a street address. */
    location: careerText(CAREER_TEXT.location),
    /** Optional: a published place of this projection (validated to resolve). */
    place: slugSchema.optional(),
    /** Free text ("Permanent", "Contract", "Full-time", "Freelance", "Internship"). */
    employment: careerText(CAREER_TEXT.employment).optional(),
    start: careerDateSchema,
    /** Absent = the document says nothing about the end; `present` = ongoing. */
    end: careerEndSchema.optional(),
    highlights: z.array(careerText(CAREER_TEXT.highlight)).max(CAREER_LIMITS.highlights),
    skills: z
      .array(careerText(CAREER_TEXT.roleSkill))
      .max(CAREER_LIMITS.roleSkills)
      .refine((s) => new Set(s.map((x) => x.toLowerCase())).size === s.length, "skills must be unique"),
  })
  .strict()
  .refine(endsAfterStart, ENDS_AFTER_START);

export const careerEducationSchema = z
  .object({
    id: careerId,
    institution: careerText(CAREER_TEXT.institution),
    programme: careerText(CAREER_TEXT.programme),
    /** "MEng", "MSc", "CPGE". */
    level: careerText(CAREER_TEXT.level).optional(),
    start: careerDateSchema,
    end: careerEndSchema,
    location: careerText(CAREER_TEXT.location).optional(),
    place: slugSchema.optional(),
    note: careerText(CAREER_TEXT.note).optional(),
  })
  .strict()
  .refine(endsAfterStart, ENDS_AFTER_START);

export const careerLanguageSchema = z
  .object({
    name: careerText(CAREER_TEXT.languageName),
    /** "C2", "B1", "Native". */
    level: careerText(CAREER_TEXT.languageLevel),
    /** "Native", "Advanced", "Upper-intermediate". */
    label: careerText(CAREER_TEXT.languageLabel).optional(),
  })
  .strict();

export const careerSkillGroupSchema = z
  .object({
    group: careerText(CAREER_TEXT.group),
    items: z
      .array(careerText(CAREER_TEXT.item))
      .min(1)
      .max(CAREER_LIMITS.skillItems)
      .refine((s) => new Set(s.map((x) => x.toLowerCase())).size === s.length, "skills must be unique within a group"),
  })
  .strict();

export const careerLinkSchema = z.object({ label: careerText(CAREER_TEXT.linkLabel), url: careerUrl }).strict();

/**
 * A dated availability statement ("Open to opportunities", as of 2026-10). It always carries its month, so the page can show how
 * old it is and it cannot silently go stale. Plain text; no contact detail belongs here (there is no email or phone field).
 */
export const careerAvailabilitySchema = z
  .object({
    text: careerText(CAREER_TEXT.availability),
    /** `YYYY-MM`: when the owner last confirmed the statement. Authored, never the clock. */
    asOf: z.string().regex(/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/, "YYYY-MM"),
  })
  .strict();

/**
 * The portrait: ONE optional picture of the owner at the head of the page. A `/media/` file shipped with the web app, like an
 * entry's cover, with two differences: the alt text is required and is a plain line of at most 200 characters (it is read aloud
 * and must be a description, not a caption), and `width` and `height` are REQUIRED, so the page reserves the box before the
 * file arrives (no layout shift). The web app never uses it as the share image. It is not a field of the privacy kind: it shows a
 * face on purpose, which is why the owner sets it, and why the private repo asks for a rights attestation and strips the metadata.
 */
export const careerPortraitSchema = z
  .object({
    src: mediaSrcSchema,
    alt: careerText(CAREER_TEXT.portraitAlt),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

const uniqueBy = <T>(items: readonly T[], key: (t: T) => string) => new Set(items.map(key)).size === items.length;

export const publishedCareerSchema = z
  .object({
    /** "Career". */
    title: careerText(CAREER_TEXT.title),
    /** The profile statement: one paragraph of plain text. */
    summary: careerText(CAREER_TEXT.summary),
    /** `YYYY-MM`: when the owner last reviewed the document. Authored, never the clock. */
    updated: z.string().regex(/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/, "YYYY-MM"),
    /** Optional, additive in schema version 1: a picture of the owner at the head of the page. Absent = the page has no picture. */
    portrait: careerPortraitSchema.optional(),
    /** Optional: a dated "open to work" statement, shown with its date. Absent = the document says nothing. */
    availability: careerAvailabilitySchema.optional(),
    /** Most recent first (by `start`), at least one. */
    roles: z.array(careerRoleSchema).min(1).max(CAREER_LIMITS.roles),
    education: z.array(careerEducationSchema).max(CAREER_LIMITS.education),
    languages: z.array(careerLanguageSchema).max(CAREER_LIMITS.languages),
    skills: z.array(careerSkillGroupSchema).max(CAREER_LIMITS.skillGroups),
    links: z.array(careerLinkSchema).max(CAREER_LIMITS.links),
  })
  .strict()
  .superRefine((c, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const seen = new Map<string, string>();
    const claim = (kind: string, id: string, path: (string | number)[]) => {
      if (seen.has(id)) issue(path, `duplicate id "${id}" (also a ${seen.get(id)})`);
      else seen.set(id, kind);
    };
    c.roles.forEach((r, i) => claim("role", r.id, ["roles", i, "id"]));
    c.education.forEach((e, i) => claim("education item", e.id, ["education", i, "id"]));
    // Most recent first: starts never go up from one role to the next.
    for (let i = 1; i < c.roles.length; i++) {
      if (careerMonth(c.roles[i]!.start, "start") > careerMonth(c.roles[i - 1]!.start, "start")) {
        issue(["roles", i, "start"], `roles are most recent first: "${c.roles[i]!.id}" starts after "${c.roles[i - 1]!.id}"`);
      }
    }
    if (!uniqueBy(c.languages, (l) => l.name.toLowerCase())) issue(["languages"], "language names must be unique");
    if (!uniqueBy(c.skills, (g) => g.group.toLowerCase())) issue(["skills"], "skill group names must be unique");
    if (!uniqueBy(c.links, (l) => l.url)) issue(["links"], "link addresses must be unique");
  });

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
    /** Additive in schema version 1: absent means no photographs. */
    photographs: z.array(publishedContentItemSchema).default([]),
    /** Additive in schema version 1: absent means the owner has not published a career document. */
    career: publishedCareerSchema.optional(),
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
    photograph: new Set<string>(),
  };
  (
    [
      ["projects", "project"],
      ["articles", "article"],
      ["artworks", "artwork"],
      ["poems", "poem"],
      ["photographs", "photograph"],
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

  // The career's optional place references name published places of this projection.
  p.career?.roles.forEach((role, i) => {
    if (role.place !== undefined && !placeSlugs.has(role.place)) {
      ctx.addIssue({ code: "custom", path: ["career", "roles", i, "place"], message: `unknown place "${role.place}"` });
    }
  });
  p.career?.education.forEach((item, i) => {
    if (item.place !== undefined && !placeSlugs.has(item.place)) {
      ctx.addIssue({ code: "custom", path: ["career", "education", i, "place"], message: `unknown place "${item.place}"` });
    }
  });

  const routeIds = new Set<string>();
  const coordsBySlug = new Map(p.places.map((pl) => [pl.slug, [pl.coordinates.lat, pl.coordinates.lon] as const]));
  const bboxBySlug = new Map(p.places.flatMap((pl) => (pl.bbox ? [[pl.slug, pl.bbox] as const] : [])));
  let totalPoints = 0;
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
    // Leg geometry: its ends sit at the stops (the legs themselves were checked with the route).
    route.legs?.forEach((leg, j) => {
      if (leg.polyline === undefined || leg.mode === "flight") return;
      const pts = decodePolyline5(leg.polyline);
      if (!pts) return;
      totalPoints += pts.length;
      const from = coordsBySlug.get(route.stops[j] ?? "");
      const to = coordsBySlug.get(route.stops[j + 1] ?? "");
      const tol = ROUTE_LEG_LIMITS.endpointToleranceKm;
      // A path is cut where it meets the box of a stop (the box is drawn, the path plugs into its edge): that end is far from the centre by design.
      const atBoxEdge = (slug: string | undefined, q: readonly [number, number]) => {
        const box = slug === undefined ? undefined : bboxBySlug.get(slug);
        return box !== undefined && q[1] >= box[0] - ROUTE_LEG_LIMITS.boxEdgeSlackDeg && q[1] <= box[2] + ROUTE_LEG_LIMITS.boxEdgeSlackDeg && q[0] >= box[1] - ROUTE_LEG_LIMITS.boxEdgeSlackDeg && q[0] <= box[3] + ROUTE_LEG_LIMITS.boxEdgeSlackDeg;
      };
      if (from && haversineKm(pts[0]!, from) > tol && !atBoxEdge(route.stops[j], pts[0]!)) {
        ctx.addIssue({ code: "custom", path: ["routes", i, "legs", j, "polyline"], message: `starts more than ${tol} km from "${route.stops[j]}"` });
      }
      if (to && haversineKm(pts[pts.length - 1]!, to) > tol && !atBoxEdge(route.stops[j + 1], pts[pts.length - 1]!)) {
        ctx.addIssue({ code: "custom", path: ["routes", i, "legs", j, "polyline"], message: `ends more than ${tol} km from "${route.stops[j + 1]}"` });
      }
    });
  });
  if (totalPoints > ROUTE_LEG_LIMITS.pointsTotal) {
    ctx.addIssue({ code: "custom", path: ["routes"], message: `at most ${ROUTE_LEG_LIMITS.pointsTotal} leg points in the projection, got ${totalPoints}` });
  }

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
export type PublishedLeg = z.infer<typeof publishedLegSchema>;
export type LegMode = z.infer<typeof legModeSchema>;
export type PublishedContentItem = z.infer<typeof publishedContentItemSchema>;
export type PublishedCover = z.infer<typeof publishedCoverSchema>;
export type PublishedMetaEntry = z.infer<typeof publishedMetaEntrySchema>;
export type PublishedBodyBlock = z.infer<typeof bodyBlockSchema>;
export type PublishedBodyBlockType = PublishedBodyBlock["type"];
export type PublishedCareer = z.infer<typeof publishedCareerSchema>;
export type PublishedCareerRole = z.infer<typeof careerRoleSchema>;
export type PublishedCareerEducation = z.infer<typeof careerEducationSchema>;
export type PublishedCareerLanguage = z.infer<typeof careerLanguageSchema>;
export type PublishedCareerSkillGroup = z.infer<typeof careerSkillGroupSchema>;
export type PublishedCareerLink = z.infer<typeof careerLinkSchema>;
export type PublishedCareerPortrait = z.infer<typeof careerPortraitSchema>;
export type PublishedCareerAvailability = z.infer<typeof careerAvailabilitySchema>;
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
  const { slug, title, summary, date, url, cover, sensitive, tags, meta, placeSlugs, countryCode } = item;
  // `sensitive` is only ever `true` in a summary: `false` is the same as absent, and absent keys vanish in JSON.
  return { slug, title, summary, date, url, cover, sensitive: sensitive === true ? true : undefined, tags, meta, placeSlugs, countryCode };
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
  photographs: [],
};

/** Parse and validate. Throws an Error with a readable, path-annotated message. */
export function parsePublishedProjection(input: unknown): PublishedProjection {
  const result = publishedProjectionSchema.safeParse(input);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`Invalid published projection:\n${lines.join("\n")}`);
}
