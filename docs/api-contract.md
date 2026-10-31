# Catalyst public API contract (v1)

A small, read-only HTTP API that serves the **curated public content projection** and nothing else. It lives in `apps/api` (`@catalyst/api`) and deploys as its own Vercel project.

There is no import endpoint, no admin or write endpoint, no authentication and no secret. Every response is a pre-serialised view of the validated projection defined in `packages/schemas/src/published.ts`; every object in that schema is `.strict()`, so a field that is not in the schema cannot be served.

## Stability promise

**The published contract is independent of how content is stored upstream.** In v1 the content is files: a private content repo opens a PR against this repo that updates `packages/published/data/projection.json`. Later it may be database-backed editing. In both cases the projection schema, the endpoints and the response shapes below stay the same. Consumers must not be able to tell which backend produced the data.

- Everything is under `/v1`. Within v1 changes are additive only: new optional fields, new endpoints, and new members of a closed set where the section says so (the entry kinds gained `poem` and then `photograph`; clients should treat an unknown kind as "something to list, not to render specially"). Removing or retyping a field, or changing an error code, needs `/v2` (which would run alongside `/v1` for a deprecation period). Clients must ignore fields they do not know; a consumer that validates strictly (JSON Schema with `additionalProperties: false`, zod `.strict()`, such as the web app with `CATALYST_API_URL` or the private repo's contract copy) must update its schema before an entry with `sensitive`, or the `career` document, is published (see "Deployment order" in the career section below).
- `schemaVersion` (currently `1`) is in `/health` and `/v1/projection`.
- `GET /health` is operational, not part of the content contract. Do not build features on it.
- Response types are exported from `apps/api/src/contract.ts` as **types only**. The web app may `import type { ... } from "@catalyst/api/contract"`. Never import runtime code from `@catalyst/api` into the client.

## Conventions

| Topic | Behaviour |
| --- | --- |
| Methods | `GET`, `HEAD`, `OPTIONS` only. Any other method on a known path returns `405` with `Allow: GET, HEAD, OPTIONS`; on an unknown path `404`. No write verb ever succeeds. |
| Format | `application/json; charset=UTF-8`, compact JSON. |
| Paths | Exact match, no trailing slash. `/v1/places/` is a 404. |
| Auth / cookies | None. No `Set-Cookie` is ever sent. |
| Ordering | `/v1/places` and `/v1/groups` are sorted by slug. Everything else keeps the authored order (routes and stop order are curated, and so are the lists of entries). |

### Response headers

Data endpoints (`/v1/*`, 200 and 304):

```
Cache-Control: public, s-maxage=300, stale-while-revalidate=86400
ETag: "<32 hex chars>"
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: ETag
X-Content-Type-Options: nosniff
Content-Type: application/json; charset=UTF-8
```

`/health` and every error response use `Cache-Control: no-store` (plus the CORS and `nosniff` headers).

### Caching and conditional requests

- The `ETag` is a strong validator: the first 128 bits of the SHA-256 of the exact response body. It is stable across instances and redeploys for unchanged content and changes whenever that resource's bytes change.
- Send `If-None-Match` (single value, comma-separated list, weak `W/"..."` form or `*`) to receive `304 Not Modified` with no body. The 304 repeats `ETag`, `Cache-Control` and the CORS headers.
- The CDN may serve a response for up to 5 minutes and a stale one for up to 24 hours while it revalidates, so a new deployment can take a few minutes to be visible to all clients.

### CORS

`Access-Control-Allow-Origin: *`, read-only, never credentialed. Origins are deliberately not restricted because the data is public by design. `OPTIONS` on a known path returns `204` with `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`, `Access-Control-Allow-Headers: If-None-Match, Accept` and `Access-Control-Max-Age: 86400`.

### Errors

All non-2xx JSON responses share one envelope:

```json
{ "error": { "code": "not_found", "message": "No resource at /v1/places/atlantis" } }
```

| Status | `error.code` | When |
| --- | --- | --- |
| 404 | `not_found` | Unknown path, unknown place slug, or unknown entry slug (also an entry slug under the wrong kind). |
| 405 | `method_not_allowed` | Known path, method other than GET/HEAD/OPTIONS. |
| 503 | `content_unavailable` | The projection failed validation at startup (see below). |
| 500 | `internal_error` | Unexpected failure; the message is generic, details only go to server logs. |

`code` is stable and meant for programs; `message` is for humans and may change.

## Endpoints

The examples below are real responses of the demo content (placeholder fixture, `packages/published/fixtures/demo.json`; the tests serve it through `@catalyst/published/dev`: a deployed API serves the published snapshot only and refuses `CATALYST_CONTENT=demo`).

### `GET /health`

Liveness plus a summary of what is loaded. `200` when content is valid, `503` otherwise.

```json
{
  "ok": true,
  "schemaVersion": 1,
  "content": "demo",
  "counts": { "places": 18, "groups": 8, "routes": 4, "projects": 4, "articles": 5, "artworks": 5, "poems": 4, "photographs": 4 }
}
```

`content` is `published` in production (anything else there is a misconfiguration worth alerting on). On failure:

```json
{ "ok": false, "error": { "code": "content_unavailable", "message": "Content failed validation at startup; see server logs" } }
```

### `GET /v1/projection`

The complete validated projection, exactly the shape of `PublishedProjection`: `schemaVersion`, `places` (full objects, authored order), `groups` (the automatic place hierarchy, see below), `routes`, `projects`, `articles`, `artworks`, `poems` and, once the owner has published it, `career` (see "The career document" below). This is what the globe loads. It is always the **complete** projection: entries (`projects`, `articles`, `artworks`, `poems`) are full objects with their `body`, unlike the list endpoints below. With the committed (empty) content:

```json
{ "schemaVersion": 1, "places": [], "groups": [], "routes": [], "projects": [], "articles": [], "artworks": [], "poems": [], "photographs": [] }
```

`groups`, `poems` and `photographs` default to `[]` when a projection file omits them (see "Entries"), so the committed file does not have to carry `poems` yet; the response always does. `career` is the opposite: it is **absent** (the key is not there, not `null`) unless a document is published.

### `GET /v1/places`

Array of `PlaceSummary` (`slug`, `name`, `region?`, `coordinates`, `labelPriority`, `bbox?`, `viewRadiusKm?`, `group?`, `countryCode?`, `summary?`), sorted by `slug`. Optional fields are omitted when absent.

```json
[
  { "slug": "cape-town", "name": "Cape Town", "region": "South Africa", "coordinates": { "lat": -33.92, "lon": 18.42 }, "labelPriority": 55 },
  { "slug": "cusco", "name": "Cusco", "region": "Peru", "coordinates": { "lat": -13.52, "lon": -71.97 }, "labelPriority": 40 }
]
```

`bbox` (optional, `[west, south, east, north]`, additive in schema version 1): the whole extent of the area the place names, in WGS84 degrees (GeoJSON order). For a city it is the city as a whole, not the neighbourhood where the author happened to be: a place whose `coordinates` sit in the north of a large city carries the box of the whole city. The private export takes it from OpenStreetMap administrative boundaries (a committed cache, never fetched at export time) or from a hand-set editorial value. Rules, validated by `parsePublishedProjection` and by the private export: four finite numbers, longitudes in -180 to 180, latitudes in -90 to 90, `west < east` and `south < north` (a box never crosses the antimeridian). The box is **not** required to contain `coordinates`, and generally does not have the same centre: `coordinates` stays the marker and label anchor, the box is the framing. When `bbox` is present, clients should fit it (centred on the box); when absent there is no known extent and they fall back to `viewRadiusKm`. It carries no source text, only numbers; the underlying boundaries are © OpenStreetMap contributors (ODbL). It is part of both `PlaceSummary` and the full place; consumers that ignore it are unaffected and projections without it stay valid.

`viewRadiusKm` (optional, number, 0.5 to 500, additive in schema version 1): the radius in km of the area that should fit on screen when the place is shown. **When `bbox` is present it is derived from the box**: the radius of the circle centred on the box that covers it (half its diagonal, rounded to 0.1 and clamped to 0.5 to 500), a convenience for clients that frame with a circle; it is then NOT a circle around `coordinates`. **The box is authoritative** (decision of issue #236, 2026-10-31): the web app ignores `viewRadiusKm` for a place with a valid `bbox` and derives its own framing from the box (`bboxFitRadiusKm` in `globe/engine/framing.ts`: the longer half extent, so the whole box fits, centred on the box); `viewRadiusKm` is the framing only of a place without a box. The two values differ by design (a circle that covers the box against a circle that fits it), so neither is to be compared with the other; what the exporter writes is pinned by a test on the committed projection (`packages/published/src/index.test.ts`, "the bbox / viewRadiusKm contract"). Without `bbox` it is the authored city-wide framing around `coordinates`, typically the centre-to-edge distance of the built-up area (Lisbon 10, Paris 14, Ho Chi Minh City 18). Clients fit the whole circle into the free map area with a margin. When absent, the web app uses 12 km, a typical city-wide framing: it is large enough that a mid-size city is seen whole (so the visitor can tell where they are) and small enough that streets stay legible. Consumers that ignore the field are unaffected, and projections without it stay valid. It is part of both `PlaceSummary` and the full place.

`countryCode` (optional, string, additive in schema version 1): the ISO 3166-1 alpha-2 country code of the place, uppercase (`XK` for Kosovo is allowed; pattern `^[A-Z]{2}$`). It is **derived** by the private export for every published place, never authored in the projection: an explicit editorial value wins, else the majority country of the place's source steps, else a lookup of its approved coordinates in static country borders. It carries no source text. It is omitted when the country cannot be determined. It is part of `PlaceSummary`, the full place and the projection; consumers that ignore it are unaffected and projections without it stay valid. The web app uses it to label a country on the globe when exactly one place belongs to it.

### `GET /v1/groups`

The automatic place hierarchy, flat, sorted by `slug` (`PublishedGroup[]`). Groups are derived by the private content repo from the published places (nobody authors them one by one) and `parent` links them into a tree. Empty array when there are no groups.

```json
[
  { "slug": "balkans", "name": "Balkans", "kind": "region", "parent": "europe", "coordinates": { "lat": 45.464, "lon": 17.511 }, "viewRadiusKm": 279.9, "labelPriority": 80 },
  { "slug": "europe", "name": "Europe", "kind": "continent", "coordinates": { "lat": 53.139, "lon": 0.024 }, "viewRadiusKm": 1935.7, "labelPriority": 90 }
]
```

| Field | Meaning |
| --- | --- |
| `slug` | kebab-case, unique across groups and **never equal to a place slug** (the globe addresses groups and places by slug). |
| `name` | 1 to 120 characters. Comes from a static country/continent table, an owner-edited region list, or a published place name (`"<place> area"`). |
| `kind` | `continent`, `subregion`, `region` (informal, e.g. Balkans), `country` or `area` (places close together inside one country), from widest to narrowest. |
| `parent` | Slug of the enclosing group; absent on a root group. No cycles. |
| `coordinates` | Centre of the group's bounding circle. |
| `viewRadiusKm` | 0.5 to 20000. Radius of the circle around `coordinates` that covers every descendant place (for a place with a `bbox`: its whole box), including each place's own view radius, with a 10% margin. Fit it on screen to show the whole group. |
| `labelPriority` | 0 to 100, like places (continent 90 down to area 55). |

Guarantees (validated by `parsePublishedProjection` and by the private export): every `parent` and every place `group` resolves, parent chains never cycle, group slugs are unique and distinct from place slugs, and **no group is empty**: each has at least one descendant place. A level with only one child is skipped when the hierarchy is built, so a chain of identical squares never appears. A place that is the only one of its continent (and country, and so on) belongs to no group and has no `group` field.

`group` on a place (summary, detail and projection) is the slug of the **innermost** group that contains it. Walk `parent` to get the rest of the chain.

**Additive in schema version 1.** `groups` and `group` are new optional fields; `schemaVersion` stays `1` and projections without them stay valid (`groups` then defaults to `[]`). Consumers that ignore them are unaffected. The only observable change for existing clients is that `/health` counts gained `groups`, `/v1/places` summaries gained the optional `group`, and `/v1/places/:slug` gained `groupChain`.

### `GET /v1/places/:slug`

The full place with `related` resolved to `{ kind, slug, title }` and its group chain resolved to `{ slug, name, kind }` so a detail view needs no second request. `groupChain` runs from the innermost group (the place's own `group`) to the root and is `[]` for a place in no group. Unknown slug: `404`.

```json
{
  "slug": "lisbon",
  "name": "Lisbon",
  "region": "Portugal",
  "coordinates": { "lat": 38.72, "lon": -9.14 },
  "labelPriority": 60,
  "bbox": [-9.25, 38.664, -9.07, 38.776],
  "viewRadiusKm": 10,
  "group": "europe",
  "countryCode": "PT",
  "summary": "A hilly city on a wide river mouth, used as a base for slow walks, long afternoons of writing and the planning of slower bus rides.",
  "dates": { "start": "2024-03", "end": "2024-04", "label": "Spring 2024" },
  "body": [
    "Lisbon is the city I keep returning to for no good reason, which is the best reason. The hills do the work of a gym, the light does the work of a therapist, and the trams do whatever they like.",
    "Most of what is filed here was written elsewhere and edited here, at a café table with a view of a laundry line and a slice of river. It is a good city for finishing things."
  ],
  "images": [
    { "src": "/media/demo/field-notes.svg", "alt": "A page of a grid notebook, drawn as a plain monochrome grid", "width": 960, "height": 600, "caption": "A page of the notebook that goes everywhere" }
  ],
  "related": [
    { "kind": "article", "slug": "morocco-coast-bus", "title": "Eleven hours of Atlantic coast, by bus" },
    { "kind": "project", "slug": "label-collision-engine", "title": "Collide, a label collision engine for maps" }
  ],
  "groupChain": [{ "slug": "europe", "name": "Europe", "kind": "continent" }]
}
```

`body` is plain text paragraphs (no HTML or markdown is interpreted). `images[].src` is a site-relative `/media/...` path served by the web app, not by this API.

### `GET /v1/routes`

Explicitly curated routes; stops are place slugs in travel order. Routes are never inferred.

```json
[{ "id": "demo-route-vietnam", "title": "Demo route (curated stop order)", "stops": ["hanoi", "hue", "ho-chi-minh-city"],
   "legs": [{ "mode": "rail", "polyline": "..." }, { "mode": "flight" }] }]
```

Each route may also carry `summary` (a line or two about the trip, 1 to 400 characters) and `dates` (the same shape as a place's `dates`; months are enough). Both are additive in schema version 1 and optional; the place panel shows them on the trip's card. A route may also carry `url` (additive, optional, https only, the shared URL rules): the trip's own public page, for instance a public Polarsteps trip; the trip's card links to it ("Follow the trip on <host>", the host read from the address). **The exporter sets it only for a trip it knows to be public**; a trip whose visibility it cannot confirm has no `url`.

#### Route legs (`routes[].legs`, optional, additive in schema version 1)

`legs` says how each leg of a route is travelled and, optionally, the path it follows. Absent: every leg is the geodesic arc between its two stops, as before. Where present it is positional: `legs[i]` is the leg between `stops[i]` and `stops[i + 1]`, so `legs.length === stops.length - 1`. No timestamps, durations or speeds ride along (order is the only time).

| Field | Meaning |
| --- | --- |
| `mode` | `road`, `rail`, `ferry`, `flight`, `walk` or `unknown`. Picks the line style on the map (solid, dashed with ticks, dotted, lifted dotted arc, fine dots, dashed arc) and the noun of the place panel's "Journeys" list. |
| `polyline` | Optional. Encoded polyline, precision 5 (the "Google polyline" algorithm: `[lat, lon]` pairs, deltas in 1e-5 degrees, characters `?` to `~`). Absent: the leg is drawn as the geodesic arc between its stops. Never on a `flight` (an arc costs nothing). |

Checks (schema, `parsePublishedProjection`; the private export must enforce the same numbers, they are exported as `ROUTE_LEG_LIMITS`):

| Rule | Limit |
| --- | --- |
| `legs.length` | `stops.length - 1` |
| characters of one polyline | 16,000 (`charsPerLeg`) |
| decoded points: per leg / per route / in the whole projection | 2,000 / 12,000 / 60,000 (`pointsPerLeg`, `pointsPerRoute`, `pointsTotal`) |
| first and last point | within 3 km of the leg's stops (`endpointToleranceKm`), or on the edge of the stop's `bbox` (a path is cut where it meets a city's box; 1e-5 degree of slack) |
| consecutive points | less than 200 km apart (`maxJumpKm`) |
| a `flight` | carries no `polyline` |

Size: the spike's pre-baked legs simplified at 50 m average about 145 points per leg (about 0.9 per km), 5 to 7 characters per point; the archive came to 75 to 110 KB gzipped. The limits keep the true worst case under 0.5 MB raw. The web app decodes each polyline once and derives its own simplification levels; nothing about levels is in the contract. `/v1/routes` and `/v1/projection` serve legs as authored.

**Private repo:** `packages/schemas/published.schema.json` is the generated contract (`pnpm --filter @catalyst/schemas build:contract`). Its copy in the private repo is byte-identical and must be copied over after this lands (the rollout order stays: public contract and renderer first, then the private schema copy, then the export). The JSON Schema cannot express the cross-checks (endpoint distance, jump, totals): the private validator re-implements them from `ROUTE_LEG_LIMITS` and `decodePolyline5` (exported by `@catalyst/schemas`).

### Entries: `projects`, `articles`, `artworks`, `poems`, `photographs`

An **entry** is a published piece of content that can be linked to places. An entry may also carry `countryCode` (optional, ISO 3166-1 alpha-2, uppercase) when only its country is known: a country, never a point, independent of the generated group hierarchy; it is in the summaries and the details.

There are five kinds: `project` (a development project), `article`, `artwork`, `poem` and `photograph` (`ContentKind`; a photograph's `cover` is the picture itself, see [content-entry-model.md](content-entry-model.md), "Photographs", and [media-policy.md](media-policy.md)). Each kind has its own collection in the projection and its own pair of endpoints, with the same shape (`PublishedContentItem`):

| Field | Type | Meaning |
| --- | --- | --- |
| `slug` | kebab-case, max 80 | Unique within its kind (two kinds may reuse a slug). |
| `title` | 1 to 160 | |
| `summary` | optional, 1 to 500 | Plain text. |
| `date` | optional `YYYY`, `YYYY-MM` or `YYYY-MM-DD` | |
| `url` | optional, https only, max 2000 | The entry's external destination (live demo, repository, original publication). No credentials, no whitespace. |
| `cover` | optional `{ src, alt, width?, height?, small? }` | Image shown in lists and on top of the entry. `src` is a `/media/...` path, `alt` is required (1 to 300), `width` and `height` go together or not at all. `small` (optional, additive in schema version 1) is a smaller copy of the same picture, `{ src, width, height }` (strict, all three required), and needs the cover's own `width` and `height`: clients build `srcset` from the two (`<small.src> <small.width>w, <src> <width>w`) and fall back to `src` when it is absent. |
| `sensitive` | optional boolean | `true` = mature content: clients should draw the entry's images (`cover` and `image` blocks) blurred until the visitor asks to see them, and must not use the cover as a share or structured-data image. **The exporter omits it when false** (absent and `false` mean the same). Any kind may carry it; only artworks do today. Only meaningful with a cover or an image block. Part of the list summaries too. **`sensitive` is a presentation hint for clients, not access control**: `cover.src`, the `src` of `image` blocks, `alt`, `title` and `summary` are served as authored by every endpoint (lists, details, `/v1/projection`), and the files stay public and unblurred at their `/media/` addresses. A summary carries `sensitive` only when it is true (false is dropped there); the detail and the projection pass through whatever the projection holds. |
| `tags` | optional, max 12 | Unique lowercase kebab-case tags (`open-source`), max 40 characters each. |
| `meta` | optional, max 10 `{ label, value }` | Kind-specific facts as plain text, see below. |
| `body` | optional, max 200 blocks | The content as typed blocks, see below. **Detail and projection only.** |
| `placeSlugs` | array, max 100 | The places the entry is linked to (each must exist). |

`meta` is free-form but small: `label` 1 to 40 characters, `value` 1 to 200, one line of plain text each, labels unique within the entry (case-insensitive). The expected conventions, which the web app can rely on but the schema does not enforce: **project** `Stack`, `Status`, `Repository`; **artwork** `Medium`, `Year`, `Dimensions`; **article** `Publication`; **poem** `Language`. A `meta` value is never a link; the clickable destination of an entry is `url` or a `link` block.

#### Body blocks

`body` is a flat array of blocks. Every block is an object with a `type` and is `.strict()`. **All text is plain text:** no HTML, no markdown and no escape sequence is interpreted anywhere, so `<b>` and `*x*` are displayed as written. Text fields reject control characters (a line feed, and for `code` a tab too, is allowed only where noted) and the bidirectional override and isolate characters (U+202A to U+202E, U+2066 to U+2069). Text is trimmed, except in `verse` and `code`, where indentation is content.

| `type` | Fields | Notes |
| --- | --- | --- |
| `paragraph` | `text` (1 to 5000) | A line feed inside the text is a hard line break. |
| `heading` | `level` (`2` or `3`), `text` (1 to 160, one line) | The entry's title is the level 1. |
| `list` | `ordered` (boolean), `items` (1 to 50 strings, 1 to 1000 each) | Flat: no nested lists. |
| `quote` | `text` (1 to 2000), `cite?` (1 to 200, one line) | |
| `image` | `src`, `alt`, `width?`, `height?`, `caption?` (1 to 300, one line) | Same rules as `cover`; `alt` required. |
| `verse` | `stanzas`: 1 to 60 stanzas of 1 to 60 lines (each 1 to 300 characters, one line, with a visible character) | For poems. Line and stanza breaks are the structure and leading spaces in a line are kept (indentation). Not trimmed. |
| `code` | `language?` (`^[a-z0-9+#-]{1,20}$`), `code` (1 to 10000) | Verbatim: line feeds and tabs allowed, not trimmed. The language is a label; no highlighting is implied. |
| `link` | `title` (1 to 160), `url` (https), `description?` (1 to 300) | A block-level link card. https only, max 2000, no credentials or whitespace. |
| `divider` | none | A thematic break. |

Limits on the whole body: at most **200 blocks** and **60,000 characters** of text in total (media paths and URLs do not count). `media` paths follow one rule for place images, covers and image blocks: `/media/` followed by plain file names (`[A-Za-z0-9_-]` first, then `[A-Za-z0-9._-]`), separated by single slashes; `..`, `.`, empty and dot-leading segments are rejected, so a path cannot leave `/media/`.

**Not in the contract (yet).** There is no inline emphasis or inline link inside a text field, no nested lists, no tables, no callouts and no entry-to-entry references. They would be new **optional** fields or new block types in a later additive change (for example a `spans` array next to `text`, which renderers that do not know it can ignore in favour of `text`). Until then a text is one plain string.

All of this is **additive in schema version 1**: `poems`, `cover`, `tags`, `meta`, `body` and `sensitive` are new and optional, `schemaVersion` stays `1`, and a projection that has none of them stays valid (`poems` defaults to `[]`, like `groups`). The only observable changes for existing clients: `/health` counts gained `poems` and `photographs`, `contentKindSchema` and the `kind` of a place's `related` refs gained `poem` and `photograph` (clients with an exhaustive switch over kinds must handle it), the list endpoints gained fields, `url` and media paths are validated slightly more strictly (https without credentials or whitespace; no `..` segments in `/media/` paths: nothing that was a sane value is affected), and there are new endpoints.

#### `GET /v1/projects`, `GET /v1/articles`, `GET /v1/artworks`, `GET /v1/poems`, `GET /v1/photographs`

Arrays of **summaries**, in authored order: the entry without its `body` (`ContentItemsResponse`: `slug`, `title`, `summary?`, `date?`, `url?`, `cover?`, `sensitive?`, `tags?`, `meta?`, `placeSlugs`). Optional fields are omitted when absent. A list entry is roughly 0.4 to 0.7 KB (summary, cover, tags, meta), which is what a list page needs; fetch the detail (or the projection) for the text.

```json
[
  {
    "slug": "demo-poem",
    "title": "Layover",
    "summary": "Nine hours in an airport between two flights: a poem about benches, announcements and the strange tenderness of being in no place at all.",
    "date": "2025-10",
    "cover": { "src": "/media/demo/cover-layover.svg", "alt": "Short white lines grouped in stanzas, one of them cyan, beside a dithered shadow at the right edge", "width": 1200, "height": 630 },
    "tags": ["layover", "airports", "travel", "free-verse"],
    "meta": [
      { "label": "Language", "value": "English" },
      { "label": "Form", "value": "Free verse, six stanzas" },
      { "label": "Written", "value": "In transit, October 2025" }
    ],
    "placeSlugs": ["reykjavik"]
  }
]
```

The real `/v1/poems` answer has four such items (the demo has 5 articles, 4 projects, 5 artworks, 4 poems and 4 photographs); only the first is shown.

#### `GET /v1/projects/:slug`, `GET /v1/articles/:slug`, `GET /v1/artworks/:slug`, `GET /v1/poems/:slug`, `GET /v1/photographs/:slug`

The complete entry (`ContentDetailResponse`): every field of the table above **including `body`**, plus `kind` and `places`, the entry's places resolved to `{ slug, name }` in the order of `placeSlugs`, so a detail view needs no second request. `placeSlugs` is kept. An unknown slug, or a slug that belongs to another kind (`/v1/projects/demo-poem`), is `404`. Slugs are lowercase kebab-case; `/v1/poems/Demo-Poem` is a 404.

```json
{
  "kind": "poem",
  "slug": "demo-poem",
  "title": "Layover",
  "summary": "Nine hours in an airport between two flights: a poem about benches, announcements and the strange tenderness of being in no place at all.",
  "date": "2025-10",
  "cover": { "src": "/media/demo/cover-layover.svg", "alt": "Short white lines grouped in stanzas, one of them cyan, beside a dithered shadow at the right edge", "width": 1200, "height": 630 },
  "tags": ["layover", "airports", "travel", "free-verse"],
  "meta": [
    { "label": "Language", "value": "English" },
    { "label": "Form", "value": "Free verse, six stanzas" },
    { "label": "Written", "value": "In transit, October 2025" }
  ],
  "body": [
    {
      "type": "verse",
      "stanzas": [
        ["Gate 14 has been closed since noon,", "and the sign above it has forgotten", "which city it was meant to promise."],
        ["I count the windows. I count the planes.", "A child lies flat on the carpet", "and conducts the whole terminal,", "with one finger, as if the announcements, the trolleys and the slow doors were waiting for his count."],
        ["Somebody's suitcase turns on the belt", "alone, a small patient animal,", "making the circuit it was told to make", "and finding it enough."],
        ["    We are all between things here:", "    between flights, between coffees,", "    between the person who left", "    and the one who will land."],
        ["The announcer apologises in three languages", "and means it in none, and then, once,", "in a fourth, quietly, to nobody,", "as if to the weather itself."],
        ["Outside, the light does that long, flat thing", "it does at the edge of the world, and I think:", "this is the only hour of the trip that is mine,", "        and I have spent it waiting for the others."]
      ]
    },
    { "type": "divider" },
    { "type": "paragraph", "text": "Written on a nine-hour layover in Keflavík, on the back of a boarding pass. The last line was the first one I had." }
  ],
  "placeSlugs": ["reykjavik"],
  "places": [{ "slug": "reykjavik", "name": "Reykjavík" }]
}
```

A place's `related` (`{ kind, slug }`, resolved to `{ kind, slug, title }` in `GET /v1/places/:slug`) may now have `kind: "poem"` or `kind: "photograph"`. Both directions of the link are valid (an entry lists `placeSlugs`, a place lists `related`); the web app merges them.

#### Payload size and cost

The projection is **bundled** into the web app and into the API function, and `/v1/projection` serves all of it, so entry bodies are paid for in three places: the API bundle (`dist/index.mjs`, parsed at cold start), the web server bundle, and every `/v1/projection` response. Measured with `buildSnapshot` (bytes):

| | raw | gzip | brotli |
| --- | --- | --- | --- |
| Committed projection today (empty) | 108 | 92 | 71 |
| Demo fixture, `/v1/projection` (18 places, 8 groups, 18 entries) | 49,059 | 16,616 | 14,070 |
| Demo: the 18 entries with their bodies (as in the projection) | 42,692 | 14,963 | 12,699 |
| Demo: the four lists (summaries: 5 articles, 4 projects, 5 artworks, 4 poems) / the 18 details | 11,357 / 44,249 | | |
| Demo: one detail, the shortest (a haiku-like poem) / a typical one (a 12-block article) / the longest (a 14-block project with code) | 520 / 3,348 / 4,566 | 341 / 1,597 / 2,125 | |
| 100 entries (25 per kind) with a ~3 KB body each, cover, 4 tags, 3 meta, 2 places, **entries only** | ~355,000 | 130,000 to 155,000 | 115,000 to 136,000 |
| Same, one list (25 summaries) | ~16,000 | ~5,200 | ~4,600 |
| Same, one detail | ~3,600 | ~1,900 to 2,000 | |

Each entry costs about 3.5 KB raw in the projection (body 3 KB plus cover, meta and tags) and about 1.3 to 1.6 KB gzipped. The compressed figures come from random dictionary words (about 2.3:1, pessimistic) and are consistent with the ratio of real prose (2.5 to 3:1); source code and verse compress somewhat worse than prose. To budget a whole site, add the places: the owner's preview (146 places, 47 groups) is about 41.5 KB raw and 9 KB gzipped, so **146 places plus 100 entries of 3 KB is about 400 KB raw, 140 to 165 KB gzipped**. The server also pre-serialises every response at startup (the projection, the lists, one detail per entry and per place): that is about 790 KB of strings in memory for the 100-entry case and a module load of a few milliseconds (zod validation of the 100 entries took about 1 ms, building the snapshot about 2 ms), which is negligible next to the 20 ms module load of the bundle itself.

The consequence for the free Vercel quota is in [api-cost-and-abuse.md](api-cost-and-abuse.md) (section 2): `/v1/projection` is the only endpoint whose size grows with the bodies, and a cache-busted client would pull about 400 KB per request from the function. The detail and list endpoints stay small (a few KB). Budget rules that keep the numbers in this table valid: no body above 60,000 characters (enforced), at most 200 blocks (enforced), covers and images are `/media/` files served by the web app, never inlined; if the real content ever approaches 1 MB of projection, split `/v1/projection` (not an incompatible change: a new endpoint) rather than raising a limit.

### The career document (`career`)

A curriculum vitae as data, for the page recruiters read. It is **one optional top-level object of the projection**, not an entry kind: there is no list, no detail and no slug, and **no new endpoint** (it is served inside `GET /v1/projection`, which already carries every top-level key, so the Vercel firewall's path allowlist needs no change). It is **absent** (no key) while the owner has not published the document, and `/health` counts do not mention it.

```json
{
  "title": "Career",
  "summary": "Design engineer who builds interfaces for map-heavy and data-heavy products.",
  "updated": "2026-09",
  "portrait": { "src": "/media/demo/portrait-example.svg", "alt": "A hand-penned blueprint portrait ...", "width": 940, "height": 640, "dark": { "src": "/media/demo/portrait-example-dark.svg", "width": 940, "height": 640 } },
  "availability": { "text": "Open to example opportunities", "asOf": "2026-09" },
  "roles": [
    {
      "id": "lead-frontend-example-studio",
      "title": "Lead Design Engineer",
      "org": "Example Studio",
      "orgUrl": "https://example.org/studio",
      "logo": { "src": "/media/demo/logo-example.svg", "width": 200, "height": 200 },
      "location": "Lisbon, Portugal",
      "place": "lisbon",
      "employment": "Permanent",
      "start": "2025-09",
      "end": "present",
      "highlights": ["Led a team of four on a rebuild of the studio's flagship mapping product."],
      "skills": ["React", "TypeScript", "WebGL"]
    }
  ],
  "education": [{ "id": "institut-exemple", "institution": "Institut Exemple", "programme": "Computer Science and Applied Mathematics", "level": "MEng", "start": "2016", "end": "2021", "location": "Paris, France", "place": "paris" }],
  "languages": [{ "name": "English", "level": "C2", "label": "Native" }],
  "skills": [{ "group": "Primary", "items": ["React", "TypeScript"] }],
  "links": [{ "label": "Code", "url": "https://example.com/demo-profile/code" }]
}
```

(The demo fixture's career, shortened: every employer in it is made up.)

| Field | Type | Meaning |
| --- | --- | --- |
| `title` | 1 to 40, one line | "Career". |
| `summary` | 1 to 500, one line | The profile statement, plain text. |
| `updated` | `YYYY-MM` | When the owner last reviewed the document. Authored, never the clock of the export. |
| `availability` | optional `{ text, asOf }` | A dated "open to work" statement: `text` 1 to 120, one line of plain text; `asOf` `YYYY-MM`, authored, when the owner last confirmed it. Shown with its date so it cannot silently go stale; absent = the document says nothing. Nothing else belongs in it (a contact detail is not a field). |
| `portrait` | optional `{ src, alt, width, height, dark? }` | A picture of the owner at the head of the page. `src` a `/media/` path of plain file names (the private export names it `/media/career/portrait.<hash>.<ext>`; the page's own image rules apply: raster in production, the demo uses an SVG), `alt` 1 to 200, one line, required (and checked for contact details like every career text), `width` and `height` positive integers, both required (the page reserves the box from them: no layout shift). Strict: no caption, no credit, no other key. Absent = the page has no picture. It is never the share image (`og:image`) and never in the structured data. Additive in schema version 1; the contract field is named `portrait`, not `photo`. |
| `roles` | 1 to 8, **most recent first by `start`** | See below. |
| `education` | 0 to 4 | See below. Authored order (the main degree before an exchange year, say). |
| `languages` | 0 to 6 | `name` (1 to 30), `level` (1 to 12: `C2`, `B1`, `Native`), `label?` (1 to 30: `Native`, `Upper-intermediate`). Names unique (case-insensitive). |
| `skills` | 0 to 6 groups | `group` (1 to 30, unique), `items` (1 to 16 of 1 to 36, unique within the group). |
| `links` | 0 to 6 | `label` (1 to 30), `url` (https only, at most 100, no credentials, unique, never a contact channel). |

A **role**: `id` (kebab-case slug of at most 40, unique across roles and education: an anchor), `title` (1 to 60), `org` (1 to 50), `orgUrl?` (https, at most 100), `logo?` (`{ src, width, height }`: a `/media/` file with its pixel size, no alt text, the organisation's logo as a square picture; the page draws it as the item's marker, else it picks an icon from the title), `location` (1 to 40, free text such as `Paris, France`: where the work was, never an address), `place?` (the slug of a place **of this projection**: validated to resolve), `employment?` (1 to 30, free text: `Permanent`, `Contract`, `Full-time`, `Freelance`, `Internship`), `start` (`YYYY` or `YYYY-MM`, years 1900 to 2099), `end?` (a date, or `present`, or **absent: the document says nothing about the end**; never before `start`, a year alone is the whole year), `highlights` (0 to 5 lines of 1 to 180), `skills` (0 to 8 of 1 to 30, unique). An **education item**: `id`, `institution` (1 to 60), `programme` (1 to 60), `level?` (1 to 20: `MEng`, `MSc`, `CPGE`), `start`, `end` (a date or `present`), `location?` (1 to 40), `place?`, `note?` (1 to 80).

Rules the JSON Schema cannot express (zod in `packages/schemas`, re-implemented by the private export's second gate): `end` not before `start`; roles most recent first; ids unique across roles and education; unique language names, group names, skills and link addresses; every `place` resolves to a place of the projection.

**Pictures of an item (additive, schema version 1).** `portrait.dark?`, a role's `logo?` and an education's `logo?` share one shape, `{ src, width, height }`: `src` a `/media/` path of plain file names, `width` and `height` the real pixel size (the page reserves the box). A logo has no alt text (it is decorative: the organisation's name is next to it); `portrait.dark` is the same picture drawn for the dark colour scheme and shares the portrait's alt text (the page offers it through `<picture>` and `prefers-color-scheme: dark`; there is no scheme toggle). Absent = none: an old projection stays valid, a page without a `logo` falls back to a file of its own by organisation name (`apps/web/public/career-logos/`, `lib/career.ts`), then to an icon. The private export has to produce them (docs/career-page.md).

**What is deliberately not here.** There is no field for an email address, a phone number or a street address, no boolean `openToWork` flag (the only availability is the dated, optional `availability` text above) and no line for where the owner lives; every object is `.strict()`, so none can be served by accident (a test walks the generated JSON Schema and fails on any property named like one). Adding one is a contract decision, not an authoring one. All text is plain text under the entries' rules (no control characters, no bidirectional overrides, trimmed; `<b>` is displayed as written, and the private vault refuses markup-looking text earlier).

**Contact details typed as text are refused too.** Property names are not the only door: every career text and every URL is also checked by value, in the zod schema and again by the private export (so it fails closed before anything is published). An e-mail-like string (`a@b.tld`, `name [at] domain`, `name (at) domain`, `name at domain dot org`), a phone-like number (international `+CC ...`, `00CC ...`, national grouped forms such as `06 12 34 56 78`, `415 555 2671`, `123-456-789`, parenthesised area codes, ten plain digits) and, in `links[].url` and `orgUrl`, a contact-channel address (`mailto:`, `tel:`, `sms:`, `skype:`, `wa.me`, `whatsapp.com`, `t.me`, `signal.me`, an e-mail address in the query) are validation errors that name the field. Dates, year ranges, percentages and version numbers are not mistaken for phone numbers (tests include the owner's real document). This is a heuristic for accidents, not a guarantee: the owner still reviews the publication PR.

**Size.** Bounded by the limits, which a test turns into the true maximum: every list full, every optional field present, every text at its limit and made of 3-byte characters, every URL at its limit. That maximum is about 57.5 KB of UTF-8 (22 KB in plain ASCII; the portrait adds under 1 KB), under the 60,000-character cap of one entry's body, and the test asserts it stays under 60 KB. The owner's real document is 5.0 KB compact (about 2 KB gzip), the demo's 3.1 KB. It is part of the bundled projection, so it is paid for in the same three places as an entry's body ("Payload size and cost").

**Deployment order.** A strict consumer rejects an unknown top-level key, so the key must be known **before** a projection that carries it is merged, exactly as `sensitive` was:

1. Merge the public change that adds `career` to the schema, the generated JSON Schema and the API's types (this repo). Both Vercel projects redeploy and accept a projection with or without the key (the web app validates the projection through the same schema; its page, `/career`, answers 404 while there is no career). Nothing visible changes: the committed projection has no `career`.
2. The private repo's first gate is the public repo's generated schema: the `publish` workflow's "Refresh contract schema" step copies the **public default branch's** `published.schema.json` over `contract/` before validating, so a publication run sees the new key as soon as step 1 is merged. The committed copy in the private repo only matters for local runs and tests (refresh it with `cp`, and `pnpm test` compares it with a public checkout when `CATALYST_PUBLIC_REPO` is set; the private CI checks the public repo out and sets it). Before step 1 is merged, the first gate (ajv, `additionalProperties: false`) fails closed on a document with `status: published`: a publication PR cannot even be opened.
3. Only then set `status: published` on `content/career/index.md`. The publication PR carries `career` in `projection.json`; merging it is the publication.

Rolling back is setting `status: unpublished` (or `draft`) in the private repo and merging the next publication PR: the key disappears, which every consumer already accepts.

All of this is **additive in schema version 1**: `career` is a new optional top-level key, `schemaVersion` stays `1`, a projection without it is valid and `EMPTY_PROJECTION` does not carry it. `@catalyst/published` has `getCareer(mode)` for code without a projection at hand; the career page (`/career`, [career-page.md](career-page.md)) reads `projection.career`. The types are exported from `apps/api/src/contract.ts` (`PublishedCareer` and its parts).

## Configuration

| Variable | Values | Default | Notes |
| --- | --- | --- | --- |
| `CATALYST_CONTENT` | `published` \| `demo` | `published` (unset or empty) | `demo` serves placeholder fixtures for local development. **Leave it unset in production.** Any other value is a startup error, never a silent fallback. This includes `preview`: the local preview of unpublished drafts is a web-dev-only mode and the API never serves it. |
| `PORT` | number | `3001` | Local dev server and built artifact only. Ignored on Vercel. |

No secrets. See `apps/api/.env.example`.

### Startup validation

The content is selected and validated once, when the module loads, and every response body is serialised then. If validation fails (bad projection, bad `CATALYST_CONTENT`):

- the details are logged with `console.error` (visible in Vercel function logs);
- on Vercel (`src/index.ts`, bundled into `dist/index.mjs`) the app still starts but answers `503 content_unavailable` on `/health` and every `/v1/*` endpoint. There is no separate startup phase to abort on a serverless platform, and a crash would surface as an opaque platform error instead of this one;
- the node server (`src/server.ts`, used by `pnpm dev` and the built artifact) exits with code 1 instead.

Because the same validation runs in the content repo and in CI, a bad projection should never reach a deployment.

## Running locally

```bash
pnpm --filter @catalyst/api dev                     # http://localhost:3001 (tsx watch + @hono/node-server)
CATALYST_CONTENT=demo pnpm --filter @catalyst/api dev
pnpm --filter @catalyst/api test                    # vitest, uses app.request()
pnpm --filter @catalyst/api typecheck
pnpm --filter @catalyst/api build && pnpm --filter @catalyst/api start   # self-contained bundle under plain node
```

`vercel dev` (run from `apps/api` after `vercel link`) also works and exercises the default export the way Vercel does. It needs Vercel auth and was not run as part of this work.

## Deployment on Vercel

Two Vercel projects, one per app, from this one repo. Both need a **Root Directory** (a dashboard setting no file in the repo can set) and **Include source files outside of the Root Directory** (the apps import `packages/*`). Everything else is in the repo: `apps/web/vercel.json` and `apps/api/vercel.json` pin the Framework Preset (`react-router`, `hono`), the Node version comes from `engines`, the package manager from `packageManager` and `pnpm-lock.yaml`.

### Owner checklist (click by click)

**Plan (owner's decision, 2026-10-07).** The existing project `catalyst-v1` (formerly `catalyst`, formerly `bsodium`) is the old Yarn app at the repository root and was renamed on purpose: it stays the v1 site. The rebuild gets two NEW projects, created after this branch is merged, because the dashboard only offers a Root Directory that exists on the default branch (`apps/web` does not exist on `main` yet). The web project is served on a temporary `v2.bsodium.fr` until it replaces the main domain.

Until the merge, the PR's Vercel check (project `catalyst-v1`, Root Directory empty) keeps failing, with `Failed to resolve "@remix-run/dev"` in the build log; that is expected and not a defect of this branch (see "Evidence"). After the merge, `catalyst-v1` would also fail on every push to `main`: disconnect its Git repository, or set an Ignored Build Step on it, once v2 is live.

Web project (new, e.g. `catalyst-v2`):

1. vercel.com, team `photonsquid`, **Add New**, **Project**, import the GitHub repository.
2. **Root Directory**: `apps/web`. Leave **Include source files outside of the Root Directory** enabled (the default); it must be on.
3. **Framework Preset**: `React Router` (the committed `apps/web/vercel.json` also says so; the file wins).
4. Leave every override off: **Install Command**, **Build Command**, **Output Directory**, **Development Command** on their defaults.
5. **Node.js Version**: `22.x` or newer (the repo's `engines` is `>=22`; Vercel then uses 24.x and says so in the build log, which is fine). **Environment Variables**: none needed; never set `CATALYST_CONTENT=demo`/`preview` (only `published`, the default, is allowed in production).
6. Deploy. Expect `Detected pnpm-lock.yaml`, `Running "pnpm install"` at the repo root, then the React Router build, status Ready. Add the domain `v2.bsodium.fr` under **Settings, Domains**.

API project (new, e.g. `catalyst-v2-api`):

1. Same repository, **Add New**, **Project**.
2. **Root Directory**: `apps/api`; **Include source files outside of the Root Directory**: on. Framework Preset: `Hono` (pinned by `apps/api/vercel.json`; `Other` fails with "No Output Directory named public"). No overrides, no environment variables. Deploy.
3. Leave **Settings, Build and Deployment, Root Directory, Skip deployment** as it is (it skips a project that a push did not affect, see "Monorepo build behaviour").

After both are green, every PR shows two Vercel checks, one per project.

### Project settings

| Setting | Web (`apps/web`) | API (`apps/api`) |
| --- | --- | --- |
| Git repository | this repo (GitHub-connected) | same |
| Root Directory | `apps/web` | `apps/api` |
| Include source files outside of the Root Directory | on | on |
| Framework Preset | React Router (pinned in `vercel.json`) | Hono (pinned in `vercel.json`; not `Other`) |
| Node.js version | `engines` `>=22`: Vercel uses 24.x (`.nvmrc` says 22, local and CI-style checks ran on 22 and 26) | same |
| Install Command | default (`pnpm install` at the workspace root, from `pnpm-lock.yaml`) | default, or `pnpm install --filter @catalyst/api...` (see below) |
| Build / Output | defaults. The web build applies `@vercel/react-router` only when `VERCEL=1` (`react-router.config.ts`); the API's `build` script emits `dist/` and then runs `scripts/check-function.mjs`; the function IS `dist/index.mjs` (through `index.mjs`), so the default build command must stay (the `build` script is what produces the function) | defaults |
| Environment variables | none required: `CATALYST_CONTENT` unset (`published`); optionally `CATALYST_TILES_*` (docs/self-hosting.md, section 6) | none |

### Evidence (what was reproduced, 2026-10-06)

The check cannot be read without Vercel access, so the cause was reproduced instead:

- The Vercel bot comment on the PR carries the project metadata: one project (`prj_bWZMUhylXdrg9k95Wsq58Cah9XDx`), `rootDirectory: null`, a monorepo. The same project built the old app at the repo root with a green deployment (PR #227). The last three deployments of the rebuild branch (`e94751d`, `1dec39e`, `aae202e`) all failed.
- `git archive` of the pushed head (`aae202e`), `pnpm install --frozen-lockfile` and `VERCEL=1 pnpm run build` pass on Node 22 with pnpm 9 and 10 (web and API), and the built web server answers `/` with 200: the committed tree itself builds.
- The Vercel CLI (`vercel build`, offline, with a hand-written `.vercel/project.json` carrying the settings) on that tree: Root Directory empty fails whatever the preset (React Router: `Failed to resolve "@remix-run/dev"`, Other: `No Output Directory named "public" found`, Vite: `No Output Directory named "dist" found`); Root Directory `apps/web` with React Router succeeds and emits the Build Output API (static assets, one SSR function per route); Root Directory `apps/api` succeeds with Hono and fails with Other.

What is not known: the literal error line of the failed deployment (log not readable), and whether the project's saved Install/Build Command overrides, if any, add a second failure. The checklist clears them either way.

The deploy entry is `apps/api/index.mjs`, a two-line re-export of `dist/index.mjs`: the esbuild bundle of `src/index.ts` that `pnpm build` (`scripts/build.mjs`) emits, with `@catalyst/schemas`, `@catalyst/published`, zod, hono and the projection inlined. Why not `src/index.ts` itself: see "Incident" below. Vercel's Hono preset looks for the first of `app`, `index`, `server`, `src/app`, `src/index`, `src/server` (any of `js cjs mjs ts cts mts`, root before `src/`) that imports `hono`, so the root `index.mjs` wins over everything under `src/`; it only passes that check because of the `import("hono")` type annotation in a comment, which must stay. Do not add a root `app.*` (it would be picked first). Per the Vercel Hono docs, `serveStatic` is ignored there and static assets would have to live in `public/`; this API serves none (images are served by the web app).

### How a new projection reaches the API

1. The private content repo builds a projection and opens a PR against this repo that changes `packages/published/data/projection.json` (and media for the web app).
2. The projection must pass validation (`pnpm validate:published`, `pnpm test`) before merge.
3. Merging to `main` triggers a production redeploy of the affected Vercel projects. The API picks the new content up at cold start of the new deployment; the CDN serves the old payload for at most the `s-maxage` window and the old one stale for the `stale-while-revalidate` window.

The projection is bundled into the deployment. There is no runtime fetch from the content repo, so an upstream outage cannot take the API down: it keeps serving the last merged snapshot.

### Monorepo build behaviour

Per the Vercel monorepo docs (fetched 2026-10-03, `vercel.com/docs/monorepos`):

- By default a push creates a deployment for **each** connected project in the repo.
- Vercel can automatically **skip unaffected projects**. A project counts as changed if its own source changed, if any of its internal (workspace) dependencies changed, or if a lockfile change only affects that project's dependencies. This does not use concurrent build slots, unlike the Ignored Build Step.
- Requirements: the project is connected to a **GitHub** repository; the monorepo uses npm, yarn, pnpm or Bun workspaces (pnpm is detected from the root lockfile and `packageManager`); every workspace package has a **unique `name`**; dependencies between packages are **explicitly declared** in each `package.json`; packages are covered by the workspace definition. Files outside the workspace globs count as global changes and redeploy everything.
- This repo meets them: `pnpm-workspace.yaml` includes `apps/*` and `packages/*` (the two prototypes left it on 2026-10-31, tag `prototypes-final`); `@catalyst/api` declares `@catalyst/schemas` and `@catalyst/published` as `workspace:*`. Any package added to the workspace needs its own unique name, or it will confuse the graph.
- To turn the behaviour off: project **Settings > Build and Deployment > Root Directory > Skip deployment** toggle. If the requirements cannot be met, use the **Ignored Build Step** setting instead (its cancelled builds do count against build limits).
- Optional filtered install (installs only this app and its workspace dependencies), as `installCommand` in `apps/api/vercel.json` or in project settings: `pnpm install --filter @catalyst/api...`. Not required, so no install-command override is committed (`apps/*/vercel.json` only pin the framework preset).

**Dependency graph consequence.** `@catalyst/published` is a dependency of both the API and the web app, so a change to published content (`packages/published/**`) affects **both** projects and redeploys both. This is intended: they must move together. Conversely a change confined to `apps/web` does not redeploy the API. If the web app declares `@catalyst/api` (even as a devDependency, for the types), changes in `apps/api` will also redeploy web; that is the price of typed access and is acceptable because `contract.ts` is stable.

### Incident: 500 `FUNCTION_INVOCATION_FAILED` on every path (2026-10-08)

The first production deployment of `catalyst-v2-api` (Root Directory `apps/api`, preset Hono, from `main` at `d07ddd1`, Node 24.x) built green and answered 500 on every path, including `/health`. The runtime log (`vercel logs -p catalyst-v2-api`):

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/var/task/apps/api/node_modules/@catalyst/schemas/src/index.ts' imported from /var/task/apps/api/src/app.js
```

Root cause, two stacked defects of the setup, both visible in the build log (`vercel inspect <url> --logs`):

1. **Wrong entry.** The build log says `Multiple entrypoints found: src/app.ts, src/index.ts. Using src/app.ts.` Both files import `hono`, and the preset prefers `src/app` over `src/index`. `src/app.ts` only exports `createApp`, not a default app, and never loads the content. Even with its imports fixed, the function would not have served anything.
2. **No bundling.** The preset (builder `@vercel/node`) compiles each traced `.ts` file to a `.js` file with `tsc` and keeps the import specifiers: relative ones stay extension-less (`./snapshot`) and the workspace packages are still imported by their `exports`, which point at raw sources (`@catalyst/schemas` -> `./src/index.ts`). The function holds `packages/schemas/src/index.js`, nothing at `.../src/index.ts`, so the import fails (and Node does not strip types under `node_modules` anyway).

The earlier "Verified with the Vercel CLI offline ... the entry bundles together with the workspace packages" claim here was **incomplete and wrong**: a `vercel build` that succeeds only shows that the build step passes and that `.vercel/output/functions/index.func` exists. That output was never executed. It contains no `@catalyst/published`, no default export and a handler (`apps/api/src/app.js`) that cannot be imported, which executing it shows at once.

Fix: the function is the esbuild bundle that already ran standalone under plain node (`dist/index.mjs`), selected through the root `apps/api/index.mjs` (see above). The resulting function contains exactly `apps/api/index.mjs` and `apps/api/dist/index.mjs`, no `node_modules` (`.vc-config.json`: handler `apps/api/index.mjs`, no `filePathMap`). The packages keep exporting `.ts` sources (the web app and the tests rely on that).

Guard: `scripts/check-function.mjs` (the tail of `pnpm build`, hence CI and the Vercel build; also `pnpm --filter @catalyst/api check:function`). It checks that the preset's entry detection yields `index.mjs`, then copies `index.mjs` and `dist/index.mjs` alone into an empty temp directory (no `node_modules`, no sources), imports the default export and requests `/health`, `/v1/projection`, `/v1/places`, a 404 and a 405. Verified to fail when the bundle leaves `@catalyst/schemas` external (`ERR_MODULE_NOT_FOUND`) and when a root `app.ts` is added.

### What is and is not verified

Verified locally (Node 26.10; the project runs Node 24.x on Vercel, no other Node was available; the bundle targets node22 and CI runs 22):

- `typecheck`, the vitest suites, `pnpm build` (including `check-function.mjs`) and `check:leaks` pass.
- Reproduction before the fix: `vercel build` (CLI 52.0.0, offline, hand-written `.vercel/project.json` with `rootDirectory: apps/api`, preset `hono`, in a scratch copy) prints the same `Multiple entrypoints found ... Using src/app.ts` line as the production build and emits handler `apps/api/src/app.js`. Importing that handler in a copy of `index.func` (with the `filePathMap` symlinks restored, as in the lambda) fails with the production error: `Cannot find module '.../apps/api/node_modules/@catalyst/schemas/src/index.ts' imported from .../apps/api/src/app.js`.
- After the fix: the same `vercel build` prints `Multiple entrypoints found: index.mjs, src/app.ts, src/index.ts. Using index.mjs.` and emits handler `apps/api/index.mjs`. The default export of that handler, run from a copy of `index.func`, answers `/health` 200, `/v1/projection` 200, `/v1/places` 200 (`[]`: the committed projection is empty), `/nope` 404 and `POST /v1/places` 405, all as JSON.
- `pnpm dev` is untouched (`tsx watch src/server.ts`).

Not verifiable without a real deployment:

- Vercel's own launcher and runtime (the local check calls the default export's `fetch` directly) and Node 24; the Vercel build uses CLI 62.1.0, the local check CLI 52.0.0, so a difference in the Hono builder between them is possible. The PR's preview deployment of the API project is the real proof: `curl -i <preview-url>/health` must answer 200 with `{"ok":true,"schemaVersion":1,"content":"published",...}`, `/v1/places` 200, `/nope` 404 JSON. Its build log must say `Using index.mjs`.
- The CDN honouring `s-maxage` / `stale-while-revalidate` as documented, and the automatic skip of unaffected projects in this specific repo layout.
- The dashboard's saved overrides (the checklist clears them).

Optionally, the web project can discover this API's preview URL with Vercel Related Projects (`relatedProjects` in `apps/web/vercel.json`), so web previews call the matching API preview rather than production.

**The API project only builds when the API can have changed (2026-10-27).** `apps/api/vercel.json` has an `ignoreCommand` that skips the build (exit 0 means skip) unless the commit touches `apps/api`, `packages/schemas`, `packages/published` or the lockfile, the only inputs of the API. A web-only or docs-only commit no longer spends two of the free plan's 100 deployments a day on the API project; Vercel marks that preview "Skipped" (inactive), which the `main` ruleset's "Preview – catalyst-v2-api" rule does not count as a success, so that rule needs the API preview waived for such commits.
