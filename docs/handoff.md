# Handoff (2026-10-07, second session)

State of the rebuild on branch `feat/places-archive-rebuild` (draft PR #234) and what is left.

## Verified at handoff

- `pnpm typecheck` clean, `pnpm test` green (web 586), `pnpm build` and `pnpm check:leaks` pass (see the PR for the exact run).
- Private repo (`catalyst-content`): 504 tests green, typecheck clean, everything pushed to `origin main`.
- Not verified: Safari/iOS, real phones, reduced motion in a browser.

## Done this session

- **Camera centres on the bounding box** (`cb2e704`): every camera move to a place uses `placeFraming(place)`; marker and label stay on `coordinates`. `scripts/globe/groups.mjs` reads the cut (3.7 up, 3.45 back) from `handover/maths.ts` and checks both sides of each threshold. The old failure was a stale constant, not a regression.
- **Owner's guide** ([owner-guide.md](owner-guide.md), `0fc9c92`).
- **Self-review of both repos**: private repo `docs/self-review-2026-10.md` (ranked actions, 42 doc corrections, suggested order of work). Its doc corrections were applied except two that need a decision: the street line gate count (`performance.md` says 171 of 171, `street-architecture.md` 241 of 241; rerun `pnpm test:street-lines` and pick one) and the `web-architecture.md` rule against importing app code from `globe/`.
- **Content model v2, owner approved D1 to D5**; phase P0 done in the private repo (`b9402fd`: `src/vault/model`, `DocumentStore`, `SourceReader`; export and preview bytes unchanged). P1 (`vault migrate`, shadow `content/`) is not started.
- **Vercel failure diagnosed from the real build log** (`vercel inspect --logs`): the old project `catalyst-v1` (renamed on purpose, it stays the v1 site) builds at the repo root and fails with `Failed to resolve "@remix-run/dev"`. Expected until the merge; not a defect of this branch.
- **GPU budgets rerun** (headless, machine not idle: 48 % then 34 % GPU busy before the run, WindowServer and other apps). The three rows that failed before (`s2-hcmc`, `s3-in`, `s3-out`) pass in both runs. Remaining: `s4 gpuMean` 5.05 and 4.71 (budget 4.5) and `s5-open gpuMean` 5.13 once (budget 5). Frame time, main thread, heap and drops pass. Not conclusive: rerun with the other GPU users closed, and `--headed` for the 120 Hz number.

## Open items, in priority order

1. **Vercel (owner action, after the merge).** The dashboard only offers Root Directories that exist on `main`, so the two NEW v2 projects (web on `apps/web`, served on a temporary `v2.bsodium.fr`; API on `apps/api`) are created after the merge. Disconnect or ignore-build `catalyst-v1` then. Checklist in [api-contract.md](api-contract.md#deployment-on-vercel).
2. **Mark the PR ready** once merged-ready (the Vercel check of the old project keeps failing until then, by design).
3. **Bounding boxes**: decided 2026-10-07 to keep the dynamic OSM-derived boxes with as few manual overrides as possible; some cities are legitimately large. No size limit is enforced. Only a clearly wrong match (Mostar matched a 5 x 6 km local community) is worth a fix, ideally in the geocoding query rather than by hand. 34 places have no box (the `status: "fallback"` entries of the private `config/bboxes.json`) and keep their radius.
4. **GPU budgets**: accepted as is (2026-10-07). The remaining `s4`/`s5-open` `gpuMean` overruns are marginal; the owner will check a low-end phone instead of chasing the budget further.
5. **Content model v2, P1** (in progress, private repo): `SourceReader` listing first, then `vault migrate` (shadow `content/` beside `editorial/`). See the private `docs/content-model-v2-migration.md`.
6. **CI for both repos**, then the other self-review actions (ranked in the private report): dead web code and the three upward imports, conformance test between the private golden projection and the public zod schema, splitting `handover/controller.ts` and `street/engine.ts` around pure, tested decisions.
7. **Phone testing**: `pnpm dev` binds to all interfaces ([performance.md](performance.md#testing-on-a-phone)). There is no on-screen perf overlay; use `?globe-debug` and `__perf`.
8. **Nothing is published yet** (0 published places, the public site shows an empty globe). Publishing is by PR from the private repo's `publish.yml`; merging that PR is the act of publishing.

## Stacked branch: globe polish (not part of PR #234)

Owner feedback from the dev build, kept out of this PR and stacked on top as `feat/globe-polish`: larger pixel font instead of bold, dashed boxes with solid corners, unlabelled squares (Houston, New York) with no label and no click target, a low-contrast "Credits ↗" link instead of the info chip, a fainter globe outline, a larger hit area (label plus the gap to the box, pointer cursor).

## Decisions taken

- Content model v2: D1 to D5 adopted as recommended (see private `docs/content-model-v2.md` section 9).
- Selected/hovered box styling: superseded by the globe polish branch (dashed boxes with solid corners, solid on hover or selection; no width change, no inner ring).
- Credits follow the tile configuration, not the active source.
