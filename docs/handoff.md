# Handoff (2026-10-08)

Where the project stands and what is left. Details live in the linked docs; this file only keeps the state, the open items and the decisions.

## State

- `main` holds the rebuild (#234), the globe polish (#239 to #241) and the API fix (#243). Open PRs, stacked: **#244** (DOM labels, sticky placement, calmer streets, skybox stars, `feat/polish-2`) and the **peek** branch `feat/peek` (important places drawn inside closed groups, base `feat/polish-2`).
- Deployments (Vercel team `photonsquid`): `catalyst-v2` (web, `apps/web`) at `v2.bsodium.fr`, `catalyst-v2-api` (`apps/api`) at `v2.api.bsodium.fr`. `v1.bsodium.fr` and `v1.api.bsodium.fr` redirect to the old v1 site and API (separate projects; the v1 project's pull-request and non-default-branch deployments are disabled). `v2.bsodium.fr` stays the main domain of the new site until the MVP.
- Nothing is published yet (0 published places: the public site and API show an empty projection). Publishing is by PR from the private repo's `publish.yml`; merging that PR is the act of publishing. `pnpm dev` serves the owner's local preview (`pnpm export:preview --out ../catalyst` in the private repo), `pnpm dev:demo` the made-up fixture.
- Checks: `pnpm typecheck`, `pnpm test`, `pnpm test:scripts`, `pnpm test:deploy`, `pnpm build`, `pnpm check:leaks` (CI runs all of them on every PR). Private repo: `pnpm typecheck`, `pnpm test`, plus the `migration-parity` workflow.
- Not verified anywhere: Safari/iOS, real phones, real reduced motion (Chromium emulation only), the street overlay labels and `groups.mjs handover` after the label overhaul (they need the local tile server), GPU and CPU cost on a phone. The GPU budgets (`pnpm --filter @catalyst/web perf`) were last run on 2026-10-07 on a busy machine and accepted (marginal `gpuMean` overruns at street pan); they were not rerun after the label, sky and peek work.

## Where the details are

| Topic | Doc |
|---|---|
| Layers, publication flow, content modes | [architecture.md](architecture.md) |
| Day-to-day (add, hide, preview, sync, publish, secrets, troubleshooting) | [owner-guide.md](owner-guide.md) |
| Globe engine: LOD, labels in device pixels, sticky placement, binary visibility, peeks, idle rotation, skybox, framing | [web-architecture.md](web-architecture.md) |
| Street map: palette, road hierarchy, binary layers, tile ease, the cut at zoom 3.7 | [street-architecture.md](street-architecture.md) |
| Tokens (colours, label type, map card, sky) | [design-tokens.md](design-tokens.md) |
| Frame cost, budgets, phone testing | [performance.md](performance.md) |
| API contract, Vercel setup, the 500 incident of 2026-10-08 | [api-contract.md](api-contract.md) |
| API quota, abuse, the firewall rules applied | [api-cost-and-abuse.md](api-cost-and-abuse.md) |
| Private repo: content model v2, importance score, bbox acceptance, self-review, route research | `catalyst-content/docs/` |

## Open items

1. **Review and merge #244, then the peek PR.** Retarget the peek PR to `main` after #244.
2. **Owner actions on Vercel:** usage alerts (team settings) and a weekly look at the Usage page for the first month; disconnect or ignore-build the v1 project's Git link when convenient. The firewall rules (allowlist deny, 120 requests per minute per IP) are live; one of the three free custom rules is left.
3. **Content model v2** (private repo): P0 and P1 are done (shadow `content/`, parity gates, CI job). Next: P2 (flip to `content/` as the source) after a week of real use and one real edit in Obsidian or VS Code; issue Catalyst-content#2 tracks P2 to P4.
4. **Importance ranking** (private `config/population.json`, 85 of 146 places matched): 61 places share the same priority today because nothing is published and no entry links to a place. It improves by itself as items are linked; unmatched places can get a manual offset (an authored `labelPriority` is an offset around 50) only if something looks wrong.
5. **Bounding boxes:** automatic acceptance rule (`config/publish.json` `bboxAcceptance`: type and size limits); rejected boxes fall back to a point with the default radius. Quito and Stara Zagora are true cities dropped by it (their OSM boxes are a county and a state district); Rissani, Akhfennir, Samaipata, Sucre, Ipiales and Diama are rural but accepted. Edit the thresholds or set a hand `bbox` for one place. Mostar matched a local community (5 x 6 km).
6. **Routes: skipped by the owner** (they would only look right with road snapping). The research is kept in the private repo (`docs/route-display-research.md`).
7. **Large-scale review items** are tracked as issues: #235 (split the renderer orchestration units), #236 (bbox / `viewRadiusKm` contract and a conformance test), #237 (fate of `prototypes/*`), #238 (dev-only loaders out of the API bundle), and Catalyst-content #1 to #3.
8. **Known test gaps:** `tile-fade.mjs ghostlow` fails at `z4.5 zoom` (about 15 % trail cells in the one frame where MapLibre swaps tile level; no baseline), `sea-ease.mjs` was not updated for the binary switches, `street/lod-check.mjs` has one failure ("out z8 sea XOR graticule"), `markers.mjs` errors on preview content (passes on demo), and the street-line gate count differs between docs (171 vs 241: rerun `pnpm test:street-lines` and fix one number).

## Decisions taken (owner)

- Content model v2: D1 to D5 as recommended (private `docs/content-model-v2.md` section 9).
- Boxes: dim at rest, hover changes colour only, selected changes colour and switches to a solid line; width never changes. Dashes anchored to one corner per edge; arm and gap scale with the box (kept).
- Credits follow the tile configuration; the line is monospace with a middle dot before "See more".
- Vercel: v1 stays as is; v2 web and API are separate projects from this repo.
- Bounding boxes: dynamic, OSM-derived, as few manual overrides as possible; routes skipped; GPU budgets accepted.
- Importance: peek-only client design, population from Natural Earth, step counts never count (privacy), an authored `labelPriority` is an offset around 50, group names keep the authored priority.
