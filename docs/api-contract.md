# Catalyst public API contract (v1)

A small, read-only HTTP API that serves the **curated public content projection** and nothing else. It lives in `apps/api` (`@catalyst/api`) and deploys as its own Vercel project.

There is no import endpoint, no admin or write endpoint, no authentication and no secret. Every response is a pre-serialised view of the validated projection defined in `packages/schemas/src/published.ts`; every object in that schema is `.strict()`, so a field that is not in the schema cannot be served.

## Stability promise

**The published contract is independent of how content is stored upstream.** In v1 the content is files: a private content repo opens a PR against this repo that updates `packages/published/data/projection.json`. Later it may be database-backed editing. In both cases the projection schema, the endpoints and the response shapes below stay the same. Consumers must not be able to tell which backend produced the data.

- Everything is under `/v1`. Within v1 changes are additive only: new optional fields and new endpoints. Removing or retyping a field, or changing an error code, needs `/v2` (which would run alongside `/v1` for a deprecation period).
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
| Ordering | `/v1/places` and `/v1/groups` are sorted by slug. Everything else keeps the authored order (routes and stop order are curated). |

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
| 404 | `not_found` | Unknown path or unknown place slug. |
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
  "counts": { "places": 18, "groups": 8, "routes": 1, "projects": 1, "articles": 1, "artworks": 1 }
}
```

`content` is `published` in production (anything else there is a misconfiguration worth alerting on). On failure:

```json
{ "ok": false, "error": { "code": "content_unavailable", "message": "Content failed validation at startup; see server logs" } }
```

### `GET /v1/projection`

The complete validated projection, exactly the shape of `PublishedProjection`: `schemaVersion`, `places` (full objects, authored order), `groups` (the automatic place hierarchy, see below), `routes`, `projects`, `articles`, `artworks`. This is what the globe loads. With the committed (empty) content:

```json
{ "schemaVersion": 1, "places": [], "groups": [], "routes": [], "projects": [], "articles": [], "artworks": [] }
```

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

### `GET /v1/projects`, `GET /v1/articles`, `GET /v1/artworks`

Arrays of content items (`slug`, `title`, `summary?`, `date?`, `url?` (https only), `placeSlugs`).

```json
[{ "slug": "demo-project", "title": "Demo project", "summary": "Demo fixture entry.", "date": "2024", "placeSlugs": ["lisbon"] }]
```

```json
[{ "slug": "demo-artwork", "title": "Demo artwork", "placeSlugs": ["kyoto"] }]
```

## Configuration

| Variable | Values | Default | Notes |
| --- | --- | --- | --- |
| `CATALYST_CONTENT` | `published` \| `demo` | `published` (unset or empty) | `demo` serves placeholder fixtures for local development. **Leave it unset in production.** Any other value is a startup error, never a silent fallback. This includes `preview`: the local preview of unpublished drafts is a web-dev-only mode and the API never serves it. |
| `PORT` | number | `3001` | Local dev server and built artifact only. Ignored on Vercel. |

No secrets. See `apps/api/.env.example`.

### Startup validation

The content is selected and validated once, when the module loads, and every response body is serialised then. If validation fails (bad projection, bad `CATALYST_CONTENT`):

- the details are logged with `console.error` (visible in Vercel function logs);
- on Vercel (`src/index.ts`) the app still starts but answers `503 content_unavailable` on `/health` and every `/v1/*` endpoint. There is no separate startup phase to abort on a serverless platform, and a crash would surface as an opaque platform error instead of this one;
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

The first PR of the rebuild failed its Vercel check because the one project that existed, `catalyst` (formerly `bsodium`, the old Yarn app at the repository root; now renamed `catalyst-v1`, to be confirmed: check that the old `catalyst` project is gone), still had **Root Directory empty**. At the repo root there is no app any more (a pnpm workspace with a `build` script that builds both), so no preset can succeed there. See "Evidence" below.

Web project (reuse the existing project, now `catalyst-v1`):

1. vercel.com, team `photonsquid`, project `catalyst-v1`, **Settings**, **Build and Deployment**.
2. **Root Directory**: type `apps/web`, Save. Leave **Include source files outside of the Root Directory** enabled (the default); it must be on.
3. **Framework Preset**: `React Router` (the committed `apps/web/vercel.json` also says so; the file wins).
4. Clear every override: **Install Command**, **Build Command**, **Output Directory**, **Development Command** all left on their defaults (toggles off). A leftover `yarn install`, `corepack yarn build` or `dist`/`build` from the old app breaks the build.
5. **Node.js Version**: `22.x` or newer (the repo's `engines` is `>=22`; Vercel then uses 24.x and says so in the build log, which is fine). **Settings, Environment Variables**: none needed; make sure no `CATALYST_CONTENT=demo`/`preview` is set (only `published`, the default, is allowed in production).
6. Redeploy: **Deployments**, the failed one, the three dots, **Redeploy** (or push a commit). Expect `Detected pnpm-lock.yaml`, `Running "pnpm install"` at the repo root, then the React Router build, status Ready.

API project (new):

1. vercel.com, team `photonsquid`, **Add New**, **Project**, import the same GitHub repository.
2. Name `catalyst-api`; **Root Directory**: `apps/api`; **Include source files outside of the Root Directory**: on. Framework Preset: `Hono` (pinned by `apps/api/vercel.json`; `Other` fails with "No Output Directory named public"). No overrides, no environment variables. Deploy.
3. Leave **Settings, Build and Deployment, Root Directory, Skip deployment** as it is (it skips a project that a push did not affect, see "Monorepo build behaviour").

After both are green, the PR shows two Vercel checks, one per project.

### Project settings

| Setting | Web (`apps/web`) | API (`apps/api`) |
| --- | --- | --- |
| Git repository | this repo (GitHub-connected) | same |
| Root Directory | `apps/web` | `apps/api` |
| Include source files outside of the Root Directory | on | on |
| Framework Preset | React Router (pinned in `vercel.json`) | Hono (pinned in `vercel.json`; not `Other`) |
| Node.js version | `engines` `>=22`: Vercel uses 24.x (`.nvmrc` says 22, local and CI-style checks ran on 22 and 26) | same |
| Install Command | default (`pnpm install` at the workspace root, from `pnpm-lock.yaml`) | default, or `pnpm install --filter @catalyst/api...` (see below) |
| Build / Output | defaults. The web build applies `@vercel/react-router` only when `VERCEL=1` (`react-router.config.ts`); the API's `build` script emits `dist/`, which Vercel ignores | defaults |
| Environment variables | none required: `CATALYST_CONTENT` unset (`published`); optionally `CATALYST_TILES_*` (docs/self-hosting.md, section 6) | none |

### Evidence (what was reproduced, 2026-10-06)

The check cannot be read without Vercel access, so the cause was reproduced instead:

- The Vercel bot comment on the PR carries the project metadata: one project (`prj_bWZMUhylXdrg9k95Wsq58Cah9XDx`), `rootDirectory: null`, a monorepo. The same project built the old app at the repo root with a green deployment (PR #227). The last three deployments of the rebuild branch (`e94751d`, `1dec39e`, `aae202e`) all failed.
- `git archive` of the pushed head (`aae202e`), `pnpm install --frozen-lockfile` and `VERCEL=1 pnpm run build` pass on Node 22 with pnpm 9 and 10 (web and API), and the built web server answers `/` with 200: the committed tree itself builds.
- The Vercel CLI (`vercel build`, offline, with a hand-written `.vercel/project.json` carrying the settings) on that tree: Root Directory empty fails whatever the preset (React Router: `Failed to resolve "@remix-run/dev"`, Other: `No Output Directory named "public" found`, Vite: `No Output Directory named "dist" found`); Root Directory `apps/web` with React Router succeeds and emits the Build Output API (static assets, one SSR function per route); Root Directory `apps/api` succeeds with Hono and fails with Other.

What is not known: the literal error line of the failed deployment (log not readable), and whether the project's saved Install/Build Command overrides, if any, add a second failure. The checklist clears them either way.

The deploy entry is `apps/api/src/index.ts`: it imports `hono` and has `export default app`, which is what Vercel's zero-config Hono support looks for. Per the Vercel Hono docs, `serveStatic` is ignored there and static assets would have to live in `public/`; this API serves none (images are served by the web app).

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

### What is and is not verified

Verified locally:

- `typecheck` and the vitest suite pass.
- The built bundle (`dist/server.mjs`, copied outside the repo with no `node_modules`) runs under plain node and serves every endpoint, 304, HEAD, OPTIONS and 405s correctly. The bundled `dist/index.mjs` default export works as a fetch handler.
- `pnpm dev` serves on port 3001.

Verified with the Vercel CLI offline (`vercel build`, see "Evidence" above): with Root Directory `apps/api` and the Hono preset the entry bundles together with the workspace packages and the projection (`.vercel/output/functions/index.func`), and the `build` script emitting `dist/` does no harm.

Not verifiable without Vercel access (no credentials were used, nothing was deployed):

- A real deployment: the function's runtime behaviour on Vercel (cold start, the content being found at runtime), the CDN honouring `s-maxage` / `stale-while-revalidate` as documented, and the automatic skip of unaffected projects in this specific repo layout.
- The literal log of the failed web deployment, and the dashboard's saved overrides (the checklist clears them).

Optionally, the web project can discover this API's preview URL with Vercel Related Projects (`relatedProjects` in `apps/web/vercel.json`), so web previews call the matching API preview rather than production.
