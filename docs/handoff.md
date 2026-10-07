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
- **Vercel failure diagnosed from the real build log** (`vercel inspect --logs`): the deployment fails at the repo root with `Failed to resolve "@remix-run/dev"`, i.e. Root Directory is still empty. The project is now named `catalyst-v1`.
- **GPU budgets rerun** (headless, machine not idle: 48 % then 34 % GPU busy before the run, WindowServer and other apps). The three rows that failed before (`s2-hcmc`, `s3-in`, `s3-out`) pass in both runs. Remaining: `s4 gpuMean` 5.05 and 4.71 (budget 4.5) and `s5-open gpuMean` 5.13 once (budget 5). Frame time, main thread, heap and drops pass. Not conclusive: rerun with the other GPU users closed, and `--headed` for the 120 Hz number.

## Open items, in priority order

1. **Vercel (owner action).** Dashboard, project `catalyst-v1`: Root Directory `apps/web`, keep "Include source files outside of the Root Directory", clear Install/Build/Output overrides, redeploy. Then a second project, Root Directory `apps/api`. Checklist in [api-contract.md](api-contract.md#deployment-on-vercel).
2. **Push and mark the PR ready** once the Vercel checks are green.
3. **Review the bounding boxes** (private `config/bboxes.json`): 24 boxes have a side over 45 km (Quito 87 x 94 km is the whole canton, Tupiza, Caïdat de Bir Gandouz, Leticia, London = Greater London, Houston, ...), Mostar matched a 5 x 6 km local community instead of the city. 34 places have no box (the `status: "fallback"` entries of that file) and keep their radius. Fix by hand-setting `bbox` or `viewRadiusKm` on the editorial place, or `pnpm geocode-bboxes --refresh <slug>`. Proposed actions were sent to the owner in chat.
4. **GPU budgets on a truly idle machine** (above), then decide whether the ease stage (`gl/pixel-pass.ts` `FRAG_EASE`) needs a cheaper path at tile-heavy views.
5. **Content model v2, next phase**: P1 shadow (`vault migrate`); first make `SourceReader` list steps so `propose`, `coverage`, `scaffold` and `curate-cli` stop reading `source/trips/**` directly (details in the self-review, 3.3).
6. **Self-review actions** (ranked in the report): CI for both repos, dead web code and the three upward imports (`engine/scene.ts`, `engine/renderer.ts`, the two canvases importing `components/attribution-button`), conformance test between the private golden projection and the public zod schema, splitting `handover/controller.ts` and `street/engine.ts` around pure, tested decisions.
7. **Phone testing**: `pnpm dev` binds to all interfaces ([performance.md](performance.md#testing-on-a-phone)). There is no on-screen perf overlay; use `?globe-debug` and `__perf`.
8. **Nothing is published yet** (0 published places, the public site shows an empty globe). Publishing is by PR from the private repo's `publish.yml`; merging that PR is the act of publishing.

## Decisions taken

- Content model v2: D1 to D5 adopted as recommended (see private `docs/content-model-v2.md` section 9).
- Boxes that are selected, focused or hovered keep the extra inner ring.
- Credits follow the tile configuration, not the active source.
