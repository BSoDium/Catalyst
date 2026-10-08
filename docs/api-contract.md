# Catalyst public API contract (v1)

A small, read-only HTTP API that serves the **curated public content projection** and nothing else. It lives in `apps/api` (`@catalyst/api`) and deploys as its own Vercel project.

There is no import endpoint, no admin or write endpoint, no authentication and no secret. Every response is a pre-serialised view of the validated projection defined in `packages/schemas/src/published.ts`; every object in that schema is `.strict()`, so a field that is not in the schema cannot be served.

## Stability promise

**The published contract is independent of how content is stored upstream.** In v1 the content is files: a private content repo opens a PR against this repo that updates `packages/published/data/projection.json`. Later it may be database-backed editing. In both cases the projection schema, the endpoints and the response shapes below stay the same. Consumers must not be able to tell which backend produced the data.

- Everything is under `/v1`. Within v1 changes are additive only: new optional fields, new endpoints, and new members of a closed set where the section says so (the entry kinds gained `poem`; clients should treat an unknown kind as "something to list, not to render specially"). Removing or retyping a field, or changing an error code, needs `/v2` (which would run alongside `/v1` for a deprecation period).
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

The examples below are real responses with `CATALYST_CONTENT=demo` (placeholder fixture, `packages/published/fixtures/demo.json`).

### `GET /health`

Liveness plus a summary of what is loaded. `200` when content is valid, `503` otherwise.

```json
{
  "ok": true,
  "schemaVersion": 1,
  "content": "demo",
  "counts": { "places": 18, "groups": 8, "routes": 1, "projects": 1, "articles": 1, "artworks": 1, "poems": 1 }
}
```

`content` is `published` in production (anything else there is a misconfiguration worth alerting on). On failure:

```json
{ "ok": false, "error": { "code": "content_unavailable", "message": "Content failed validation at startup; see server logs" } }
```

### `GET /v1/projection`

The complete validated projection, exactly the shape of `PublishedProjection`: `schemaVersion`, `places` (full objects, authored order), `groups` (the automatic place hierarchy, see below), `routes`, `projects`, `articles`, `artworks`, `poems`. This is what the globe loads. It is always the **complete** projection: entries (`projects`, `articles`, `artworks`, `poems`) are full objects with their `body`, unlike the list endpoints below. With the committed (empty) content:

```json
{ "schemaVersion": 1, "places": [], "groups": [], "routes": [], "projects": [], "articles": [], "artworks": [], "poems": [] }
```

`groups` and `poems` default to `[]` when a projection file omits them (see "Entries"), so the committed file does not have to carry `poems` yet; the response always does.

### `GET /v1/places`

Array of `PlaceSummary` (`slug`, `name`, `region?`, `coordinates`, `labelPriority`, `bbox?`, `viewRadiusKm?`, `group?`, `countryCode?`, `summary?`), sorted by `slug`. Optional fields are omitted when absent.

```json
[
  { "slug": "cape-town", "name": "Cape Town", "region": "South Africa", "coordinates": { "lat": -33.92, "lon": 18.42 }, "labelPriority": 55 },
  { "slug": "cusco", "name": "Cusco", "region": "Peru", "coordinates": { "lat": -13.52, "lon": -71.97 }, "labelPriority": 40 }
]
```

`bbox` (optional, `[west, south, east, north]`, additive in schema version 1): the whole extent of the area the place names, in WGS84 degrees (GeoJSON order). For a city it is the city as a whole, not the neighbourhood where the author happened to be: a place whose `coordinates` sit in the north of Houston carries the box of all of Houston. The private export takes it from OpenStreetMap administrative boundaries (a committed cache, never fetched at export time) or from a hand-set editorial value. Rules, validated by `parsePublishedProjection` and by the private export: four finite numbers, longitudes in -180 to 180, latitudes in -90 to 90, `west < east` and `south < north` (a box never crosses the antimeridian). The box is **not** required to contain `coordinates`, and generally does not have the same centre: `coordinates` stays the marker and label anchor, the box is the framing. When `bbox` is present, clients should fit it (centred on the box); when absent there is no known extent and they fall back to `viewRadiusKm`. It carries no source text, only numbers; the underlying boundaries are © OpenStreetMap contributors (ODbL). It is part of both `PlaceSummary` and the full place; consumers that ignore it are unaffected and projections without it stay valid.

`viewRadiusKm` (optional, number, 0.5 to 500, additive in schema version 1): the radius in km of the area that should fit on screen when the place is shown. **When `bbox` is present it is derived from the box**: the radius of the circle centred on the box that covers it (half its diagonal, rounded to 0.1 and clamped to 0.5 to 500), a convenience for clients that frame with a circle; it is then NOT a circle around `coordinates`. Without `bbox` it is the authored city-wide framing around `coordinates`, typically the centre-to-edge distance of the built-up area (Lisbon 10, Paris 14, Ho Chi Minh City 18). Clients fit the whole circle into the free map area with a margin. When absent, the web app uses 12 km, a typical city-wide framing: it is large enough that a mid-size city is seen whole (so the visitor can tell where they are) and small enough that streets stay legible. Consumers that ignore the field are unaffected, and projections without it stay valid. It is part of both `PlaceSummary` and the full place.

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
  "summary": "Demo fixture: a place with prose, dates, an image and related content.",
  "dates": { "start": "2024-03", "end": "2024-04", "label": "Demo dates" },
  "body": [
    "Demo fixture text. This paragraph exists only to exercise the detail panel layout.",
    "A second demo paragraph, to check reading width and spacing."
  ],
  "images": [
    { "src": "/media/demo/field-notes.svg", "alt": "Abstract monochrome grid used as a demo fixture image", "width": 960, "height": 600, "caption": "Demo fixture image" }
  ],
  "related": [
    { "kind": "article", "slug": "demo-article", "title": "Demo article" },
    { "kind": "project", "slug": "demo-project", "title": "Demo project" }
  ],
  "groupChain": [{ "slug": "europe", "name": "Europe", "kind": "continent" }]
}
```

`body` is plain text paragraphs (no HTML or markdown is interpreted). `images[].src` is a site-relative `/media/...` path served by the web app, not by this API.

### `GET /v1/routes`

Explicitly curated routes; stops are place slugs in travel order. Routes are never inferred.

```json
[{ "id": "demo-route-vietnam", "title": "Demo route (curated stop order)", "stops": ["hanoi", "hue", "ho-chi-minh-city"] }]
```

### Entries: `projects`, `articles`, `artworks`, `poems`

An **entry** is a published piece of content that can be linked to places. There are four kinds: `project` (a development project), `article`, `artwork` and `poem` (`ContentKind`). Each kind has its own collection in the projection and its own pair of endpoints, with the same shape (`PublishedContentItem`):

| Field | Type | Meaning |
| --- | --- | --- |
| `slug` | kebab-case, max 80 | Unique within its kind (two kinds may reuse a slug). |
| `title` | 1 to 160 | |
| `summary` | optional, 1 to 500 | Plain text. |
| `date` | optional `YYYY`, `YYYY-MM` or `YYYY-MM-DD` | |
| `url` | optional, https only, max 2000 | The entry's external destination (live demo, repository, original publication). No credentials, no whitespace. |
| `cover` | optional `{ src, alt, width?, height? }` | Image shown in lists and on top of the entry. `src` is a `/media/...` path, `alt` is required (1 to 300), `width` and `height` go together or not at all. |
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

All of this is **additive in schema version 1**: `poems`, `cover`, `tags`, `meta` and `body` are new and optional, `schemaVersion` stays `1`, and a projection that has none of them stays valid (`poems` defaults to `[]`, like `groups`). The only observable changes for existing clients: `/health` counts gained `poems`, `contentKindSchema` and the `kind` of a place's `related` refs gained `poem` (clients with an exhaustive switch over kinds must handle it), the list endpoints gained fields, `url` and media paths are validated slightly more strictly (https without credentials or whitespace; no `..` segments in `/media/` paths: nothing that was a sane value is affected), and there are new endpoints.

#### `GET /v1/projects`, `GET /v1/articles`, `GET /v1/artworks`, `GET /v1/poems`

Arrays of **summaries**, in authored order: the entry without its `body` (`ContentItemsResponse`: `slug`, `title`, `summary?`, `date?`, `url?`, `cover?`, `tags?`, `meta?`, `placeSlugs`). Optional fields are omitted when absent. A list entry is roughly 0.4 to 0.7 KB (summary, cover, tags, meta), which is what a list page needs; fetch the detail (or the projection) for the text.

```json
[
  {
    "slug": "demo-poem",
    "title": "Demo poem",
    "summary": "Demo fixture entry: a poem set in verse blocks.",
    "date": "2022-11",
    "cover": { "src": "/media/demo/cover-poem.svg", "alt": "Abstract short lines grouped in two stanzas, a demo fixture cover", "width": 960, "height": 600 },
    "tags": ["demo", "verse"],
    "meta": [{ "label": "Language", "value": "English (placeholder)" }],
    "placeSlugs": ["hue"]
  }
]
```

#### `GET /v1/projects/:slug`, `GET /v1/articles/:slug`, `GET /v1/artworks/:slug`, `GET /v1/poems/:slug`

The complete entry (`ContentDetailResponse`): every field of the table above **including `body`**, plus `kind` and `places`, the entry's places resolved to `{ slug, name }` in the order of `placeSlugs`, so a detail view needs no second request. `placeSlugs` is kept. An unknown slug, or a slug that belongs to another kind (`/v1/projects/demo-poem`), is `404`. Slugs are lowercase kebab-case; `/v1/poems/Demo-Poem` is a 404.

```json
{
  "kind": "poem",
  "slug": "demo-poem",
  "title": "Demo poem",
  "summary": "Demo fixture entry: a poem set in verse blocks.",
  "date": "2022-11",
  "cover": { "src": "/media/demo/cover-poem.svg", "alt": "Abstract short lines grouped in two stanzas, a demo fixture cover", "width": 960, "height": 600 },
  "tags": ["demo", "verse"],
  "meta": [{ "label": "Language", "value": "English (placeholder)" }],
  "body": [
    {
      "type": "verse",
      "stanzas": [
        ["Demo fixture verse, line one,", "placeholder words in a row,", "    an indented line follows,", "the stanza ends here."],
        ["A second stanza begins,", "made up to check spacing,", "between lines and between stanzas."]
      ]
    },
    { "type": "divider" },
    { "type": "paragraph", "text": "A placeholder note on the poem, in prose." }
  ],
  "placeSlugs": ["hue"],
  "places": [{ "slug": "hue", "name": "Huế" }]
}
```

A place's `related` (`{ kind, slug }`, resolved to `{ kind, slug, title }` in `GET /v1/places/:slug`) may now have `kind: "poem"`. Both directions of the link are valid (an entry lists `placeSlugs`, a place lists `related`); the web app merges them.

#### Payload size and cost

The projection is **bundled** into the web app and into the API function, and `/v1/projection` serves all of it, so entry bodies are paid for in three places: the API bundle (`dist/index.mjs`, parsed at cold start), the web server bundle, and every `/v1/projection` response. Measured with `buildSnapshot` (bytes):

| | raw | gzip | brotli |
| --- | --- | --- | --- |
| Committed projection today (empty) | 108 | 92 | 71 |
| Demo fixture, `/v1/projection` (18 places, 8 groups, 4 entries) | 9,606 | 2,702 | 2,223 |
| Demo: the four entries with their bodies, as lists / as details | 1,853 / ~4,340 | | |
| 100 entries (25 per kind) with a ~3 KB body each, cover, 4 tags, 3 meta, 2 places, **entries only** | ~355,000 | 130,000 to 155,000 | 115,000 to 136,000 |
| Same, one list (25 summaries) | ~16,000 | ~5,200 | ~4,600 |
| Same, one detail | ~3,600 | ~1,900 to 2,000 | |

Each entry costs about 3.5 KB raw in the projection (body 3 KB plus cover, meta and tags) and about 1.3 to 1.6 KB gzipped. The compressed figures come from random dictionary words (about 2.3:1, pessimistic) and are consistent with the ratio of real prose (2.5 to 3:1); source code and verse compress somewhat worse than prose. To budget a whole site, add the places: the owner's preview (146 places, 47 groups) is about 41.5 KB raw and 9 KB gzipped, so **146 places plus 100 entries of 3 KB is about 400 KB raw, 140 to 165 KB gzipped**. The server also pre-serialises every response at startup (the projection, the lists, one detail per entry and per place): that is about 790 KB of strings in memory for the 100-entry case and a module load of a few milliseconds (zod validation of the 100 entries took about 1 ms, building the snapshot about 2 ms), which is negligible next to the 20 ms module load of the bundle itself.

The consequence for the free Vercel quota is in [api-cost-and-abuse.md](api-cost-and-abuse.md) (section 2): `/v1/projection` is the only endpoint whose size grows with the bodies, and a cache-busted client would pull about 400 KB per request from the function. The detail and list endpoints stay small (a few KB). Budget rules that keep the numbers in this table valid: no body above 60,000 characters (enforced), at most 200 blocks (enforced), covers and images are `/media/` files served by the web app, never inlined; if the real content ever approaches 1 MB of projection, split `/v1/projection` (not an incompatible change: a new endpoint) rather than raising a limit.

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
- This repo meets them: `pnpm-workspace.yaml` includes `apps/*`, `packages/*` and `prototypes/*`; `@catalyst/api` declares `@catalyst/schemas` and `@catalyst/published` as `workspace:*`. Any package added under `prototypes/*` needs its own unique name, or it will confuse the graph.
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
