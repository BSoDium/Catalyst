# API cost and abuse on Vercel Hobby

Decision document for `apps/api` (Hono, read-only JSON) deployed at `v2.api.bsodium.fr` on the free Hobby plan. Written 2026-10-08. All Vercel facts below come from the official docs, fetched 2026-10-08 (URLs in "Sources"). Numbers marked *measured* come from this repo, *assumed* are estimates, *unverified* could not be checked without deploying.

## 0. Read this first

1. **The production deployment is currently broken.** Every request to `v2.api.bsodium.fr` (checked 2026-10-08, ~10:28 CEST, `curl` plus `vercel logs`) returns `500 FUNCTION_INVOCATION_FAILED`. Runtime log: `ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/apps/api/node_modules/@catalyst/schemas/src/index.ts'`. The workspace packages export raw `.ts` (`"exports": {".": "./src/index.ts"}`) and the Hono preset does not bundle them. Consequences for cost: each request is still a billed invocation, the process crashes and cold-starts each time (TTFB 0.5 to 1.2 s), and a 500 is never cached. Fix this before anything else (options in section 5, step 1). `catalyst-v2-api.vercel.app` answers `DEPLOYMENT_NOT_FOUND` at the moment (alias not yet resolving).
2. **The binding limit is not the one you would guess.** Caching protects function quotas, but every request, cache HIT included, consumes one of the **1,000,000 CDN Requests** per month. At 0.39 requests/second sustained, the free quota is gone. Only the firewall (denied requests are free) can protect that quota. Section 5 is therefore mostly firewall rules.
3. **Hobby allotments are per team, not per project** ("Hobby teams get a monthly allotment of each billable resource"). Your team `photonsquid` holds about 15 projects (v1 site `www.bsodium.fr`, `api.bsodium.fr`, the v2 web app...). Abuse of this one API burns the quota the others share. The docs do not say whether a pause hits every project; plan as if it can.

## 1. Hobby limits that matter

| Resource | Hobby included per month | Binding for us? |
| --- | --- | --- |
| CDN Requests (formerly Edge Requests) | 1,000,000 (HITs, MISSes, static, 304, 404 all count; firewall-blocked do not) | **Yes, first for any HIT traffic** |
| Function Invocations | 1,000,000 ("counts regardless of request success or failure"; HIT does not invoke) | Yes for MISS / uncacheable traffic |
| Fast Origin Transfer (function to CDN, in+out bytes) | 10 GB | **Yes for large cache-busted bodies** (section 2) |
| Fast Data Transfer (CDN to visitor, incl. headers, URL, compression) | 100 GB | No (about 3M requests of the largest payload) |
| Active CPU | 4 hours (14,400 s), billing pauses during I/O | No |
| Provisioned Memory | 360 GB-hours (Hobby is fixed at 2 GB / 1 vCPU, so about 180 instance-hours) | No |
| WAF custom rules | 3 per project; rate limiting = **1 rule**, fixed window only, keys IP or JA4, window 10 s to 10 min, 1M "allowed requests" included | Constraint on mitigations |
| WAF IP blocks | 3 | - |
| Function regions | 1 | - |
| Runtime logs | 1 hour | Limits forensics |

**When exceeded:** there is no overage billing on Hobby. Docs: "if you exceed your usage limits on the Hobby plan, you will have to wait until 30 days have passed before you can use the feature again" (rolling 30 days, no billing cycle). The "paused deployment" KB says visitors see `503 DEPLOYMENT_PAUSED` and "paused projects resume one at a time, never automatically". Vercel also says it "reaches out before taking action". Not documented: warning thresholds, and whether the pause is per project or per team. Confidence: medium. Spend Management (a hard budget stop) is Pro only. Hobby is also non-commercial only. A public read-only map-data API is fine.

## 2. What one request costs here

Cache and billing facts (docs): a CDN HIT is served "without reaching your origin": it costs 1 CDN Request plus Fast Data Transfer, **no invocation, no CPU, no memory, no Fast Origin Transfer**. A MISS adds 1 invocation, CPU, provisioned memory and Fast Origin Transfer for the function's response bytes. The cache is segmented by region, so each edge region fills its own copy: one hot URL costs about one MISS per region per `s-maxage` window.

Statuses cached by the CDN: 200, 404, 410, 301, 302, 307, 308 (only with a caching `Cache-Control`). Our errors (404, 405, 503) are `no-store`, 500 is not cacheable, and OPTIONS is never cached, so **every one of those is an invocation**. HEAD is cacheable, but the cache key includes the method, so HEAD entries are separate from GET.

**Payload sizes** (measured with `buildSnapshot`; bytes, raw / gzip):

| Endpoint | Published today (empty) | Demo (18 places, 17 entries) | Preview data (146 places, 47 groups, no entries) | Est. 150 places | Est. 500 places | Est. 146 places + 100 entries of 3 KB |
| --- | --- | --- | --- | --- | --- | --- |
| `/v1/projection` | 108 / 92 | 47,551 / 16,172 | 41,548 / 9,031 | ~43 KB / ~9.5 KB | ~145 KB / ~32 KB | **~397 KB / ~140 to 165 KB** |
| `/v1/places` | 2 / 22 | 3,081 / 993 | 28,749 / 7,541 | ~29.5 KB / ~7.7 KB | ~98 KB / ~26 KB | same as 146 places |
| `/v1/groups` | 2 / 22 | 1,219 / 411 | 7,596 / 1,686 | ~7.8 KB / ~1.7 KB | ~26 KB / ~5.5 KB | same |
| `/v1/places/:slug` | - | 429 avg, 1,270 max | 411 avg, 571 max | ~0.4 KB | ~0.4 KB | ~0.4 KB |
| `/v1/projects`, `articles`, `artworks`, `poems` (summaries, no body) | 2 | 1,963 to 3,108 (4 or 5 entries each) | 2 (still empty) | small | small | ~16 KB / ~5 KB each for 25 entries |
| `/v1/<kind>/:slug` (detail, with body) | - | 0.5 to 4.6 KB (avg 2.5 KB) | - | - | - | ~3.6 KB / ~2 KB |
| `/health`, any 404/405 | ~150 | ~150 | ~150 | ~150 | ~150 | ~150 |

Measured 2026-10-09 (the demo column after the demo fixture was filled with 17 realistic entries; the other columns 2026-10-08, after the entry contract extension (poems, `cover`, `tags`, `meta`, `body` blocks; [api-contract.md](api-contract.md), "Entries")). The last column is synthetic: 25 entries of each of the four kinds, a body of about 3 KB each (5 blocks), a cover, 4 tags, 3 meta, 2 places, plus the preview's 146 places (random dictionary words: about 2.3:1 gzip, a bit pessimistic compared with prose). Entries cost about **3.5 KB raw / 1.3 to 1.6 KB gzip each** in the projection. `/v1/projection` is the only endpoint whose size grows with the bodies; the lists carry no body and the details are one entry each. Server side, the 100-entry snapshot is about 790 KB of pre-serialised strings and the function bundle grows by the projection size (the bundle is 832 KB today with the demo fixture inlined); validation plus snapshot take about 3 ms.

The 150 and 500 columns scale the preview file linearly (about 285 B per place in `/v1/projection`, 197 B per place in the list, 162 B per group, groups about a third of places). Every response also carries about 0.5 KB of headers.

**Compute cost per invocation** (measured locally on the built bundle, Node, no network): module load 19 to 21 ms and 31 MB RSS (this is the cold-start part we control; bundle 840 KB); handler time 5 to 10 µs per request (200: 6 to 10, 304: 9, 404: 5.4, 405: 5.6, OPTIONS: 4.8). The platform wrapper adds more that I cannot measure without a working deployment: assume 1 to 5 ms of Active CPU per invocation. Cold-start wall time on Vercel is *unverified* (Fluid compute keeps instances warm and shares one instance across concurrent requests; bytecode caching applies to production).

**How many requests fit in the free quota** (everything else at zero; remember the quotas are team-wide):

| Traffic type | Limiting resource | Requests / month | Per day | Per second (avg) |
| --- | --- | --- | --- | --- |
| Any cacheable GET that HITs | CDN Requests | 1,000,000 | 33k | 0.39 |
| `/v1/projection`, cache-busted, 150 places | Fast Origin Transfer (10 GB / ~43.5 KB) | ~230,000 | 7.7k | 0.09 |
| `/v1/projection`, cache-busted, 500 places | Fast Origin Transfer | ~69,000 | 2.3k | 0.03 |
| `/v1/projection`, cache-busted, 146 places + 100 entries of 3 KB | Fast Origin Transfer (10 GB / ~397 KB) | **~25,000** (about 100,000 if FOT counts compressed bytes) | 0.8k | 0.01 |
| `/v1/<kind>` list (25 summaries) / `/v1/<kind>/:slug` detail, cache-busted | FOT (10 GB / 16 KB) / Function Invocations (10 GB / 3.6 KB is 2.9M, above the 1M cap) | ~600,000 / 1,000,000 | | |
| `/v1/places`, cache-busted, 150 / 500 places | Fast Origin Transfer | ~330,000 / ~100,000 | | |
| `/v1/groups`, cache-busted, 150 / 500 places | invocations / FOT | 1,000,000 / ~380,000 | | |
| `/v1/places/:slug`, `/health`, 404, 405, OPTIONS | Function Invocations | 1,000,000 | 33k | 0.39 |

Fast Origin Transfer is assumed to count uncompressed function output (compression happens at the CDN); if it counts compressed bytes the cache-busted rows improve by about 4x. Active CPU (14,400 s / 5 ms = 2.9M requests) and memory (1M requests x 10 ms x 2 GB is about 5.6 of 360 GB-h) never bind before the rows above.

**What the entry contract changes in this table.** Before it, a cache-busted `/v1/projection` could pull the 10 GB of Fast Origin Transfer in about 230,000 requests; with 100 published entries of 3 KB it takes about 25,000 (4 to 5 minutes at 100 req/s). That is one tenth of the margin, so **the firewall's per-IP rate limit and path allowlist matter more, not less**, and nothing else in the mitigation list changes: the CDN Requests cap (1M) still binds first for HIT traffic, and the web app still does not call the API at runtime (step 5), so legitimate load is unchanged. Fast Data Transfer (100 GB) is not affected in practice: 100 GB is about 650,000 full compressed projections. If the real content grows past roughly 1 MB of projection, split the heavy endpoint instead of raising limits (see api-contract.md, "Payload size and cost"), or take option 14 (prebuilt static JSON), which removes the function and FOT from the equation.

**Time to exhaust 1M requests:** 1 req/s: 11.6 days. 10 req/s: 28 hours. 100 req/s (one laptop with a `curl` loop): **under 3 hours**. "A few days" is optimistic for a motivated client.

**Legitimate load** is negligible: the web app bundles the projection and only optionally fetches the API, so expect a few hundred requests a month, a few dozen MISSes.

## 3. Abuse vectors

| Vector | Hits | Cost | Notes |
| --- | --- | --- | --- |
| Cache-busting query (`?cb=<random>`) on `/v1/projection` | MISS every time | CDN req + invocation + FOT (up to 43 to 145 KB each) + CPU | **Query string is part of the CDN cache key** for function responses (cache key = method, full URL, host, deployment URL, scheme; "cache keys are not configurable"). It is ignored only for static files. Today the handler ignores the query (covered by a new test), so the bytes are identical, but each variant is a separate cache entry. |
| Random paths (`/x1`, `/wp-login.php`, `/.env`) | Function always (Hono catch-all) | invocation + CDN req, tiny body | 404 is `no-store`, never cached. Fixed scanner paths could be cached; unique random ones cannot. |
| Methods: OPTIONS, POST/PUT/DELETE | Function always | invocation + CDN req | OPTIONS is never cached; 405 is `no-store`. |
| HEAD | Cached separately from GET; MISS invokes | invocation, no body | Cheap in bytes, same invocation count. |
| Huge `If-None-Match` / URL | Function (or CDN if cached) | FDT for the request bytes; our parser is linear | Header and URL size limits are enforced by the platform (exact values not checked). Pathological header (2,000 candidates) covered by a new test. Not a real vector. |
| Many IPs (botnet, residential proxies) | Everything above, spread out | Same, and per-IP rate limits do not bite | WAF rate-limit counters are also per region. Not fully preventable on Hobby; this is what Attack Mode and the automatic DDoS layer are for. |
| Alternate hostnames (`*.vercel.app`, deployment URLs) | Same project | Same | Firewall rules are per project, so they apply to every hostname as long as you do not condition on `host`. |

What is **not** a vector: write endpoints (none), secrets (none), the web app (static bundle, separate project).

## 4. Mitigations, ranked by value / effort

| # | Mitigation | Hobby? | Protects | Effort | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | **Fix the production crash** | - | Stops paying for crashing cold starts | S to M | **Do first** |
| 2 | **WAF custom rule: deny anything not on the route allowlist or not GET/HEAD/OPTIONS** | Yes (rules are free; denied traffic does **not** incur CDN Requests or Fast Data Transfer) | Random paths, scanners, write verbs: the whole class of 404/405 invocations | 10 min, dashboard or CLI | **Do** |
| 3 | **WAF rate limit, per IP, deny** | Yes, but 1 rule, fixed window, IP/JA4 only, 10 s to 10 min | Single-source floods of any kind, cache-busting included | 5 min | **Do** |
| 4 | WAF rule against query strings | Partly: the `query` condition needs a specific `key`; no "any query" wildcard. `raw_path` might include the query (*unverified*) | Cache-busting | 10 min + test in Log mode | **Try in Log mode**, keep if it matches |
| 5 | Attack Mode (free, unlimited, blocked traffic costs nothing) | Yes | Incident response: challenges all browsers, lets known bots through; standalone API clients (curl, server fetch) **cannot** pass | 1 command | **Runbook only**, not permanent. Fine because the web app does not call the API at runtime. |
| 6 | Automatic DDoS mitigation | On by default, free | Large or abnormal floods only; low-rate or distributed traffic can pass and is billed ("requests not recognized as a DDoS event ... incur usage") | 0 | Already there, do not rely on it |
| 7 | Bot Protection managed ruleset | Yes, off by default | Challenges all non-browser traffic: would block the API's own consumers. | - | **No** |
| 8 | AI Bots managed ruleset (deny) | Yes | Known AI crawlers only | 1 command | Optional, low value |
| 9 | `vercel.json` `routes` with `mitigate: deny` | Supported (deny/challenge only, no Log mode) | Same as #2 but versioned in git | M | **No**: cannot be dry-run, `has` needs exact header/query keys, and mixing `routes` with the Hono preset is unverified. Dashboard rules are safer. |
| 10 | Function config in `vercel.json` | Memory: **not settable** on Hobby or with Fluid compute (build warns); `maxDuration`: default 300 s, irrelevant for 5 ms handlers; `regions`: Hobby is one region, flat pricing | None of these change quota | - | **No change** (evaluated, nothing to gain) |
| 11 | App-level guard in Hono (reject any query with 400, early 404) | - | Nothing: the invocation is already billed before our code runs. Measured handler time is 5.4 us for a 404 vs 8 us for a 200, a 0.003% difference. A 400 is also uncacheable and changes today's "query ignored" behaviour. | S | **No** |
| 12 | Cache `404`s for 60 s (`public, s-maxage=60`) | Yes | Repeated scanner paths (not unique random ones) | S | Not now: contradicts the contract ("every error is `no-store`"); #2 already covers it for free. |
| 13 | Longer CDN-only TTL via `Vercel-CDN-Cache-Control` (not forwarded to clients, so the public `Cache-Control` stays as documented) | Yes | Reduces the legitimate MISS floor (about regions x resources per TTL). Content only changes on deploy and the cache key contains the deployment URL, so staleness after a deploy should not occur (*unverified*) | S | Low value at today's traffic; revisit if the web app starts calling the API |
| 14 | **Prebuilt static JSON** (section 4a) | Yes | Cache-busting becomes harmless (query ignored, no invocation, no CPU/memory/FOT). Does **not** lift the 1M CDN Requests cap. | M, changes contract details | **Phase 2, optional**; also removes the crash class |
| 15 | Cloudflare in front | Not feasible cheaply: `bsodium.fr` uses Vercel nameservers (so a proxy needs a zone move); Cloudflare's "ignore query string" cache key is Enterprise / pay-as-you-go only; Vercel says another CDN on top is "not recommended" (stale content after deploys) and Bot Protection degrades behind a proxy | - | L | **No** |
| 16 | Usage notifications and a weekly look at the Usage page | Yes | Early warning | 2 min | **Do** |

### 4a. Static JSON, trade-offs in detail

Generate `/v1/*.json`, `/health.json` and one file per place at build time from the same `buildSnapshot()`, serve them from `public/`, rewrite `/v1/places/:slug` to `/v1/places/:slug.json` (a file `places` cannot coexist with a directory `places/`), and set `Content-Type`, `Cache-Control` and CORS with `headers` in `vercel.json`. Unknown paths then 404 at the CDN with no function at all.

| Aspect | Today (Hono function) | Static |
| --- | --- | --- |
| Bodies | `JSON.stringify` of snapshot | **Byte-identical** (same builder), so consumers see no data change |
| Query string | in cache key, MISS per variant | **ignored** for static files (docs) |
| Invocations, CPU, memory, FOT | per MISS | **zero** |
| CDN Requests and FDT | per request | same: **still the 1M cap**, still needs the WAF |
| Invalid content | runtime 503 on every endpoint | build fails (better) |
| 404 body | JSON envelope `not_found`, `no-store` | Vercel's platform 404 page, unless a `routes` + `status: 404` fallback to `/404.json` is added (*unverified* with the Hono preset; needs `framework: null`) |
| 405 for write verbs | JSON envelope with `Allow` | Platform behaviour (*unverified*); contract text about 405 would need rewording |
| OPTIONS preflight (204 + `Access-Control-Allow-*`) | yes | not available for static files. Simple GETs (no custom request header) never preflight, so the web app is unaffected; a client sending `If-None-Match` by hand from a browser would be |
| ETag / 304 | strong, 128-bit content hash | platform-generated, value format differs (*unverified*) |
| Dev server and tests | Hono | Keep Hono for `pnpm dev` and tests; add a test that every generated file equals the app's response |

Net: roughly one day of work, a documented softening of the 404/405/OPTIONS parts of `docs/api-contract.md`, and the benefit is robustness (and an end to the module-resolution failure), not a higher request cap. Do it only if the WAF rules prove insufficient or the payloads grow toward 500+ places.

## 5. Recommendation and exact steps

**Step 1. Make the deployment work (repo owner; not part of this change).** Either bundle the entry so that workspace packages and the projection are inlined (the repo already has `scripts/build.mjs` producing `dist/index.mjs` with esbuild; wire Vercel to serve that bundle, for example as the function entry), or build the workspace packages to JS. Verify with `curl -i https://v2.api.bsodium.fr/health` showing `200`, then `/v1/places` twice and look for `x-vercel-cache: HIT` and an `age` header on the second call.

**Step 2 status (applied 2026-10-08, with the owner's go-ahead, through the Vercel CLI).** Published to production on project `catalyst-v2-api`, tested right after against `https://v2.api.bsodium.fr`:

| Rule | Result of the test |
|---|---|
| `api-allowlist` (deny when the path is outside the allowlist or the method is not GET, HEAD or OPTIONS) | `/health`, `/v1/places`, `/v1/projection`, `/v1/groups`: 200; `/v1/places/<slug>` reaches the app (our JSON 404 for an unknown slug); `OPTIONS` 204; `HEAD` 200; `/`, `/nope`, `/favicon.ico` and `POST /v1/places`: 403 from the firewall (not billed) |
| `api-rate-limit` (120 requests per 60 s per IP, deny) | 150 requests in a row: 110 passed (about 14 earlier test requests already counted), 40 got 403; back to 200 after the window |
| `api-no-query` (experiment, deny when the raw path contains `?`) | **Does not work**: `?cb=123` still returned 200, so `raw_path` excludes the query string. The rule was removed again; cache-busting stays covered by the per-IP rate limit only |

**Entry endpoints (poems and the `:slug` details of projects, articles, artworks and poems).** The live `api-allowlist` rule was published with the older regex (`/health`, `/v1/(projection|places|groups|routes|projects|articles|artworks)` and `/v1/places/<slug>`), so until it is edited the new endpoints are denied by the firewall (403) in production. Update it when the API with the entry contract is deployed (owner action, same condition as above, new regex; the method condition is unchanged):

```bash
vercel firewall rules edit "api-allowlist" \
  --condition '{"type":"path","op":"re","value":"^/(health|v1/(projection|places|groups|routes|projects|articles|artworks|poems)|v1/(places|projects|articles|artworks|poems)/[a-z0-9]+(-[a-z0-9]+)*)$","neg":true}' \
  --or \
  --condition '{"type":"method","op":"ninc","value":["GET","HEAD","OPTIONS"]}' --yes
vercel firewall publish --yes
```

Check the exact flags of `rules edit` with `vercel firewall rules edit --help` first (not run as part of the entry work; the CLI was not used). Verify afterwards: `/v1/poems` and `/v1/poems/<slug>` answer 200 or the app's JSON 404, `/v1/poems/` and `/v1/groups/x` answer 403.

**Update 2026-10-09 (entry contract, PR #246):** the live `api-allowlist` regex was edited to the one in the allowlist section (adds `poems` and the `/v1/<kind>/:slug` detail routes), published, and tested on production: `/health`, `/v1/poems` 200, `/v1/poems/nope` and `/v1/articles/nope` reach the app (our JSON 404), `/nope` and `POST /v1/poems` 403 from the firewall.

Live rules: `vercel firewall rules list` from a directory linked to the project (`vercel link --project catalyst-v2-api`). To undo one: `vercel firewall rules remove <name> --yes` then `vercel firewall publish --yes`. The CLI subcommand is `vercel firewall rules add` (the plain `firewall add` shown in the help text does not exist in CLI 52). The commands below were the plan; rule 1 was created directly in deny mode (the traffic view is unavailable on this plan, so a log-only phase could not be read) and verified by the tests above.

**Step 2. Firewall rules (owner action).** Dashboard: Project `catalyst-v2-api` > **Firewall** > **Configure** > **Add New... > Rule**; **Review Changes** > **Publish**. Or CLI from a directory linked to the project (read the draft with `vercel firewall diff`, apply with `vercel firewall publish --yes`). Create them in **log** mode first, watch the Firewall tab for 10 minutes, then switch to deny. Order matters: put the deny rule first so junk never reaches the rate limiter.

```bash
# Rule 1: allowlist of paths and methods (deny everything else). Slugs are lowercase kebab-case.
# The path regex is pinned by a test (apps/api/test/app.test.ts, "firewall allowlist"): it must match every path the app
# serves (lists, projection and one detail per place and per entry of the four kinds) and nothing more.
vercel firewall rules add "api-allowlist" \
  --condition '{"type":"path","op":"re","value":"^/(health|v1/(projection|places|groups|routes|projects|articles|artworks|poems)|v1/(places|projects|articles|artworks|poems)/[a-z0-9]+(-[a-z0-9]+)*)$","neg":true}' \
  --or \
  --condition '{"type":"method","op":"ninc","value":["GET","HEAD","OPTIONS"]}' \
  --action log --yes
# after checking the log: vercel firewall rules edit "api-allowlist" --action deny --yes

# Rule 2: per-IP rate limit. A page load needs at most about 8 requests; 120/min leaves ample headroom.
vercel firewall rules add "api-rate-limit" \
  --condition '{"type":"path","op":"pre","value":"/"}' \
  --action rate_limit --rate-limit-window 60 --rate-limit-requests 120 \
  --rate-limit-keys ip --rate-limit-action deny --yes

# Rule 3 (experiment): any query string. Keep only if it logs requests carrying "?".
vercel firewall rules add "api-no-query" \
  --condition '{"type":"raw_path","op":"sub","value":"?"}' --action log --yes

vercel firewall diff && vercel firewall publish --yes
```

Effects on the contract: a denied request now gets Vercel's 403 page instead of our JSON 404/405 envelope. Well-formed clients never see this; only requests to unknown paths or with write verbs do. Counters are per region, so the effective limit can be a multiple of 120 for a client spread over regions.

**Step 3. Incident runbook (owner action, effective immediately, free):**

```bash
vercel firewall attack-mode enable --duration 24h --yes      # challenge all browsers, API clients are blocked
vercel firewall ip-blocks block <ip-or-cidr> --notes "abuse" --yes ; vercel firewall publish --yes
vercel firewall attack-mode disable --yes
```

Dashboard equivalent: Project > Firewall > **Bot Management** > Attack Mode > Enable. Note: on this Hobby team `vercel firewall overview` fails with `402 IP Bypass is unavailable`; use `vercel firewall rules list`, `ip-blocks list` and the dashboard Firewall tab for traffic (the installed CLI 52.0.0 has no `traffic` subcommand yet).

**Step 4. Watch usage (owner action).** Dashboard: team **Usage** page (CDN Requests, Function Invocations, Fast Origin Transfer) and Settings > Notifications for usage alerts (exact menu labels not verified; Vercel notifies "when nearing your usage limits"). Check weekly for the first month.

**Step 5. Keep the web app independent.** Do not set `CATALYST_API_URL` in the web project's Production environment unless needed: it would route real visitors through the shared 1M CDN Request quota.

**Step 6 (optional, later).** Static JSON (4a) and `Vercel-CDN-Cache-Control` TTL (#13) once Step 1 is verified and if traffic grows.

## 6. What changed in the repo

Only `apps/api/test/app.test.ts`: a new `abuse invariants` block (3 tests) that pins what this document relies on: the response never depends on the query string (status, body, ETag, Cache-Control identical on every known path with arbitrary queries, including a 4 KB one), unknown paths with queries stay `404` + `no-store` + no ETag, and a 2,000-candidate `If-None-Match` neither errors nor slows down. `pnpm --filter @catalyst/api test` (35 passing) and `typecheck` pass. **No change to `vercel.json` or `src/`**: memory cannot be set on Hobby, `maxDuration` and `regions` do not affect quota, and an in-app guard saves nothing because the invocation is already billed. `docs/api-contract.md` is untouched; the contract stays as documented until the owner decides on step 2's 403 behaviour or phase 2.

## Sources (all fetched 2026-10-08)

- Hobby plan: https://vercel.com/docs/plans/hobby
- Fair use / typical monthly usage: https://vercel.com/docs/limits/fair-use-guidelines
- Limits: https://vercel.com/docs/limits
- Why paused: https://vercel.com/kb/guide/why-is-my-account-deployment-blocked
- CDN pricing and usage: https://vercel.com/docs/manage-cdn-usage
- Functions pricing: https://vercel.com/docs/functions/usage-and-pricing
- CDN cache, cacheable criteria, per-region cache: https://vercel.com/docs/caching/cdn-cache
- Cache keys: https://vercel.com/docs/caching/cdn-cache/purge
- How the CDN works: https://vercel.com/docs/how-vercel-cdn-works
- Firewall, WAF usage and pricing (blocked traffic free): https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing
- Custom rules, `routes` + `mitigate`: https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules
- Rate limiting limits: https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting
- Attack Mode: https://vercel.com/docs/vercel-firewall/attack-mode
- DDoS mitigation: https://vercel.com/docs/vercel-firewall/ddos-mitigation
- Bot management: https://vercel.com/docs/bot-management
- CLI firewall: https://vercel.com/docs/cli/firewall
- Memory / region / Fluid compute: https://vercel.com/docs/functions/configuring-functions/memory , https://vercel.com/docs/functions/configuring-functions/region , https://vercel.com/docs/fluid-compute
- `vercel.json` (`functions`, `routes`): https://vercel.com/docs/project-configuration/vercel-json
- Hono on Vercel (`public/` for static): https://vercel.com/docs/frameworks/backend/hono
- Another CDN on top of Vercel: https://vercel.com/kb/guide/why-running-another-cdn-on-top-of-vercel-is-not-recommended
- Cloudflare cache rule settings: https://developers.cloudflare.com/cache/how-to/cache-rules/settings/
