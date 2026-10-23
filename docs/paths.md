# Travel paths (2026-10-15, trails 2026-10-20)

Every leg of every route is drawn on both maps as a PLANE TRAIL (below, "Trails") whenever the overlay (boxes and labels) is; the legs next to the selected place go to the full-strength head colour. The place panel lists the same legs as sentences. Contract: [api-contract.md](api-contract.md#route-legs-routeslegs-optional-additive-in-schema-version-1). Code: `apps/web/app/globe/paths/` (pure), `engine/route-layer.ts` + `engine/materials.ts` (`pathMaterial`) on the globe, `street/core/routes.ts` + `street/style/street-style.ts` on the street map, `lib/journeys.ts` (text).

## Data path

`resolveRoutes` (lib/projection.ts) turns `routes[]` into `GlobeRoute { points, legs? }`. `buildNetwork` (paths/network.ts) runs once per route set: decodes each polyline (paths/polyline.ts), builds the geodesic arc (0.4 degree steps, lifted 0.12 per radian, the curated routes' look) for legs without one, and derives 5 simplification levels by Douglas-Peucker on the sphere in metres (20, 80, 320, 1,280, 5,120 m; each level a subset of the one before, ends always kept; the 3D distance makes a chord's sag under the surface count, so no level can sink into the planet's disc). `buildBuffers` makes one shared vertex set and one index range per level.

## Globe

- One instanced `LineSegments` (one draw call; instanced x3: copies 1 and 2 are the rail's cross-ticks and the cross of every head's spark, discarded by the fragment shader elsewhere). Attributes per vertex: position (lifted), distance along the leg, leg id, mode id, leg length, route palette (`aInfo` is a vec4), tangent. Selection is a texel per leg in a small `uState` texture and a draw-on front uniform: no geometry rebuild.
- Zoom: `levelFor(metresPerCell, current)` picks the coarsest level whose error is at most half an art pixel, with a 25 % hysteresis; applied with `setDrawRange` (no rebuild). `fadeLevel`: a leg shorter than 2 art pixels is hidden, and its tone steps up through the palette (solid levels, the borders' staircase, no alpha) to the faint tone at 14 pixels. So short legs are hidden at the world view and appear as you zoom.
- Colours: the trails of the next section (solid entries of one list, `uTrail`). The short-leg fade (`fadeLevel`) mixes toward the page colour in the same solid levels (the `coast` level count).
- Styles in art pixels (one buffer pixel is one; table in paths/modes.ts, read by the shader and the street style): road solid; rail 4 on / 2 off with a 1-cell tick across (a 3-cell cross) at the middle of each dash; ferry 1.5 / 2.5; flight 1.5 / 3.5 and lifted; walk 1.5 / 1.5; unknown 4 / 3 and lifted. A "dot" is 1.5 cells because docs/pixel-line-rules.md 3.12 (c) measured that shorter dashes break at some angles under the pixel pass.
- Occlusion: the analytic "does the camera ray enter the occluder sphere first" test of the old route material (the depth buffer is off for lines), so limb behaviour is unchanged: nothing from the far side shows, nothing is cut mid-dash. Lifted arcs flatten with `routeLift` at the hand-over.
- Draw order: renderOrder 4 as the old routes (above coast, below the horizon outline, markers and labels).
- Selection shows the legs ADJACENT to the place (arriving and leaving, on every route through it), drawing on from the place outwards, 2.2 s, eased as before. Before this change the whole route through the place lit; adjacent legs match the Journeys list and keep a 100-stop trip from lighting up whole. The far-end places are forced drawn (as the route's stops were).
- Reduced motion: no draw-on and no dash march; the lit legs are complete at once.
- Idle cost is zero: the layer renders nothing by itself; `advance` is true only during a draw-on.

## Street map

One GeoJSON source `routes` with a feature per leg (`key` = `routeId:legIndex`, `mode`, `pal`), built once. Layers (see "Street trails"): 1 art pixel wide, dasharrays from the same table, trail colours. `routes-focus` is `setFilter`ed to the selected place's keys; no `setData` on selection. The old erasing halo is gone (a 3-cell halo would cut every road a 1-cell path crosses). The "Paths" switch sets layout visibility.

## Trails (colour)

The owner's reference: a handheld ADS-B radar, a short red-orange-to-white trail behind each aircraft. Every leg is a trail from its ORIGIN (the tail: pale and cool) to its DESTINATION (the head: saturated and bright, with a small spark), in the colour of its route. Code: `globe/paths/trail.ts` (pure, one table for both renderers), `engine/materials.ts` (`pathMaterial`), `street/style/street-style.ts` (`gradientOf`, `byPalette`), tests `lib/trail.test.ts`.

**One gradient.** Every route takes the same trail gradient (owner feedback, 2026-10-20: not a colour per trip): a saturated blue tail (`blue-500`) turning into a violet head (`violet-700` in light, `violet-400` in dark), lit `violet-800` / `violet-200`, spark `violet-900` / `violet-50`; five solid bands between the two ends (`globe/paths/trail.ts`). `--trail-from` / `--trail-to` are the two ends for the panel's trip cards and map.

**Steps** (per scheme; the page colour decides the scheme):

| | tail | head (faint legs) | lit (selected place's legs) | spark |
| --- | --- | --- | --- | --- |
| light | 400 | 600 | 700 | 900 |
| dark | 700 | 300 | 200 | 50 |

The light page gets a pale tail and a saturated head; on the dark page the tail is the dark end and the head the bright one, so the head always pops. The tail-to-head gradient is `TRAIL_BANDS` = 5 solid bands, each a mix of the two steps (`mixHex`), so a leg is a pixel-art staircase of colour, not a smooth ramp, and every colour the globe draws is one entry of a 28-colour list (4 palettes x 5 bands + lit + spark). The position along the leg is `dist / length` (both are in the buffers: no extra attribute), the band `floor(fraction * 5)`. A leg of the selected place is the lit colour along its WHOLE length (the owner's "full-strength head colour"), inked from the place outwards by the draw-on as before, with a bigger spark; the others keep their gradient. Mode patterns are unchanged and the gradient runs along the leg in every mode (a rail dash, a ferry dot are each a band of the trail); the rail's ticks take the band's colour.

**Spark.** At the head, outside the destination's box (the box and its plate cover the last cells of the leg, so the spark starts `SPARK.*.clear` cells back from the destination): a faint leg gets a small plus (3 cells of line in the spark colour, a 3-cell bar across it), a lit leg a 3 x 3 dot on a short stem. It uses the rail ticks' two extra copies and ignores the dash gaps.

**Theme.** `uTrail` (the 28 colours of the scheme) and `uPage` are uniforms rewritten by `RouteLayer.applyTheme`: a theme change touches no geometry. Faintness: only the short-leg fade (a solid mix toward the page in `uFinal` levels) and the overlay presence below; no alpha anywhere.

**Overlay presence.** The paths are part of the overlay, like the detection boxes and labels: `RouteLayer.setPresence(LodTree.overlayAlpha)` runs in `syncNodes`, the same timed value and clock that fade the boxes and labels in and the flat ring out. At 0 (the home screen's caption and ring) the layer does not draw (no draw call), in between the colours mix toward the page in the fade's own levels (solid), at 1 complete; reduced motion: the value jumps like the ring's. A selection hides the caption and shows the overlay, so lit legs follow the same rule. Pages without the showcase have presence 1. Checked by `scripts/paths/check.mjs overlay` (start view: no draw call and no trail pixel; presence equal to the ring's overlay value in every frame, monotonic both ways; a flight to a place; reduced motion).

**Contrast** (WCAG 1.4.11, graphics 3:1, `lib/trail.test.ts` asserts every one; the page `#fbfbfb` / `#0a0a0a`):

| Colour | scheme | blue | green | ocre | violet |
| --- | --- | --- | --- | --- | --- |
| faint head | light | 4.47 | 4.45 | 4.53 | 4.83 |
| lit | light | 5.59 | 5.24 | 5.64 | 6.01 |
| spark | light | 10.99 | 10.50 | 11.06 | 11.48 |
| faint head | dark | 12.21 | 12.46 | 12.05 | 11.71 |
| lit | dark | 14.93 | 15.16 | 14.85 | 14.61 |
| spark | dark | 18.49 | 18.57 | 18.40 | 18.34 |

The tail (the quiet end, deliberately) is above 1.8:1 (a visible line). Colour-vision: colour is never the only carrier (mode patterns, the Journeys sentences, the place's box). CIEDE2000 between heads under deuteranopia / protanopia: blue-violet 4.6 / 7.3 (light) and 1.0 / 3.8 (dark), green-ocre 11.2 / 8.1 (light) and 7.7 / 4.9 (dark): the doc's weak pairs, and violet follows blue in the order, so a trip's palette is a hint, not an identifier. At most one palette per leg, two when two routes meet at a place.

**Pixel pass.** The globe renders into the art-pixel buffer with nearest upscaling: the list colours reach the screen exactly (the check counts exact colours). The street pass matches the globe's pixels to the nearest entry of ITS palette at the hand-over, so the list is appended to the pass palette (below).

## Street trails

The street map is a greyscale level image (`street/core/palette.ts`), and the paths are the one thing in it that is not grey. The pass palette is now the 12 greys (`MAX_LEVELS` slots, padded with the ink when fewer are active) followed by the same 28 trail colours (`TRAIL_LEVEL_BASE` = 12, `PALETTE_CAPACITY` = 40, `LEVEL_SCALE` = 40); the style writes a trail colour as a level like any other. Consequences:

- **Gradient** (`line-gradient`; needs `lineMetrics: true` on the `routes` source and a `line-progress` expression; it takes no per-feature colour, and cannot be combined with `line-dasharray`): one layer per palette for the faint ROAD legs (`routes-faint-p0..p3`, filter on `pal`), a `step` over `line-progress` through the five band levels. The legs' coordinates run origin to destination, so progress 1 is the head. The step makes it a banded pixel-art gradient; since the level is the palette entry, the theme needs no style change (the pass palette is per theme).
- **Dashed modes** (rail, ferry, flight, walk, unknown) cannot take a gradient: they are one layer per mode in the head band's colour chosen per feature by `match` on `pal` (data-driven colour is allowed), so on the street map a dashed leg is a solid-colour dashed line, not a gradient. Said plainly: the gradient along the leg exists on the globe in every mode and on the street map for roads only.
- **Focus** layers (`routes-focus[-mode]`, filtered by `setFilter`) use the lit colour; the sparks are two circle layers (`routes-head` for every leg, `routes-head-focus` for the lit ones, a separate `heads` source of one point per leg) at the destination itself, in the spark colour: a MapLibre layer cannot be offset by art cells along a line, and the street map's box is hollow, so the spark shows inside it.
- **Exact levels.** A level read from a blended pixel is a different hue, so a path is painted at R = 1 with an opacity of 1 (`routeColor`: it overwrites the road or fill under it) and B = 128 marks it a one-pixel line the pass may thin (a wide line has B = 0; `routeThin` in `gl/pixel-pass.ts`). The path layers are the TOP layers (above the world coast and borders): a first version under the coast blended with it and printed stray blue and black cells where a road crossed a route. (Cost: a route hides the coastline cell it crosses.)
- **Ease.** The temporal ease slews a level one step per tick; the trail levels are hues, so a trail colour is shown as it is and one that is gone is cleared at once (`isTrailLevel`, in `core/ease.ts` and its GPU twin).

## Journeys swatch

Each journey line of the place panel starts with a 8 px square in its route's head colour (`--trail-<hue>` tokens in app.css: step 600 in light, 300 in dark, the same as the faint head), `aria-hidden`; the sentence is unchanged. No legend or tooltip (the swatch is the legend; skipped as the brief allowed).

## Switch

There is no switch: the paths follow the overlay (boxes and labels). The engines keep `setPaths` for checks.

## Accessibility

Paths are drawn into the aria-hidden canvases. The place panel's "Journeys" section (`lib/journeys.ts`) lists "Arrived from X by road, about 190 km" / "Left for Y by train, about 540 km": distance from the polyline (or the stops' great circle) rounded to 10 km, noun by mode (road: by road, rail: by train, ferry: by ferry, flight: by plane, walk: on foot, unknown: nothing), no timestamps.

## Measurements (headless Chrome 147-ish for Testing, Apple GPU through ANGLE/Metal, 1440x900 @2: NOT a phone)

`node apps/web/scripts/paths/check.mjs perf` (synthetic legs by `?globe-debug&paths-stress=N`, shape of the spike's legs: about 0.9 points/km):

| legs | vertices | segments per level (0..4) | buffers | drawn: world / zoom |
| --- | --- | --- | --- | --- |
| 13 (demo) | 3,941 | 629 / 547 / 355 / 183 / 90 | 168 KB | 90 / 183 |
| 225 | 32,189 | 20,566 / 11,302 / 5,713 / 2,481 / 1,095 | 1.5 MB | 1,095 / 2,481 |
| 2,000 | 327,250 | 189,637 / 105,514 / 54,627 / 24,021 / 10,563 | 15.4 MB | 10,563 / 24,021 |

Frame cost: `renderNow()` JS time p50 below the 0.1 ms timer resolution and p95 0.1 ms at every view and size; GPU-synced frame p50 0.4 to 0.5 ms (p95 0.8 to 1.4 ms). One draw call added. The design's goal ("a few thousand segments visible") holds at 225 legs; at 2,000 legs it is 10 to 24 thousand segments.

## Trail measurements (same machine and method as above, 2026-10-20)

`check.mjs perf` against `origin/main` and this branch, same session, GPU-synced frame (p50 / p95): main 0.4 to 0.5 ms / 3.7 to 4.0 ms at 225 and 2,000 legs; trails 0.4 to 0.8 ms / 3.6 to 4.3 ms (p50 up to 0.1 ms at 2,000 legs, from the three instances being always on and the fragment's palette lookup; the p95 is the sync's noise floor on this machine, identical on both). `renderNow()` JS p50 under the timer resolution, p95 0.1 ms, unchanged. Still one draw call; buffers 187,849 bytes for the demo (info grew from 3 to 4 floats a vertex: 17.1 MB instead of 15.4 MB at 2,000 legs).

## The paths' cost (2026-10-22)

- Only the main line of each leg is sent through the vertex stage until the rail ticks come on (zoom 5.5): instances 1 and 2 (the ticks) were always discarded by the fragment shader before that, so the vertex and raster work at the world and continent views is a third of what it was. Same pixels (checked on the settled world and continent frames); the saving was not measurable on a fast desktop GPU.
- The network (`buildNetwork`: every leg decoded and simplified into its levels) and its buffers (`buildBuffers`) are built once per page for the same routes (a hash of their content, not the array: the loader's is a new object at each revalidation), not at every mount of the globe. A phone mounts it again each time a place's panel closes; that was about three quarters of the mount ([performance.md](performance.md), "A phone's CPU on a Mac").

## Not verified

Safari; any phone GPU; the pixel pass on the street map beyond screenshots of the demo and the owner's preview data at a world-ish street zoom (the street checks in `scripts/street` were not run: they need tile servers); the street map's gradient at city zoom with many tiles (line-progress across tile boundaries was seen to be continuous on one 260 km leg only); colour-vision simulation is the doc's model, not a person.


## Patterned legs on the street map, cell by cell; far away; sparks

- **Cell by cell** (`street/overlay/trail-dots.ts`, `trail-dots-layer.ts`; owner feedback 2026-10-20: dotted legs flickered and read as artefacts). MapLibre drew dashes at device resolution and the pass thresholded them onto the art grid, so a dash 1.5 cells long was one cell or two or none depending on the angle and the offset. Every mode but road is now projected to cell space and walked in whole cells (`CELL_PATTERN` in `paths/modes.ts`: flight 1 on / 4 off, ferry 1 / 3, walk 1 / 2, rail 4 / 2 with a 3-cell tick, unknown 4 / 3), anchored to the leg's own length, on a canvas of the art cells under the boxes. A dot is exactly one art pixel at every angle and zoom. Roads keep the MapLibre gradient line.
- **Far away.** The paths are quieter from space: a solid mix toward the page by `farOf(zoom)` (0.55 at the whole globe, none from internal zoom 2.6; sixths), the selected place's legs excepted. The globe's arcs keep their look.
- **Sparks.** None from space (the globe draws none). On the street map a cell at each head (a plus when lit) from map zoom 6.5 (`SPARK_FROM_ZOOM`), inside the place's box.
- **Dash length by zoom.** The one remaining MapLibre dashed layers (graticule, dashed road classes) get their arrays scaled by 2^-(zoom fraction) because MapLibre sizes dashes at `floor(zoom)` (`applyDashScale`).

Owner-visible changes of 2026-10-20: see the sections above (one gradient, cell-by-cell patterns, far tone, sparks, trip cards).

## Pictures of the modes, thinning, ticks (2026-10-20)

- **The mode as a picture.** Each leg that is long enough wears a square badge at its middle (owner, 2026-10-21: full resolution, not the art grid): a 22 px plate in the colour of the path at that point (the selected place's legs in the lit colour) with the mode's icon in the page colour, the icons being Lucide's vectors (a plane, a train, a bus, a ship, footprints: `paths/mode-icon-paths.ts`, ISC licence, the app's one icon library, copied because the engine has no React), square caps and mitres, a ring of the page colour round the plate. They are DOM elements on a layer over the cell canvas (`paths/mode-icons.ts`, `paths/trail-dots-layer.ts`), placed on the cell grid so they move in the same steps as the line. The selected place's legs first, then the longest; a badge is skipped where it would touch another (`ICON_GAP`), so a crowd shows a badge where there is room. On the street map from zoom 5 (a leg must be 44 cells long, 24 when selected); on the globe from unified zoom 2.6, lifted like its arc and not where the planet hides it. `unknown` has none. The pattern of the line is the other half of the mode: neither carries it alone.
- **Thinning** (`paths/thin.ts`). At each zoom step (a quarter) the legs are taken, the selected place's first and then the longest, and one is dropped when it is under 10 cells long or when 65 % of it lies on cells (a grid of 4 art pixels in the Mercator plane of that zoom) that kept legs already cover: the same corridor travelled again says one line. The selected place's legs are never dropped; from map zoom 9.5 nothing is. On the street map the keys that stay filter the road layer and the cell canvas; on the globe a leg that is thinned away is a state of its texel (`STATE_HIDDEN`) the vertex shader clips.
- **Ticks.** A rail's cross-ticks are drawn only from unified zoom 5.5 on the globe (`TICK_FROM`) and map zoom 6.5 on the street map; before that a rail is a dashed line (the ticks doubled the weight of every rail and made a region of many trips a mesh of crosses).
- **Boxes.** A lopsided box (the long side three times the short one or more) has solid short sides and dashed long ones, like the edges of a big box (`BOX_STYLE.lopsided`): the dashes say "not selected", and two edges that long are never corners.

## Up close: badges, straight lines, the way back (2026-10-21)

- **Badges only up close.** The pictures of the modes show from unified zoom 4.5 on the globe and map zoom 5.5 on the street map, and only on a leg that spans at least 0.3 of the view's smaller side (0.18 for the selected place's legs). From farther they were a crowd. A leg that has been quietened (below) has none.
- **Straight lines quieten with the share of the screen they take** (`paths/thin.ts` `fadeStraight`): a flight or an arc (a leg without a road under it) is drawn as it is while its ends are up to one screen apart, so a short flight (Minsk to Moscow) stays readable at the zoom that fits it, then steps through three tones toward the page colour (the last is 80 % of the way, solid, never an opacity) by three screens. The selected place's legs keep their strength. The globe does it in the vertex shader (a state texel 52, 56 or 60), the street map in the canvas that draws these lines.
- **Hiding the lines hides the badges** (`TrailDotsLayer.setVisible(false)` clears them): they used to stay on screen when the home screen came back, because the layer was only drawn again when the lines were.
- **The ring's type grows with the planet** (`ringTargetEm`, `RING.type.emPerPlanet` 0.042, from 11 to 17 CSS px): it was 11 px whatever the planet's size, which read as tiny round a big planet on a laptop's screen.
- **The home screen gives way smoothly**: when the cover goes away (`setCover` with no blocks) the planet keeps its size and the lift is eased, as it was before the landing placement; the lowest zoom changing no longer snaps either (it used to shrink the planet and move it at once while the boxes faded in).

## The home screen's type (2026-10-21)

- The caption's thickness and the back of its rows are closer to the page: `sideMix` 0.2 (light) and 0.18 (dark), it was 0.34 and 0.3 ("too visible"); a row seen from behind (past the horizon, curling back) is drawn whole in the thickness' tone (`gl_FrontFacing` in the caption's fragment shader).
- The ring of type goes all the way round the planet again, as it did before the landing placement: the cut that masked its letters below the top of the home screen's content (`RingLayer.setCut`) is gone, and the overlay's own gradient dims what runs behind it.
