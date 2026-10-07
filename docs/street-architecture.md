# Street map (`apps/web/app/globe/street/`)

Status: stage 2 of 2, 2026-10-05; 2026-10-07: earlier cut with a cross-fade, road hierarchy, temporal ease (sections "Handover", "Road hierarchy", "Temporal ease"). The production street-scale renderer, built from `docs/street-zoom-spike.md` and `docs/pixel-line-rules.md` (variant F), now integrated: the globe hands over to it (`app/globe/handover/`, described in `docs/web-architecture.md`, "Handover"). The shell passes `loaderData.tiles` to `<Globe tiles>`. `/dev/street` and `/dev/street-lines` remain, as development-only routes.

## What it is

A client-only, lazily loaded module: MapLibre draws four plain channels, a separate overlay WebGL context turns them into 1-bit pixel art (2.5 CSS px art pixel on desktop, 2 on phones: `ART_PIXEL`, the globe's own `TUNING.pixelSize`), a pixel-art canvas overlay draws the detection boxes and their labels (the globe's `BoxScene`), a tile source manager keeps the map on a working source, the data credits are a pixel-art info button and a modal dialog (HTML, outside the pass and the engine).

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
    ease.ts              the temporal ease (tile arrival / departure, tone steps, the cut): CPU twin of the pass's `FRAG_EASE`
    warp.ts              camera-delta warp for the ease: where a cell of this frame was in the previous one (Mercator or globe mesh)
    registration.ts      globe <-> map camera (log2 cos lat)
    tile-health.ts       request scoring: error rate, timeouts, p95 latency, stalls
    tile-source-manager.ts   the state machine
    source-descriptor.ts TileJSON / PMTiles header -> descriptor, URL validation
    palette.ts           the level encoding between the style and the pass (the grey ramp itself is engine/palette.ts, shared with the globe)
    snap.ts              pan snapping: centre quantised to whole art cells while the zoom is steady
    attribution.ts, routes.ts
    label-place.ts       only `labelPriorityFloor` is used (hud-layer); `placeLabels` and `snapToCell` are test-only
    marker-visibility.ts test-only (no production importer)
  gl/pixel-pass.ts       pass A (centre sampling, palette level), T (stair removal), E (tile fade ease), B (present: reveal, sharp, blend)
  gl/compositor.ts       overlay context, canvas copy per map `render` (native: the map IS the art grid, 3 px per cell), suspend, context loss, hold
  style/street-style.ts  one MapLibre style for both schemas, no glyphs, no sprites, no symbol layers
  style/lod.ts           the level-of-detail table (`LOD`: `from`, `full`, `role`, dashes per class), the one place to tune
  style/probe.ts         test helpers: read a palette level / pattern back out of a style paint
  net/probe.ts           TileJSON / PMTiles header probes with timeout and real abort
  net/tile-protocols.ts  per-instance protocols `catp<N>` / `catf<N>`: timed, timeout-bounded tile requests
  overlay/hud-layer.ts   the detection boxes of places and groups, labels and chips (engine/box-scene.ts), hit testing
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
map.seedFrom(globeCanvas, grid) / map.crossfadeTo(globeCanvas | null, grid)   // the cut as a tone cross-fade, both ways (see "Temporal ease")
map.setRenderScale(n)       // native mode: map pixels per art cell per axis (the frame governor lowers it)
map.getView() / getTileStatus() / getMaxZoom() / dispose() / debug()
```
React: `<StreetMapCanvas places routes selectedSlug focusedSlug initialView reducedMotion tiles insetRight onSelect onViewChange onTileStatus onReady engineOptions />`. `onReady(map)` hands the handle to the parent (null on dispose). The engine is rebuilt only when `places`, `routes` or the tile URLs change; the camera is kept.

Accessibility is the globe's: map, pass canvas and overlay are `aria-hidden` and have no tab stop (the MapLibre canvas has its `tabindex`/`aria-label` removed, keyboard handling off); the only exposed content is the info button (a real `<button>`, below) and a `role="status"` message when WebGL is unavailable or a context is lost. The place list stays the accessible path.

## Embedded use (the handover)

`createStreetMap(container, { embedded: true, ... })` is how the handover controller uses the engine; `StreetMapCanvas` (React wrapper, `/dev/street`) stays standalone. Embedded means:

- the map root is transparent (`setBlend` < 1 shows the Three.js globe underneath, cell by cell) and takes no pointer events (the globe canvas keeps all input); `hit(x, y, kind)` answers what a click at a container point would select, so the host routes picking;
- the host owns the camera: `setCamera(view, { inset, sync })` jumps the camera and applies the globe's animated inset in the same step (no easing: the engine's own padding ease is off), `sync` renders, composites and updates the overlay before returning. The engine does not ease the camera back to the cap when `capped` (the host reads `getMaxZoom()` and does it); the style swap on a source transition still happens;
- the overlay is the globe's: `HudLayer` is a thin host of `engine/box-scene.ts`, so places and groups are rectangles (the cut of the place hierarchy, `engine/lod-tree.ts`, evaluated from the unified camera registered from the map's), labels are pixel text with the group chip, on the same art-pixel canvas, font and rules as the globe ("Detection boxes and pixel text" in `docs/web-architecture.md`); the spike's boxed HUD and the leader lines are gone (`OverlayLook` is kept for the option only). Routes are drawn only while the selected place is one of their stops (`routesForPlace`);
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
- Attribution is an info button, not a ribbon: a pixel-art "i" (`components/attribution-button.tsx`, picture in `components/info-button-art.ts`) drawn on the art-pixel grid at the maps' own cell size in the label font (Tiny5), bottom right, left of the detail panel's inset. Rest: ink outline on the page colour with a one-cell shadow; hover: inverted; pressed: one cell down into the shadow; keyboard focus: a one-cell ring. It is a real `<button aria-label="Map credits">` of at least 44 CSS px (the picture is about 35), so touch and keyboard work; it opens a native modal `<dialog>` (focus trapped by `showModal()`, Escape or a click outside closes it, focus returns to the button, Motion fade, none under reduced motion) that lists the credits with links. The credits (`core/attribution.ts`) follow the tile configuration, not the active source: an OpenFreeMap primary "© OpenStreetMap contributors", "OpenFreeMap", "OpenMapTiles"; a fallback archive or a PMTiles primary adds "Protomaps"; a self-hosted TileJSON primary "© OpenStreetMap contributors" only; always "Natural Earth" (public domain, the globe's and the lowest zooms' lines, a courtesy). The button is app UI handed to the globe through the `attribution` prop (`GlobeProps`, `StreetMapCanvasProps`; the app passes `components/attribution-slot.tsx`): it is rendered by the globe (`globe-canvas.tsx`, so it is there on the globe too) and by `StreetMapCanvas`, not by the engine, and `globe/` does not import it.

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

Summary (full description in `docs/web-architecture.md`, "Handover"; the numbers below are current): the globe renderer owns one camera whose zoom extends past 6.5 into street scale; the street map follows it (registered, synchronous) and takes over from the globe at internal zoom `cutZoom` **3.7** (was 5.05; back below `cutBackZoom` 3.45, hysteresis), once its tiles are loaded or `cutMaxWaitMs` 1200 ms have passed, swapping markers and labels in the same task. The swap is a **tone cross-fade of about 300 ms** (`crossfadeMs`; see "Temporal ease: tile arrival, tile departure and the cut"), not a click; the pixel-grid dissolve (blend 3.3 to 4.1) stays behind `HANDOVER.dissolve`, off. The chunk (about 305 KB gzip plus the 146 KB MapLibre worker, 451 KB in all, see Measurements) loads at zoom **2.6** (`mountZoom`, was 4.0), the map follows the camera invisibly from **3.0** (`followZoom`, was 4.3) so its tiles are ready at the cut, and it is released again below 1.9. In map zoom the cut is 3.7 + log2 cos(lat): 3.2 at 46 degrees, 2.7 at 60, 1.4 at 78 (`STREET_TUNING.minZoom` is 1). Why 3.7: the globe's own borders have reached the peak level at 3.5 (`TUNING.borderZoom`, asserted in `handover/maths.test.ts`), the cut sits after that and well before the old 5.05 (the test asserts at least 1.3 zoom levels earlier); the 3.5 to 4.2 range of the brief maps to the same picture, the street map draws the same coast and borders from the first tile zoom (`DEFAULT_HANDOFF.openmaptiles` 1) and keeps the bundled world lines under them while tiles load (`WORLD_PLACEHOLDER_BELOW`), so an early cut never shows an emptier map than the globe it replaces. `scripts/street/cut-seam.mjs` measures the seam (1440x900 @1, light, OpenFreeMap; share of the globe's coast and border cells that have a street cell within one art cell / the reverse): Europe 91 % / 88 % at 3.7 against 87 % / 73 % at the old 5.05, Borneo 94 % / 81 % against 84 % / 49 % (the street map draws more than the globe's 110m coast, the unmatched cells are detail the cross-fade brings in). Until a tile source works the globe's zoom limit is 6.5 and a flight toward street scale waits at it. `onTileStatus` drives the limit: `capped` makes the controller ease the camera back to the globe's range and show the small notice. `GlobeViewState.street` stores street scale in the shell's saved view.

## Palette and tone (2026-10-05)

One grey palette for both renderers (`engine/palette.ts`, spec in `docs/pixel-line-rules.md` section 7, comparison of N = 4, 6, 8, 10 in `docs/palette/compare-*.png`): `PALETTE_LEVELS` = 12 levels derived from `--background` and `--foreground` in OKLab; the 10 map levels only reach `MAP_CONTRAST` of the way to the ink (the map recedes), the last level is the full ink (markers, labels, selection, routes). Named roles wash, faint, soft, mid, strong, peak, ink. The style paints level-encoded colours (`core/palette.ts`), the pass quantises to a level per cell without smoothing, the presenter looks the level up. Lines carry their class's tone (coast and borders peak, major roads strong, minor roads mid, rail, paths and links soft). Fills: buildings are a flat wash; **water and green areas are screen-anchored patterns** (`PATTERN` in `core/palette.ts`, evaluated by `patternLit` in the pass from the art cell only): green = a sparse dot lattice, water = short horizontal dashes, both one cell in eight in the `soft` level, so parks never read as lakes. The pattern id travels with the level in the fill colour (`B = pattern x 16 + level`); the pass reads it from the cleanest texel of the cell so anti-aliased erasing strokes cannot garble it. **The sea eases in over zoom**: the water fill is one layer whose colour steps through the levels from the faintest one at map zoom `handoff + 0.7` (5.2 for OpenFreeMap, 9.2 for the PMTiles extract, whose tiles only exist around its place) to `soft` 4.8 zoom later (`seaFade` in `street-style.ts`), so it is never a single step, in both directions, and nothing is drawn where the globe is shown. Debug override of the count: `?levels=N` on a `?globe-debug` page or sessionStorage `palette-levels` (the synthetic gate takes `LINES_QUERY=levels=N`).

## Level of detail (street style)

`street/style/lod.ts` is the one table to tune (`LOD`: `from`, `full`, `role`, final dash per class); `street-style.ts` builds ONE layer per class from `from`. Its colour is a zoom `step` expression: the class enters at the faintest palette level and steps up through the levels, in steps of equal zoom length, to its role's level at `full` (the final look). It is the same line (width, dashes, filter) from the first zoom, only its tone changes, so the fade adds, removes and moves no cell: `scripts/street/lod-check.mjs` forces the levels 1..7 on the real pipeline and counts 0 cells that differ (the dither ramp this replaces added about 200 to 600 cells per 1/16 step, which read as noise). Widths are untouched by the fade (art px, floor 1): the weight is the tone, the dashes of minor roads, paths and rail are their final look; the one width step of the road hierarchy (motorway, trunk and primary, 2 px from z9) is below. Both schemas map to the same classes (Protomaps keeps trunk, primary, secondary and tertiary under `major_road`, so the classes are split on `kind_detail`; links, sidewalks, crossings, platforms and underground rail are dropped or lightened identically).

### Road hierarchy (2026-10-07)

Owner: dense is fine, but roads must not all look the same colour. Before, motorway, trunk, primary and secondary were all the `strong` level (8 of 12) and tertiary and residential `mid` (6): at Paris framing (map zoom 10.6) the map read as one weight. Now the class is told by **tone and width**, inside the line rules (one art pixel floor, centre sampling, no antialiased grey: tone is a palette level, never a width below 1 and never a half-covered cell):

| Class | tone at `full` (level of 12; named role) | width (art px) | from > full (was) | final look |
|---|---|---|---|---|
| motorway, trunk | 10 (`peak`, the loudest the map gets; still `MAP_CONTRAST` below the ink of labels, markers and boxes) | 2 from z9 (1 below), hollow from z16.9 | 5.5 > 8.5 (same) | solid |
| primary | 9 (`at` 0.9) | 2 from z9, hollow from z16.9 | 8.6 > 9.7 (9.5 > 12.5) | solid |
| secondary | 7 (`at` 0.7) | 1, 1.7 from z15.2 | 9 > 10.2 (11.8 > 14.2) | solid |
| tertiary | 5 (`at` 0.5) | 1, 1.7 from z16 | 10.9 > 11.7 (13 > 15.5) | solid |
| residential, unclassified | 4 (`soft`) | 1 | 12.2 > 14.2 (14.4 > 16.4) | dotted `[1.8, 2.4]`, solid 16.6 to 17.4 |
| service, track | 4 | 1 | 13.4 > 15.4 (15.4 > 16.8) | dotted `[1.8, 3.6]` |
| junction links | 4 | 1 | 10.2 > 12.2 (14.8 > 16.6) | dotted `[1.8, 3.6]` |
| rail | 4 | 1 | 10.2 > 12.2 (12.5 > 14.5) | dashed `[3, 2.2]` |
| paths | 3 (`faint`) | 1 | 14.6 > 16.4 (15.9 > 17) | dotted `[1.8, 3.6]` |

Tone by zoom band (the level a class is painted at; the minor classes enter later and stay lower; `node` script in the tests prints the same: `levelAt`):

| class | z9 | 9.5 | 10 | 10.5 | 11 | 12 | 13 | 14 | 15 | 16+ |
|---|---|---|---|---|---|---|---|---|---|---|
| motorway, trunk | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| primary | 4 | 8 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 |
| secondary | 0 | 3 | 6 | 7 | 7 | 7 | 7 | 7 | 7 | 7 |
| tertiary | 0 | 0 | 0 | 0 | 1 | 5 | 5 | 5 | 5 | 5 |
| residential | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 4 | 4 | 4 |
| service | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 4 | 4 |
| links, rail | 0 | 0 | 0 | 1 | 2 | 4 | 4 | 4 | 4 | 4 |
| paths | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 3 |

The finer tiers need more than the six named roles, so a `LodEntry` may carry `at` (0 to 1 along the map ramp, `toneLevel` in `lod.ts`); `fadeInColor` ramps up to that level like to a role's. The two-pixel width is `MAJOR_ART` in `street-style.ts`: it steps from 1 to 2 within 0.01 of zoom at `MAJOR_WIDE_FROM` 9 (no width between 1.25 and 1.6, where a line is one or two cells wide depending on its offset), `inkOpacityStops` samples a hair before every width stop so the ink class switches with it, and a two-pixel line is a wide class (never thinned). Adjacent tiers differ by at least 0.04 of OKLab lightness in both themes and the three loudest by 0.06 (asserted in `lod.test.ts` with the tone, width and ordering of every tier, and that no road reaches the ink). The line gate runs the two-pixel band (`road-major-case` below z16: 1.8 to 3.1 cells per step, never broken) and passes 241 of 241. Evidence: `docs/street-zoom/city-paris-desktop-<light|dark>-after.png` (and the other cities and viewports of `city-frames.mjs`); the "before" files are the single-weight map.

Other classes of the same table (unchanged by the hierarchy): rivers 7 > 9.2 (9 > 11.5), lakes 5.5 > 8 (7.5 > 10), small water outlines 11.2 > 13.2 (12 > 14), canal 12 > 13.8 and stream 13 > 15 (13 > 15, 14 > 16), building outline 16.6 > 17.4, region borders **3.8 > 5.2 (was 4.5 > 6.5)** dashed `mid`, country borders see "Borders". Fills: water 1.7 > 6.5 (5.2 > 10 at the old hand-over; `seaFade` shifts it per schema), park (dots) 6.4 > 8.8 (8.6 > 11.6), urban green (dots; parks, gardens, golf) 9.6 > 11.2 (new in the city-framing pass), building fill 15.8 > 17.5 (flat wash). Every fade-in is kept, only earlier: the class still enters at the faintest level and steps up in equal zoom lengths, adding, removing and moving no cell (`lod-check.mjs`: 0 cells over levels 1 to 7, re-run after this change).

### Tuned to the framing of a click (2026-10-06)

Owner: "streets inside cities should start loading earlier ... I sometimes can't see streets at all". The camera of a click is `placeFraming(place)` (`engine/framing.ts`): the centre of the place's bounding box and the radius that fits its larger half-extent, else the recorded point and `viewRadiusKm` (12 km by default); that circle fits the free viewport with a 25 % margin. The table below is for places without a box; boxed places frame wider (several have sides over 45 km, see `handoff.md`). In MapLibre zoom (unified zoom + `log2 cos lat`, `scripts/street/city-frames.mjs --table=1`):

| viewport | 10 km | 12 km | 14 km | 18 km |
|---|---|---|---|---|
| 1440x900, panel closed (Lisbon / Paris / HCMC) | 11.10 / 10.85 / 11.43 | 10.84 / 10.59 / 11.17 | 10.62 / 10.37 / 10.95 | 10.25 / 10.01 / 10.59 |
| 1440x900, panel 50 % open | 10.78 / 10.53 / 11.11 | 10.52 / 10.27 / 10.85 | 10.29 / 10.05 / 10.63 | 9.93 / 9.68 / 10.26 |
| 390x844 phone | 9.89 / 9.65 / 10.23 | 9.63 / 9.39 / 9.96 | 9.41 / 9.16 / 9.74 | 9.05 / 8.80 / 9.38 |

The old table drew primary roads at about a third of their tone and no secondary road at all there (secondary started at 11.8): "motorways and a few faint roads". The new one is bounded by the DATA: MapLibre draws the tiles of zoom floor(map zoom), and OpenMapTiles tiles hold primary roads from z8, secondary from z9, **tertiary from z11, residential and paths from z12, service from z13** (probed with `scripts/street/border-probe.mjs`-style tile dumps; Protomaps is the same within a level; a vector source cannot ask for tiles one zoom deeper, MapLibre throws for a vector `tileSize` other than 512). So below 11 a city is its arterials (primary, secondary, trunks, ramps, rail, rivers, parks) and tertiary roads start the moment they exist (10.9, full at 11.9); residential streets cannot show before z12 and start there dotted at the faintest level. At the framing zooms: primary in full, secondary in full or one level short, links, rail, rivers, parks and water showing (asserted in `lod.test.ts` from `radiusFitZoom`), and `green-fill` adds urban parks (OpenMapTiles keeps them in `landcover`, not in the `park` layer, which is protected areas only; Protomaps `landuse`).

Far-zoom calm is kept by construction: nothing road-like below z5.5, no road but motorways and trunks below z8.6 (primary from 8.6, secondary from 9; river lines from 7 and lake outlines from 5.5 are water). Ink cells per 1000 (800x500 CSS px, 3 px cells, fills hidden, light, `scripts/street/lod.mjs`, before > after; most added cells are in levels 1 to 4, contrast 1.1 to 1.7):

| zoom | 3.5 | 5.5 | 6.5 | 7.5 | 8 | 8.5 | 9 | 9.5 | 10 | 10.5 | 11 | 11.5 | 12 | 13 | 15 | 16+ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Paris | 42>40 | 123>123 | 55>54 | 41>41 | 37>37 | 36>36 | 62>187 | 111>182 | 104>172 | 91>187 | 87>209 | 68>186 | 100>151 | 94>149 | 57>118 | same |
| Lisbon | 28>27 | 56>55 | 36>35 | | 30>30 | | | | 81>105 | | 60>127 | | | 67>142 | 43>80 | same |
| Bucharest | | 95>91 | | 46>46 | 40>40 | | 64>119 | 75>111 | 78>111 | 66>104 | 59>131 | | 90>126 | 90>145 | | |
| Ho Chi Minh City (Protomaps) | | | | | 47>47 | | | | 93>132 | | 75>175 | | | 139>194 | 74>95 | same |

(That table was measured with the table of the city-framing pass, before the hierarchy.) Re-measured with the hierarchy at 2 px cells (800x500 CSS px at DPR 1, so 100,000 cells; the table above counts bigger cells, the two are not comparable), Paris, line cells per 1000: z5.5 129, z8.5 53, **z9 202**, 9.5 276, 10 262, 10.5 273, 11 288, 12 202, 13 176, 15 127, 16 82. The jump at z9 is the two-pixel motorways, trunks and primaries together with the secondary roads entering. World and country scale (z8.5 and below) is within 4 % everywhere (the small differences at 3.5 to 6.5 are the border fix below), z9 to 13 is 1.3 to 3 times denser, z16 and up is untouched. Evidence: `docs/street-zoom/city-<place>-<desktop|desktop-panel|mobile>-<light|dark>-<before|after>.png` (Lisbon, Paris, Bucharest, Ho Chi Minh City at the 12 km framing of each viewport) and `zoomout-paris-before-after.png` (z5.5, 7.5, 9, 10.5, 12). `node scripts/street/city-frames.mjs --tag=after`, `node scripts/street/lod-layers.mjs` (ink cells per class at a zoom, the tool for the next tuning round).

## Borders: one line per frontier (2026-10-06)

Owner: a second, "wavy and complex" line beside the Mauritania / Western Sahara / Morocco / Algeria border. Cause, from the live tiles (`scripts/street/border-probe.mjs -13,24 3,5,7,9`): the OpenMapTiles `boundary` layer carries the same frontier several times. Besides the de-facto border (`admin_level` 2, `disputed` 0, `maritime` 0) there are **disputed lines** (`disputed` 1: here "Mur de securite marocain", the Moroccan wall, 70 % of it 11 to 180 km beside the real border; Kashmir's LoC and LAC, Arunachal, Crimea, the West Bank, Guyana / Suriname, Olivenza, ...) and **maritime limits** (`maritime` 1). The style drew every land line (`maritime` excluded only), and ALSO the bundled Natural Earth lines up to z8 (`world-borders`), so from the globe-to-street cut two different geometries of one frontier were drawn on top of each other. Protomaps has the same `disputed` flag (a boolean; `unrecognized_country` and `overlay_limit` kinds are not drawn).

Rule (`street-style.ts`: `COUNTRY_BORDER_OMT`, `COUNTRY_BORDER_PM`, `borderHandoff`):

- A country border is a **de-facto land line only**: OpenMapTiles `admin_level` 2, not `maritime` 1, not `disputed` 1 (a missing flag is not disputed: Kosovo / Serbia has none); Protomaps `kind` country, `disputed` not true. Regional borders (`admin_level` 3 to 6) follow the same exclusions. Solid, peak tone, from its first zoom. Disputed and maritime lines are never drawn, at any zoom (a dotted claim line beside the border reads as a second border).
- One source per zoom: the bundled Natural Earth borders (`world-borders`) run up to `borderHandoff` and the tile boundary (`boundary-country`) starts there, like the coastline: `max(handoff, 5)`, i.e. 5 for OpenFreeMap (which itself switches its boundary DATA from Natural Earth, z0 to z4, to OpenStreetMap, z5 and up, there) and 8.5 for the PMTiles extract. Never both.
- Cost of the rule: frontiers that OpenStreetMap only carries as disputed lines have no line from z5 on (the China / India line of actual control, most of Kashmir, Arunachal, the Crimean isthmus, the West Bank). The alternative, a faint dotted claim line, would put a second line beside the Moroccan wall again, and the data cannot tell "only line" from "claim beside a border" (`disputed_name` is free text).
- Registration across the cut (`scripts/street/border-register.mjs`, 7.3 km per art cell at z5): 95.0 % of the Natural Earth length (what the globe draws) is within one cell of a tile line, 96.9 % within two; 3.1 % is farther than two cells, all of it disputed frontiers: Kashmir and Aksai Chin (75 to 80 E, 35 N: up to 52 cells), Arunachal / Tibet (95 E, 30 N), Crimea, the Morocco / Western Sahara line that Natural Earth has and OpenStreetMap (Morocco, wall excluded) has not (a line that disappears at z5), Mauritania's northern corner. The other way, 99.4 % of the tile lines are within two cells of a Natural Earth line. Those stretches jump or vanish once, at the cut; the globe's own data is outside the style (`engine/`).
- Checks: `style/street-style.test.ts` (filters evaluated with `probe.evalFilter` against real attribute sets of both schemas, one source per zoom for every hand-over), `node scripts/street/border-check.mjs` (live tiles: no disputed or maritime feature is rendered in 7 regions although the data holds them), before and after PNGs `docs/street-zoom/border-<ws|kashmir|crimea|cyprus|kosovo|israel>-before-after.png` (`border-shots.mjs`). No doubled line remains in Western Sahara, Kosovo / Serbia, Cyprus, Israel / Palestine or Crimea; Kashmir has fewer lines, not two.

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
node apps/web/scripts/street/tile-fade.mjs        # temporal ease: no ghost in motion, tiles fade in/out at rest and in motion, first load, idle after
node apps/web/scripts/street/ease-twin.mjs        # GPU ease pass against its CPU twin (core/ease.ts) on random frames
node apps/web/scripts/street/warp-check.mjs       # the camera warp (core/warp.ts) against MapLibre's projection
node apps/web/scripts/street/cut-fade.mjs         # the globe <-> street cut as a cross-fade (needs the app route, SOURCE=primary for the slow-tile drill)
node apps/web/scripts/street/cut-seam.mjs         # globe vs street coast / borders around the cut zoom, contact sheets
node apps/web/scripts/street/fade-sheet.mjs       # docs/street-zoom/fade-paris-*.png: consecutive frames, slow first load / pan / departure
node apps/web/scripts/street/city-frames.mjs --tag=after   # Paris, Lisbon, Bucharest, HCMC at the framing of a click (the road hierarchy)
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
- The cut is a tone cross-fade of about 300 ms between two images of the same grid; it is not motion compensated across the renderers (both are registered to under a thousandth of a pixel at the cut, so nothing needs to move). Where the globe's data and the tiles disagree (disputed borders, `Borders`), those cells fade out and in rather than move.
- Routes are drawn as dashed pixel lines on the ground (no lift, no draw-on animation, route stops are not enlarged).
- Markers: superseded by the detection boxes (rectangles, pixel text; see `docs/web-architecture.md`).
- Mapbox is out of scope.

## Temporal ease: tile arrival, tile departure and the cut (2026-10-07)

Owner: "tiles loading and unloading is brutal" (2026-10-05), then: on a first load or a slow network tiles must not pop in or out, in motion or at rest, and the globe-to-street cut must be a fade. MapLibre has no per-tile or per-layer opacity for vector tiles (`fadeDuration` is for symbols and rasters; a layer paint transition cannot know a tile just arrived), and a custom layer would re-implement tile tessellation. So the fade is a stage of the art-resolution pass: a **motion-compensated temporal ease** (`core/ease.ts` is the reference, `FRAG_EASE` in `gl/pixel-pass.ts` its GPU twin, `core/warp.ts` the camera warp, `gl/compositor.ts` the driver, `TILE_FADE` / `EASE` the constants).

What the stage knows per frame: T (the classified image of this frame, palette levels, plus which lit cells are LINES and which are screen-anchored FILL patterns), Tp (the previous classified image), P (the image presented at the previous frame) and W, where every cell of this frame was in the previous one. W comes from the two cameras (`buildWarpMesh`: a 16-cell mesh over the art grid, interpolated bilinearly in the shader): the exact affine Web Mercator map from z10.5 up, the perspective globe model of `engine/geo.ts` below it (the one the handover registers the street map against). `scripts/street/warp-check.mjs` compares the mesh with MapLibre's own projection for random pans and zooms: worst mean 0.014 cell and max 0.074 at z11 (Mercator), 0.027 and 0.235 on the globe projection (the match radius is 2).

The rule, per cell (step = whole levels to move this frame, from elapsed time at `EASE.msPerLevel` 24 ms per level, so the whole palette (10 levels) takes about a quarter of a second, frame rate independent, a frame counts for at most 100 ms):

1. T = 0 and the warped P shows a line: if a lit line cell of T within `radius` (2 cells while the camera moved, 0 at rest) has a level of at least P - 1, the line only MOVED (one cell over, a dash that slid): cleared at once. Otherwise it was removed: it fades out, `step` levels per tick.
2. T > 0: look in Tp, around the warped position, for a cell of the same level. Found: same content, so its presented tone (not its target) is the base and the fade continues while it slides ("tone follows the content": a tile that arrived mid-pan keeps fading in as it moves). Not found: new content or a changed tone, base = the warped P. Either way the cell moves from its base towards T by at most `step` levels.
3. A cell the previous frame did not show at all (a pan uncovered it, or the globe had no ground there) takes the target at once; a camera jump larger than `EASE.jumpCells` (30 cells) drops the previous image (a cut, not a double exposure).
4. Fill patterns (water dashes, park dots) are a function of the screen cell, so they are tracked on the screen with the lattice-sized radius `FILL_RADIUS` 4; a line over a fill takes over from the fill's tone (no dip). The louder of the line and fill parts wins.

With the identity warp the rule reduces to "move every cell towards its target by at most `step` levels". After the last map frame a settle loop (rAF, one ease pass per whole level of progress, none in a hidden tab) finishes the fade with the camera fixed and stops by itself: an idle map costs no frame (asserted: 0 renders, 0 passes, 0 eases, 0 rAF). Reduced motion, `tileFade: false` and the device-resolution mode present the classified image as it is.

Slow network and first load: a style swap keeps the presented image (`hold`) and what arrives afterwards eases in; while tiles are loading below z5 the bundled world coast and borders (the globe's own lines) are drawn as a placeholder (`PLACEHOLDER_LAYERS`, switched on from `map.areTilesLoaded()`), so the map is never empty and the real tile lines cross-fade over them (never both at rest: they are hidden once the tiles are in).

### The cut as a cross-fade

Both renderers draw on the same art grid with the same palette, so the cut is the same mechanism with another image as the source:

- globe to street: right after `setActive(true)`, in the task that drew the globe canvas, the controller calls `seedFrom(globeCanvas, grid)`: the compositor classifies the Three.js canvas into the presented image (`levelsFromCanvas`) and the first street frame shows it exactly, then every cell crosses over to the street image at the ease's pace (about 300 ms, `HANDOVER.crossfadeMs`);
- street to globe: the street map stays on screen (`streetRoot` opacity 1) and `crossfadeTo(globeCanvas, grid)` is called after every globe frame (the camera keeps in step); the globe's classified canvas is the target, and when `easing()` is 0 or `crossfadeMs` passed the map is hidden;
- reduced motion, no native grid or a lost context: an instant swap as before. Idle after the cross-fade is zero (`scripts/globe/handover-perf.mjs idle`: 0 rAF calls, 0 ticks, 0 renders, 0 passes at world, just past the cut and at street scale).

### Checks

`node scripts/street/ease-twin.mjs` (GPU against the CPU twin on random frames of lines, dashes, fills, arrivals, removals and tone steps over identity, whole-cell, fractional, zoom and globe warps: at most 2 cells of 13,500 differ, from a float32 `floor()` on an exact boundary), `warp-check.mjs`, `tile-fade.mjs` (ghosting in pan, zoom and zoom-pan at z4.5, 6.5, 9 and street scale: worst 0.28 % trail cells; arrival at rest, mid-pan and mid-zoom through at least 3 levels with no cell moving more than 4 in a frame; first load on a slow network: 29,449 cells mid-fade, 3.7 to 3.9 s; removal: 11,818 of 11,824 cells through at least 3 levels; idle after; off and reduced motion: never an intermediate level), `cut-fade.mjs` (seed: 0 of 324,000 cells differ from the globe's; forward: 9 levels seen, no cell moves more than 3 in a frame, settled in about 250 ms; back: the street map stays and eases to the globe through 9 levels, then hides; slow tiles: never empty, tile lines cross-fade in with 10 levels, max step 3; reduced motion: instant), `cut-seam.mjs` (how much of the globe's coast and borders the street map redraws within one cell, per zoom around the cut, and the contact sheets of both renderers side by side). Evidence: `docs/street-zoom/fade-paris-<first|pan|leave>-<light|dark>.png` (`scripts/street/fade-sheet.mjs`: consecutive changing frames of Paris at city framing: slow first load, a pan with 700 ms tiles, roads hidden at rest), `docs/palette/tone-fade-sequence.png`.

Cost (1440x900 @2, GPU timer queries, Paris z12.4, 120 pan frames with a zoom wobble, two interleaved rounds): the ease pass 1.3 to 1.5 ms against 0.8 to 1.2 ms for the pass-through of `tileFade: false`, pool 1.2 to 1.9 against 0.8 to 1.0 ms (timer noise is about 20 %); the CPU side is the warp mesh, 0.1 ms per frame. `docs/performance.md` has the budgets.

Limits: a line that moves by more than the match radius between two frames (a very fast flick that is not a jump) fades out where it was and in where it is rather than moving; dashes that slide along a road are the limit of the "louder than its target" check (264 cells worst frame); a fill pattern edge that moves by more than 4 cells in a frame fades. Native art-resolution mode only. Not run on Safari / iOS or a real phone.

