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
| Ordering | `/v1/places` is sorted by slug. Everything else keeps the authored order (routes and stop order are curated). |

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
  "counts": { "places": 11, "routes": 1, "projects": 1, "articles": 1, "artworks": 1 }
}
```

`content` is `published` in production (anything else there is a misconfiguration worth alerting on). On failure:

```json
{ "ok": false, "error": { "code": "content_unavailable", "message": "Content failed validation at startup; see server logs" } }
```

### `GET /v1/projection`

The complete validated projection, exactly the shape of `PublishedProjection`: `schemaVersion`, `places` (full objects, authored order), `routes`, `projects`, `articles`, `artworks`. This is what the globe loads. With the committed (empty) content:

```json
{ "schemaVersion": 1, "places": [], "routes": [], "projects": [], "articles": [], "artworks": [] }
```

### `GET /v1/places`

Array of `PlaceSummary` (`slug`, `name`, `region?`, `coordinates`, `labelPriority`, `summary?`), sorted by `slug`. Optional fields are omitted when absent.

```json
[
  { "slug": "cape-town", "name": "Cape Town", "region": "South Africa", "coordinates": { "lat": -33.92, "lon": 18.42 }, "labelPriority": 55 },
  { "slug": "cusco", "name": "Cusco", "region": "Peru", "coordinates": { "lat": -13.52, "lon": -71.97 }, "labelPriority": 40 }
]
```

### `GET /v1/places/:slug`

The full place with `related` resolved to `{ kind, slug, title }` so a detail view needs no second request. Unknown slug: `404`.

```json
{
  "slug": "lisbon",
  "name": "Lisbon",
  "region": "Portugal",
  "coordinates": { "lat": 38.72, "lon": -9.14 },
  "labelPriority": 60,
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
  ]
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
| `CATALYST_CONTENT` | `published` \| `demo` | `published` (unset or empty) | `demo` serves placeholder fixtures for local development. **Leave it unset in production.** Any other value is a startup error, never a silent fallback. |
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

### Project settings

| Setting | Value |
| --- | --- |
| Git repository | this repo (GitHub-connected) |
| Root Directory | `apps/api` |
| Framework Preset | Hono (or Other) |
| Node.js version | 22.x (matches `.nvmrc`) |
| Install Command | default, or `pnpm install --filter @catalyst/api...` (see below) |
| Build / Output | defaults; no `vercel.json` is needed |
| Environment variables | none. `CATALYST_CONTENT` unset in Production, Preview and Development |

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
- Optional filtered install (installs only this app and its workspace dependencies), as `installCommand` in `apps/api/vercel.json` or in project settings: `pnpm install --filter @catalyst/api...`. Not required, so no `vercel.json` is committed.

**Dependency graph consequence.** `@catalyst/published` is a dependency of both the API and the web app, so a change to published content (`packages/published/**`) affects **both** projects and redeploys both. This is intended: they must move together. Conversely a change confined to `apps/web` does not redeploy the API. If the web app declares `@catalyst/api` (even as a devDependency, for the types), changes in `apps/api` will also redeploy web; that is the price of typed access and is acceptable because `contract.ts` is stable.

### What is and is not verified

Verified locally:

- `typecheck` and the vitest suite pass.
- The built bundle (`dist/server.mjs`, copied outside the repo with no `node_modules`) runs under plain node and serves every endpoint, 304, HEAD, OPTIONS and 405s correctly. The bundled `dist/index.mjs` default export works as a fetch handler.
- `pnpm dev` serves on port 3001.

Not verifiable without Vercel access (no credentials were used, nothing was deployed):

- Whether Vercel's Hono builder bundles the workspace TypeScript sources (`@catalyst/schemas`, `@catalyst/published`, JSON imports) when building `src/index.ts`. The docs do not say. The `build` script proves the entry is bundleable by esbuild, and the entry is kept minimal, but that is not proof about Vercel's own pipeline.
- Whether Vercel's builder is happy with the `build` script emitting `dist/` (the output is unused by Vercel). If it misbehaves, rename the script (for example `bundle`) and keep the root `build` script pointing at it.
- The CDN honouring `s-maxage` / `stale-while-revalidate` as documented, and the automatic skip of unaffected projects in this specific repo layout.

If the first deploy fails to resolve workspace packages, the fallback that needs no change to the API contract is to deploy with Root Directory `apps/api` and an Install/Build Command that runs the esbuild bundle, or to compile the workspace packages to JS. Decide that only from the actual build log.

Optionally, the web project can discover this API's preview URL with Vercel Related Projects (`relatedProjects` in `apps/web/vercel.json`), so web previews call the matching API preview rather than production.
