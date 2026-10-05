# Catalyst

A personal archive organized around places. An interactive globe is the main way to discover curated places and the stories, projects, articles and artworks attached to them. Live at https://bsodium.fr.

This repository is the **public** half of the system: the web app, the public API, and the sanitized, published content projection. Raw travel data and editorial drafts live in a separate **private** content repository and reach this repo only as a reviewed pull request.

## Repository layout

```
apps/
  web/            React Router (framework mode, SSR), Tailwind 4, Motion, Three.js globe   [Vercel project 1]
  api/            Hono API serving ONLY the published projection (read-only)                [Vercel project 2]
packages/
  schemas/        The published content contract (zod) + generated JSON Schema
  published/      The published projection (data/projection.json) + demo fixture + loader
  geodata/        Coastline/border datasets for the globe + the generator script
prototypes/
  globe/          Renderer comparison (Three.js vs MapLibre). Not deployed; kept as evidence.
docs/             Architecture, contracts, decisions (see below)
```

## How content flows

```
Polarsteps ──(one-way, daily, GitHub Actions)──▶ private repo: source/ + archive/
                                                  private repo: editorial/   (hand-written, status: draft|published)
                                                          │  export (allowlist + schema gate)
                                                          ▼
                              PR against this repo: packages/published/data/projection.json
                                                          │  merge = publication
                                                          ▼
                                       apps/api  and  apps/web  redeploy
```

The website keeps working from the last merged projection if Polarsteps, the client library or the importer breaks.

## Quick start

Requires Node 22+ and pnpm 10.

```bash
pnpm install
pnpm dev            # web on http://localhost:5173, demo content (placeholder fixtures)
pnpm dev:api        # api on http://localhost:3001
```

`pnpm dev` uses `CATALYST_CONTENT=demo`: clearly labelled placeholder places so the globe and panels have something to show. The committed real projection starts empty; it is replaced by the first publication PR from the content repo. To see the real (empty) state: `pnpm --filter @catalyst/web dev:published`.

## Commands

| Command | What it does |
|---|---|
| `pnpm typecheck` | Type-check every package |
| `pnpm test` | Unit tests across the workspace |
| `pnpm build` | Production builds of both Vercel projects (`apps/web`, `apps/api`) |
| `pnpm validate:published [file]` | Validate a projection against the contract incl. cross-references |
| `pnpm --filter @catalyst/schemas build:contract` | Regenerate `published.schema.json` (a test fails if it is stale) |
| `pnpm --filter @catalyst/geodata generate` | Regenerate the globe datasets from Natural Earth |

## Environment variables

| Variable | App | Meaning |
|---|---|---|
| `CATALYST_CONTENT` | web, api | `published` (default) or `demo`. Never set `demo` in production. |
| `CATALYST_API_URL` | web | Optional. Fetch `${url}/v1/projection` with a 2 s timeout; fall back to the bundled snapshot on any failure. |
| `PORT` | api (dev server only) | Defaults to 3001. |

No secrets exist in this repository or in either Vercel project. The Polarsteps token is a secret of the private content repo's workflow only.

## Documentation

- [Architecture overview](docs/architecture.md): layers, data flow, invariants, deployment
- [Web architecture](docs/web-architecture.md): routing, data, focus management, globe lifecycle, measurements
- [Design tokens](docs/design-tokens.md)
- [Renderer decision](docs/renderer-decision.md): why standalone Three.js, with benchmarks
- [API contract](docs/api-contract.md): endpoints, caching, Vercel setup, monorepo build behaviour
- Private repo docs (privacy model, import contract, sync invariants, editorial workflow, publication, database migration plan) live in the content repository.

## License

Source-available, not open source. You are welcome to read the code, learn from it, take inspiration, and reuse individual pieces (functions, shaders, components) in your own projects with attribution. You may not publish or deploy a copy of the site, and the Catalyst name, design and content are not licensed for reuse. See [LICENSE](LICENSE) for the exact terms. `packages/geodata` is MIT.
