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
  published/      The published projection (data/projection.json) + loader, local preview loader, placeholder test fixture
  geodata/        Coastline/border datasets for the globe + the generator script
prototypes/
  globe/          Renderer comparison (Three.js vs MapLibre). Not deployed; kept as evidence.
  street-zoom/    Spike of the street map pass (not deployed; source of the line rules and of docs/street-zoom-spike.md)
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

The website keeps working from the last merged projection if Polarsteps or the importer breaks.

## Quick start

Requires Node 22+ and pnpm 10.

```bash
pnpm install
pnpm dev            # web on http://localhost:5173: your local preview if you made one, else the published (empty) state
pnpm dev:demo       # web with the placeholder fixture (made-up places), explicit opt-in only
pnpm dev:api        # api on http://localhost:3001
```

### Test on a phone

`pnpm dev` listens on every interface, so a phone on the same Wi-Fi or on your Tailscale tailnet can open it: read the URLs it prints at startup (`http://<LAN IP>:5173/`, `http://<tailscale IP or name>:5173/`). WebGL (the globe and the street map) works over plain http; service workers, the clipboard API and other secure-context APIs need https (`tailscale serve --bg 5173`, tailnet only). Which URLs, how to read the performance state and the caveats: [Testing on a phone](docs/performance.md#testing-on-a-phone). The preview data is then reachable by anyone who can reach that port: on a network you do not trust, run `CATALYST_DEV_HOST=localhost pnpm dev`.

### See your real places locally (preview)

The committed projection is empty until the first publication, and demo data is made up, so to see your own places on the globe, build a **local preview** from the private repo (all places, drafts included, names and positions only, with the generated group hierarchy):

```bash
cd ~/Developer/catalyst-content && pnpm export:preview --out ../catalyst
cd ../catalyst && pnpm dev          # the bottom-left badge reads "PREVIEW · local data · not published"
```

This writes one git-ignored file, `packages/published/data/preview.projection.json`. It is never committed, never published, never part of a build (`pnpm check:leaks` fails if it is tracked or if its places appear in a production bundle). Without that file, `pnpm dev` serves the published (empty) projection and prints a one-line hint. Re-run the export after editing places; reload the page to see it (restart `pnpm dev` only if the file did not exist when it started). The API never serves the preview.

To try a production build with the preview on your machine only: `pnpm build && CATALYST_CONTENT=preview CATALYST_ALLOW_PREVIEW=1 pnpm --filter @catalyst/web start` (without `CATALYST_ALLOW_PREVIEW=1` a production process refuses preview content).

## Commands

| Command | What it does |
|---|---|
| `pnpm typecheck` | Type-check every package |
| `pnpm test` | Unit tests across the workspace |
| `pnpm test:scripts` | Tests of the repo scripts (leak-check helpers) |
| `pnpm test:deploy` | Tests of the tile extraction plan (`deploy/tiles`) |
| `pnpm check:leaks` | After `pnpm build`: fail on private vocabulary, a tracked/unignored preview file, or preview places inside a bundle |
| `pnpm build` | Production builds of both Vercel projects (`apps/web`, `apps/api`) |
| `pnpm validate:published [file]` | Validate a projection against the contract incl. cross-references (default: the committed projection; a relative path is relative to the directory you typed the command in, run it from the repo root) |
| `pnpm --filter @catalyst/schemas build:contract` | Regenerate `published.schema.json` (a test fails if it is stale) |
| `pnpm --filter @catalyst/geodata generate` | Regenerate the globe datasets from Natural Earth |

GitHub Actions (`.github/workflows/ci.yml`) runs `pnpm install --frozen-lockfile`, `typecheck`, `test`, `test:scripts`, `test:deploy`, `build` and `check:leaks` on every pull request and on pushes to `main`. It needs no secret. The browser, GPU and local-tile checks (`pnpm perf`, the Playwright scripts) are not part of it.

## Environment variables

| Variable | App | Meaning |
|---|---|---|
| `CATALYST_CONTENT` | web, api | `published` (default). Web only: `preview` (local file, dev only) or `demo` (placeholder fixture). The api accepts `published` or `demo`. Never set `demo` or `preview` in production. |
| `CATALYST_DEV_HOST` | web (dev server) | Unset: the dev server listens on every interface (phones on the LAN or tailnet can open it). `localhost` keeps it on this machine; an IP binds that one interface. Dev only, builds ignore it. |
| `CATALYST_DEV_ALLOWED_HOSTS` | web (dev server) | Comma-separated extra Host names the dev server accepts (a leading dot allows a domain). `*.ts.net`, `*.local`, `*.lan`, `*.home.arpa` and this machine's hostname are accepted already; IP addresses always are. |
| `CATALYST_ALLOW_PREVIEW` | web | `1` lets a production-mode process (`react-router-serve`) read the local preview file; for testing a build on your own machine only, never set it on a deployment. |
| `CATALYST_API_URL` | web | Optional. Fetch `${url}/v1/projection` with a 2 s timeout; fall back to the bundled snapshot on any failure. |
| `PORT` | api (dev server only) | Defaults to 3001. |

No secrets exist in this repository or in either Vercel project. The Polarsteps token is a secret of the private content repo's workflow only.

## Documentation

- [Owner's guide](docs/owner-guide.md): day-to-day recipes (add, edit, hide, preview, sync, publish, roll back), secrets, groups, Vercel, troubleshooting, cheat sheet
- [Architecture overview](docs/architecture.md): layers, data flow, invariants, deployment
- [Web architecture](docs/web-architecture.md): routing, data, focus management, globe lifecycle, measurements
- [Design tokens](docs/design-tokens.md)
- [Renderer decision](docs/renderer-decision.md): why standalone Three.js, with benchmarks
- [Street map architecture](docs/street-architecture.md): the street-scale renderer (pixel pass, style, handover, palette, road hierarchy)
- [Pixel line rules](docs/pixel-line-rules.md): the line and palette spec the street renderer follows
- [Performance](docs/performance.md): investigation, fixes, measurements and the budget check of the globe and street renderers
- [Self-hosting](docs/self-hosting.md): containers and the fallback tile server
- [Handoff](docs/handoff.md): state of the rebuild and what is left
- [API contract](docs/api-contract.md): endpoints, caching, Vercel setup, monorepo build behaviour
- Private repo docs (privacy model, import contract, sync invariants, editorial workflow, publication, database migration plan) live in the content repository.

## License

Source-available, not open source. You are welcome to read the code, learn from it, take inspiration, and reuse individual pieces (functions, shaders, components) in your own projects with attribution. You may not publish or deploy a copy of the site, and the Catalyst name, design and content are not licensed for reuse. See [LICENSE](LICENSE) for the exact terms. `packages/geodata` is MIT.
