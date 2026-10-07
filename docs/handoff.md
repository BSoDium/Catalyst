# Handoff (2026-10-07)

State of the rebuild on branch `feat/places-archive-rebuild` (draft PR #234) and what is left. Written when the weekly budget ran out, for whoever continues.

## Verified at handoff

- `pnpm typecheck` clean, `pnpm test` green (web 583, api 32, schemas 28, published 11, geodata 105), `pnpm build` and `pnpm check:leaks` pass.
- Private repo (`catalyst-content`): 489 tests green, everything pushed to `origin main`.
- Not verified: Safari/iOS, real phones, reduced motion in a browser.

## Open items, in priority order

1. **Vercel deployment fails** (the only failing check on the PR). Evidence-based cause (about 85 %): the Vercel project still has Root Directory empty and builds the old app. Owner action in the dashboard, with the checklist in [api-contract.md](api-contract.md#deployment-on-vercel): Root Directory `apps/web`, keep "Include source files outside of the Root Directory", clear Install/Build/Output overrides, redeploy; second project with Root Directory `apps/api`. `apps/web/vercel.json` and `apps/api/vercel.json` are in the repo.
2. **Push the public branch** if not done (`git push`), then update the PR description and mark it ready.
3. **GPU budgets**: `pnpm --filter @catalyst/web perf` fails some `gpuP95` rows (s2-hcmc, s3-in, s3-out) while the report says the GPU was about 46 % busy before the run with nothing of ours running. Rerun on an idle machine (close browser panes and other GPU users) before treating it as a regression; if it still fails, the cost is probably the new ease stage (`gl/pixel-pass.ts` `FRAG_EASE`) at tile-heavy views. Frame time, main-thread and heap budgets pass.
4. **Camera centre on the box**: `placeFraming(place)` in `apps/web/app/globe/engine/framing.ts` exists but the camera still centres on the recorded GPS point (`handover/controller.ts` around lines 174 and 389, `routes/shell.tsx` line 53). Call `placeFraming` there so a selected city is centred on its bounding box.
5. **`scripts/globe/groups.mjs` check** "across the real cut the drawn set is the same on both sides" failed at zoom 4.9 before the cut moved (now `cutZoom` 3.7). Rerun and adapt the check to the new cut.
6. **Review the bounding boxes** (private repo `config/bboxes.json`): 24 boxes have a side over 45 km, some are whole municipalities (Quito 87 x 95 km, Tupiza, Caïdat de Bir Gandouz, London = Greater London, Mostar only 5 x 6 km). Fix by hand-setting `bbox` or `viewRadiusKm` on the editorial place, or `pnpm geocode-bboxes --refresh <slug>`. 34 places have no box and keep the radius (list in the private repo's commit `54ec349` message trail and `docs/publication-export.md`).
7. **Camera/selection ring**: boxes that are selected, focused or hovered got a second inner ring because every box is now full ink. Keep or drop (owner's call).
8. **Credits follow the tile configuration**, not the active source (info button on `AttributionButton`). Owner decision pending.
9. **Phone testing**: `pnpm dev` now binds to all interfaces (see [performance.md](performance.md#testing-on-a-phone)); restart a running dev server to pick it up. There is no on-screen perf overlay; use `?globe-debug` and `__perf`.
10. **Content model v2** (private repo `docs/content-model-v2.md`, migration plan next to it): owner decisions D1 to D5 are still open; nothing is migrated.
11. **Nothing is published yet** (0 published places, so the public site shows an empty globe). Publishing is by PR from the private repo's `publish.yml`.
12. **Not started**: the self-review report on modularity and cleanliness of both repos; the owner's guide (how to add, exclude and publish places, preview, sync, secrets, groups, troubleshooting). Both were requested by the owner. Suggested order: owner's guide first (mostly assembling existing docs: README, `editorial-workflow.md`, `publication-export.md`, `grouping.md`, `sync-invariants.md`), then the review (dead code, duplication, module boundaries, test gaps, doc accuracy).

## Done in the last session (for orientation)

- Rectangles: opacity fades (no shade changes), background-coloured masked minimum squares, bold name plus separate regular counter, full-contrast ink by default.
- City boxes: optional `bbox` in the contract, Nominatim-derived cache in the private repo, export derives `viewRadiusKm` from it, web consumes it.
- Resolution doubling bug: the frame governor misread input-event frame intervals as slowness and never recovered. Fixed with a frame clock, plus regression tests (`engine/governor.test.ts`).
- Empty circle on reload: removed; the canvas stays at opacity 0 until its first drawn frame (`scripts/globe/first-frames.mjs`).
- Info button and credits dialog replace the attribution ribbon.
- Street map: road hierarchy by tone and width, detail earlier, globe-to-street cut at zoom 3.7 as a cross-fade, motion-compensated tile fades (documented in [street-architecture.md](street-architecture.md#temporal-ease-tile-arrival-tile-departure-and-the-cut-2026-10-07)). That worker was cut off by a usage limit during its final doc edits, so re-read that section and `docs/performance.md` for accuracy.
