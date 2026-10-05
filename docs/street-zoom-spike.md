# Street zoom spike: globe to city streets with one pixel pass

Status: spike result, 2026-10-05. Prototype: `prototypes/street-zoom` (`@catalyst/prototype-street-zoom`, not deployed, dev port 5190). Builds on `docs/renderer-decision.md` (Three.js globe, tuned constants) and `docs/design-tokens.md`.

## Recommendation

1. **Keep the pixel pass idea: it works.** Render the map in four plain channels into a texture and run our own final pass (grid snap, max-pool, hard ink threshold, Bayer dither, palette from the CSS tokens, focus mask, dither dissolve). Zoomed to Ho Chi Minh City at z14.5 it gives the same 3 px, 1-bit, token-coloured look as the globe, at 60 fps and about 1.3 ms of GPU time for the pass (Apple M4, headless Chrome). Idle is zero frames.
2. **Use the copy compositor** (`texImage2D` from the map canvas in the map's `render` event, separate overlay GL context). It needs no `preserveDrawingBuffer`, is engine-agnostic (any canvas works, including Mapbox), and was measured as cheap or cheaper than the in-context custom layer.
3. **Production architecture: hybrid.** Keep the Three.js globe for world scale. Lazy-load MapLibre plus the pass (430 KB gzip, about 3x the Three chunk) when a place is opened or the user zooms past about zoom 5. Hand over with a dither dissolve on the same art-pixel grid. I measured that the two cameras register to a mean of 1.3 px (max 2.1 px, under one 3 px art pixel) once MapLibre's zoom is corrected by `log2(cos(lat))`. A single-engine MapLibre globe is smoother by construction but looked worse at world scale (see "What is worse than Three.js") and would mean rewriting the tuned production globe; I would only choose it if the live handover turns out to be visible. **I did not build the live crossfade**, only the registration measurement and a static 50% dissolve mock.
4. **Tile source: OpenFreeMap as primary, own PMTiles as fallback, bundled globe as the floor.** OpenFreeMap is global to zoom 14, so per-place extracts are not needed to make the feature work. Because it has no SLA, tiles are treated as an enhancement with a first-class degradation path (prototyped and tested here). The fallback is a static PMTiles file for curated places on the owner's home server (the only self-hosting they accept); Vercel static holds up to about 3 city extracts as an alternative.
5. **Mapbox should not be the primary source** (reasons and the conditions that would change this are in "Mapbox"). It stays docs-only: no token exists.

## What was built

`prototypes/street-zoom` (Vite + TypeScript strict, 95 unit tests after the line-integrity work, `typecheck` and `test` pass):

| File | Role |
|---|---|
| `src/style/monoStyle.ts` | Hand-written MapLibre style for two schemas (Protomaps v4 and OpenMapTiles) that paints only the pass's four channels. No glyphs, no sprites, no text layers. |
| `src/gl/pixelPass.ts` | The two shaders: pool (pass A) and present (pass B). |
| `src/gl/compositors.ts` | `CopyCompositor` (art-resolution or device-resolution output) and `InlineCompositor` (MapLibre custom layer). |
| `src/core/pixel.ts` | Pure twins of the shader logic (Bayer, classify, pooling, mask, dissolve), unit-tested. |
| `src/core/health.ts` | Tile source health: probe with timeout, error window, source choice, back-off, degraded policy. |
| `src/street.ts` | Lazy chunk: map, PMTiles protocol, compositor, labels, reveal, fail-over. |
| `src/labels.ts`, `src/core/labelPlace.ts` | HTML boxed labels with leader lines and greedy collision placement. |
| `scripts/` | `fetch-tiles.sh`, `measure.mjs`, `failover.mjs`, `registration.mjs`, `session-bytes.mjs`, `zoom-bytes.mjs`, `gallery.mjs`, `hybrid-mock.mjs`, `summarize.mjs`. |

### The pass

Channel contract (what the style paints, what the pass reads):

| Channel | Meaning | Pooling and decision |
|---|---|---|
| R | hard ink (foreground) | max-pool over the art cell, on if above 0.5 |
| G | foreground tone 0..1 (fills, dotted minor roads, faded borders) | max-pool, on if above the cell's 8x8 Bayer threshold |
| B | muted tone (graticule, rail, globe limb) | same, drawn in the muted colour |
| A | coverage | outside the globe disc alpha is 0; a cell straddling the edge becomes the 1 art pixel limb |

Palette: `--background`, `--foreground`, and `--globe-limb` composited over the background (the same tokens the production globe reads). Black in the style erases, which is how big roads come out hollow.

Pass A runs one fragment per art cell (480x300 at a 1440x900 viewport and 3 px cells). Pass B runs per output pixel, nearest-samples the art texture, and shows the sharp source render instead when the focus-mask coverage exceeds the cell's Bayer threshold. The same mechanism with a global `sharp` value is the dither dissolve; a cell never flickers back once revealed (unit-tested). Tuning: art cell 3 CSS px (2 below 520 px), rounded to whole device pixels.

## Compositor comparison

| | Copy (`texImage2D` from canvas) | Inline (custom layer) |
|---|---|---|
| Works | yes, **without** `preserveDrawingBuffer`: reading inside the `render` event (same task) sees the valid buffer | yes |
| Hidden map canvas | `visibility:hidden` still renders and still feeds the copy | n/a |
| Engine-agnostic | yes, anything that draws to a canvas | MapLibre custom layer API only (Mapbox on globe unverified) |
| GL contexts | 2 | 1 |
| Output resolution | art (cheap, CSS `image-rendering: pixelated`) or device (needed for the sharp reveal) | device only |
| State handling | none | must save and restore ~12 GL state items |
| Isolated cost, 2880x1800 source | upload 0.35 to 0.53 ms, pool+present 1.25 to 1.6 ms | measured inside the frame only |
| Frame cost vs copy at same scale | baseline | 1.3 to 2.1 ms higher synced p50 in all three views |
| Art-resolution output at 1x | upload 0.41 to 0.51 ms, pass 0.04 to 0.19 ms | not possible |

Anything else I looked at: `getImageData`/2D canvas readback (a CPU round trip, not tried), `OffscreenCanvas` in a worker (the map owns its canvas, no hook), a MapLibre `preserveDrawingBuffer` copy (not needed, so not measured). A render-to-texture hook would be better than all of these but neither engine documents one.

## Measurements

Environment: Mac, Apple M4, macOS 27.0.1, Chrome for Testing 153 headless via `playwright-core`, ANGLE Metal, 1440x900 at devicePixelRatio 2, vsync 60 Hz, production build served by `vite preview`. Scenario: scripted circular pan (160 CSS px radius, 0.9 rad/s) at each view, 1.5 s warm-up then 8 s measured (about 480 frames), one browser session per row. Views: world (zoom 2.4, globe), region (8.5, globe, 1 to 2 tiles of the extract), street (14.5, Mercator). "Synced" is Map `_render` start to the end of a blocking 1 pixel `readPixels` on the final context, so it includes GPU time. **A fast desktop GPU at 60 Hz means everything hits the cap; the useful numbers are the synced times, and session to session noise is about 3 ms** (the same configuration varied that much between runs). The isolated costs are the reliable measure of the pass. **None of this is phone data.**

Frame times, Protomaps extract, synced ms p50 / p95 (full JSON in `docs/street-zoom/results/`):

| Pass | Map scale | world | region | street |
|---|---|---|---|---|
| none (map only, channel colours) | 2x | 8.7 / 10.7 | 8.4 / 10.3 | 5.5 / 10.2 |
| copy, art-resolution output | 1x | 4.8 / 7.2 | 4.4 / 5.0 | 3.4 / 5.0 |
| copy, device output | 1x | 5.3 / 7.7 | 6.0 / 7.9 | 5.9 / 6.8 |
| copy, device output | 2x | 7.7 / 10.6 | 7.6 / 10.1 | 6.7 / 9.5 |
| inline custom layer | 2x | 9.6 / 11.5 | 8.9 / 11.8 | 8.8 / 10.7 |

- Every row of every table: 60.1 fps, rAF interval p50 16.7 ms, max 16.8 ms. JS per frame (render plus composite) p50 0.9 to 1.9 ms; the composite itself is under 0.5 ms of JS.
- **Cost of the copy and the pass (isolated, GPU-synced, 30 repeats):** canvas copy 0.22 to 0.53 ms, pool + present 0.75 to 1.6 ms at device output (up to 2880x1800), 0.04 to 0.19 ms at art output. The choice of map render scale matters more than the pass: rendering at CSS resolution (scale 1) roughly halves GPU time.
- **Idle:** 0 map renders, 0 rAF calls and 0 pass runs over 3 s with no input, in all 35 (view, mode) combinations measured, including after a reveal finished. A pending reveal or dissolve runs its own rAF loop only while animating.
- **Reduced motion** (`rm=1`): a fly to the place becomes a jump (4 renders total), the reveal jumps to its target, and the dissolve is instant. Static frames only.
- **A full flight** world to street z14.5 with tile loading (copy-device, 2x): 383 frames in 6.4 s, p50/p95/max rAF 16.7/16.7/16.8 ms, **0 frames above 25 ms**. The globe-to-Mercator change has no visible step: the meridian skew of the unprojected viewport corners halves every zoom level (0.0543 at z3, 0.0041 at z8, 0.0010 at z10, 0.0005 at z11) and is exactly 0 from z12.
- CPU throttle 4x (main thread only; GPU and the MapLibre worker are unaffected): street and block views, 60 fps, rAF max 16.8 ms, synced p95 4.6 ms (art) to 12.1 ms (device 2x).
- Mobile, **emulated only** (Chrome at 390x844, DPR 3, iPhone UA, on the M4 GPU): copy-art 1x street 2.7 / 8.7; copy-device 1x 3.9 / 5.1; copy-device 3x (1170x2532 source) 5.7 / 7.1. Not representative of a phone.
- JS heap 13 to 52 MB across runs (no trend by mode; sampling noise). The earlier globe doc measured 11 MB for Three.
- GPU memory (computed, not measured): copy-device at 2880x1800 holds about 21 MB each for the map canvas, the source texture and the output canvas (about 62 MB plus depth); at 1x art output about 1.3 MB for a phone-sized map. Phones at DPR 3 should use scale 1 and art output.

### Bundle (production build, min + gzip)

| Chunk | Raw | gzip | brotli |
|---|---|---|---|
| street (maplibre-gl + pmtiles + our code) | 1,044 KB | 287.3 KB | 237.4 KB |
| MapLibre worker (separate file) | 496 KB | 142.7 KB | 118.2 KB |
| geodata coastlines + borders (already in the globe) | 73 KB | 28.3 KB | 23.7 KB |
| app shell | 6 KB | 2.8 KB | 2.5 KB |

The lazy street part is about 430 KB gzip (356 KB brotli), versus 140 KB for the Three engine chunk. MapLibre's own CSS is not used. The v6 worker needs `?worker&url` + `setWorkerUrl` under Vite (as in the earlier doc); I did not re-test the "1 byte worker" production trap because the build output shows the real 496 KB worker.

## Screenshots (`docs/street-zoom/`)

Headless Chrome, 900x560 at 2x, dark unless noted, quantised to 16 colours. Compare `three-world.png` (target) with `ours-world.png` (this spike) first.

| File | Shows |
|---|---|
| `three-world.png` | The production Three.js globe, view 106E 17N zoom 3 (target look) |
| `ours-world.png` | MapLibre + pixel pass at the same view (zoom corrected by `log2(cos 17 deg)`) |
| `native-world-dark.png` | MapLibre's native pixelated render (`pixelRatio 1/3`, no pass): soft grey lines, round markers |
| `world-light.png` | Same view, light tokens |
| `region-z8.png` | Region view z8.5 (the extract only has 1 to 2 tiles here: the gap discussed below) |
| `city-z11.png`, `streets-z14.png`, `streets-z14-light.png`, `block-z16.png` | City, street and block scales, Protomaps tiles |
| `reveal-z15.png` | Focus mask: sharp hairline vector detail around the selected place, pixel art outside |
| `dissolve-40.png`, `dissolve-70.png` | Global dither dissolve at 40% and 70% sharp |
| `ofm-streets-z14.png` | OpenFreeMap tiles (OpenMapTiles schema), same style spec |
| `mobile-streets.png` | 390x844 at DPR 3, emulated |
| `hybrid-50.png` | Static 50% Bayer dissolve between the Three.js screenshot and the MapLibre one (6 px cells) |
| `degraded.png` | All tile sources blocked: bundled coastline only, zoom capped at 6, notice shown |

## Scale continuity: one engine or hybrid

**Look match at world scale (`three-world.png` vs `ours-world.png`).** Geometry and framing agree and the palette is identical (same tokens). It is close, not equal. What is worse than Three.js:

- Coastlines are 1 art pixel for most of their length but show occasional 2 pixel doubles where a hairline straddles two cells (max-pool of a 0.6 CSS px line, 0.5 threshold). Three draws exact 1 pixel lines.
- The graticule is uneven: dash phase against the art grid is not controlled, so the dots are irregular and dimmer than Three's regular every-third-pixel stipple.
- The 50% dotted border band (zoom 3 to 3.3) reads as hatching in dense ranges (Himalaya).
- No lifted route arcs, no depth-occluded GL markers (markers and labels are HTML here).
- MapLibre's zoom is Mercator-equivalent at the centre latitude, so the globe grows by `1/cos(lat)`; the earlier doc's compensation code is still needed for bounded zoom.
- At street scale: dithered building and park fills (zoom 15 to 17) are busy; roads at zoom 16 to 17 are solid white bars (hollow interiors only start at about z17); the stipple is screen-anchored and may "swim" while panning (I judged static frames only, no motion review).
- In the sharp reveal, hairlines are thinner and greyer than the pixel area. It reads as an instrument overlay but is a visible weight change.

**Data seam inside one engine.** Even a single MapLibre engine has a data seam: the bundled 110 m coastline hands over to tile water edges (a dithered band at zoom 8.5 for the extract, 4.5 for OpenFreeMap). The Protomaps extract only has tiles around the place, so between zoom 3 and 9 anything outside those 1 to 2 tiles is empty. **A per-place extract cannot carry the world-to-region range; a global low-zoom set (OpenFreeMap) can.**

**Camera registration (`scripts/registration.mjs`).** Projecting a 5x5 grid of points (+-8 degrees) with the Three.js `project()` and MapLibre `map.project()` at 1440x900:

| Centre lat, zoom | Raw zoom: mean / max px | With `z + log2(cos lat)`: mean / max px |
|---|---|---|
| 10.8, 2.6 | 4.1 / 6.4 | 5.2 / 8.1 |
| 10.8, 3.5 | 2.2 / 4.7 | 1.3 / 2.1 |
| 10.8, 4.5 | 4.6 / 7.0 | 1.4 / 2.1 |
| 40, 3.0 | 22.7 / 35.6 | 1.5 / 2.1 |
| 40, 4.0 | 45.0 / 68.1 | 1.3 / 2.1 |
| 60, 3.0 | 65.2 / 102.9 | 1.3 / 2.1 |

With the correction the cameras agree to about 1.3 px (under one 3 px art pixel) in all cases except the lowest zoom at low latitude (5.2 px mean), which is below any handover zoom. `hybrid-50.png` shows the 50% Bayer dissolve: coastlines coincide with no doubled edges.

| | Single engine (MapLibre globe + pass) | Hybrid (Three world, MapLibre street, dither dissolve) |
|---|---|---|
| Smoothness | best by construction, one camera | needs a camera map and a short two-context overlap; registration is measured to under 1 art pixel |
| World look | measurably worse (list above) | unchanged |
| First-load JS | about 430 KB gzip always | 140 KB, plus 430 KB only when street scale is requested |
| Code | rewrite the tuned globe (input, flights, picking, routes) on MapLibre | add a lazy street module and a second source in the present pass |
| Risk | MapLibre v6 packaging, route arcs lost | two engines to keep in sync; **live handover not built or reviewed** |

I recommend hybrid for the reasons in the table; switch to single-engine only if the real handover shows visible swimming or popping.

## Tile sources

### Extract that was downloaded

- Source: Protomaps basemap daily build `20261004.pmtiles` (`https://build.protomaps.com/20261004.pmtiles`, listed by `https://build-metadata.protomaps.dev/builds.json`; uploaded 2026-10-04, basemap version 4.15.2, full planet 138.6 GB).
- Command: `pmtiles extract <url> public/hcmc.pmtiles --bbox=106.50,10.55,106.95,11.00 --maxzoom=15` (about 49 x 50 km around Ho Chi Minh City). 47 range requests, 22 MB transferred, 12 s.
- Result: **21,445,172 bytes (20.45 MiB)**, 2,479 tiles, zoom 0 to 15, gzip tiles. Not committed (`*.pmtiles` is ignored); `scripts/fetch-tiles.sh` reproduces it.

Compressed tile bytes per zoom level (`scripts/zoom-bytes.mjs`): z0 to z9 together 0.7 MB; z10 0.27 MB; z11 0.36 MB; z12 1.5 MB; z13 2.8 MB (14%); z14 5.1 MB (25%); **z15 9.7 MB (48%)**.

### Per-place storage estimate

What a smaller extract around the same centre would weigh (computed from the tiles already in the file, tile-granular, so it matches what `pmtiles extract` of that box would produce within a few percent):

| Box (side) | max zoom 13 | max zoom 14 | max zoom 15 |
|---|---|---|---|
| 10 x 10 km | 1.8 MB | 3.0 MB | 5.3 MB |
| 20 x 20 km | 2.9 MB | 5.3 MB | 10.4 MB |
| 50 x 50 km | 5.7 MB | 10.7 MB | 20.1 MB |

This is the densest core of a megacity, so it is an upper bound for most places; a town or rural area will be a fraction of it (not measured). Capping at z14 halves the size, and views past z14 overzoom cleanly in line work. Planning figure: **about 5 to 10 MB per curated city, 20 MB for a very large one**; 30 places is roughly 150 to 300 MB. `pmtiles extract --region` accepts a GeoJSON MultiPolygon, so all curated places could be one archive that stores the shared low zooms once (flag set confirmed with `--help`; not run).

### Bytes per session

Measured with `scripts/session-bytes.mjs` (world view, fly to HCMC z14.5, five pans of 300 to 600 CSS px, then zoom 16.5; 1440x900 at 2x):

| Source | Requests | Transferred | Notes |
|---|---|---|---|
| Protomaps extract (PMTiles) | 70 | 3.5 MiB (3.7 MB) | all `206 Partial Content`; the browser reads directory pages and tiles by range |
| OpenFreeMap | 103 | 10.8 MiB (11.3 MB) | `200`, gzip; the flight crosses every zoom level, tiles are full planet detail |

The flight itself pulls most of it; the pans after arrival were served from MapLibre's tile cache and cost nothing.

### Tile source options

| | Protomaps extract on Vercel static | Same, Vercel Blob | Same, home server | OpenFreeMap (hosted) | Mapbox (hosted) |
|---|---|---|---|---|---|
| Hosting | file in `public/` of the deployment (build-time copy from a fetch script, never in git) | Blob store | nginx or caddy static | public instance, no key | Mapbox |
| Cost | free (Hobby) | free tier: 1 GB storage, 10 GB transfer/month | electricity | free, donations | 50,000 free map loads/month, then USD 5 per 1,000 (see Mapbox) |
| Limits | 100 MB per static CLI upload, so at most about 3 city extracts; counts toward every deployment | 512 MB cache limit per blob | the home uplink | "no limits on map views or requests" per its site | token required |
| Range requests | **verified**: Vercel CDN answers `206` + `Accept-Ranges` for static files | **not verified** | yes (nginx default, see snippet) | not needed (z/x/y tiles) | not needed |
| SLA | none | none | none; one old PC | **none** ("no SLA or personalized support") | contractual terms not read |
| Attribution | OSM (ODbL) + Protomaps | same | same | "OpenFreeMap (c) OpenMapTiles, Data from OpenStreetMap" | Mapbox logo and text attribution must stay visible |
| Schema | Protomaps v4 | same | same | OpenMapTiles | Mapbox Streets |
| Coverage | the extract only (per place) | same | same | **planet, zoom 0 to 14** | planet |
| Fit with the pixel pass | tested | untested | untested | tested | untested (no token) |
| Risk | deployment size and rebuilds; per place curation | range support unknown | home uplink and uptime | volunteer service can change or vanish | vendor lock-in, terms, token abuse |

Cloudflare R2 is deliberately not recommended (owner's decision; its free-tier numbers were not verified).

### OpenFreeMap

TileJSON `https://tiles.openfreemap.org/planet` (v3.16.0 on 2026-10-05): 0 to 14, bounds the whole Web Mercator world, attribution string `OpenFreeMap (c) OpenMapTiles Data from OpenStreetMap`. Layers: boundary, building (from z13), housenumber, landcover, landuse, park, place, poi, transportation, transportation_name, water, waterway and others. The same style spec restyles to it with different source layer names; `ofm-streets-z14.png` shows it. It lists no maximum request rate and offers no SLA; the author says he may add a paid plan.

- **Does global coverage make per-place extracts unnecessary?** For function, yes: z0 to 14 everywhere, so the world-to-street path has no gap and no per-place build step. Detail ends at z14 (buildings from z13); views past z14 overzoom, which is fine for 1-bit linework. Extracts are only needed as the fallback.
- **Street legibility:** comparable to Protomaps at the same view. OpenMapTiles has fewer road attributes, so my class mapping is coarser (primary/secondary share the "major" style) and it carries more small features; at the same zoom its roads looked slightly denser. OFM tiles are about 3x heavier per session (10.8 vs 3.5 MiB), which matters on mobile data.
- **Failure mode and fallback plan:** below.
- I used OpenFreeMap through normal MapLibre tile loading for about 10 browser sessions in total (measurement runs, fail-over tests, screenshots); no scraping or bulk fetch.

## Graceful degradation (first-class requirement, prototyped)

Tiles are an enhancement. The bundled globe (110 m coastlines, 50 m borders, graticule: 29 KB gzip) must always work. Policy implemented in `src/core/health.ts` and `src/street.ts`, and exercised by `scripts/failover.mjs` (Playwright blocks or delays the hosts with `page.route`):

1. **Start tile-less and probe.** The map is created with the bundled data only; the chain's sources are probed in parallel (OpenFreeMap: the TileJSON; PMTiles: a `Range: bytes=0-15` header read) with a hard timeout (default 3 s). The globe never waits for the probe.
2. **Pick the first healthy source of the chain** (`chain=ofm,pm`) and swap the style with the camera unchanged (schema differences are hidden in `monoStyle.ts`).
3. **Runtime:** 6 tile errors within 8 s trigger one re-probe of the active source; if it fails the source is marked down and the next one takes over.
4. **Everything down: degraded mode.** Max zoom capped at 6 (regional scale: where the bundled data still reads), the camera eases back if deeper, the bundled coastline stays on at every remaining zoom, an `aria-live` notice says "Street detail is unavailable right now. The globe still works." There is never an empty or half-loaded street map.
5. **Recovery:** down sources are re-probed with back-off (30 s, 60 s, 120 s, 240 s, then 5 min) and the best source is promoted when it answers.

Measured (headless Chrome, `chain=ofm,pm`, view z14.5; times from page start):

| Scenario | Result |
|---|---|
| A. OpenFreeMap blocked | probe fails in 4 ms, serving from the PMTiles file at 169 ms, zoom stays 14.5 |
| B. both blocked | degraded at 154 ms, max zoom 6, zoom eased 14.5 to 6, notice visible (`degraded.png`) |
| C. OpenFreeMap slow (6 s delay, probe timeout 1.5 s) | timeout after 1501 ms, PMTiles serving at 1687 ms |
| D. OpenFreeMap dies at runtime | error burst re-probe at 1473 ms (about 1 s after the block), PMTiles serving at 1475 ms |
| E. both blocked, then restored | degraded at 158 ms, recovered and promoted OpenFreeMap at 1812 ms (test hook: 1.5 s re-probe) |
| F. healthy control | OpenFreeMap serving at 683 ms |

Not covered, and a real gap: a source that answers but is slow or stalls on individual tiles (no error events) will not trigger fail-over. MapLibre has no tile timeout; production should add a request timeout through `transformRequest` or a watchdog on pending tiles. After recovery the zoom stays where the cap left it. The style swap briefly shows world-only linework while the new tiles load; a "keep the last frame until the first tiles land" step is worth adding. Context-loss handling is not implemented in the prototype.

### Home server as the fallback (owner's Optiplex: i5 7th gen, 16 GB RAM, little storage)

Static PMTiles over HTTP is the lightest workload there is: no tile server, no database. nginx serves a file with `Range`; the 16 GB of RAM holds every extract in the page cache; a 7th gen i5 should saturate a gigabit port with `sendfile` (not measured), so CPU is irrelevant. The limits are storage, the home uplink and uptime.

- **Storage:** 30 curated places at 5 to 10 MB is 150 to 300 MB; even 100 places at 10 MB is 1 GB. Using one multi-place archive via `--region` shares the low zooms. This fits "little storage".
- **Bandwidth:** one street session is about 3.7 MB (measured). At an assumed 20 Mbit/s uplink (2.5 MB/s; the real line is unknown) a session is served in about 1.5 s, and a saturated line sustains roughly 2,400 sessions per hour. 1,000 sessions a day is about 3.7 GB/day or 110 GB/month: check the ISP's cap. Browsers do not reliably cache `206` responses, so repeat visits probably re-fetch (not verified); a long `Cache-Control` still helps intermediaries.
- **Minimal nginx (sketch, untested here):**

```nginx
# http {} context
limit_req_zone $binary_remote_addr zone=tiles:10m rate=30r/s;

server {
  listen 443 ssl http2;
  server_name tiles.example.org;           # dynamic DNS name pointing at the home connection
  root /srv/tiles;                         # read-only directory holding *.pmtiles
  sendfile on;
  tcp_nopush on;

  location ~ \.pmtiles$ {
    limit_req zone=tiles burst=40 nodelay;
    gzip off;                              # tiles are already gzip; never recompress ranges
    add_header Accept-Ranges bytes always;
    add_header Access-Control-Allow-Origin "https://YOUR-SITE" always;
    add_header Access-Control-Allow-Headers "Range, If-Match" always;
    add_header Access-Control-Expose-Headers "Content-Length, Content-Range, ETag" always;
    add_header Cache-Control "public, max-age=86400, stale-while-revalidate=604800" always;
    if ($request_method = OPTIONS) { return 204; }
  }
}
```

  nginx sends an `ETag` by default, which the PMTiles client uses to detect a changed file. Use Let's Encrypt for TLS, forward only port 443, keep the box on its own VLAN or at least unprivileged. Since it is the second link of the chain, its being down costs nothing but the street layer.
- Do not make it primary: home uplink, power and ISP are the weakest links in the chain.

## Mapbox (docs-only, no token present)

`prototypes/street-zoom/.env.local` has no `VITE_MAPBOX_TOKEN`, so nothing was run and no token was created or requested. From the docs (Map constructor options page and attribution page, 2026-10-05; the globe-and-custom-layer contradiction is from the earlier renderer doc):

- Canvas readback is possible: `preserveDrawingBuffer` exists (default `false`). There is **no `pixelRatio`/devicePixelRatio option**, so the map always renders at device resolution; the compositor does not need one, but a phone at DPR 3 cannot use the cheap scale-1 art path, which weighs on mobile. `antialias` default `false`.
- The Mapbox wordmark must stay visible (it may move, `logoPosition`), text attribution (Mapbox, OpenStreetMap, "Improve this map") must stay visible and legible, and "You may not style the Mapbox logo". Both are DOM elements in the map container, not canvas pixels. So the pass must sit **below** them in z-order, or attribution must be our own HTML outside the pass. In this spike the attribution is already an HTML element outside the pass. **The terms themselves were not read**; whether post-processing the map render into a 1-bit image is allowed is an open question that needs reading the terms (or asking Mapbox).
- `performanceMetricsCollection` defaults to `true` (telemetry): a privacy note for a personal site.
- Globe projection exists. Whether custom layers work on globe is contradictory in the docs, which is another reason to use the copy compositor.
- Pricing (from the earlier doc): 50,000 free map loads a month, then USD 5 per 1,000. Hosted DEM terrain is a real plus for later.

**Should it be the primary source, with MapLibre and own tiles as fallback? No, not now.**

- Reliability is its strongest argument (a commercial operator), but a free-tier token carries no SLA I could find; SLAs are an enterprise contract matter, not verified.
- Mapbox's tiles are for use with Mapbox's SDK. The fallback chain therefore needs two engines (mapbox-gl and maplibre-gl) in the bundle, both matching the style and both passing through the pass. The copy compositor makes that possible, but it doubles the engine weight and the test matrix.
- A token in the client, billing exposure to bot traffic (a hard spending cap was not found), and a closed licence.
- It buys detail beyond z14, hosted terrain and a vendor with a track record, none of which the current brief needs.
- Revisit if OpenFreeMap proves unreliable in the health log, if terrain or z16+ building detail becomes a requirement, or if the Mapbox terms clearly allow the pass. The health chain is written so another source (with its own engine) can be added to the end.

## Data attribution and licences

- OpenStreetMap data is ODbL; the rendered pixel map is a Produced Work and needs the credit "(c) OpenStreetMap contributors" with a link to `https://www.openstreetmap.org/copyright`. Protomaps asks for its name too. OpenFreeMap requires its own line (above). I am not a lawyer: share-alike obligations apply to derived databases, not to rendered maps, but the owner should confirm.
- The attribution must be real HTML, always visible, outside the pass and the canvas (the prototype does this; it is included in the screenshots).
- Natural Earth (the bundled 110 m and 50 m lines) is public domain.
- Protomaps asks not to hotlink its builds: mirror once (done, one extract).

## Risks

- **Safari and iOS unverified.** The iOS Simulator is blocked by the owner's permission state and I did not work around it. Mobile numbers are Chrome emulation on an M4. Unverified: `texImage2D` from a WebGL canvas in Safari, context limits with two contexts plus the Three globe, memory at DPR 3.
- **WebGL context loss** is not handled (neither the map's nor the pass's context); production must rebuild both.
- **Live handover** (hybrid) is not built; only registration numbers and a static mock exist. Temporal artefacts (stipple swimming on pan, the weight jump at the reveal edge) are unreviewed since I only looked at still frames.
- **Cartographic tuning is hand-made**: line density at 3 px cells needs zoom-based thinning; I tuned by eye on Ho Chi Minh City only, one dense delta city. Other places (rural, coastal, mountainous) were not tried.
- **Volunteer-run tile service** (OpenFreeMap) and **home uplink** are both unmetered but unguaranteed; the chain depends on the health logic working in production.
- **MapLibre v6 packaging** under Vite remains fragile (worker URL).
- **Terrain** is design-only (below), no DEM or terrain tiles were fetched.

## Staged plan to bring it into `apps/web`

**Stage 0, decisions (no code).** Confirm hybrid; confirm OpenFreeMap primary and the home server fallback; read the OFM terms; decide the attribution placement; choose the curated place list for extracts.

**Stage 1, street module, no seam change.** Move `monoStyle`, `pixelPass`, the copy compositor and `health` into `apps/web/app/globe/street/` (framework-free, unit tested, same style as `engine/`). Load it with a dynamic `import()` from `globe-canvas.tsx` so it never touches the main bundle or the server. Add a dev-only route that mounts it alone.

**Stage 2, the Globe seam.** `GlobeViewState` today maps zoom 0..1 to the fit zoom ... 6.5. Extend, do not break: add an optional `street` field to the view state (street zoom beyond 6.5) and a prop that says whether street detail is available for the selected place. `GlobeCanvas` owns both engines behind the one `GlobeRenderer` interface: Three while zoom is below the handover band, MapLibre plus the pass above it, both fed the same `{lon, lat, zoom}` through `zoom_ml = zoom + log2(cos(lat))`. In the band (about 5 to 6.5) the present pass takes a second source texture (the Three canvas) and dissolves between them with the existing Bayer mask. The existing `placeLabels`/`LabelLayer` contract (`project(lon, lat) -> {x, y, visible, facing}`) is satisfied at street scale by `map.project()` plus the same far-side test. `data-globe` stays on the root; unmounting must free both contexts (the mobile slide-over unmounts the globe).

**How place selection drives zoom.** Selecting a place keeps today's behaviour (rotate to the place, zoom at least 3.2, panel opens, inset applied). Street scale is then entered by continued zoom or an explicit control; optionally a "show on map" action flies to the place at z14.5 (the 6.4 s flight measured above, shorter if the owner prefers; instant under reduced motion). The sharp reveal opens around the selected place after arrival (`reveal=auto` in the prototype) and closes on departure.

**Routes and markers.** Markers and route stops stay HTML or small GL squares snapped to the art grid (`snapToCell`). Routes are GeoJSON lines on the surface at street scale (the lifted arcs of the Three globe fade out in the handover band); both read the same lon/lat from `@catalyst/published`, so alignment is by projection, not by assets. Inset (`insetRight`): use `map.setPadding` or a camera offset, same rounded-to-art-pixel rule as `engine/inset.ts`.

**Labels stay HTML.** Everything textual is the existing label layer or the boxed leader-line style from `labels.ts`. The style has no symbol layers, so no glyph server is ever contacted. Place names from tiles (`querySourceFeatures`) are optional and only for the curated place's area.

**Stage 3, degradation.** Wire `health` with the chain `ofm -> pm -> degraded`, the notice, a request timeout or stall watchdog, "keep last frame" during style swaps, and Playwright tests that block hosts (port `scripts/failover.mjs`). Add the attribution component.

**Stage 4, hardening.** `webglcontextlost` for both contexts; remount cycles (20, as in the earlier doc) with the context counter; real device checks (iPhone Safari, Android Chrome, low-end) and the `?bench=1` method of the earlier doc; fix the line quality items (hairline phase, graticule dash phase, border band); tune LOD per zoom.

**Stage 5, optional.** Pan-anchored dither (shift the Bayer phase by the whole-cell pan offset in Mercator), a terrain pass (below), a second extract per curated place, `--region` multi-place archive on the home server.

### Terrain (design note only, nothing fetched)

MapLibre supports a `raster-dem` source and `terrain`; Mapbox hosts a DEM. For this look, contour lines would fit best: compute isolines from DEM tiles in a third small pass (or a hillshade channel dithered with the same Bayer matrix), so elevation arrives as the same 1-bit vocabulary. Open: a free DEM source and its licence and size, and whether MapLibre terrain works together with the globe projection (listed as a candidate in the brief; not tested). Do not enable terrain until tiles for it are chosen.

## Open questions

1. Hybrid or single engine: does the live handover show swimming or popping on a real device? (decides Stage 2.)
2. Is the OpenFreeMap terms page acceptable for a long-lived site, and what is the real home uplink and its monthly cap?
3. Mapbox terms: may the map canvas be post-processed and re-rendered as a 1-bit image?
4. Which places get street scale at all (extract list), and at what max zoom (z14 halves the size)?
5. Hairline weight in the sharp reveal vs the pixel area: keep the instrument look or match weights?
6. Is `206` caching in browsers good enough that repeat visits to the home server are cheap? (unverified)
7. Should the focus mask also change content (extra detail only inside the circle), or only sharpness?

## Reproduce

```
./prototypes/street-zoom/scripts/fetch-tiles.sh                      # one extract, ~21 MB, needs `brew install pmtiles`
pnpm --filter @catalyst/prototype-street-zoom typecheck && pnpm --filter @catalyst/prototype-street-zoom test
pnpm --filter @catalyst/prototype-street-zoom dev                    # http://localhost:5190
```

Harness URL parameters: `src=pm|ofm`, `chain=ofm,pm`, `probe=1`, `ptimeout=ms`, `recheck=ms`, `comp=copy-device|copy-art|inline|none`, `scale=N` (map render scale), `px=N` (art pixel CSS px), `theme=light|dark`, `view=lon,lat,zoom`, `select=ho-chi-minh-city`, `reveal=auto|on|off`, `sharp=0..1`, `dither=0|1`, `ink=0.05..0.95`, `rm=0|1`, `proj=globe|mercator`, `bench=1` (hides the panel), `native=1` with `comp=none` (engine-native look). `window.__app.street` and `window.__app.bench` are the automation hooks.

```
# measurements need Chrome for Testing (CHROME_PATH or the Playwright cache) and a server on :5190 (dev or `vite preview`)
node prototypes/street-zoom/scripts/measure.mjs --src=pm [--rows=copy-device:2,... --views=world,region,street --throttle=4 --size=390x844 --dpr=3 --mobile]
node prototypes/street-zoom/scripts/failover.mjs <screenshot-dir>
node prototypes/street-zoom/scripts/registration.mjs               # also needs the globe prototype on :5180
node prototypes/street-zoom/scripts/session-bytes.mjs pm|ofm
node prototypes/street-zoom/scripts/zoom-bytes.mjs public/hcmc.pmtiles 106.70,10.776,10 14
```

## Line integrity (added 2026-10-05)

The owner reported lines that disappear and a look closer to a downscaled hi-res image than to an old LCD. Full spec, comparison and numbers: **`docs/pixel-line-rules.md`**. In short:

- **Cause.** The pass max-pooled anti-aliased lines drawn at their nominal CSS width (0.6 to 1 px). At DPR 1 the peak coverage of a hairline falls under the 0.5 threshold: 9.6 % of minor-road polylines and 32.8 % of building outlines came out broken (synthetic, 384 lines per row), and real-map building outlines were split into 1.54x as many pieces as the native raster. At DPR 2 the same rule thickened lines: 86 % of minor roads were above 1.25 cells per step. This also explains the "2 pixel doubles" and the uneven dotted lines listed under "What is worse than Three.js" above.
- **Fix, now the default.** Widths authored in art pixels with a floor of one; pass A decides by sampling the cell centre (native rasterisation, threshold only); a staircase remover leaves every one-pixel line at one cell per step. Dotted lines are 1 px ink dashes, fills use a screen-anchored "clean" lattice, hollow roads are two exact 1 px outlines. Measured at DPR 1/2: 0 broken, 0 doubled, 0.96 cells per step (0.90 to 1.05), under 0.1 % of line cells missing, pan stability 1.04x the native raster, zero cell changes inside fills, idle still 0 frames; cost unchanged (pass 1.04 ms, synced frame 6.5 ms vs 7.0 before).
- **Tried and rejected:** conservative max-pool (never drops, always doubles), supersample plus Zhang-Suen thinning (shimmers under pan: 1.4x to 1.9x the native change rate, 4.7 % reversals, cuts 4.7 % of line cells), ridge detection (74 % to 79 % broken on MapLibre's flat-profile lines). A native art-resolution render with the same rule matches the quality at less than half the cost (2.8 vs 6.5 ms) but cannot feed the sharp reveal, so it is the option for phones. Vertex-stage grid snapping was not built.
- **Regression gate.** `pnpm --filter @catalyst/prototype-street-zoom test:lines` (Playwright, 211 checks, exit 1 on violation; the old rule fails 108 of them). `?rule=legacy&widths=legacy&pattern=bayer8` restores the spike's rendering for before/after comparisons.
- Screenshots: `docs/street-zoom/line-*-before.png` and `line-*-after.png`. The older screenshots above show the pre-fix look.
