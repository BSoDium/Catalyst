# Street map (`apps/web/app/globe/street/`)

Status: stage 1 of 2, 2026-10-05. The production street-scale renderer, built from `docs/street-zoom-spike.md` and `docs/pixel-line-rules.md` (variant F). It is NOT wired into the UI yet: stage 2 (the globe-to-street handover) integrates it. The shell loader already carries the tile configuration (`loaderData.tiles`).

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
    attribution.ts, label-place.ts, marker-visibility.ts, routes.ts
  gl/pixel-pass.ts       pass A (centre sampling), T (stair removal), B (present: reveal, sharp, blend)
  gl/compositor.ts       overlay context, texImage2D copy per map `render`, context loss, hold
  style/street-style.ts  one MapLibre style for both schemas, no glyphs, no sprites, no symbol layers
  net/probe.ts           TileJSON / PMTiles header probes with timeout and real abort
  net/tile-protocols.ts  per-instance protocols `catp<N>` / `catf<N>`: timed, timeout-bounded tile requests
  overlay/hud-layer.ts   markers, labels, leader lines, hit testing
  harness/synthetic.ts   line-connectivity harness (dev route /dev/street-lines), not in the engine chunk
```
Outside the folder: `app/lib/tiles-config.server.ts` (+ test), `app/routes/dev-street.tsx`, `dev-street-lines.tsx`, one line in `routes.ts`, the loader line in `routes/shell.tsx`, `apps/web/scripts/street/*`.

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
map.getView() / getTileStatus() / getMaxZoom() / dispose() / debug()
```
React: `<StreetMapCanvas places routes selectedSlug focusedSlug initialView reducedMotion tiles insetRight onSelect onViewChange onTileStatus onReady engineOptions />`. `onReady(map)` hands the handle to the parent (null on dispose). The engine is rebuilt only when `places`, `routes` or the tile URLs change; the camera is kept.

Accessibility is the globe's: map, pass canvas and overlay are `aria-hidden` and have no tab stop (the MapLibre canvas has its `tabindex`/`aria-label` removed, keyboard handling off); the only exposed content is the attribution (real links) and a `role="status"` message when WebGL is unavailable or a context is lost. The place list stays the accessible path.

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

## For the handover worker

- Mount `<StreetMapCanvas>` under the Three canvas in the same box (it fills its container, transparent where `setBlend` < 1) or drive `createStreetMap` yourself; lazy-load it when the user zooms past about globe zoom 5 or opens a place (the chunk is about 435 KB gzip plus the worker).
- Start the street map at `globeViewToMap(view, { minZoom: globe.getMinZoom(), maxZoom: 6.5 })` with the same `insetRight`; hand back with `mapToGlobeView`.
- Dissolve between the engines on the art-pixel grid with `setBlend` (0 transparent to 1 opaque; Bayer, same grid as the globe's pixels). Fade `map.overlay` (markers, labels) alongside. `setReveal(true)` opens the sharp circle around the selected place after arrival, `setSharp` dissolves the whole pixel art into the vector render. All are instant under reduced motion (a static dissolve).
- Respect `onTileStatus`: when `state === "capped"`, `maxZoom` is 6; do not offer street scale (the engine already eases back). Do not offer street scale for a place outside the fallback boxes while on `fallback`.
- `onSelect` is the only navigation request, as for the globe.

## Dev route and checks

`/dev/street` (and `/dev/street-lines`) exist only in development or a build made with `CATALYST_DEV_ROUTES=1`; otherwise they are not in `routes.ts` and their loaders answer 404. Query: `source=primary|fallback`, `chaos=block-primary|slow-primary|block-all` (+ `chaos-after`, `chaos-heal`, `chaos-slow`), `view`, `select`, `inset`, `rm=1`, `theme`, `reveal=1`, `sharp`, `blend`, `fallbackUrl`, `primaryUrl`, `timings=`, `thresholds=`.

```
node apps/web/scripts/street/serve-tiles.mjs prototypes/street-zoom/public/hcmc.pmtiles 5240   # local Range server
CATALYST_TILES_FALLBACK_URL=http://127.0.0.1:5240/places.pmtiles pnpm --filter @catalyst/web dev   # then BASE_URL=...
pnpm --filter @catalyst/web test:street-lines     # the line regression gate (needs the dev server on BASE_URL, Chrome)
node apps/web/scripts/street/failover.mjs         # failover drills with Playwright routing
node apps/web/scripts/street/perf.mjs all         # frames, idle, context loss, 20 cycles, flight (prefer a CATALYST_DEV_ROUTES=1 build)
node apps/web/scripts/street/registration.mjs
node apps/web/scripts/street/shot.mjs name source=fallback scheme=dark
```

## Measurements (Apple M4, Chrome for Testing 153 headless, ANGLE Metal; production build, local PMTiles)

- Line gate: 165 of 165 checks (synthetic 24 angles x 16 offsets x 3 zooms at DPR 1, 1.5, 2: 0 broken one-pixel lines, 0 doubled, 0 thin; hollow roads 2.0 cells per step; dashed lines never vanish, 0.26 to 1.0 cells per step; real map: thin ink in 2x2 blocks 0.2 % to 2.9 %; idle 0 renders, 0 pass runs, 0 rAF). Hollow-road rows tolerate 1 broken line in 384 (an angle/offset tie, seen at DPR 1 and 1.5).
- Frames (GPU-synced: jumpTo + sync render + upload + pass + readPixels, circular pan, 450 frames): 1440x900@2 p50 9.3 / p95 11.7 / max 13.7 ms; 390x844@3 emulated 6.1 / 6.8 / 8.1 ms. rAF 16.7 ms throughout. JS part p50 1.5 / 1.1 ms. JS heap 23 to 28 MB.
- World to street flight (real OpenFreeMap): 5.6 s, 338 frames, max rAF interval 16.8 ms, 0 frames over 25 ms.
- Failover (Playwright routing): primary blocked at start, fallback serving about 0.6 s after navigation; primary slow (tiles 8 s): fallback after 5.0 s (`stalled`); primary dies at runtime: fallback within 20 ms of the first failures; both blocked: capped, zoom eased to 6; unblocked: primary again 1.2 s after (test timings 2 s / 0.5 s; production 30 s + 4 s). No uncaught errors; no console errors for tiles missing from the archive.
- Context loss: both contexts lose and restore, overlay repaints (22,149 ink cells after restore); 20 mount / dispose cycles: 0 live contexts away, 2 back, 43 created = 43 lost over the run, DOM canvases 2.
- Bundle (min + gzip): street engine 19.6 KB, MapLibre + PMTiles 283.7 KB, React wrapper 1.4 KB, MapLibre worker 146.3 KB (separate file): 451 KB total (the spike's budget note: about 430 KB). Not in the main bundle, not in the globe chunk; a production build without the dev routes contains no street code at all, and with the stage 2 import the server JS still has none (the `?worker&url` asset may be emitted as an unreferenced file in `build/server/assets`).

## Limitations and open items

- Not verified: Safari / iOS (iOS Simulator unavailable), real phones (the "mobile" row is emulation on the M4), a real DPR change, real GPU context loss, behaviour against a real Caddy/Traefik/home uplink, OpenFreeMap beyond a few sessions.
- Gate gap: the spike's high-resolution reference comparison on the real map (per class line-miss, fragmentation) and the pan stability metrics were not ported; the synthetic part and the real-map block / idle checks were.
- The recovery probe checks the TileJSON, not a tile: a source that serves TileJSON but slow tiles can be promoted and demoted again; the flap backoff bounds that to one failover per growing interval.
- Phones render the map at scale min(DPR, 2) with device-resolution output (no art-resolution path); the spike's cheaper A2 path is future work.
- Routes are drawn as dashed pixel lines on the ground (no lift, no draw-on animation, route stops are not enlarged).
- Markers: normal 3, focused 7, selected 9 art pixels like the globe; labels use the spike's HUD style (selected/focused solid, others dotted and muted).
- Mapbox is out of scope.
