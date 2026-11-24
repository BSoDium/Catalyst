# Development reference

The details behind the README's quick start: phone testing, the local preview, every command and every environment variable.

## Test on a phone

`pnpm dev` listens on every interface, so a phone on the same Wi-Fi or on your Tailscale tailnet can open it: read the URLs it prints at startup (`http://<LAN IP>:5173/`, `http://<tailscale IP or name>:5173/`). WebGL (the globe and the street map) works over plain http; service workers, the clipboard API and other secure-context APIs need https (`tailscale serve --bg 5173`, tailnet only). Which URLs, how to read the performance state and the caveats: [Testing on a phone](performance.md#testing-on-a-phone). The preview data is then reachable by anyone who can reach that port: on a network you do not trust, run `CATALYST_DEV_HOST=localhost pnpm dev`.

## See your real places locally (preview)

The committed projection holds only what has been published, and demo data is made up. To also see places you have not published yet, build a **local preview** from the private repo (all places, drafts included, names and positions only, with the generated group hierarchy):

```bash
cd ~/Developer/catalyst-content && pnpm export:preview --out ../catalyst
cd ../catalyst && pnpm dev          # the bottom-left badge reads "PREVIEW · local data · not published"
```

This writes one git-ignored file, `packages/published/data/preview.projection.json`. It is never committed, never published, never part of a build (`pnpm check:leaks` fails if it is tracked or if its places appear in a production bundle). Without that file, `pnpm dev` serves the published projection and prints a one-line hint. Re-run the export after editing places; reload the page to see it (restart `pnpm dev` only if the file did not exist when it started). The API never serves the preview.

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
