# Street map (`apps/web/app/globe/street/`)

Status: stage 2 of 2, 2026-10-05. The production street-scale renderer, built from `docs/street-zoom-spike.md` and `docs/pixel-line-rules.md` (variant F), now integrated: the globe hands over to it (`app/globe/handover/`, described in `docs/web-architecture.md`, "Handover"). The shell passes `loaderData.tiles` to `<Globe tiles>`. `/dev/street` and `/dev/street-lines` remain, as development-only routes.

## What it is

A client-only, lazily loaded module: MapLibre draws four plain channels, a separate overlay WebGL context turns them into 1-bit pixel art (3 CSS px art pixel, 2 on phones; the globe's own `TUNING.pixelSize`), an HTML overlay draws markers and boxed labels, a tile source manager keeps the map on a working source, attribution is HTML outside the pass.

```
street/
  index.tsx              StreetMapCanvas (client-only, lazy; SSR stub) + pure re-exports (registration)
  street-map-canvas.tsx  React lifecycle, the globe-canvas.tsx pattern; the only place that imports ./engine
  engine.ts              createStreetMap(container, options): StreetMap   (the lazy chunk's entry)
  types.ts, tuning.ts    public contract; constants (reads the globe's TUNING, never copies it)
  core/                  pure, unit tested
    art-line.ts          widths in art px (floor 1), ink classes, hollow roads, Bayer lattices
    art-measure.ts       masks, components, stair remover, reference rasteriser (tests and gate only)
    pixel.ts             cell size, focus-mask coverage, EasedValue (reveal / dissolve)
    registration.ts      globe <-> map camera (log2 cos lat)
    tile-health.ts       request scoring: error rate, timeouts, p95 latency, stalls
    tile-source-manager.ts   the state machine
    source-descriptor.ts TileJSON / PMTiles header -> descriptor, URL validation
    palette.ts           the level encoding between the style and the pass (the grey ramp itself is engine/palette.ts, shared with the globe)
    snap.ts              pan snapping: centre quantised to whole art cells while the zoom is steady
    attribution.ts, label-place.ts, marker-visibility.ts, routes.ts
  gl/pixel-pass.ts       pass A (centre sampling, palette level), T (stair removal), E (tile fade ease), B (present: reveal, sharp, blend)
  gl/compositor.ts       overlay context, canvas copy per map `render` (native: the map IS the art grid, 3 px per cell), suspend, context loss, hold
  style/street-style.ts  one MapLibre style for both schemas, no glyphs, no sprites, no symbol layers
  net/probe.ts           TileJSON / PMTiles header probes with timeout and real abort
  net/tile-protocols.ts  per-instance protocols `catp<N>` / `catf<N>`: timed, timeout-bounded tile requests
  overlay/hud-layer.ts   markers, labels, leader lines, hit testing
  harness/synthetic.ts   line-connectivity harness (dev route /dev/street-lines), not in the engine chunk
```
Outside the folder: `app/globe/handover/` (the integration), `app/lib/tiles-config.server.ts` (+ test), `app/routes/dev-street.tsx`, `dev-street-lines.tsx`, the dev routes in `routes.ts` (absent from production builds), the loader and the `tiles` prop in `routes/shell.tsx`, `apps/web/scripts/street/*` and `scripts/globe/handover-*.mjs`.

The engine imports pure helpers from `../engine/` (tuning, geo, inset, visibility, dpr, colors, view) instead of copying them. Build side effect: Rollup hoists `geo` (2 KB) and `tuning` (0.4 KB) into tiny shared chunks used by both the globe engine and the street engine.

## API

```ts
const map = createStreetMap(container, {
  view: { lon, lat, zoom },            // MapLibre zoom
  places, routes,                      // GlobePlace[], GlobeRoute[] (app/globe/types.ts)
  selectedSlug, focusedSlug, reducedMotion,
  tiles: { primaryUrl, fallbackPmtilesUrl, maxFallbackZoom },
  insetRight,                          // CSS px covered at the right edge, as for the globe
  onSelect, onViewChange, onTileStatus, onContextChange,
});
map.flyTo / jumpTo / setSelected(slug, { fly }) / setFocused / setInset / setReducedMotion
map.setReveal(on, { center }) / setSharp(0..1) / setBlend(0..1)   // capabilities, return a Promise
map.setCamera(view, { inset, sync, snap }) / hit(x, y, kind) / covers(lon, lat)   // embedded use, see below
map.setActive(false)        // keep loading tiles, copy and draw nothing (the handover while the globe is shown)
map.setRenderScale(n)       // native mode: map pixels per art cell per axis (the frame governor lowers it)
map.getView() / getTileStatus() / getMaxZoom() / dispose() / debug()
```
React: `<StreetMapCanvas places routes selectedSlug focusedSlug initialView reducedMotion tiles insetRight onSelect onViewChange onTileStatus onReady engineOptions />`. `onReady(map)` hands the handle to the parent (null on dispose). The engine is rebuilt only when `places`, `routes` or the tile URLs change; the camera is kept.

Accessibility is the globe's: map, pass canvas and overlay are `aria-hidden` and have no tab stop (the MapLibre canvas has its `tabindex`/`aria-label` removed, keyboard handling off); the only exposed content is the attribution (real links) and a `role="status"` message when WebGL is unavailable or a context is lost. The place list stays the accessible path.

## Embedded use (the handover)

`createStreetMap(container, { embedded: true, ... })` is how the handover controller uses the engine; `StreetMapCanvas` (React wrapper, `/dev/street`) stays standalone. Embedded means:

- the map root is transparent (`setBlend` < 1 shows the Three.js globe underneath, cell by cell) and takes no pointer events (the globe canvas keeps all input); `hit(x, y, kind)` answers what a click at a container point would select, so the host routes picking;
- the host owns the camera: `setCamera(view, { inset, sync })` jumps the camera and applies the globe's animated inset in the same step (no easing: the engine's own padding ease is off), `sync` renders, composites and updates the overlay before returning. The engine does not ease the camera back to the cap when `capped` (the host reads `getMaxZoom()` and does it); the style swap on a source transition still happens;
- the overlay uses the globe's look (`OverlayLook "globe"`: markers 3 / focused 7 solid / selected 9 ring with dot, the globe's label type, background, selection inversion, `engine/labels.ts` placement, no leader lines, every label eligible at street scale) instead of the spike's boxed HUD (`"hud"`, still the standalone default);
- `covers(lon, lat)`: whether the active source has tiles there (false while connecting or capped, and outside the bounds of a fallback archive). The host does not fly to street scale for an uncovered place.
- Routes are 2 art pixels wide with a 7 px dash period (62 % ink), the Three.js globe's stroke, so a route keeps its weight through the dissolve (1 px before stage 2).

## Lifecycle

1. Create: DOM, a tile-less style (bundled coastline, borders, graticule and routes draw at once), compositor, overlay, listeners. The manager starts and probes the primary TileJSON (3 s timeout). World lines load from `@catalyst/geodata` (shared chunk with the globe).
2. A transition swaps the style (`setStyle`, the overlay keeps its last frame until the new tiles are idle, 2.5 s cap).
3. On demand frames: the overlay redraws on the map's `render` event and while a reveal / dissolve animates. Idle = zero map renders, zero pass runs, zero rAF calls (asserted).
4. ResizeObserver / DPR watcher recompute the art cell (`applyCell` re-applies the art-pixel widths), `visibilitychange` cancels animation and tells the manager not to count the hidden time as stalls, theme changes re-read `--background`, `--foreground`, `--globe-limb` (`engine/colors.readTheme`, the globe's reader).
5. Context loss: the overlay context is `preventDefault`ed, drawing stops, and on restore every GL object is rebuilt and the next map frame repaints. The map's context is restored by MapLibre. `onContextChange(true)` while either is lost; the wrapper shows a status message.
6. Dispose: stops timers and animation, observers, removes the map (frees its context), disposes the compositor (deletes GL objects, forces the context loss) and the tile protocols, removes all DOM. Twice is safe.

## Tile source state machine

```
 connecting --probe ok--------------------------------------------> primary
     | probe fails                                                     |  health fails / style error / source died
     v                                                                 v
 (probe fallback) --ok--> fallback <---------------------------------+
     | fails                |  health fails (then the primary is re-probed at once)
     v                      v
   capped <-----------------+      recovery: probe upwards with backoff 30 s, 60 s ... 5 min;
   maxZoom = 6                      promotion needs 2 probes 4 s apart; from capped the fallback is tried too
```
- Triggers (all unit tested, `tile-health.ts`): 4 failures in a row, or half of a 20 s window with at least 4 samples (`error-rate` / `timeout`), p95 of successful requests over 4.5 s with at least 5 samples (`slow`), 2 requests pending over 5 s or 1 with no success for 10 s (`stalled`), a style / TileJSON error confirmed by a probe, a dead source. Every request has a 10 s timeout (the spike's gap: MapLibre has none). Cancelled requests and empty tiles (HTTP 404/204, tile missing from the archive) never count.
- Hysteresis: each transition resets the health window; confirmation probes; backoff; a primary that fails again inside 60 s of its promotion keeps its growing backoff; a source probed down is not a failover target for 10 s.
- The fallback is never probed while the primary works (it is a home uplink).
- `onTileStatus({ state, source, reason, detail, maxZoom, at })`. When `capped` the engine clamps the camera to `maxZoom` (eases back, jump under reduced motion) and reports it; the handover decides the UX. A pinned source (`forceSource`) disables probing, failover and recovery.
- Fallback coverage: tiles outside the extracted boxes are empty tiles (no error, no log). Requests are limited to `maxFallbackZoom`; beyond it the map over-zooms.
- A 200 answer to a range request is treated as a failure and aborted (never downloads the whole archive).
- Attribution per active source: primary on OpenFreeMap "© OpenStreetMap contributors · OpenFreeMap · OpenMapTiles"; fallback "© OpenStreetMap contributors · Protomaps"; a custom TileJSON primary "© OpenStreetMap contributors"; while connecting or capped "Natural Earth". It moves left of the inset.

## Environment contract

Read per request in the server loader by `app/lib/tiles-config.server.ts` (docs/self-hosting.md section 6) and passed in `loaderData.tiles`; never `VITE_`, never baked into the bundle.

| Variable | Default | Notes |
| --- | --- | --- |
| `CATALYST_TILES_PRIMARY_URL` | `https://tiles.openfreemap.org/planet` | OpenFreeMap's planet TileJSON: the style-independent description of the OpenMapTiles-schema vector tiles, z0 to z14, no key. A `.pmtiles` URL also works (Protomaps schema). |
| `CATALYST_TILES_FALLBACK_URL` | unset | PMTiles archive with Range + CORS. Unset: chain is primary then the globe. |
| `CATALYST_TILES_MAX_FALLBACK_ZOOM` | `14` | integer 0 to 15 |

Trimmed, empty = unset, https only (plain http for localhost outside production), no credentials; an invalid value warns once and behaves as unset.

## Registration (globe <-> map)

`zoom_map = zoom_globe + log2(cos lat)` (`core/registration.ts`: `registerGlobeToMap`, `registerMapToGlobe`, `globeViewToMap`, `mapToGlobeView` for the app's [0, 1] zoom). `zoom_globe` is the globe's internal zoom. Measured (`scripts/street/registration.mjs`, live MapLibre globe vs the globe model `engine/geo.ts`, 1440x900, 5x5 grid of +-8 degrees): with the correction the mean AND max difference are under 0.001 px in all nine cases (lat 10.8, 40, 60; globe zoom 2.6 to 5.5); without it 1.1 px (lat 10.8, z2.6) up to 350 px (lat 60, z5.5), matching the spike's raw column. The spike's 1.3 px residual came from its prototype globe; the production model coincides with MapLibre's. This compares projections, not Three pixels (the globe's own tests tie the model to the Three camera). Unit tests add an analytic Mercator check (under 1 px mean within 250 px of the centre from z10 at every latitude).

## Handover (stage 2)

Summary (full description and numbers in `docs/web-architecture.md`, "Handover"): the globe renderer owns one camera whose zoom extends past 6.5 into street scale; the street map follows it (registered, synchronous), replaces the globe by a clean CUT at internal zoom 5.05 once its tiles are loaded (the pixel-grid dissolve between 4.6 and 5.5 is kept behind `HANDOVER.dissolve`, off), swapping markers and labels in the same task, and is released again below 3.3. The chunk (about 435 KB gzip plus the worker) loads at zoom 4.0 or when a place is selected; until a tile source works the globe's zoom limit is 6.5 and a flight toward street scale waits at it. `onTileStatus` drives the limit: `capped` makes the controller ease the camera back to the globe's range and show the small notice. `GlobeViewState.street` stores street scale in the shell's saved view.

## Palette and tone (2026-10-05)

One grey palette for both renderers (`engine/palette.ts`, spec in `docs/pixel-line-rules.md` section 7, comparison of N = 4, 6, 8, 10 in `docs/palette/compare-*.png`): `PALETTE_LEVELS` = 12 levels derived from `--background` and `--foreground` in OKLab; the 10 map levels only reach `MAP_CONTRAST` of the way to the ink (the map recedes), the last level is the full ink (markers, labels, selection, routes). Named roles wash, faint, soft, mid, strong, peak, ink. The style paints level-encoded colours (`core/palette.ts`), the pass quantises to a level per cell without smoothing, the presenter looks the level up. Lines carry their class's tone (coast and borders peak, major roads strong, minor roads mid, rail, paths and links soft). Fills: buildings are a flat wash; **water and green areas are screen-anchored patterns** (`PATTERN` in `core/palette.ts`, evaluated by `patternLit` in the pass from the art cell only): green = a sparse dot lattice, water = short horizontal dashes, both one cell in eight in the `soft` level, so parks never read as lakes. The pattern id travels with the level in the fill colour (`B = pattern x 16 + level`); the pass reads it from the cleanest texel of the cell so anti-aliased erasing strokes cannot garble it. **The sea eases in over zoom**: the water fill is one layer whose colour steps through the levels from the faintest one at map zoom `handoff + 0.7` (5.2 for OpenFreeMap, 9.2 for the PMTiles extract, whose tiles only exist around its place) to `soft` 4.8 zoom later (`seaFade` in `street-style.ts`), so it is never a single step, in both directions, and nothing is drawn where the globe is shown. Debug override of the count: `?levels=N` on a `?globe-debug` page or sessionStorage `palette-levels` (the synthetic gate takes `LINES_QUERY=levels=N`).

## Level of detail (street style)

`street/style/lod.ts` is the one table to tune (`LOD`: `from`, `full`, `role`, final dash per class); `street-style.ts` builds ONE layer per class from `from`. Its colour is a zoom `step` expression: the class enters at the faintest palette level and steps up through the levels, in steps of equal zoom length, to its role's level at `full` (the final look). It is the same line (width, dashes, filter) from the first zoom, only its tone changes, so the fade adds, removes and moves no cell: `scripts/street/lod-check.mjs` forces the levels 1..7 on the real pipeline and counts 0 cells that differ (the dither ramp this replaces added about 200 to 600 cells per 1/16 step, which read as noise). Widths are untouched (art px, floor 1): the weight is the tone, the dashes of minor roads, paths and rail are their final look. Both schemas map to the same classes (Protomaps keeps trunk, primary, secondary and tertiary under `major_road`, so the classes are split on `kind_detail`; links, sidewalks, crossings, platforms and underground rail are dropped or lightened identically).

| Class | from | full | final look |
|---|---|---|---|
| motorway, trunk | 5.5 | 8.5 | solid 1 px |
| primary | 9.5 | 12.5 | solid 1 px |
| secondary | 11.8 | 14.2 | solid 1 px |
| tertiary | 13 | 15.5 | solid 1 px, 1.7 px from z16 |
| residential / minor | 14.4 | 16.4 | dotted `[1.8, 2.4]`, solid ramp 16.6 to 17.4 |
| junction links | 14.8 | 16.6 | dotted `[1.8, 3.6]` |
| service, track | 15.4 | 16.8 | dotted `[1.8, 3.6]` |
| paths | 15.9 | 17 | dotted `[1.8, 3.6]` |
| rail | 12.5 | 14.5 | dashed `[3, 2.2]` (was a solid muted 1.8 px line) |
| rivers (lines) / lakes / small water outlines | 9 / 7.5 / 12 | 11.5 / 10 / 14 | solid 1 px (the sea outline is always drawn) |
| canal / stream | 13 / 14 | 15 / 16 | dashed |
| region border | 4.5 | 6.5 | dashed (country borders unchanged) |
| building outline / fill | 16.6 / 15.8 | 17.4 / 17.5 | 1 px / flat wash |
| water fill (pattern: dashes) / park fill (pattern: dots) | 5.2 (+ handoff - 4.5) / 8.6 | 10 (+ same) / 11.6 | `soft` level, one cell in eight |

Main roads are 1 art px up to z14.6 and hollow only once the casing holds two outlines and a 2 px interior (z16.9 and up). Measurements and before/after are in `docs/street-zoom/style-*`; `node scripts/street/lod.mjs --tag=after` regenerates them (line cells per 1000 art cells with fills hidden, vector line features rendered).

## Dev route and checks

`/dev/street` (and `/dev/street-lines`) exist only in development or a build made with `CATALYST_DEV_ROUTES=1`; otherwise they are not in `routes.ts` (a production build contains none of their code) and their loaders answer 404. Query: `source=primary|fallback`, `chaos=block-primary|slow-primary|block-all` (+ `chaos-after`, `chaos-heal`, `chaos-slow`), `view`, `select`, `inset`, `rm=1`, `theme`, `reveal=1`, `sharp`, `blend`, `fallbackUrl`, `primaryUrl`, `timings=`, `thresholds=`.

```
node apps/web/scripts/street/serve-tiles.mjs prototypes/street-zoom/public/hcmc.pmtiles 5240   # local Range server
CATALYST_TILES_FALLBACK_URL=http://127.0.0.1:5240/places.pmtiles pnpm --filter @catalyst/web dev   # then BASE_URL=...
pnpm --filter @catalyst/web test:street-lines     # the line regression gate (needs the dev server on BASE_URL, Chrome)
node apps/web/scripts/street/lod-check.mjs      # tone ramp: levels 1..7 change no cell
node apps/web/scripts/street/lod.mjs --tag=after # LOD screenshots + line density per zoom/theme/place
node apps/web/scripts/street/failover.mjs         # failover drills with Playwright routing
node apps/web/scripts/street/perf.mjs all         # frames, idle, context loss, 20 cycles, flight (prefer a CATALYST_DEV_ROUTES=1 build)
node apps/web/scripts/street/registration.mjs
node apps/web/scripts/street/tile-fade.mjs        # tile fade: no ghost in motion, intermediate levels at rest, idle after
node apps/web/scripts/street/palette-compare.mjs  # N = 4, 6, 8, 10 contact sheets (docs/palette/)
node apps/web/scripts/street/palette-shots.mjs after views=paris-sel,lisbon-z13  # the same views in both themes (before/after evidence)
node apps/web/scripts/street/sea-ease.mjs after scheme=dark   # sea tone and its largest step, zooming in and out across the globe cut (docs/palette/sea-ease-*)
node apps/web/scripts/globe/stale-check.mjs       # stale soft edge + no dashed coast/border on the live map
node apps/web/scripts/globe/reload-fade.mjs       # reload fade of a direct place load
node apps/web/scripts/street/shot.mjs name source=fallback scheme=dark
```

## Measurements (before the performance phase; current numbers and method in `docs/performance.md`) (Apple M4, Chrome for Testing 153 headless, ANGLE Metal; production build, local PMTiles)

- Line gate: 171 of 171 checks now at native resolution (165 of 165 in the device-resolution path this paragraph was written for; the hollow-road bound became a fraction, see `docs/performance.md` limits) (synthetic 24 angles x 16 offsets x 3 zooms at DPR 1, 1.5, 2: 0 broken one-pixel lines, 0 doubled, 0 thin; hollow roads 2.0 cells per step; dashed lines never vanish, 0.26 to 1.0 cells per step; real map: thin ink in 2x2 blocks 0.2 % to 2.9 %; idle 0 renders, 0 pass runs, 0 rAF). Hollow-road rows tolerate 1 broken line in 384 (an angle/offset tie, seen at DPR 1 and 1.5).
- Frames (GPU-synced: jumpTo + sync render + upload + pass + readPixels, circular pan, 450 frames): 1440x900@2 p50 9.3 / p95 11.7 / max 13.7 ms; 390x844@3 emulated 6.1 / 6.8 / 8.1 ms. rAF 16.7 ms throughout. JS part p50 1.5 / 1.1 ms. JS heap 23 to 28 MB.
- World to street flight (real OpenFreeMap): 5.6 s, 338 frames, max rAF interval 16.8 ms, 0 frames over 25 ms.
- Failover (Playwright routing): primary blocked at start, fallback serving about 0.6 s after navigation; primary slow (tiles 8 s): fallback after 5.0 s (`stalled`); primary dies at runtime: fallback within 20 ms of the first failures; both blocked: capped, zoom eased to 6; unblocked: primary again 1.2 s after (test timings 2 s / 0.5 s; production 30 s + 4 s). No uncaught errors; no console errors for tiles missing from the archive.
- Context loss: both contexts lose and restore, overlay repaints (22,149 ink cells after restore); 20 mount / dispose cycles: 0 live contexts away, 2 back, 43 created = 43 lost over the run, DOM canvases 2.
- Bundle (min + gzip): street engine 19.6 KB, MapLibre + PMTiles 283.7 KB, React wrapper 1.4 KB, MapLibre worker 146.3 KB (separate file): 451 KB total (the spike's budget note: about 430 KB). Not in the main bundle, not in the globe chunk; a production build without the dev routes contains no street code at all, and with the stage 2 import the server JS still has none (the `?worker&url` asset may be emitted as an unreferenced file in `build/server/assets`).

## Limitations and open items

- Not verified: Safari / iOS (iOS Simulator unavailable), real phones (the "mobile" row is emulation on the M4), a real DPR change, real GPU context loss, behaviour against a real Caddy/Traefik/home uplink, OpenFreeMap beyond a few sessions.
- Gate gap: the spike's high-resolution reference comparison on the real map (per class line-miss, fragmentation) and the pan stability metrics were not ported; the synthetic part and the real-map block / idle checks were.
- The recovery probe checks the TileJSON, not a tile: a source that serves TileJSON but slow tiles can be promoted and demoted again; the flap backoff bounds that to one failover per growing interval.
- Rendering: native art resolution by default (`renderScale` 3 map pixels per cell per axis, the pass runs on the `cols x rows` art grid, the canvas is scaled up with `image-rendering: pixelated`); `highResolution: true` keeps the device-resolution render the sharp reveal and dissolve need (both off by default; `setReveal`/`setSharp` are no-ops in native mode). See `docs/performance.md` for why 3, the numbers, the pan snapping, the frame governor and the budgets.
- Outside a fallback archive's bounds the street map shows empty tiles (world lines only): the handover does not fly there, but the user can pan there. Primary-only deployments have global coverage.
- Embedded, the registration is exact (the same maths) but the street map's globe projection is not drawn: the handover ends well before MapLibre's own globe-to-Mercator transition (zoom 12 in MapLibre; the cameras agree to under 1 px within 250 px of the centre from zoom 10).
- Routes are drawn as dashed pixel lines on the ground (no lift, no draw-on animation, route stops are not enlarged).
- Markers: normal 3, focused 7, selected 9 art pixels like the globe; labels use the spike's HUD style (selected/focused solid, others dotted and muted).
- Mapbox is out of scope.

## Tile fade (2026-10-05)

Owner: "tiles loading and unloading is brutal, no animation at all". MapLibre has no per-tile or per-layer opacity for vector tiles (`fadeDuration` is for symbols and rasters, `raster-fade-duration` is for rasters, and a layer paint transition cannot know a tile just arrived), and a custom layer would have to re-implement tile tessellation. So the fade is a stage of the art-resolution pass (pass E, `gl/pixel-pass.ts`, driven by `gl/compositor.ts`, constants `TILE_FADE`):

- The classifier writes the target art image as before. Pass E keeps the PRESENTED levels (two small ping-pong textures) and moves every cell at most one level towards the target per tick; the presenter reads the presented levels. A tick is 32 ms, and the loop stops by itself after `levels - 1` ticks, so a fade of the whole palette takes about 220 ms and an idle map costs no frame (asserted: 0 renders, 0 rAF).
- It only runs while the camera RESTS (no `move` event of the map for 100 ms) and not under reduced motion. During any movement the presented image is the classified one, taken at once (step 255): an eased image of a moving map would smear, and a motion compensated one would need a flow estimate for no visible gain. So content that appears or disappears at a resting camera (tiles arriving after a flight, a pan or a zoom has stopped; tiles replaced by sharper ones; unloading) eases through the grey levels, and nothing ever ghosts or trails while panning or zooming.
- Limits: a tile that arrives within 100 ms of the camera stopping, or while it moves, pops in as before (with a network source tiles mostly arrive later; the local PMTiles are often faster than that). A line that moves by one cell when a sharper tile replaces an over-zoomed one cross-fades over those 220 ms (two cells at half tone) rather than being redrawn in place. Native art-resolution mode only (the device-resolution mode, off by default, presents unfaded). `StreetMapOptions.tileFade: false` turns it off.
- Check: `scripts/street/tile-fade.mjs` (delayed tiles): a pan and zoom presents exactly the classified image on all 40 frames; tiles arriving at a resting camera show intermediate levels (peak 1,830 cells at once), never move a cell more than one level per tick, converge, and leave the map idle; with the fade off or under reduced motion no intermediate level appears. `scripts/street/tile-fade-shots.mjs` made `docs/palette/tile-fade.png`.
