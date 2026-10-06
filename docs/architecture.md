# Architecture overview

Catalyst is a personal archive organized around places. Two repositories, three data layers, two Vercel projects.

## Two repositories

| | Public: this repo | Private: `catalyst-content` |
|---|---|---|
| Holds | App code, the sanitized published projection, approved public media | Source snapshots, archive, editorial files, sync/validate/export scripts |
| Visibility | Public | Private |
| Writes to the other | Never | Opens a PR here (never pushes to the default branch) |

## Three data layers (never mixed)

1. **Source snapshot** (private: `source/`, `archive/`). Imported Polarsteps trips and steps keyed by stable Polarsteps ids. Machine-owned, one-way, never edited by hand. Imported text is source material only.
2. **Editorial content** (private: `editorial/`). Hand-written places, routes and linked content with explicit `status` (`draft` default, `published`, `unpublished`). A place may reference several source steps. Sync can never change it.
3. **Published projection** (public: `packages/published/data/projection.json`). An allowlisted export of records explicitly marked published, plus the place hierarchy derived from them. This is the only content the website and API know about. Contract: `packages/schemas` (zod) and the generated `published.schema.json`.

## Publication flow

`export` in the private repo maps editorial records field by field into the contract, validates them (JSON Schema + cross-references), and opens or updates a PR here. **Merging that PR is the publication step.** It triggers redeploys of both Vercel projects.

## Place grouping (automatic hierarchy)

Places are grouped automatically: everything in the Balkans shows as "Balkans" from far away, above it a continent, and a group's square grows and its children appear as you zoom in. Nobody defines the groups. The private export derives them from the **published** places only (never drafts) and ships them in the projection as `groups` (plus an optional `group` slug on each place): `place -> [area] -> country -> [informal region | UN subregion] -> continent`, with single-child levels skipped so no chain of identical squares appears. Hand-authored places (no source step, for instance where family lives) are first-class: they are grouped by their country, which is derived from their coordinates when not given. Group names come only from static tables, an owner-edited region list and published place names, never from raw source text, so nothing new can leak.

The contract change is additive within schema version 1 (`groups` defaults to `[]`, `group` is optional). The public side only validates and serves it: `PublishedGroup` and the cross-reference rules (parents, cycles, slug clashes, no empty groups) in `packages/schemas`, `GET /v1/groups` and a resolved `groupChain` on place detail in `apps/api` ([api-contract.md](api-contract.md#get-v1groups)). The web app currently only passes the data through (`groups` in the shell loader, `groupSlug` on `GlobePlace`); rendering it is a separate piece of work. Algorithm and configuration live in the private repo's `docs/grouping.md`.

## Deployables

- `apps/web`: React Router framework mode (SSR), Tailwind 4, Motion, shadcn Button, Three.js globe in a lazy client chunk.
- `apps/api`: Hono, read-only JSON from the published projection. No import endpoint, no write endpoints, no secrets.

Both read the same bundled projection. The web app can optionally fetch it from the API (`CATALYST_API_URL`) and always falls back to its bundled snapshot.

## Importer (private repo)

Runs from the private repo's GitHub Actions workflow (daily cron plus manual dispatch), never from browser-reachable routes. It calls the unofficial Python client `remuzel/polarsteps-api` through a thin bridge behind a replaceable `SourceAdapter`. See the private repo's `docs/import-contract.md` and `docs/sync-invariants.md`.

Key invariants: upsert by stable id; prior versions archived before replacement; absence from a complete fetch marks a record missing (never deletes); incomplete or failed fetches make no deletion decisions and no writes for that trip; source removal only raises human-review flags; the token exists only in workflow secrets.

Risk: the client uses undocumented endpoints and a session cookie, may break at any time, may conflict with Polarsteps' terms (account suspension is possible), and has no license (so it is pinned by commit and installed in CI, not vendored). The site is insulated from all of this because it serves the last merged projection.

## Scheduling caveat

The importer's scheduler is GitHub Actions `schedule`, which is best-effort and can be delayed. (If it were ever moved to Vercel Cron on Hobby: once-daily only, may fire anywhere in the scheduled hour, no automatic retry.) Either way the importer is rerunnable and idempotent, logs failures, and preserves the last good snapshot.

## Deployment on Vercel

Two projects from one repo, distinct Root Directories (`apps/web`, `apps/api`). By default a push creates a deployment for every connected project; Vercel automatically skips unaffected projects for GitHub-connected pnpm workspaces when the project's source, its internal dependencies or its own lockfile entries are unchanged (a published-content change affects both, which is intended). Details and fallbacks: [api-contract.md](api-contract.md#deployment-on-vercel).

## Future: database-backed editing

Stable across the migration: the `SourceAdapter` interface, the editorial schema as the data model, the published contract and API. Swapped: file-backed source/editorial storage for private persistent storage and an editor UI. Plan in the private repo's `docs/migration-plan.md`.
