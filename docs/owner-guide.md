# Owner's guide

How to run Catalyst day to day: add and edit places, see them locally, sync from Polarsteps, publish, handle secrets, and fix what breaks. Written for the owner; commands are meant to be pasted. Everything here was checked against the scripts and workflows of both repos on 2026-10-07 (what could not be checked is marked **unverified**).

Two repos, side by side on disk:

| | Path | Branch | Visibility |
|---|---|---|---|
| Public (app, API, published data) | `~/Developer/catalyst` | `feat/places-archive-rebuild` (draft PR #234) | public |
| Private (sources, your editing, scripts) | `~/Developer/catalyst-content` | `main` | private |

Commands below say which repo to run them in: **[private]** or **[public]**.

> **Content model v2 may change this guide.** The editorial files are JSON today (`editorial/places/<slug>.json`). A Markdown "vault" (`content/<kind>/<slug>/index.md`) is proposed but **not adopted**: decisions D1 to D5 are open and nothing is migrated. Everything below describes the current (v1) workflow. If you adopt v2, the recipes in section 2 (file paths, image handling, `new-place`/`propose-places`) change; sections 3 to 10 mostly do not. Read [content-model-v2.md](../../catalyst-content/docs/content-model-v2.md) (owner summary at the top, decisions in section 9) and [content-model-v2-migration.md](../../catalyst-content/docs/content-model-v2-migration.md); the open decisions are also listed in [handoff.md](handoff.md#pending-owner-decisions-content-model-v2).

## 1. Mental model

```
Polarsteps ──sync (GitHub Actions, daily)──▶ private: source/ + archive/      machine-written, never edited
                                                    │ (a base for names, positions, which steps belong to a place)
you ──edit──▶ private: editorial/ (+ config/)       hand-written, status: draft | published | unpublished
                                                    │ export (publish.yml): allowlist + two validation gates
                                                    ▼
                    ONE rolling PR "content: publish editorial update" on the PUBLIC repo
                    packages/published/data/projection.json + apps/web/public/media/**
                                                    │ YOU MERGE IT = publication
                                                    ▼
                    Vercel redeploys web (bsodium.fr) and API
```

| Layer | Where | Written by | Leaves the private repo? |
|---|---|---|---|
| 1. Source snapshot | private `source/`, `archive/` | `sync` only | never |
| 2. Editorial | private `editorial/`, plus `config/regions.json`, `config/bboxes.json`, `config/publish.json` | you (bboxes: one script you run) | only the allowlisted subset of `published` records |
| 3. Published projection | public `packages/published/data/projection.json` + `apps/web/public/media/**` | `export`, never by hand | yes, by design |
| Local preview | public `packages/published/data/preview.projection.json` (git-ignored) | `pnpm export:preview` | never |

Rules to remember:

- **The only publication act is merging the publication PR in the public repo.** Setting `status: "published"` and pushing to the private `main` only makes a PR appear. CI never pushes to the public default branch.
- Sync never touches `editorial/`. Polarsteps text and photos never reach the site; only coordinates, names and which steps belong to a place are used as a starting point. Prose, dates and images are yours.
- Everything is a draft until you set `status: "published"`. Today: 146 places, all drafts, 0 published, so the public site is an empty globe (state at handoff).
- Groups (Balkans, countries, continents) are derived, never authored.

## 2. Daily recipes

All in **[private]** (`cd ~/Developer/catalyst-content`). After any edit run `pnpm validate` (errors block export; add `--strict` to fail on warnings too).

### Add a place by hand (no Polarsteps)

```bash
pnpm new-place --name "Warsaw" --lat 52.23 --lon 21.01 --country PL   # --slug warsaw is the default
```

Creates `editorial/places/warsaw.json` as a draft with your coordinates as given (the `--country` is optional, otherwise derived from the coordinates). Then edit that file. To make it publishable you need:

- `summary`, `body` (array of plain-text paragraphs, no HTML or Markdown), `dates` (`{ "start": "2024-03", "label": "..." }`), optionally `region`, `labelPriority` (0 to 100, default 50);
- **at least one approved image** (`requireImageForPublishedPlaces` is true in `config/publish.json`);
- `coordinates` at the precision you accept publicly (2 decimals is about 1 km, 3 about 100 m; more than 3 warns);
- `"status": "published"`.

Minimal shape (synthetic):

```json
{
  "id": "plc_xxxxxxxx", "slug": "warsaw", "name": "Warsaw", "status": "published", "sourceRefs": [],
  "coordinates": { "lat": 52.23, "lon": 21.01 },
  "summary": "One line for lists.", "dates": { "start": "2024-03", "label": "Spring 2024" },
  "body": ["First paragraph.", "Second paragraph."],
  "images": [{ "src": "/media/warsaw/skyline.webp", "alt": "What the photo shows", "caption": "optional", "publish": true }],
  "related": [], "labelPriority": 50
}
```

Images: your own photo or cleared rights ([checklist](../../catalyst-content/docs/media-policy.md#rights-and-ownership-checklist)); about 2000 px on the long side, at most 3000 px and 2.5 MB; **strip all metadata**; put it in `editorial/media/<slug>/`:

```bash
exiftool -all= -overwrite_original editorial/media/warsaw/skyline.webp
```

Originals stay out of Git. Merged images stay in the public Git history forever.

### Add places from Polarsteps steps

The snapshot is only a base. Proposals come from positions, not names.

```bash
ls source/trips                                      # trip ids
pnpm propose-places --trip <tripId>                  # read-only table (or --all --across-trips --radius-km 25 --min-steps 2)
pnpm propose-places --trip <tripId> --write          # creates DRAFT files (name, 2-decimal centroid, sourceRefs, nothing else)
pnpm new-place old-town --name "Old Town" --from-step <tripId>/<stepId> --from-step <tripId>/<stepId2>   # or one by one
pnpm curation coverage                               # which countries have steps but no place yet (counts and codes only)
```

Then edit the drafts like any hand-authored place: fix `name`/`slug` (rename the file with the slug), check `coordinates` (with `new-place --from-step` the position lands in `coordinatesSuggestion`: copy what you want public into `coordinates` and delete the suggestion), write your own text, add an image, publish. `?` after a proposed name and `!` on a radius mean "check this one". Full flags: [editorial-workflow.md](../../catalyst-content/docs/editorial-workflow.md#curate-places-from-the-snapshot-propose-places).

### Edit a place

Edit the JSON, then:

```bash
pnpm validate
pnpm export:preview --out ../catalyst        # then reload the dev page (section 3)
git add -A && git commit -m "content: ..." && git push     # on main: publish.yml refreshes the rolling PR if the paths below changed
```

`publish.yml` runs on pushes to `main` that touch `editorial/**`, `config/regions.json`, `config/bboxes.json` or `config/publish.json`. Renaming a slug: rename the file too; it is the public URL identity and the key of the box cache (`config/bboxes.json`), so refresh its box afterwards.

### Exclude or hide a place

| You want | Do |
|---|---|
| A place not on the public site | Leave it `draft` (default) or set `unpublished`. Nothing else is needed; both are ignored by the export. |
| A draft gone from your preview globe | Delete the file: `git rm editorial/places/<slug>.json` (drafts only), or `pnpm curation exclude-place <slug> --delete-file` |
| A Polarsteps step, trip or place never proposed again | `pnpm curation exclude-trip <tripId>`, `exclude-step <tripId>/<stepId>`, `exclude-place <slug>`; undo with `include-trip` / `include-step`; `pnpm curation list` to see them. Stored in `editorial/curation.json`, survives deleting drafts. |
| A trip not synced at all | `config/sync.json`: add its id to `scope.exclude` (commit and push) |

Never delete a **published** place file to hide it (`exclude-place --delete-file` refuses without `--force`): set `unpublished` so the export removes it from the public repo.

### Set a bbox or viewRadiusKm, refresh boxes

A place names an area: the globe frames its `bbox` (whole city, `[west, south, east, north]`). `coordinates` is only where the marker sits. Priority: hand `bbox` in the place file, then the geocoded box in `config/bboxes.json` (unless the place has a hand `viewRadiusKm`), else the radius (default 12 km). `viewRadiusKm` is derived from any box; a hand value is used only when there is no box.

```bash
pnpm geocode-bboxes --dry-run                 # who would be queried (no request)
pnpm geocode-bboxes                           # only places with no cache entry (~1 request/s to OpenStreetMap Nominatim, no secret)
pnpm geocode-bboxes --refresh <slug>          # re-ask one place (repeatable); --all re-asks everything: avoid
pnpm validate && git add config/bboxes.json && git commit -m "data: refresh bbox <slug>"
```

Overrides, in the place file: `"bbox": [w, s, e, n]` (always wins; it need not contain `coordinates`, `validate` only warns) or `"viewRadiusKm": 8` (a deliberate framing: opts the place out of the geocoded box; use it for regions, monuments, hamlets). Boxes the lookup could not resolve are cached as `fallback` and keep their radius.

To find boxes that look too big (a municipality instead of a city; the handoff lists 24 over 45 km and 34 places without a box), after a preview export:

```bash
node -e 'const p=require("../catalyst/packages/published/data/preview.projection.json");for(const x of p.places){if(!x.bbox)continue;const[w,s,e,n]=x.bbox,k=Math.cos((s+n)/2*Math.PI/180);const W=Math.round((e-w)*111.3*k),H=Math.round((n-s)*110.6);if(Math.max(W,H)>45)console.log(x.slug,W+"x"+H+" km")}'
```

Then fix by hand or `--refresh`, re-export the preview, reload, select the place.

### Unpublish

Set `"status": "unpublished"`, fix anything that still references it (a published route or content item pointing at it is a validation error), `pnpm validate`, push. The next PR deletes the place and its media from the public tree; merge it. For an emergency, see Roll back in section 5.

## 3. See it locally

```bash
# [private]
pnpm export:preview --out ../catalyst        # ALL places incl. drafts: names and positions only, plus the group hierarchy
# [public]
pnpm dev                                     # http://localhost:5173
```

- It writes exactly one file, `packages/published/data/preview.projection.json` (git-ignored, never published, refused by production builds). It refuses unless `--out` is the root of the public checkout and the file is git-ignored.
- `pnpm dev` serves **preview** when that file exists, else **published** (the empty globe) and prints a hint. A `CATALYST_CONTENT` set in your shell wins over both. The dev-only badge bottom-left reads `PREVIEW · local data · not published` (or `DEMO · placeholder data`). Production builds never show it.
- After re-running the export, reload the page; restart `pnpm dev` only if the file did not exist when it started.
- `pnpm dev:demo` serves made-up placeholder places (explicit opt-in, never your data). `pnpm dev:api` serves the API on `http://localhost:3001` (`published` or `demo` only, never the preview).
- Production build on your machine only, with the preview: `pnpm build && CATALYST_CONTENT=preview CATALYST_ALLOW_PREVIEW=1 pnpm --filter @catalyst/web start`.
- Rehearse the real export without touching the public repo: `pnpm export --out out` in **[private]** (`out/` is git-ignored; delete it after). `pnpm export --out ../catalyst` really writes `projection.json` into your public working tree: normally leave that to CI.

Before merging a publication PR, if you want more than the Vercel checks (the public repo has no GitHub CI): **[public]** `pnpm validate:published && pnpm typecheck && pnpm test && pnpm build && pnpm check:leaks`.

### Phone testing

`pnpm dev` listens on every interface and prints the URLs: `http://<LAN IP>:5173/` (same Wi-Fi) and, with Tailscale running, `http://<machine>.<tailnet>.ts.net:5173/`. WebGL works over plain http. For https on your tailnet only: `tailscale serve --bg 5173` (stop: `tailscale serve reset`); never `tailscale funnel` (public internet).

Your real places are served to anyone who can reach the port. On a network you do not trust: `CATALYST_DEV_HOST=localhost pnpm dev`, or `pnpm dev:demo`. Add `?globe-debug` to the URL, then in the remote inspector: `__handoverDebug.quality()` (0 is full quality, higher means the phone cannot hold the frame budget) and `__perf.snapshot()`. Details, tile caveat (`localhost` fallback URLs do not work from a phone) and what to look at: [performance.md](performance.md#testing-on-a-phone). Not yet measured on a real phone or Safari/iOS.

## 4. Sync from Polarsteps

**What runs.** `.github/workflows/sync.yml` in the private repo, cron `23 5 * * *` (UTC, daily, best-effort: GitHub may delay or skip a run, the next one catches up) and manual dispatch (Actions, `sync`, Run workflow, input `dry_run`). One run makes **one** `GET https://www.polarsteps.com/currentuser` with your own session (plus at most 2 retries on 429/5xx), writes `source/` and `archive/`, and commits them to `main` as `catalyst-sync[bot]` ("sync: +n added..." or "state refresh": it commits a heartbeat daily). It stages only `source` and `archive`, so it can never change `editorial/` or trigger a publication.

**Locally** (secret in your shell only, section 6):

```bash
pnpm sync:dry          # the one request, prints the diff, writes nothing
pnpm sync              # same, then writes source/ and archive/ (exit 0 ok, 1 fatal, 3 partial)
pnpm sync --adapter fixture --fixture-dir fixtures/polarsteps/base --dry-run   # no credential, no network
```

**Invariants, in plain words** (full table: [sync-invariants.md](../../catalyst-content/docs/sync-invariants.md)):

- Same input twice gives no change; records are matched by Polarsteps id, never by name.
- Before a changed record is replaced, the old version is archived. Nothing is ever deleted: a step missing from a *complete* fetch is marked `missing`, upstream-deleted becomes `deleted-upstream`, and both are reversible.
- A failed, partial or invalid fetch for a trip makes no decision and no write for that trip (exit 3, last known good kept). A fatal error (auth, wrong account, listing failure) writes nothing (exit 1).
- A removal or edit upstream never touches your editorial places; it only raises review flags. `pnpm validate` then prints `source-review` warnings: keep the place, rewrite it, or unpublish it.
- Only an allowlisted slice of your Polarsteps account is kept (no emails, no followers, no other people's data). A credential of another account is refused (username check against `config/sync.json`).
- The credential never appears in arguments, logs, reports or files. A re-issued `remember_token` is detected and only raises `credentialRotated` (boolean) and a warning.

Check health: `source/sync-state.json` (`lastSuccessAt`, `credentialRotated`, per-trip `lastStatus`), the Actions tab, or `gh run list --workflow sync.yml -R BSoDium/Catalyst-content`. At handoff the only real run was a local one (2026-10-06, 12 trips, 236 steps); whether the CI schedule works from GitHub-hosted runner IPs is **unverified**: run the workflow once with `dry_run` ticked before trusting it ([import-contract.md](../../catalyst-content/docs/import-contract.md#verified-and-not-verified)).

Risk to keep in mind: this is an unofficial endpoint with your session cookie. It may break or conflict with Polarsteps' terms; the site is unaffected because it serves the last merged projection.

## 5. Publish

**What triggers it.** A push to the private `main` touching `editorial/**`, `config/regions.json`, `config/bboxes.json` or `config/publish.json`, or a manual run: Actions, `publish`, Run workflow (or `gh workflow run publish.yml -R BSoDium/Catalyst-content`).

**What the workflow does** (`publish.yml`): mints a short-lived token from the GitHub App, checks out the public repo, refreshes `contract/published.schema.json` from it, runs `pnpm validate`, `pnpm export --out public` and `pnpm export --out public --check`, builds the PR body (counts and slugs only), then opens or updates **one rolling PR** from branch `content/publish`, titled "content: publish editorial update", assigned to `PR_ASSIGNEE` (default `BSoDium`). The PR may only contain `packages/published/data/projection.json` and `apps/web/public/media`. Nothing to change means no PR. If validation fails, nothing is opened: read the failed run.

**Review before merging** (the PR is visible to anyone while the public repo is public; review is a quality gate, not a secrecy gate):

1. The body: totals, and which place slugs were added, changed, removed (it lists slugs only, no names or positions). Does it match what you meant?
2. Files changed, `projection.json`: for each new or changed place, read name, `coordinates` (precision you accept), `summary`, `body`, `dates`; confirm the text is yours and no Polarsteps wording slipped in. Skim `groups` for plausible names.
3. Files changed, media: open every image: rights, nothing private visible (house numbers, plates, faces you should not show). Metadata is already checked by `validate`.
4. Only those two paths changed; both Vercel checks (web and API) are green.
5. Optional local run: `pnpm validate:published && pnpm check:leaks` (section 3).

Merge. Vercel redeploys both projects (published content affects both). The web app serves the bundled snapshot; the API's CDN may serve the old payload for up to 5 minutes (`s-maxage=300`, stale for up to 24 h while revalidating).

**Roll back.**

1. *Fast, in the public repo:* revert the merge (GitHub "Revert" button on the merged PR, then merge the revert PR; locally `git revert -m 1 <merge-sha>` for a merge commit, plain `git revert <sha>` for a squash). The revert also restores the media. Vercel's dashboard can also promote the previous deployment of each project (standard Vercel feature, **unverified** here).
2. *Make it stick, in the private repo:* the rolling PR mirrors the latest private `main`. Set the place `unpublished` (or revert the editorial commit) and push, otherwise the next trigger of `publish.yml` re-proposes the same content.
3. What was merged stays in public Git history and forks (images especially). If something genuinely private went out, rolling back is not enough: that needs a history rewrite, deliberately.

## 6. Secrets

Exactly these exist. The public repo and both Vercel projects have **none**.

| Name | Kind | Where | Used by |
|---|---|---|---|
| `POLARSTEPS_REMEMBER_TOKEN` **or** `POLARSTEPS_COOKIE` | secret | private repo, GitHub Actions secrets; your own shell for local sync | `sync.yml` (and `pnpm sync`). Set one; the cookie (full `Cookie` header value) wins when both are set. |
| `APP_PRIVATE_KEY` | secret | private repo, GitHub Actions secrets | `publish.yml`: private key of the GitHub App installed on the public repo (Contents and Pull requests read/write, Metadata read) |
| `APP_CLIENT_ID` | variable (public) | private repo, Actions variables | same App |
| `PUBLIC_REPO_TOKEN` | secret, fallback | private repo | only if no App is configured: fine-grained PAT limited to the public repo (contents + pull requests write), short expiry |
| `PUBLIC_REPO`, `PR_ASSIGNEE` | variables (not secrets) | private repo | defaults `BSoDium/Catalyst`, `BSoDium` |

Set them yourself, never in chat, never in a file or an argument (`.env.example` suggests copying to `.env`, but the Polarsteps value must not go there):

```bash
# GitHub: prompts for the value, nothing lands in your shell history or argv
gh secret set POLARSTEPS_COOKIE -R BSoDium/Catalyst-content
gh secret list -R BSoDium/Catalyst-content            # names only: confirms what is set
# local sync: read silently into this shell only
read -s POLARSTEPS_COOKIE; export POLARSTEPS_COOKIE
pnpm sync:dry
unset POLARSTEPS_COOKIE POLARSTEPS_REMEMBER_TOKEN
```

(The same can be done in the web UI: private repo, Settings, Secrets and variables, Actions.) Which secrets are actually set today is **unverified**: check with `gh secret list`.

**Getting the Polarsteps value:** logged in at polarsteps.com, DevTools, Network, a request to `www.polarsteps.com`, the `Cookie` request header (whole value for `POLARSTEPS_COOKIE`, or just `remember_token` for the other; if the token alone gets a 401/403, use the full cookie).

**Rotation.**

- *Polarsteps cookie:* replace it when the sync fails with `auth` every day (session expired), when the run prints the `credentialRotated` warning, or if you think it leaked (log out and back in on Polarsteps invalidates it). Get a fresh value, update the GitHub secret (command above) and your local shell. CI cannot update its own secret.
- *GitHub App key:* nothing expires (a token is minted per run). If the key leaks: App settings, generate a new private key, update `APP_PRIVATE_KEY`, delete the old key.
- *PAT fallback:* rotate before its expiry.

## 7. Groups

Nobody defines groups. The export derives them from **published** places only (drafts never create one), per place: `place → [area] → country → [informal region | UN subregion] → continent`.

- **Country**: your `countryCode` in the file if set, else the majority country of its Polarsteps steps, else a lookup of its coordinates (nearest country within 30 km for coastal points). No country means no group (export prints `WARN [ungrouped] place "<slug>"`, `validate` warns `country-unresolved`): set `countryCode`.
- **Area**: places of one country chained by hops of at most 60 km, at least 2 places, only in countries with at least 4 places, never one that holds the whole country; named `<its top-priority place> area`.
- **Informal region**: first matching region in `config/regions.json` (else the UN subregion). **Continent**: from the country table.
- A group with a single child is skipped, so no chain of identical squares. A group's extent covers the boxes of its places.
- Names come only from static tables, `regions.json` and published place names, never from Polarsteps text.

**Edit the region list** (`config/regions.json`, order is priority, the first region listing a country wins, region names become public group names):

```json
{ "regions": [ { "name": "Balkans", "countries": ["AL", "BA", "BG", "GR", "HR", "XK", "ME", "MK", "RO", "RS", "SI"] } ] }
```

Codes are ISO 3166-1 alpha-2 (`XK` allowed); an unknown code or a duplicate name makes export fail (`unknown country code "ZZ"`). Area tuning is `areas.{enabled,linkKm,minMembers,minCountryPlaces}` in `config/publish.json`. There is no per-group rename, merge or hide in v1: the levers are these two files, an explicit `countryCode`, and which places are published. Changing either config file triggers `publish.yml`.

**Check it** (private repo, then list the result):

```bash
pnpm export:preview --out ../catalyst        # prints "preview: N places, M groups (k area, ...)" and WARN [ungrouped] lines
node -e 'const p=require("../catalyst/packages/published/data/preview.projection.json");for(const g of p.groups)console.log(g.kind.padEnd(10),g.slug,"->",g.parent??"(root)")'
pnpm curation coverage                        # countries with steps but no place
pnpm test                                     # includes the group generator tests
```

The preview builds groups as if every place were published, so the real groups differ until you publish them all. Algorithm and licences: [grouping.md](../../catalyst-content/docs/grouping.md).

## 8. Vercel

Two NEW projects from this repo (team `photonsquid`), created after the rebuild branch is merged: web (Root Directory `apps/web`, preset React Router, temporary domain `v2.bsodium.fr`) and API (Root Directory `apps/api`, preset Hono). `catalyst-v1` is the old app and stays as it is; it will fail on pushes to `main` once the monorepo lands, so disconnect it or set an Ignored Build Step when v2 is live. Checklist per project: Root Directory set, **Include source files outside of the Root Directory** on, Install/Build/Output/Development Command overrides all off, Node 22 or newer, **no** environment variables (never `CATALYST_CONTENT=demo` or `preview`). Click-by-click steps and the evidence behind them: [api-contract.md, Deployment on Vercel](api-contract.md#deployment-on-vercel). Until the merge, the PR's Vercel check (the old project) fails by design.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Public site shows an empty globe | Nothing is published yet (`projection.json` has 0 places); expected until the first publication PR is merged | Publish (section 5). To see your places meanwhile, section 3. |
| Empty globe in `pnpm dev` although you made a preview | `CATALYST_CONTENT` set in your shell (`published` wins over the preview); or the preview file is invalid and the server fell back to empty (the dev server log says `[content] bundled "preview" projection is invalid`) | `unset CATALYST_CONTENT`; `pnpm validate:published "$PWD/packages/published/data/preview.projection.json"` (absolute path: pnpm runs it inside `packages/published`, so a relative path fails); re-run `pnpm export:preview --out ../catalyst` |
| Preview badge missing | The badge exists in dev only and only for preview or demo. Either the file did not exist when `pnpm dev` started (the startup line says "no local preview yet"), or `CATALYST_CONTENT` is set, or you are on a production build (`build`/`start`: no badge by design) | Run the export, restart `pnpm dev`, `unset CATALYST_CONTENT` |
| `export:preview` refuses | `--out` is not the root of the public checkout (needs `packages/published`), or `preview.projection.json` is not git-ignored there | Use `--out ../catalyst`; check `.gitignore` of the public repo |
| `pnpm validate` fails | Read the `ERROR [code]` lines. Common: `image-required` (published place without an approved image), `coordinates-required`, `media-metadata` (run `exiftool -all=`), `media-too-large` / `media-too-large-dimensions`, `media-missing`, `published-refs-unpublished` (a published record points at a non-published one), `filename-mismatch` (file name must equal slug), `duplicate-slug`, `unknown-country-code`, `curation-invalid` | Fix the file; media codes are only warnings for drafts. Code list: [editorial-workflow.md](../../catalyst-content/docs/editorial-workflow.md#validation-codes) |
| `export aborted (validate)` / `(contract)` | Editorial errors (same as validate), or contract drift: the public contract changed and `contract/published.schema.json` or the mapper is behind | `pnpm validate`; after a contract change `cp ../catalyst/packages/schemas/published.schema.json contract/` and update `src/export/{map,types,verify}.ts` |
| `export --check` says `differs: ...catalyst-manifest.json` | Your public checkout has never received an export (no manifest yet), so there is a diff even with nothing published | Harmless; CI runs `export` before `--check`. Rehearse with `pnpm export --out out` instead |
| `pnpm check:leaks` fails: `not found (run pnpm build first)` | It scans build output | `pnpm build` first |
| `check:leaks`: a forbidden word (`POLARSTEPS`, `sourceRefs`, `tripId`, `stepId`, `remember_token`, ...) in a file | Private vocabulary reached a bundle or the projection | The message names the file; remove the source of it, rebuild. Never ignore this one |
| `check:leaks`: preview file tracked / not ignored / places found in a bundle | `preview.projection.json` was committed or unignored, or a build embedded preview data | `git rm --cached packages/published/data/preview.projection.json`, restore the `.gitignore` entry, rebuild without `CATALYST_CONTENT=preview` |
| `check:leaks`: `private-layer path tracked` or `projection invalid` | A `source/`, `archive/` or `editorial/` path, or an `.env`, exists in the public repo; or `projection.json` breaks the contract | Remove the path; `pnpm validate:published` for the contract message |
| Sync: places flagged `source-review`, steps `missing` or `deleted-upstream` | The step or trip disappeared or changed on Polarsteps. Nothing was deleted or changed in your places | Per place: keep, rewrite or unpublish ([editorial-workflow.md](../../catalyst-content/docs/editorial-workflow.md#handle-review-flags-after-a-source-removal)). Review state in `source/review-flags.json` |
| Sync exit 3 (partial), a trip `skipped-incomplete` | That trip's fetched step count did not match `step_count`, or a record failed validation; its last good copy is kept | Usually clears next run; if not, see `lastErrorCodes` in `source/sync-state.json` and `completeness.stepCountMode` in `config/sync.json` |
| Sync exit 1, `auth` | Cookie expired or wrong (401/403/404/login page), or Polarsteps blocks the runner's IP | Replace the secret (section 6). Compare a local `pnpm sync:dry` with a CI `dry_run` |
| Sync exit 1, `identity` | The credential belongs to another account, or `username` in `config/sync.json` is wrong | Fix the config or the cookie |
| Sync warning "credential rotated" | Polarsteps re-issued `remember_token` | Refresh the GitHub secret and your local variable before the next run |
| Workflow: "No Polarsteps credential" | Neither secret is set | Set one (section 6) |
| Publish: "No credential for the public repo" | `APP_CLIENT_ID` or `APP_PRIVATE_KEY` missing (and no PAT) | Set them (section 6) |
| Publish: 404 when checking out the public repo | `PUBLIC_REPO` wrong, or the App or PAT has no access to it | Check the variable and the App's installation |
| Pushed, but no publication PR | The push touched none of the watched paths (for example only `source/`), or nothing changed in the output | Run `publish` manually; check the Actions run summary |
| Publish: `refusing to overwrite ... not created by this export` or `manifest is invalid` | A foreign file sits in `apps/web/public/media`, or `.catalyst-manifest.json` was edited | Move the file, or restore the manifest from Git in the public repo |
| Vercel build fails | Root Directory empty (builds the old app), leftover Install/Build/Output overrides, or API preset `Other` (`No Output Directory named "public"`) | Section 8 and the [checklist](api-contract.md#owner-checklist-click-by-click) |
| API answers `503 content_unavailable` (also `/health`) | The projection failed validation at startup, or `CATALYST_CONTENT` is invalid (`preview` is refused by the API; unset it) | Vercel function logs for the `console.error` detail; `pnpm validate:published`; redeploy a good projection or roll back |
| Merged, but the site or API still shows old content | CDN: up to 5 min fresh plus stale-while-revalidate; or a deployment is still building or failed | Wait, hard reload, check both projects' deployments are Ready |
| Phone cannot open the dev server | Different network or client isolation, `CATALYST_DEV_HOST=localhost` set, firewall, or a Host name Vite rejects | Use the printed URL; `CATALYST_DEV_ALLOWED_HOSTS=name.example`; [performance.md](performance.md#testing-on-a-phone) |
| `geocode-bboxes` refuses to start | The editorial tree has errors | `pnpm validate`, fix, rerun. Network errors keep what was fetched; just rerun |

## 10. Cheat sheet

**[private] `~/Developer/catalyst-content`**

```bash
pnpm install
pnpm new-place --name "X" --lat 0 --lon 0 [--country XX] [--slug x]      # hand-authored draft
pnpm new-place <slug> [--name "X"] --from-step <trip>/<step> [--from-step ...]
pnpm propose-places [--trip <id>|--all] [--across-trips] [--radius-km 20] [--min-steps 1] [--write]
pnpm curation exclude-trip|exclude-step|exclude-place|include-trip|include-step|list|coverage
pnpm validate [--strict]
pnpm geocode-bboxes [--dry-run] [--refresh <slug>] [--all]
pnpm export:preview --out ../catalyst        # local preview file (drafts included), never published
pnpm export --out out                        # rehearsal into the git-ignored out/ (rm -rf out afterwards)
pnpm export --out ../catalyst [--check]      # real export (CI does this; --check is read-only)
pnpm sync:dry | pnpm sync                    # Polarsteps, needs the credential in your shell
pnpm typecheck && pnpm test
gh run list -R BSoDium/Catalyst-content      # workflow runs (read-only)
gh workflow run publish.yml -R BSoDium/Catalyst-content   # manual publication PR (does not publish by itself)
gh secret list -R BSoDium/Catalyst-content   # names only
```

**[public] `~/Developer/catalyst`**

```bash
pnpm install
pnpm dev                                     # preview if present, else published (empty); LAN/phone reachable
CATALYST_DEV_HOST=localhost pnpm dev         # this machine only
pnpm dev:demo                                # made-up placeholder data
pnpm dev:api                                 # API on :3001
pnpm typecheck && pnpm test && pnpm test:scripts
pnpm build && pnpm check:leaks               # production builds, then the leak scan
pnpm validate:published ["$PWD/path/to/projection.json"]   # absolute path if you pass one
pnpm --filter @catalyst/schemas build:contract            # regenerate published.schema.json after a contract change
pnpm --filter @catalyst/web perf             # performance budgets (run on an idle machine)
pnpm tiles:plan                              # optional: fallback tile server planning (docs/self-hosting.md)
```

Where to read more: [architecture.md](architecture.md), [api-contract.md](api-contract.md), [performance.md](performance.md), [handoff.md](handoff.md); private repo `docs/` (`editorial-workflow.md`, `publication-export.md`, `grouping.md`, `sync-invariants.md`, `import-contract.md`, `privacy-model.md`, `media-policy.md`).
