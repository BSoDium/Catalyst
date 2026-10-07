# Globe renderer decision

Status: recommendation, 2026-10-03. Prototype: `prototypes/globe` (`@catalyst/prototype-globe`, not deployed). Data: `packages/geodata` (`@catalyst/geodata`).

## Recommendation

**Standalone Three.js (no MapLibre, no Mapbox).** One small imperative module, no React inside, drawn into a reduced-resolution canvas.

Why, in order of weight:

1. It is the only candidate that produces the intended look exactly: 1-bit, non-antialiased, square-pixel linework, square markers, dither-based border visibility, a 1-pixel horizon outline. MapLibre can only approximate it (soft anti-aliased lines, round markers, alpha fades).
2. It is far lighter: 134 KB gzip vs 425 KB gzip (279 KB main + 146 KB worker) for MapLibre, 11 MB vs 42 MB JS heap, 0.3 ms vs 1.6 ms JS per frame.
3. No zoom-semantics trap. MapLibre's globe zoom is Mercator-equivalent at the *centre latitude*, so the globe grows by 1/cos(lat) as you pan north (measured, below). Keeping a bounded, latitude-independent zoom needed about 60 lines of compensation and one explicit clamp for touch pinch. In Three the zoom is defined by us.
4. Curated routes can be lifted arcs above the surface with a draw-on animation done in the shader. In MapLibre they lie on the surface and the draw-on re-sends GeoJSON to a worker every frame.
5. It removes a dependency whose packaging is currently brittle under Vite (see MapLibre notes: worker URL, tree-shaken worker).

What Three costs us, honestly: about 750 lines of our own code (camera, pointer/touch/keyboard input, inertia, pinch, flight animation, picking, projection) against about 470 for MapLibre, because MapLibre ships interaction. The projection maths is shared with the label layer and unit-tested, so the risk is contained. Three itself is 134 KB gzip, more than this scene needs; a raw WebGL2 port would be a few KB, but I did not build or measure one and do not recommend it up front.

MapLibre is the fallback if the product later wants real map features (tiles, text on the GPU, terrain). Nothing in the current brief needs them.

## Environment of all measurements

- Machine: Mac, Apple M4, macOS 27.0.1.
- Browser for measurements and screenshots: Chrome for Testing 153 (headless, via `playwright-core`), ANGLE Metal on the Apple M4 GPU, 1440x900 CSS px at devicePixelRatio 2, vsync 60 Hz. WebGL2 in both renderers.
- Why not the built-in browser pane for timing: the pane was hidden, so `requestAnimationFrame` ran at about 26 Hz (measured). I used it only for early smoke checks. All numbers below are from headless Chrome, which ran rAF at 60 Hz.
- **A fast desktop GPU at 60 Hz vsync means both renderers hit the cap. The informative numbers are JS time and GPU-sync time, not fps.** These are not phone numbers.
- Versions: three 0.186.1, maplibre-gl 6.11.2 (the brief said v5; v6 is current as of this date), vite 7.3.6.
- Scenario (`?bench=1`): scripted continuous rotation (36 deg/s) plus zoom oscillation across the border threshold, every frame, 1.5 s warm-up then 10 s measured (600 frames). Fixture data (11 places, 1 route). Pixel size 3.

## Measured numbers

Columns: rAF interval ms p50/p95/max; JS render ms p50/p95/max (Three: `renderer.render`; MapLibre: patched private `Map._render`, which includes the label update); render + blocking 1-pixel `readPixels` (GPU-inclusive) p50/p95/max; label-update ms p50/p95; JS heap MB; frames rendered / rAF calls during 4 s idle.

| Scenario | Renderer | fps | rAF interval | JS render | Render + GPU sync | Label update | Heap | Idle |
|---|---|---|---|---|---|---|---|---|
| baseline | three | 60 | 16.7 / 16.8 / 16.8 | 0.3 / 0.4 / 0.6 | 2.3 / 3.0 / 5.5 | 0.1 / 0.2 | 11.2 | 0 / 0 |
| baseline | maplibre | 60 | 16.7 / 16.8 / 16.8 | 1.6 / 2.6 / 4.2 | 4.6 / 5.9 / 12.1 | 0.1 / 0.2 | 41.9 | 0 / 0 |
| pixel size 1 (1440x900 buffer) | three | 60 | 16.7 / 16.8 / 16.8 | 0.3 / 0.4 / 0.7 | 2.4 / 3.1 / 3.9 | 0.1 / 0.2 | 11.5 | 0 / 0 |
| pixel size 1 | maplibre | 60 | 16.7 / 16.8 / 16.8 | 1.4 / 2.2 / 3.4 | 4.5 / 6.0 / 9.0 | 0.1 / 0.2 | 40.3 | 0 / 0 |
| +500 synthetic markers and labels | three | 60 | 16.7 / 16.7 / 16.8 | 0.2 / 0.3 / 0.5 | 1.9 / 2.8 / 3.9 | 0.5 / 0.7 | 9.7 | 0 / 0 |
| +500 synthetic markers | maplibre | 60 | 16.7 / 16.7 / 16.8 | 2.1 / 2.7 / 3.9 | 4.0 / 5.0 / 7.6 | 0.9 / 1.1 | 27.5 | 0 / 0 |
| CPU throttle 6x (CDP, main thread only) | three | 60 | 16.7 / 16.7 / 16.8 | 0.0 / 0.4 / 1.3 | 1.2 / 1.9 / 4.3 | 0.0 / 0.2 | 11.3 | 0 / 0 |
| CPU throttle 6x | maplibre | 60 | 16.7 / 16.8 / 16.8 | 3.1 / 5.9 / 13.0 | 4.8 / 7.5 / 15.9 | 0.0 / 1.0 | 46.0 | 0 / 0 |
| CPU throttle 6x + 500 markers | three | 60 | 16.7 / 16.7 / 16.8 | 0.1 / 0.8 / 2.0 | 2.5 / 3.7 / 5.1 | 1.4 / 2.4 | 10.2 | 0 / 0 |
| CPU throttle 6x + 500 markers | maplibre | 57.7 | 16.7 / 16.8 / 49.9 | 7.5 / 10.8 / 19.5 | 8.5 / 11.4 / 24.0 | 3.2 / 4.5 | 28.9 | 0 / 0 |

Reading: Three has roughly 5x less JS per frame and about half the GPU-synced time. Only under 6x CPU throttle plus 500 markers did MapLibre drop a frame (one 49.9 ms interval). Timer resolution in Chrome is 0.1 ms, so values of 0.0 mean below that. The 6x throttle only slows the main thread (the GPU and MapLibre's worker are unaffected), so it is an indicator of JS-bound headroom, not a phone emulation.

Idle: both renderers rendered 0 frames and made 0 `requestAnimationFrame` calls over 4 s with no input (Three; MapLibre also 0 `_render` calls). A selected route animates for 2.2 s: Three issues 60 rAF/s and 59 to 61 frames/s; MapLibre issues about 124 rAF/s (its own plus the per-frame `setData` loop) for 61 frames/s. Both return to 0 once the animation finishes.

### Bundle size (production build, `pnpm --filter @catalyst/prototype-globe build`, min + gzip)

| Chunk | Raw | gzip | brotli |
|---|---|---|---|
| Three renderer chunk (three + our globe code) | 537 KB | 134.5 KB | 111.6 KB |
| MapLibre renderer chunk | 1,026 KB | 278.8 KB | 230.4 KB |
| MapLibre worker (separate file, off main thread) | 508 KB | 146.1 KB | 121.1 KB |
| App shell (zod + published contract + harness), same for both | 105 KB | 31.9 KB | 28.1 KB |
| `@catalyst/geodata` coastlines (110m) | 37.3 KB | 15.0 KB | 12.6 KB |
| `@catalyst/geodata` borders (50m, simplified) | 37.1 KB | 14.1 KB | 11.7 KB |

MapLibre total: 425 KB gzip (main + worker) vs Three 134.5 KB. Neither needs `maplibre-gl.css`: three lines of our own CSS cover the canvas container.

### Geodata sizes (committed JSON, quantised to 0.01 deg, delta-coded)

| Dataset | Lines | Vertices | Raw | gzip | brotli |
|---|---|---|---|---|---|
| coastlines 110m (shipped) | 128 | 5,121 | 37.2 KB | 14.9 KB | 12.5 KB |
| borders 50m, Douglas-Peucker 0.04 deg (shipped) | 186 | 5,542 | 37.0 KB | 14.0 KB | 12.1 KB |
| borders 110m (candidate) | 159 | 2,807 | 20.1 KB | 8.3 KB | 6.8 KB |
| coastlines 50m (candidate) | 1,409 | 24,615 | 164.2 KB | 60.2 KB | 52.2 KB |

Choice: coastlines 110m (right for a world-scale, low-resolution look). Borders 50m simplified: 110m borders (6 KB gzip smaller) were visibly cruder around the Balkans and the Alps at zoom 4; the 50m set costs 5.6 KB gzip more. Natural Earth is public domain (redistributed as TopoJSON by `world-atlas` 2.0.2). The generator also removes the artificial edges Natural Earth adds along the antimeridian and the south pole and splits segments that jump across +-180, so the data is safe in any projection (unit-tested).

### Behaviour checks (both renderers; scripted with Playwright in `prototypes/globe/scripts/suite.mjs`, `mobile.mjs`)

| Requirement | Three | MapLibre |
|---|---|---|
| Select: rotate to place | pass (flight 450 to 1600 ms by distance, lands on the exact coordinate, zoom raised to 3.2) | pass (`flyTo`, same landing) |
| Far-side markers hidden and not pickable | pass (depth occluder; picking and labels use the same front-hemisphere test) | pass (circles occluded by the globe; `queryRenderedFeatures` also returns nothing for far-side markers; my front-hemisphere test agreed with `unproject` round-trips for all 11 places) |
| Bounded zoom | pass: min = whole globe fits (2.47 at 1024x768), max 6.5 | pass, but only after compensation code (see below) |
| Idle = zero frames | pass | pass |
| Reduced motion | pass: `flyTo` becomes a jump (landed within two frames), route is static, label fade off | pass: same, MapLibre additionally honours the OS setting on its own for non-essential easing |
| Unmount / restore | pass: 20 cycles, view `lon 77.7, lat -12.3, zoom 3.7` restored exactly each time | pass: same |
| Leaked WebGL contexts | none: contexts created 21, lost 20, live 1 after 20 cycles; canvases in DOM 0 when unmounted, 1 when mounted | none: identical counts (`map.remove()` loses the context) |
| Label layer, pointer picking, touch drag/pinch/tap | pass | pass |

Leak check method: `HTMLCanvasElement.getContext` is wrapped (`src/core/glDebug.ts`) to count WebGL contexts created and `webglcontextlost` events, and live canvases are counted in the DOM. Three disposes geometries and materials, calls `renderer.dispose()` and `forceContextLoss()`, and removes the canvas and listeners.

## Comparison matrix against the brief

| Requirement | Three.js | MapLibre GL JS 6.11 | Mapbox GL JS |
|---|---|---|---|
| Low-res pixelated monochrome look | Exact. Reduced drawing buffer + `image-rendering: pixelated`, 1-px non-AA lines, 1-bit output | Close, not exact. `pixelRatio: 1/P` + CSS `pixelated` works, but line anti-aliasing cannot be turned off (`line-blur` minimum is 0), so lines are soft 2-px greys; no dithering; round markers | Not implemented. Needs a token. |
| Continent outlines, no fill | yes | yes (line layers, background layer as ocean) | n/a |
| Graticule | stippled GL lines (1 px, regular dots) | dashed line layer (`line-dasharray [1,3]`), anti-aliased and faint | n/a |
| Borders only when zoomed in | stepped dither: off below 3.0, 50% dotted 3.0 to 3.3, solid above | `line-opacity` step on zoom, alpha not dither; **zoom thresholds depend on latitude** (measured below), I approximated at 40 deg | n/a |
| True-coordinate markers | GL points, square, odd sizes, label anchor snapped to the same art pixel | circle layer, round, sub-pixel placement | n/a |
| Collision-aware HTML labels | shared `labels.ts` | same file | n/a |
| Curated route only | explicit stop list, great-circle arcs lifted above the surface, 2x2 px dashes of constant on-screen length, shader draw-on | explicit stop list, great circle on the surface (no altitude), draw-on by re-sending truncated GeoJSON each frame | n/a |
| Far-side occlusion and picking | depth occluder; same projection for labels and picking | native for rendering and `queryRenderedFeatures`; labels needed my own test | n/a |
| Rotate-to-place, bounded zoom | ours (about 60 lines) | `flyTo` is free; bounds and constant globe size needed about 60 lines | n/a |
| Idle without rAF loop | yes | yes | n/a |
| Reduced motion | ours (small) | mostly built in | n/a |
| Unmount / restore | clean | clean | n/a |
| Bundle (gzip) | 134.5 KB | 425 KB (279 + 146 worker) | not measured; proprietary SDK |
| Our code | about 750 lines | about 470 lines | n/a |
| Integration risk | low | medium (v6 worker packaging under Vite) | high (token, licence, billing) |

### MapLibre findings in detail

- **pixelRatio below 1 works.** `pixelRatio: 1/3` gives a 342x256 buffer for a 1024x768 box. Lines are always anti-aliased, so the result is grey-scale pixel art, not 1-bit.
- **Zoom is latitude-dependent in globe mode.** At zoom 2.5, apparent globe radius at the view centre was 461, 532, 922 and 1,781 px at latitudes 0, 30, 60 and 75 (ratios 1.000, 1.155, 2.000, 3.864 = 1/cos(lat)). Consequences: the globe balloons as the user drags north, a static `minZoom` cannot mean "whole globe visible", and every zoom-based style expression (borders threshold, line opacity) means a different physical scale at different latitudes. I exposed a "globe zoom" (constant radius) by converting with `log2(cos(lat))`, updating `minZoom`/`maxZoom` on every `move`, and re-setting the zoom on pure pans. It works but is fragile: touch pinch overshot the bounds until I added an explicit clamp, and pinch zooms around the finger midpoint (MapLibre warns that easing around a point is unsupported on globe), so a pinch also pans slightly.
- **Custom layer needed for the outline.** There is no style layer for the globe horizon. A 60-line custom WebGL layer draws a 1-px circle in screen space; it works and stays inside MapLibre's frame.
- **Far-side occlusion is native**, including picking. This is MapLibre's strongest point.
- **Antimeridian and poles**: GeoJSON is tiled in Web Mercator, so polar data beyond about 85 deg is clipped (a sliver of Antarctica). Our data pre-splits at +-180, which MapLibre needs.
- **v6 and Vite.** With Vite 7 the default worker URL fails ("Worker failed to load") in dev. The fix is to import `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` and call `setWorkerUrl`. A plain side-effect import of that file produced a **1-byte worker in the production build** (the package marks its dist files as side-effect free), which would silently break production; I caught it in the build output and confirmed the final production build renders. Anyone upgrading MapLibre should re-check this.
- **Route draw-on** by `setData` per frame costs a worker round trip and re-tile each frame; fine for 56 vertices, but it is not how you would animate hundreds of paths.

## Mapbox GL JS (not implemented; verified from docs on 2026-10-03)

- Globe: supported since v2.9 (`projection: "globe"`). Globe guide, "Limitations of Globe": "Globe does not yet support `CustomLayerInterface`." (https://docs.mapbox.com/mapbox-gl-js/guides/globe/). The v2.9.0 changelog entry says globe works with all layers except custom layers and sky.
- The docs contradict each other. The `CustomLayerInterface` API page documents globe-only arguments to `render()` (`projection`, `projectionToMercatorMatrix`, `renderParameters`), and the changelog for v3.32.0 says `render`/`prerender` now receive a `CustomLayerRenderParameters` object with projection and view matrices, `globeClippingPlane` and `globeCenterInScreenPixels` (https://docs.mapbox.com/mapbox-gl-js/api/properties/#customlayerinterface, https://github.com/mapbox/mapbox-gl-js/blob/main/CHANGELOG.md). So globe custom layers appear to work in recent 3.x, but the main globe guide still says otherwise. **I could not verify this by running it** (no token, and the brief says not to implement). GitHub issue #12046 ("CustomLayerInterface support in globe") was filed in 2022; issue #13041 (custom layers limited to global and Mercator projections) is open.
- Token and service requirements: a Mapbox access token is required ("TO MAKE THE MAP APPEAR YOU MUST ADD YOUR ACCESS TOKEN", https://docs.mapbox.com/mapbox-gl-js/guides/). Map loads are billed: 50,000 free per month, then USD 5 per 1,000 (50,001 to 100,000), falling to 2.50 per 1,000 between 1M and 5M (https://www.mapbox.com/pricing). Since v2 the library is under a proprietary licence that requires an active Mapbox account and use only with Mapbox products; the SDK reports "limited de-identified location and usage data" (https://github.com/mapbox/mapbox-gl-js/blob/main/LICENSE.txt). Together with the "no tile servers or API tokens" constraint, this rules Mapbox out for a public static archive.

## Not verified

- **Mobile Safari / iOS Simulator.** I booted an iPhone 17 Pro (iOS 26.1) but every `control` call (attach, open_url, screenshot) was refused: "The user has not granted Claude access" ("Let Claude use it" link in the simulator panel). I did not work around the gate (no `simctl openurl`/screenshots by shell), so there is **no Safari data**: not the rendering, not touch gestures, not perf. The simulator is still booted. Substitute evidence, clearly not Safari: Chrome for Testing emulating a 390x844 viewport at DPR 3, iPhone user agent and CDP touch events: one-finger drag, two-finger pinch (zoom clamped to bounds), tap-to-pick, tap-selected flight and unmount/restore all worked in both renderers. Phone frame times would not be representative even on the simulator (it uses the Mac GPU).
- Real-device performance, GPU memory, thermal behaviour, WebGL context loss and restore (the prototype does not handle `webglcontextlost`; production must), and Safari's `image-rendering: pixelated` on canvas (expected to work, unverified).
- Whether Mapbox custom layers really work on globe in current 3.x.

### Run `?bench=1` on a real phone (LAN)

1. On the Mac: `pnpm --filter @catalyst/prototype-globe build && pnpm --filter @catalyst/prototype-globe exec vite preview --host --port 5180` (a minified build is more representative than dev). The dev server (`pnpm --filter @catalyst/prototype-globe dev`) also listens on all interfaces and prints the LAN URL.
2. Phone on the same Wi-Fi. Turn off Low Power Mode (it caps rAF at 30 Hz) and Auto-Lock.
3. Open `http://<mac-lan-ip>:5180/?renderer=three&bench=1&dur=10` then `...?renderer=maplibre&bench=1&dur=10`. Optional stress: add `&markers=300`. Optional dark mode: `&theme=dark`. Plain HTTP is fine (no secure context needed for WebGL).
4. After about 30 s a JSON box appears top-right (continuous pass, GPU-sync pass, idle). Screenshot it. `env.glRenderer` records the GPU string; read `rafIntervalMs.p95/max`, `renderJsMs` (Three) or `maplibreRenderMsInclLabels` (MapLibre), `renderPlusGpuSyncMs`, and `idle`. Run each twice and discard the first (shader compile, thermal ramp).
5. Without `bench=1`, the page is the interactive harness: try drag, pinch, tap markers, Unmount/Remount, and the "reduce motion" box (or the OS setting).

## Tuned constants (production starting point)

| Constant | Value | Notes |
|---|---|---|
| Art pixel size | 3 CSS px (viewport min side >= 520), 2 CSS px below | Compared 2, 3, 4 (`docs/renderer/three-px2.png`, `three-px4.png`); 3 reads as intentional pixel art on desktop without losing coastline detail, 2 keeps a 390 px phone from looking like 130 px. On fractional DPR, round `P * dpr` to an integer number of device pixels (done in `TUNING.pixelSize`; checked at DPR 2.625) |
| Zoom definition | `radiusPx = 512 * 2^zoom / (2 pi)` at the view centre; vertical FOV 36.87 deg | Same as MapLibre's equatorial zoom, so zoom values are portable |
| Min zoom | whole globe fits with 12% margin (`fitZoom`) | 2.47 at 1024x768, 1.27 at 390x844 |
| Max zoom | 6.5 | about 7,400 px globe radius; Vietnam fills a laptop screen |
| Max latitude of the view centre | 82 | |
| Border threshold | hidden below zoom 3.0, 50% dither 3.0 to 3.3, solid from 3.3 | About 11 to 14 px per degree. Smooth dither ramps looked like noise on 1-px lines, so it is stepped. Below 3.0 borders clutter the continents; at 3.3 Europe's countries are legible |
| Graticule | 15 deg, stipple every 3rd pixel; no fine grid | A 5 deg grid fading in at high zoom competed with borders; removed |
| Marker | 3 px square; selected: 9 px outlined square with centre dot; route stops 5 px | Odd sizes so the marker sits on one art pixel |
| Select zoom | `max(current, 3.2)` | Never zooms out on select |
| Flight | 450 to 1600 ms by angular distance and zoom delta, ease-in-out cubic, slight pull-back on long hops | Reduced motion: jump |
| Route | arcs lifted 0.12 x leg length; sampled every 0.4 deg; 2x2 px stroke; dash period 7 art px (62% on); draw-on 2.2 s then static | Reduced motion: complete static route |
| Pick radius | 12 px mouse, 22 px touch (nearest marker wins, higher `labelPriority` breaks ties) | Labels are `<button>`s and are the accessible hit targets |
| Inertia | exp decay, time constant 320 ms, fling speed capped | Off under reduced motion |

## Implementation guidance for the production globe (`apps/web/app/globe/`)

Port these files, in this order of dependence:

- `prototypes/globe/src/core/geo.ts` (+ test): pure projection, zoom/camera maths, route sampling. No dependencies.
- `prototypes/globe/src/core/labels.ts` (+ test): `placeLabels` (pure) and `LabelLayer` (DOM). Renderer-agnostic: it needs only `project(lon, lat) -> {x, y, visible, facing}`.
- `prototypes/globe/src/three/ThreeGlobe.ts`: the globe core. Imperative class, no React.
- `prototypes/globe/src/core/types.ts`: `GlobeInit`/`GlobeRenderer` interface and `TUNING`. Keep the interface; it is what keeps the globe replaceable.
- Reference only: `src/main.ts` (lifecycle wiring), `src/core/glDebug.ts` (leak counter, dev only), `src/bench.ts`.

Module boundaries:

- `GlobeCanvas.tsx` (client only): owns a container `div`, dynamically imports `three` and `@catalyst/geodata` inside an effect (never on the server, never in the main bundle), constructs the globe, and disposes it in the effect cleanup. Make the effect safe for React StrictMode's double invoke (create, dispose, create must leave exactly one canvas; the prototype's counters prove dispose is complete).
- The semantic content is plain HTML outside the canvas: a list of places (links), used for SEO, SSR, keyboard and screen readers, and as the fallback before WebGL loads. The labels layer is also HTML buttons. The canvas is decoration plus pointer input.
- View state `{lon, lat, zoom}` lives outside the component (URL search param or a small store). On mobile the globe is fully unmounted while a detail slide-over is open: read `getView()` immediately before disposal, pass it as `initialView` when remounting. This is exactly what the harness's Unmount / Remount buttons do; restoration was exact in all 20 cycles.
- Place data and routes come from `@catalyst/published`; geodata is a dynamic `import()` after mount. Never connect markers that are not consecutive stops of a `PublishedRoute`.

Frame scheduling: one `requestRender()` that sets nothing but schedules a single rAF if none is pending. The tick advances animations (flight, inertia, route draw-on), renders once, and reschedules only while something is still animating. Input events (drag, wheel) call `requestRender()` rather than looping. Expose `isAnimating()` for tests. Verified: 0 rAF and 0 frames over 4 s idle; resize goes through a `ResizeObserver` and a single render. Do not add a perpetual marching-dash route; `routeMode: "loop"` exists only to benchmark it.

Label algorithm (`placeLabels`): project every place; discard the far hemisphere and anything within `facing < 0.08` of the limb; every visible marker (labelled or not) is an obstacle; order = selected/focused first, then `labelPriority` plus an 8-point hysteresis bonus for labels shown last frame, then id; try right, left, top, bottom (previous side first); reject a spot that leaves the viewport (4 px margin), overlaps a placed label (2 px padding) or covers another marker; selected/focused labels always render, taking the preferred side even if it overlaps. A uniform grid makes it near-linear: 500 labels cost 0.5 ms p50 (Three bench, 1.4 ms at 6x throttle). Markers are never moved. DOM updates only change `transform` and `visibility`, label sizes are measured once and again after `document.fonts.ready`. CSS opacity transitions are disabled under reduced motion.

Reduced motion: honour `matchMedia("(prefers-reduced-motion: reduce)")` live (`setReducedMotion`): flights become jumps, inertia off, route drawn complete and static, label fades off. A user-facing override is cheap and the harness has one.

Things the prototype does not do and production must:

1. Handle `webglcontextlost` / `webglcontextrestored` (call `preventDefault` on loss; rebuild on restore) and pause on `visibilitychange`.
2. Provide a no-WebGL fallback (the HTML place list already is one).
3. Keep the buffer at `css / P` regardless of DPR (cost is DPR-independent); do not switch to `devicePixelRatio`-scaled buffers.
4. Larger label tap targets on touch (the prototype uses 22 px pick radius and 12 px labels; labels need at least 44 px effective hit area, e.g. padding or a transparent hit box).
5. Pole handling: view latitude is clamped at 82; markers near the poles are fine, but meridians converge into a dense stipple cluster at the limb that may need thinning.
6. A subtle limb artefact: lines within a pixel or two of the horizon on the near side can be hidden by the depth occluder (radius 0.998 against lines at 1.0). It reads as a tidy gap; adjust the occluder radius if it bothers.

## Risks

- **Three bundle size (134 KB gzip)** is the main cost of the recommendation. Mitigated by lazy loading on the globe route only. Revisit a raw-WebGL2 core if it matters.
- **Own input handling**: inertia, pinch and keyboard behaviour must be tuned on real devices; only emulated touch was exercised.
- **Safari/iOS unverified** (see above), including `image-rendering: pixelated` on canvas and WebGL context limits when remounting repeatedly.
- **Label snapping**: label anchors are snapped to the marker's art pixel for Three; any change to canvas offset logic must keep `project()` and the draw in sync (covered by manual screenshots, partly by the geo tests).
- **Natural Earth coastlines at 110m** lack small islands; the shipped borders are 50m, so at zoom above about 5 coasts and borders disagree slightly. Add a 50m coastline set (60 KB gzip) only if the max zoom is raised.
- **Fixture data is tiny** (11 places, 1 route). Label behaviour at real density is covered only by synthetic stress markers (`?markers=N`).

## Screenshots (`docs/renderer/`)

Headless Chrome for Testing 153 on Apple M4, optimised with pngquant (32 colours).

| File | Shows |
|---|---|
| `three-overview-dark.png`, `three-overview-light.png` | Three, overview |
| `maplibre-overview-dark.png`, `maplibre-overview-light.png` | MapLibre, overview (soft lines, round markers, horizon outline via custom layer) |
| `three-borders.png`, `maplibre-borders.png` | Europe at zoom 3.6, borders on |
| `three-route.png`, `maplibre-route.png` | Curated demo route, Hanoi selected, zoom 4.4 |
| `three-vietnam-labels.png`, `maplibre-vietnam-labels.png` | Label placement in the Vietnam cluster, zoom 3.0 |
| `three-stress80.png`, `maplibre-stress80.png` | 80 synthetic markers, collision-aware labels |
| `three-px2.png`, `three-px4.png` | Pixel size comparison (3 is the default; compare with `three-borders.png`) |
| `mobile-three.png`, `mobile-maplibre.png` | 390x844 at DPR 2 (emulated, not Safari) |

## Reproduce

```
# scripted checks (need a Chrome binary, e.g. a Playwright Chrome for Testing; dev server must be running)
CHROME_PATH=/path/to/chrome node prototypes/globe/scripts/suite.mjs three|maplibre
CHROME_PATH=/path/to/chrome node prototypes/globe/scripts/bench.mjs three|maplibre 1440x900 2 "markers=500"   # THROTTLE=6 for CPU throttle
CHROME_PATH=/path/to/chrome node prototypes/globe/scripts/mobile.mjs three|maplibre   # emulated touch, not Safari
```

```
pnpm --filter @catalyst/prototype-globe dev          # http://localhost:5180/?renderer=three|maplibre
pnpm --filter @catalyst/prototype-globe typecheck && pnpm --filter @catalyst/prototype-globe test
pnpm --filter @catalyst/geodata generate -- --report  # regenerate datasets and print the size table
pnpm --filter @catalyst/geodata typecheck && pnpm --filter @catalyst/geodata test
```

Harness URL parameters: `renderer`, `theme=light|dark`, `px=N`, `view=lon,lat,zoom`, `select=slug`, `rm=1|0`, `route=loop`, `markers=N` (synthetic stress), `bench=1&dur=S`. `window.__app` and `window.__gl` expose the renderer and the context counters for scripted checks.
