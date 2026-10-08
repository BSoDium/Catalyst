# Handoff (2026-10-07, second session)

State of the rebuild on branch `feat/places-archive-rebuild` (draft PR #234) and what is left.

## Verified at handoff

- `pnpm typecheck` clean, `pnpm test` green (web 591), `pnpm build` and `pnpm check:leaks` pass (see the PR for the exact run).
- Private repo (`catalyst-content`): 504 tests green, typecheck clean, everything pushed to `origin main`.
- Not verified: Safari/iOS, real phones, reduced motion in a browser.

## Done this session

- **Camera centres on the bounding box** (`cb2e704`): every camera move to a place uses `placeFraming(place)`; marker and label stay on `coordinates`. `scripts/globe/groups.mjs` reads the cut (3.7 up, 3.45 back) from `handover/maths.ts` and checks both sides of each threshold. The old failure was a stale constant, not a regression.
- **Owner's guide** ([owner-guide.md](owner-guide.md), `0fc9c92`).
- **Self-review of both repos**: private repo `docs/self-review-2026-10.md` (ranked actions, 42 doc corrections, suggested order of work). Its doc corrections were applied except one that needs a decision: the street line gate count (`performance.md` says 171 of 171, `street-architecture.md` 241 of 241; rerun `pnpm test:street-lines` and pick one). The `globe/` import rule is now kept and enforced (see below).
- **Public CI** (`.github/workflows/ci.yml`): install, `typecheck`, `test`, `test:scripts`, `test:deploy`, `build`, `check:leaks` on every PR and push to `main`, actions pinned by SHA, no secret. It could not be run locally (only each command was); the first run on GitHub is the real test. Making the `check` job a required status is a repo setting for the owner.
- **Layering**: the three upward imports are gone (`zoomCorrection` and `routeLift` moved down into `engine/`; the credits button is handed to the globe as the `attribution` prop instead of being imported), and `app/globe/layering.test.ts` pins the rules (docs/web-architecture.md, "Layering"). Also: `validate:published` takes a path relative to where it is typed, `workspace:*` everywhere, `noUnusedLocals` on in `tsconfig.base.json` (the two prototypes opt out until their fate is decided) with the six existing errors fixed.
- **Content model v2, owner approved D1 to D5**; phase P0 done in the private repo (`b9402fd`: `src/vault/model`, `DocumentStore`, `SourceReader`; export and preview bytes unchanged). P1 (`vault migrate`, shadow `content/`) is not started.
- **Vercel failure diagnosed from the real build log** (`vercel inspect --logs`): the old project `catalyst-v1` (renamed on purpose, it stays the v1 site) builds at the repo root and fails with `Failed to resolve "@remix-run/dev"`. Expected until the merge; not a defect of this branch.
- **GPU budgets rerun** (headless, machine not idle: 48 % then 34 % GPU busy before the run, WindowServer and other apps). The three rows that failed before (`s2-hcmc`, `s3-in`, `s3-out`) pass in both runs. Remaining: `s4 gpuMean` 5.05 and 4.71 (budget 4.5) and `s5-open gpuMean` 5.13 once (budget 5). Frame time, main thread, heap and drops pass. Not conclusive: rerun with the other GPU users closed, and `--headed` for the 120 Hz number.

## Open items, in priority order

1. **Vercel (owner action, after the merge).** The dashboard only offers Root Directories that exist on `main`, so the two NEW v2 projects (web on `apps/web`, served on a temporary `v2.bsodium.fr`; API on `apps/api`) are created after the merge. Disconnect or ignore-build `catalyst-v1` then. Checklist in [api-contract.md](api-contract.md#deployment-on-vercel).
2. **Mark the PR ready** once merged-ready (the Vercel check of the old project keeps failing until then, by design).
3. **Bounding boxes**: decided 2026-10-07 to keep the dynamic OSM-derived boxes with as few manual overrides as possible; some cities are legitimately large. No size limit is enforced. Only a clearly wrong match (Mostar matched a 5 x 6 km local community) is worth a fix, ideally in the geocoding query rather than by hand. 34 places have no box (the `status: "fallback"` entries of the private `config/bboxes.json`) and keep their radius.
4. **GPU budgets**: accepted as is (2026-10-07). The remaining `s4`/`s5-open` `gpuMean` overruns are marginal; the owner will check a low-end phone instead of chasing the budget further.
5. **Content model v2, P1** (in progress, private repo): `SourceReader` listing first, then `vault migrate` (shadow `content/` beside `editorial/`). See the private `docs/content-model-v2-migration.md`.
6. **Self-review actions** (ranked in the private report; public CI, the layering test and the dead web code are done): conformance test between the private golden projection and the public zod schema, splitting `handover/controller.ts` and `street/engine.ts` around pure, tested decisions (issues #235 to #238).
7. **Phone testing**: `pnpm dev` binds to all interfaces ([performance.md](performance.md#testing-on-a-phone)). There is no on-screen perf overlay; use `?globe-debug` and `__perf`.
8. **Nothing is published yet** (0 published places, the public site shows an empty globe). Publishing is by PR from the private repo's `publish.yml`; merging that PR is the act of publishing.

## Stacked branch: globe polish (not part of PR #234)

Owner feedback from the dev build, kept out of this PR and stacked on top as `feat/globe-polish`. Implemented (2026-10-07, details in [web-architecture.md](web-architecture.md), "Targets and labels", "Box outline", "Pixel text", and [design-tokens.md](design-tokens.md)):

1. Type: Tiny5 made taller on the same grid (7-row capitals, 5-row lowercase) instead of relying on a heavy bold (`pixel-font/stretch.ts`). SUPERSEDED 2026-10-08: Fusion Pixel 10px, one weight, no stretch (docs/web-architecture.md, "Pixel text").
2. Boxes: solid corner arms with dashes between them at rest, one uninterrupted solid line on hover or selection, no ring and no doubling (`drawBox`).
3. Unlabelled, unclickable squares (Houston, New York): the label priority floor withheld the name of every priority-50 place on the world view, and the only target of a small box was its border and label. The floor is gone; a box that loses a label collision was dimmed and still clickable (`label-plan.ts`). SUPERSEDED 2026-10-08: no box is dimmed and none lacks a label (candidate positions, a shorter label, then drawn on top).
4. Credits: a dim text link "Credits" with an up-right arrow instead of the "i" chip (`--subtle-foreground`).
5. Globe outline: the `faint` palette level instead of `soft`.
6. Targets: the convex hull of the box and its label, plus slop, innermost wins (`hit-area.ts`).

Not verified: Safari/iOS, a real touch screen (the touch slop and the 44 px target are by arithmetic and unit tests only), reduced motion in a browser for the new dim rule, the street scale (only the shared `BoxScene` code path, the street overlay itself was not driven), and the GPU budgets (not rerun).

Round 2 (2026-10-08, same branch, owner feedback; details in [web-architecture.md](web-architecture.md), "Binary visibility, timed transitions", and [street-architecture.md](street-architecture.md), "Binary layers"):

1. A label that cannot sit above its box nests inside it, off the outline (`labelCell`, `INSIDE_MARGIN`); the hit hull follows it.
2. The sea texture waits for a flat view (`street/core/flatness.ts`: bulge of 4 px or less, about unified zoom 8.3 on a 900 px screen); the graticule stays until then.
3. Box arms and dashes scale with the box (arm 3 to 14 cells, gap 2 to 9; a tiny box is solid), `dashingFor`.
4. Everything is binary with timed transitions (`engine/fade.ts`, 200 ms, hysteresis on every threshold, loop runs until the last transition ends, reduced motion instant). The collision dim is binary too.
5. The same principle for the rest of the map: globe borders, street road classes, fills, sea, graticule are switches (`street/style/layer-switch.ts`); the ease already was timed. Inventory and decisions in web-architecture.md. The street style's old tone ramps (`from`/`full`) are replaced by a switch zoom `on` per class (about 30 % of the old span): the look of a class at rest is its old final look, appearing a little later than its first faint tone did. Correction (2026-10-08, owner: the streets inside cities are noisy, the hierarchy got lost): giving every class its FINAL tone at 30 % of the old span made residential streets level 4 from z12.8 and compressed primary/secondary/tertiary (9/7/5); the road tiers are now constant and equally spaced (10/8/6/4, links 3, residential, service and paths 2) and the minor classes switch on later (street-architecture.md, "Road hierarchy").
6. A node with no drawn ancestor is never dimmed or faded by its parent (London under an open Europe). (The consequence noted here, a box without a name, no longer exists: every drawn box has its label, 2026-10-08.)
7. Dead web code removed (`engine/labels.ts`, `street/core/label-place.ts`, `marker-visibility.ts` with their tests, the orphan exports, the unused locals, the `from` parameter of `bboxFitRadiusKm`); `MERCATOR_FROM` now exists once (`street/core/warp.ts`).

Not verified in round 2: Safari/iOS, touch, reduced motion in a real browser (unit tests and the `reduced` check only), the GPU cost of the new transitions (no perf budget was run). `tile-fade.mjs ghostlow` fails on `z4.5 zoom` (390 trail cells in the one frame at z5.0 where MapLibre swaps tile level; no layer is switched in that range) and could not be compared with HEAD.

## Decisions taken

- Content model v2: D1 to D5 adopted as recommended (see private `docs/content-model-v2.md` section 9).
- Selected/hovered box styling: superseded by the globe polish branch (dashed boxes with solid corners, solid on hover or selection; no width change, no inner ring).
- Credits follow the tile configuration, not the active source.

## Stacked branch: credits line and idle rotation (`feat/credits-rotation`, on top of `feat/globe-polish`, 2026-10-08)

1. Credits: the "Credits" link is a one-line mono summary ("© OpenStreetMap · OpenFreeMap · Natural Earth", derived from `core/attribution.ts`, clipped from the end on narrow screens) plus a "See more" button with an up-left arrow, in the same card as the dev badge (`lib/map-card.ts`, `MAP_CARD`). The dialog's borders are the soft `--border`. Details: [street-architecture.md](street-architecture.md) (attribution), [design-tokens.md](design-tokens.md) ("Map card and credits line"). To confirm with the owner: the line says "© OpenStreetMap" (the licence wording "© OpenStreetMap contributors" is in the dialog), and the dim text on the card's 80 % plate is 3.7:1 worst case over a full-strength map line in light (4.9:1 over the plain page).
2. Idle rotation: [web-architecture.md](web-architecture.md) "Idle rotation", [performance.md](performance.md) "Idle rotation". Off in every `?globe-debug` page unless `?rotate` / `?spin-idle=MS`, so the zero-frame checks are unchanged. Not verified: Safari/iOS, real touch, real reduced motion, GPU cost.

## Stacked branch: skybox (`feat/skybox`, on top of `feat/credits-rotation`, 2026-10-08)

A faint pixel-art Milky Way and star field behind the earth in the globe view: [web-architecture.md](web-architecture.md) "Skybox", [design-tokens.md](design-tokens.md) "Sky" (the tuning table), [performance.md](performance.md) "Skybox". Inertial celestial frame (galactic pole RA 192.86 / Dec +27.13, plane inclined 62.9 degrees to the equator); a camera orbit moves the sky with the view, the idle rotation does not move it at all (ERA compensates the longitude); palette levels 1 and 2, below the graticule; fades to the page colour towards the silhouette; a timed binary switch off when the globe fills the picture (gone before the street cut). Debug pages have it OFF unless `?sky` (the older pixel checks), `?no-sky` switches it off anywhere, `SKY=1` runs any script with it on. To confirm with the owner: how faint (the tones are the two lowest palette levels; `fade`, `band.gain` in `tuning.ts`), the band being absent from most orbit angles (the visible window is 56 x 37 degrees minus the earth, the band covers about a quarter of the sky), no real star catalogue (none could be checked), the light scheme kept. Not verified: Safari/iOS and other GPUs than the M4's, a phone, real reduced motion, no performance budget was run.
