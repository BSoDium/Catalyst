# Web app architecture (`apps/web`, `@catalyst/web`)

React 19 + TypeScript (strict), React Router v7 framework mode with SSR, Tailwind CSS 4, shadcn/ui
(Button only, trimmed), Motion for React (`motion/react`). No LLM features. Deployed as its own Vercel
project (root directory `apps/web`); the `@vercel/react-router` preset is applied only when `VERCEL` is set,
so local builds keep the plain `build/server/index.js` layout.

## Commands

Run from the repo root with `pnpm --filter @catalyst/web <script>` or inside `apps/web`.

| Script | What it does |
| --- | --- |
| `dev` | dev server on :5173 with `CATALYST_CONTENT=demo` (placeholder fixtures) |
| `dev:published` | dev server with the real bundled snapshot (empty until the content repo publishes) |
| `build` / `start` | production build / `react-router-serve` (set `PORT`) |
| `typecheck` | `react-router typegen && tsc` |
| `test` | vitest (pure logic only; `vitest.config.ts` does not boot the React Router plugin) |
| `test:street-lines` | the line regression gate of the street pass (needs the dev routes, `docs/pixel-line-rules.md`) |
| `perf` | performance budgets against a production build, exit 1 when exceeded (`docs/performance.md`; `-- --headed` for the real display) |

## Environment

| Variable | Meaning |
| --- | --- |
| `CATALYST_CONTENT` | `published` (default) or `demo`: which bundled projection `@catalyst/published` serves |
| `CATALYST_API_URL` | optional. If set, `${url}/v1/projection` is fetched (2s timeout, validated with `parsePublishedProjection`); any failure logs one warning and serves the bundled snapshot |

## Structure

```
app/
  root.tsx            html shell, SkipLinks, page-wide nav scrim, Navbar, MotionConfig, global 404 ErrorBoundary
  routes.ts           pathless layout (shell) wrapping `/` and `/locations/:slug`; /projects /articles /artworks
  routes/shell.tsx    layout: full-bleed globe + PlacesNav + detail panel; owns focusedSlug, the saved GlobeViewState
                      and the panel inset passed to the globe
  routes/home.tsx     `/` (renders nothing in the panel slot; meta only)
  routes/location.tsx `/locations/:slug` loader (404 via data()), meta, PlaceDetail, route ErrorBoundary
  routes/{projects,articles,artworks}.tsx   thin wrappers around ContentPage
  components/         navbar, nav-scrim, skip-links, places-nav, detail-panel, place-detail, content-page,
                      not-found-page, ui/button
  lib/content.server.ts   ContentSource + bundled/API sources + cache (server only)
  lib/projection.ts       pure selectors: place index, routes -> points, place detail, content lists
  lib/dates.ts            authored-date formatting; lib/meta.ts; lib/tokens.ts; lib/utils.ts (cn)
  lib/layout.ts           `panelInset()`: CSS px of the globe covered by the desktop panel (half the viewport)
  hooks/use-is-mobile.ts  matchMedia via useSyncExternalStore (server snapshot: false)
  hooks/use-viewport-width.ts  layout viewport width via useSyncExternalStore (server snapshot: 0)
  globe/              the renderer seam + the production Three.js globe (see below); imports nothing from the rest of the app
  scripts/globe/      Playwright browser checks and the frame-time benchmark for the production build (see below)
```

## Routing and data flow

- Pathless layout `routes/shell.tsx` keeps one globe instance across `/` and `/locations/:slug`.
  Its loader returns the `PlaceIndex` (`places` summaries, `globePlaces`, resolved `routes`); `shouldRevalidate`
  is `false`, so navigating between places never refetches it.
- `routes/location.tsx` loader returns the full place with related titles resolved (`getPlaceDetail`), or
  throws `data({ message }, { status: 404 })`. Its `ErrorBoundary` renders `PlaceNotFound` inside the panel
  (message, link to `/`, a plain inline list of all places); the shell and globe stay mounted. Status is a real 404.
- Unmatched URLs fall to the root `ErrorBoundary` (404 page inside the navbar).
- Content pages list items with `id={slug}` anchors (`/projects#slug`); empty collections show "Nothing here yet."
- Loaders return only what the page needs; optional sections (dates, summary, body, images, related) are
  omitted when empty. Dates are shown as authored (`label`, else `start–end`), never reformatted.
- `content.server.ts`: `getProjection()` -> `ContentSource`. Validated projections are cached in module scope
  (API success 60s, fallback 15s, concurrent callers share one request). Meta tags: title, description and
  Open Graph text tags only (`lib/meta.ts`); `<html lang="en">`.

## Layout, navigation and panel

### Floating navbar and scrim

- `Navbar` has no background, border or blur. Left: the `Orbit` icon (lucide-react, shadcn's icon set) as a link home,
  accessible name "Catalyst, home". Right: text links Projects, Articles, Artworks (`aria-current="page"` on the
  active one via `NavLink`). The `<header>` is `pointer-events-none`; only the links take the pointer. 44px targets.
- Readability over scrolling content comes from `NavScrim` (`.nav-scrim` in `app.css`, documented in
  `docs/design-tokens.md`): a fixed, `pointer-events-none` band between content (z 30) and the nav (z 40).
  `PageNavScrim` (in `root.tsx`) renders it on every route except the globe shell, where the page colour is the ocean
  and the map must not be dimmed. The open detail panel renders its own `absolute` scrim, scoped to the panel, so the
  nav links over the panel stay legible while its content scrolls beneath them.
- Stacking: content 0, panel 30, page scrim 35, navbar 40, places list overlay 45, mobile slide-over 50, skip links 60.

### Places list (keyboard path)

`PlacesNav` is the dependable route to every place (the globe is a pointer enhancement). It is always in the DOM as
`<nav aria-label="Places">` with a `<ul>` of links (`data-place-link`, `aria-current="page"` on the open place) and is
visually hidden like a skip link. While a link inside it has keyboard focus (`:has(:focus-visible)`) it is revealed as
a compact floating overlay (top-left, below the navbar, scrollable, max-height to the viewport) and hides again when
focus leaves. Screen readers reach it normally. Hover/focus on a link highlights the place on the globe.
`SkipLinks` ("Skip to content", and on the globe shell "Skip to places") are the first tab stops. When the globe
cannot run (`data-state="unavailable"`, no WebGL) a CSS rule keeps the list visible, because pointer users have no
other way in. Without JavaScript the globe screen shows no list (the globe itself needs JS).

### Detail panel, SSR and hydration

- Desktop (`md`, 768px and up): the panel is a non-modal `aside` over the right half of the viewport (`md:w-1/2`,
  full height), above the globe and below the navbar layer. It slides in from the right with Motion over
  `duration.slow` (360 ms, the same duration and easing as the globe's re-centring). The Close button sits in the nav
  row at the panel's left, so it cannot collide with the nav links on the right; content starts below the nav row. The
  panel body is the page colour at 85% with a backdrop blur, so the map faintly continues beneath it.
- Mobile: full-screen modal slide-over (`role="dialog" aria-modal`, `inert` outside, body scroll lock), the globe is
  unmounted while it is open.
- The server and the hydration pass always render the desktop markup (`useIsMobile` server snapshot is `false`).
  Positioning uses responsive Tailwind classes, so a direct load of `/locations/:slug` already looks right on both
  sizes before JS runs. After hydration `useIsMobile` flips and only the semantics change.
- `AnimatePresence initial={false}`: the SSR panel is not animated in. Closing keeps the last place content during the
  exit animation (`location.tsx` retains its last loader data). Under reduced motion the panel has no initial/exit
  state (instant).
- Inset: `shell.tsx` passes `insetRight = panelInset(viewportWidth, isOpen, isMobile)` (half the viewport while the
  desktop panel is open, else 0) to the globe.

### Focus management (`components/detail-panel.tsx`)

- Open: focus moves to the panel heading (`#panel-heading`, `tabIndex -1`) always on mobile, and on desktop only
  after a user action (places link activation, globe marker select). Back/forward and direct loads do not steal focus.
- Close (button, Escape, or history): focus returns to the place's link in the places list (which reveals the overlay
  when the user is on the keyboard). Skipped if the user already moved focus elsewhere.
- Escape closes (document listener while open). Close navigates to `/` (history-correct; back reopens).

## Globe seam (`app/globe/`)

`types.ts` defines `GlobeViewState`, `GlobePlace`, `GlobeRoute`, `GlobeTiles` and `GlobeProps` (renderer-agnostic).
`index.tsx` exports `Globe`: `React.lazy` of `globe-canvas.tsx`, mounted only on the client, with a fixed-aspect
disc outline as the Suspense fallback. `globe-canvas.tsx` is the production globe: Three.js for world to regional
scale (decision and tuned constants in `docs/renderer-decision.md`) and, when `tiles` is given, a lazily loaded street
map it hands over to (see "Handover" below). The seam extends compatibly:

- `GlobeViewState.zoom` stays in [0, 1] (fit zoom to the Three.js globe's closest view); the optional `street` field
  carries extra zoom LEVELS beyond that (street scale, about 0 to 11). It is absent on every view that has not gone
  past the regional scale, so older saved views are valid. (`zoom`, `street`) is one continuous scale.
- `GlobeProps.tiles?: GlobeTiles | null` (primary URL, optional fallback PMTiles URL, max fallback zoom: the shell
  loader's `tiles`). Absent or null = world and regional scale only, exactly as before.

Lifecycle expectations for any implementation:

1. Fill the container (`size-full`); on the shell it is the whole viewport (the navbar floats over it). The container
   is never resized or translated for the panel: the app passes `insetRight` and the implementation centres itself
   on the free area (see "Inset" below). Handle resize anyway.
2. Read `initialView` once at mount. Report every view change through `onViewChange`; the shell keeps
   the latest in a ref. If `selectedSlug` changes after mount, move the camera to that place (and report it): into
   street scale when `tiles` work and cover the place, else to the regional scale.
3. On mobile the shell UNMOUNTS the globe while the slide-over is open and remounts it on close with the saved
   view: free GPU/WebGL resources in cleanup and tolerate rapid mount/unmount.
4. `focusedSlug` is a highlight request from the list (hover/focus); `selectedSlug` is the open place (or null).
   `onSelect(slug)` is the only way the globe asks the app to navigate.
5. Honour `reducedMotion` (no camera easing, no idle motion).
6. The globe is a pointer-first enhancement: the canvas and the label overlay are `aria-hidden` and have no tab
   stops; the places list (`PlacesNav`) is the accessible path. `data-globe="<name>"` is on the root element so tests can assert
   (un)mounting.
7. Rendering nothing on the server is the seam's job; the implementation may assume `window` exists.
8. `insetRight` (CSS px, at the right edge of the container that the app covers): centre the projection on the free
   area to the left. Rotate-to-place, picking, label positions and the minimum zoom (whole globe fits the free area)
   must all use that centre. Animate a 0 <-> positive change like the panel slide (instantly under `reducedMotion`),
   read it at mount too (direct load of a place), apply other changes at once, and keep the box full width. An
   implementation may skip drawing under the covered strip and dissolve the map's right edge into the page.

To swap renderers, point the `lazy(() => import(...))` in `globe/index.tsx` at another module. Do not change
`types.ts` or import app code from `globe/`.

## Production globe

### Modules (`app/globe/`)

| File | Role |
| --- | --- |
| `globe-canvas.tsx` | React lifecycle only: root `div[data-globe="three"][data-state]`, geodata import, prop forwarding, status message and the street-unavailable notice |
| `handover/controller.ts` | `createHandover()`: owns the globe AND the lazily created street map; one camera, the dissolve, overlays, tile-state reactions |
| `handover/maths.ts` | pure handover maths and the `HANDOVER` constants (bands, hysteresis, slew, overlay owner, ceilings); `maths.test.ts` |
| `street/**` | the street map (docs/street-architecture.md); only `street/engine.ts` and what it imports are in its lazy chunk |
| `engine/index.ts` | `createGlobe()`: wires renderer + labels + view reporting; `WebGLUnavailableError`; debug introspection |
| `engine/renderer.ts` | `GlobeRenderer`: WebGLRenderer, camera, sizing (ResizeObserver, DPR), frame scheduling, context loss, visibility, picking |
| `engine/scene.ts`, `materials.ts`, `marker-layer.ts`, `route-layer.ts` | what is drawn: disc, graticule, borders, coastlines, routes, markers, horizon outline; GLSL |
| `engine/controls.ts` | pointer input: drag, wheel, pinch, tap (canvas only) |
| `engine/motion.ts` | pure flight and inertia maths |
| `engine/geo.ts`, `geometry.ts`, `view.ts`, `tuning.ts` | pure projection/zoom maths, vertex builders, `GlobeViewState` <-> internal zoom, tuned constants |
| `engine/labels.ts`, `label-layer.ts` | pure label collision (`placeLabels`), DOM overlay |
| `engine/colors.ts`, `dpr.ts`, `webgl.ts` | CSS-variable theme, `devicePixelRatio` watcher, WebGL probe |

Everything under `engine/` and `handover/` is framework-free. Pure parts are unit-tested (`engine/*.test.ts`: projection,
labels, routes and vertex buffers, flights/inertia, view mapping, colour parsing, DPR watcher).

### Loading

`three` and the geodata are never imported on the server or in the main bundle: `globe-canvas` is the lazy chunk
(Three.js, the engine and the handover controller are statically inside it) and `@catalyst/geodata` is a dynamic
import in its effect. The street map is a SEPARATE lazy chunk, fetched by the controller only when the camera gets
close or a place is selected, and never on the server (the import sits in a dead branch of a conditional expression,
which is what Rollup needs to drop it; `build/server` contains no MapLibre). Production build, min + gzip:

| Chunk | Raw | gzip |
| --- | --- | --- |
| `globe-canvas` (three + engine + handover) | 570.6 KB | 147.4 KB |
| before the handover (`globe-canvas` 3.5 KB + engine 555.4 KB) | 558.9 KB | 143.6 KB |
| geodata coastlines 110m / borders 50m | 37 KB / 37 KB | 15.0 KB / 14.1 KB |
| street engine (MapLibre, PMTiles, pass), lazy | 1,096 KB | 304 KB |
| MapLibre worker, lazy | 508 KB | (146 KB) |

The initial JS of the world view grew by 11.8 KB raw, 3.9 KB gzip (the handover controller and the extended
engine); every other initial chunk is byte-identical. `grep WebGLRenderer build/client/assets/*.js` matches only
`globe-canvas`; `grep -l maplibre build/server -r` matches nothing.

### Lifecycle

1. Server and first client render: `Globe` renders `null`. After hydration `React.lazy` loads `globe-canvas`
   and the disc outline shows (`data-state="loading"`).
2. Effect (deps `places`, `routes`): load engine + geodata in parallel. If the effect was cleaned up meanwhile
   (React StrictMode, fast unmount) nothing is created. `createGlobe` probes WebGL once per page
   (`isWebGLAvailable`, a throwaway context that is released at once); without WebGL the root shows a calm
   status message (`data-state="unavailable"`, `role="status"`) and the places list is shown permanently (CSS) so pointer users can still navigate.
3. `GlobeRenderer` creates the WebGLRenderer (antialias off, drawing buffer `css / pixelSize`, canvas upscaled
   with `image-rendering: pixelated`). If the container has no size yet it waits for the `ResizeObserver` and
   only then fits the minimum zoom and applies the start view (so a remount never fits a 1px globe).
   Start view: `initialView` if given, else the selected place at the select zoom, else the default.
4. Frames are on demand: `requestRender()` schedules at most one rAF; the tick advances flight, inertia and
   route draw-on and reschedules only while something is still animating. Idle = no rAF, no GL calls.
   Resize renders synchronously (resizing clears the buffer). `visibilitychange` hidden cancels the pending
   frame and defers work; the first visible moment repaints once.
5. After each frame the label overlay is re-placed and the view is reported (`onViewChange`, deduplicated).
   `GlobeViewState.zoom` is linear in internal zoom between the fit-to-window zoom (0) and 6.5 (1).
6. Props (the inset is item 10): `selectedSlug` changes after mount fly the camera to the place (never zooms out below
   3.2; into street scale when possible, see "Handover"; a jump under reduced motion) and play the draw-on of that place's route; `focusedSlug` highlights the marker and
   forces its label; `reducedMotion` takes effect live (route becomes static, inertia off, label fades off).
7. WebGL context loss: `webglcontextlost` is prevented, frames stop, the root shows a status message
   (`data-state="lost"`). On `webglcontextrestored` Three re-initialises its state and re-uploads buffers and
   programs on the next render; the globe re-applies the clear colour (Three's reset drops it), clears the
   message and repaints. The view is unchanged.
8. Unmount (effect cleanup, including the mobile slide-over): cancel rAF, remove all listeners
   (ResizeObserver, DPR media query, visibility, pointer, theme), dispose geometries, materials and the
   renderer, `forceContextLoss()`, remove the canvas and the label nodes. Safe to call twice.
9. Theme: colours are resolved from the CSS variables `--background`, `--foreground`, `--globe-limb` and
   `--globe-grid` through a probe element, and re-read on `prefers-color-scheme` changes (the clear colour, the disc
   and every material are updated). Labels use the same variables directly in CSS.
   **The ocean is the page colour**: the disc is drawn in exactly `--background` (opaque, depth-writing, so the far
   side never shows through) and the clear colour is the same, so the canvas has no seam against the page, light or
   dark. Everything else is linework drawn on top: coastlines and borders in `--foreground`, the graticule in
   `--globe-grid`, and a 1 px horizon line in `--globe-limb` (30% of the ink; kept because it still reads as the
   globe's edge). Verified: the screenshot pixel in open ocean, at the page edge and inside the disc is
   `rgb(251 251 251)` in light and `rgb(10 10 10)` in dark, equal to the computed page background.
10. Inset (`GlobeProps.insetRight`, pure maths in `engine/inset.ts`, unit-tested in `inset.test.ts`):
    - Projection centre: the camera uses `setViewOffset` to render the window of a same-sized virtual frame shifted
      right by half the inset, rounded to a whole number of art pixels (`insetShiftBuf`). Labels and picking use
      `projectLonLat(..., centreX)` with the same shifted centre, so markers, labels, hit tests and the GPU agree
      (tested against Three's camera for several points). The view centre therefore lands in the middle of the free
      area, and flights to a place end there.
    - Fit: `minZoom = fitZoom(freeWidth, height)`: at 1440x900 with the panel open the minimum zoom is 2.29 (2.70
      without), so the whole globe fits the left half. Zoom is re-clamped when the inset changes.
    - Animation: a change between 0 and a positive value is tweened in the renderer with the app's standard
      easing over 360 ms (`TUNING.insetMs`, `INSET_EASE`; `tokens.test.ts` keeps them equal to `--duration-slow` and
      `--ease-standard`), driven by the same rAF loop, so it runs in step with the panel's slide (measured: the
      inset and `1440 - panelLeft` agree within the sampling jitter at 88/173/257 ms). Other changes (a viewport
      resize while open) and `reducedMotion` apply at once. The initial inset is read at creation, so a direct load
      of `/locations/:slug` starts centred.
    - Scissor and fade (stretch): while an inset is set, the GL scissor limits drawing to the free area plus a
      margin (`renderMargin`: 10% of the width, 96 to 240 px) beyond the panel edge, in low-res buffer pixels, and the
      canvas and the label layer get a CSS `mask-image` gradient that dissolves the map across that margin, so it
      looks like the map continues under the translucent panel and fades instead of being cut. The zone is anchored
      on the panel's edge and grows with the inset, so it is continuous while the panel slides. **Measured effect on
      cost: none** (see the measurements below); it is kept because it is correct, never slower, and may help
      weaker GPUs with larger buffers. Debug hook: `__globeDebug.setScissor(false)`.

11. Street scale: see the next section. Unmounting (the mobile slide-over, a route change) disposes both renderers.

## Handover (globe to street)

Goal: one system. The user zooms from the world to a city in the same 1-bit pixel look, and the swap between
renderers is not noticeable. Code: `app/globe/handover/` (+ small extensions in `engine/` and `street/`).

**One camera, owned by the globe.** `GlobeRenderer` keeps the view in its internal zoom `zu`, whose range now goes
past the Three.js globe's maximum (6.5) up to the street map's maximum: above 6.5 the same number is the street
camera through the registration `zoom_map = zu + log2 cos(lat)`. The globe canvas stays the pointer target at every
scale (drag, wheel, pinch, tap, inertia, flights are the existing, tuned code), the street map is `embedded`
(transparent root, no pointer events, host-driven camera). So a gesture that crosses the threshold is the same
gesture: nothing is handed over, only what is drawn changes. After every camera tick (`onFrame`) the controller
pushes the registered camera and the globe's animated inset into the street map and renders it synchronously
(`StreetMap.setCamera(..., { sync: true })`), so both renderers show the same instant. Measured registration
(`__handoverDebug.registrationError`, projection of a place by each renderer, across wheel zoom and flights): under
1e-9 px in the dissolve band; the pixels agree too (below).

**Cut (default) or dissolve** (`HANDOVER.dissolve`, default `false`). The pixel-art dissolve between the renderers is
parked until the fade is mastered; the code path is intact (`HANDOVER.dissolve = true`, or `?globe-debug&dissolve=1` for
tests). In cut mode there is no blend at all: the street map is created opaque and shown or hidden as a whole.
Past `cutZoom` (5.05; back below `cutBackZoom` 4.8, hysteresis) the controller renders the street map synchronously for
the exact camera and waits until its tiles for it are loaded (`map.areTilesLoaded()`, polling frames; after
`cutMaxWaitMs` = 500 it swaps anyway, so the globe never stalls), then does ONE swap in a single task, hence one paint:
street root visible, globe labels hidden, street markers and labels shown, Three.js suspended, all transitions off. Going
back, the Three.js frame (and its labels) is drawn synchronously for the current camera BEFORE the street map is hidden.
No frame ever shows both label layers or neither (asserted per animation frame by `scripts/globe/framing.mjs cut`).
The two renderers are registered to under a pixel, so only the line style changes at the cut.

**Bands** (`HANDOVER`, zoom `zu`; hysteresis everywhere, a function of position, not a state machine). Rows marked
(dissolve) apply only with `HANDOVER.dissolve = true`:

| zu | |
| --- | --- |
| below 4.0 (3.3 on the way back, after 2.5 s) | street map not loaded / released |
| 4.0 | chunk requested, map created (also when a place is selected) |
| 4.3 | the map follows the camera while invisible (trailing 140 ms), so its tiles are ready |
| 4.6 to 5.5 (dissolve) | pixel-grid dither dissolve: `blendAt(zu)` (smoothstep) drives `StreetMap.setBlend`, slew-limited to 450 ms per full swing |
| 5.05 and up (cut; 5.5 with the dissolve) | the street map alone; the Three.js scene is suspended (no draw calls, the camera still ticks) |
| 3.7 to 4.6 | the globe's lifted route arcs flatten onto the ground (`routeLift`), ahead of the dissolve |

The dissolve is on the art-pixel grid (Bayer, the street pass's `blend`), so lines morph rather than cross-fade:
the same coastline in both renderers is simply the same cells. Measured at several zooms and three regions
(`handover-shots.mjs seam`, art pixels of 3 CSS px, DPR 2): 95.9 to 99.9 % of the globe's ink cells have street ink
within one art pixel of the same view, no doubled lines (the missing few percent are the dotted graticule and the
route's different dash phase); the other way round (street to globe) 77 to 96 %, the rest being street-only detail.
The route stroke was made 2 art pixels with the globe's 7 px dash period so its weight survives the handover.

**Overlay**: markers and labels are one behaviour. The street map's overlay uses the globe's look when embedded
(`OverlayLook "globe"`: same marker sizes and ring, same type, same collision code `engine/labels.ts`, same
priorities: at street scale every label may show, collisions decide). Ownership flips once at dissolve 0.8 (back at
0.65), as a 120 ms opacity cross-fade of the two DOM layers (reduced motion: instant); picking follows the owner
(`pickOverride`). `focusedSlug` and the selection are forwarded to both.

**Tile state** (`StreetMap.onTileStatus`): the zoom limit is the street map's maximum only while a tile source works
(`primary`/`fallback`), else the globe's 6.5. While the chunk or the first probe is pending a flight toward street
scale waits at 6.5 with its clock paused and resumes (no spinner, no blank: the globe is on screen). If the sources
die (`capped`), the street map is lost or its context is lost while the camera is at street scale, the camera eases
back to 6.5 (the controller flies it; the engine's own ease is off when embedded), then the dissolve returns to the
globe, then the limit drops. `capped` (or a failed chunk, or no WebGL2) shows the small notice "Street detail is
unavailable right now." (a `role="status"` paragraph at the bottom left of the map, empty otherwise) when the user is
within 0.6 of the limit or a place is selected. When tiles come back the limit lifts and the notice goes. A place
outside the fallback archive's bounds is not flown to at street scale (`StreetMap.covers`).

**Framing: the view radius.** A place's framing comes from its published `viewRadiusKm` (optional, 0.5 to 500; default
`DEFAULT_VIEW_RADIUS_KM` = 12 km, a typical city-wide framing: a mid-size city is seen whole, so you can tell where
you are, with streets still legible). `engine/framing.ts`: the circle of that radius must fit the FREE area (box width
minus `insetRight`, by height) with a 25 % margin:

```
circlePx = min(width - insetRight, height) / 2 / 1.25
zu       = log2( circlePx * 6371.0088 / radiusKm * 2*pi / 512 )          // = radiusPxToZoom(px per radian)
```

The unified zoom has one scale at the view centre (`512 * 2^zu / (2 pi)` px per radian, any latitude: the Mercator
`log2 cos lat` cancels the stretch), so the formula is latitude independent. The result is clamped to the whole-globe
fit below and the street map's maximum above (`selectionZoom`); without a street map it stays the regional select zoom 3.2
(never zooming out). The renderer uses the inset it is HEADING for (`getInsetTarget`), so a selection that opens the
panel lands on the framing for the panel's width (the canvas applies the inset before the selection). Examples at
1440x900 with the panel open (free 720x900): Lisbon (10 km) zu 11.1, Paris (14 km) 10.65 and Ho Chi Minh City (18 km)
10.3. Selections, list selections and direct loads all use it.

**Selecting a place** (marker, label, list, `setSelected(slug, true)`): a flight to the place's framing, to street scale
when `tiles` are configured and the street map is not known to fail (the street map is mounted at once and the
flight waits at the limit if it has to), else to the select zoom 3.2 as before. Street flights keep the pan ahead of
the zoom (the target stays near the centre while the scale explodes), pull back to the cruise zoom between two
distant street-scale places, and last 0.9 to 6.5 s (about 5 s from the world). Direct load or reload of
`/locations/:slug` does NOT fly: the shell derives `initialView = { lon, lat, fitRadiusKm }` (`GlobeFitView`) from the
loader's places, the renderer computes the framing on its first sized frame, and from the very first frame the camera
is the final one (constant; asserted by sampling every animation frame). The street map may not be ready at first
paint: the Three.js globe is drawn at its own maximum (6.5) centred on the place, with the panel's inset, and the cut
happens when the street map is ready (never a flight, never a blank). A saved view (mobile remount) wins over the fit view. With the panel open (`insetRight`), both renderers use the same shifted centre; the selected place lands in
the middle of the free left half. Mobile: the slide-over unmounts the globe, so there is no flight with the panel open
and a direct load of a place URL shows the world after the panel is closed (as before).

**Focus circle** (`HANDOVER.revealFocus`, one constant, now `false`): at street scale, 450 ms after arrival, the street
pass can open `setReveal` around the selected place: inside a circle (up to 280 CSS px, feathered, Bayer-masked) the
vector render shows instead of the pixel art. With the cut and the city-wide framing it looked wrong on the
screenshots (anti-aliased source lines over the pixel art read as doubled lines, e.g. the Seine in Paris), so it is
off by default; the code stays and comes back with the dissolve.

**Lifecycle**: both renderers are created and disposed by the controller. The mobile slide-over unmounting the
globe disposes the street map too (two contexts); the view comes back identical including the street scale
(`GlobeViewState.street`): a restored street view (or a framed start view) mounts the street map at once while the globe is drawn at 6.5, and
swaps without a dissolve once ready (12 s cap, then the view is clamped to 6.5). Context loss: Three and the street
renderers keep their own recovery; either one lost sets `data-state="lost"`; a lost street context makes the street
map unusable (retreat to the globe). WebGL2 missing for the street map = street unavailable, the globe is unaffected.

**Reduced motion**: flights are jumps; the swap is instant (as always); no focus circle; overlay swap instant;
routes static. **Idle**: zero rAF calls, zero ticks, zero street renders in all states (measured at world, held
mid-dissolve and street scale; the follow debounce is a timer, not a frame loop). **Phones**: art pixel 2 CSS px
(both renderers use the globe's rule); the street map renders its source at `min(DPR, 2)` and presents at device
resolution (the spike's cheaper art-resolution path is not implemented, see docs/street-architecture.md).

**Accessibility**: unchanged. All overlays and canvases are `aria-hidden` and inert (the street root is `inert`
while it is not visible, so its attribution links are not tab stops then), the places list is the keyboard path to
street view (verified: Enter on a list link, focus stays on a real element through the whole flight). No live
region announces the switch to street view (it would be noise); only the unavailable notice is a live region.

**Measurements** (Apple M4, Chrome for Testing 153 headless, production build, local PMTiles, 1440x900@2; 390x844@3 emulated):
Ho Chi Minh City flight from the world: 4.9 s; rAF interval p50 16.7, p95 16.8, max 33.4 ms; 2 frames over 25 ms on
desktop and 1 on mobile, all at the flight START (zoom 2.5 to 2.7, where the street map is created; the dissolve and
street scale have none); JS heap 11 to 37 MB. GPU-synced frame in the dissolve band (Three.js render + registered
street render + pass, circular pan, 300 frames): desktop p50 10.1 / p95 12.2 / max 17.5 ms, mobile 6.7 / 8.2 / 11.9 ms.
Contexts: 20 slide-over open/close cycles, 0 live while open and 1 after (22 created, 21 lost); 20 world to street to
world round trips, 3 live at street scale (Three + 2) and 1 after (43 created, 42 lost). `scripts/globe/handover-*.mjs`.

### Performance behaviour of the handover (see `docs/performance.md`)

- The street map is created at unified zoom 4.0 (or at the click of a place) and released 2.5 s after the camera leaves its range. While the globe is the shown renderer the map is **inactive** (`StreetMap.setActive(false)`): tiles keep loading, but there is no canvas copy, no pass and no overlay work, and the camera is only pushed to it once the camera rests (140 ms debounce). From the cut it is pushed on every tick, snapped to the art-cell grid (`street/core/snap.ts`) while the zoom is steady.
- The street map renders at native art resolution (3 map pixels per cell per axis), like the globe. `highResolution` follows `HANDOVER.revealFocus` (off).
- The street chunk is fetched and evaluated in an idle period 2.5 s after the globe is up (not on data-saver/2g connections), so the first flight or zoom does not pay for it.
- `engine/governor.ts` watches the frame intervals of the moving camera and lowers the quality on a device that cannot keep up (street render scale 3 to 2, then a larger art pixel), with hysteresis; `__handoverDebug.quality()` / `forceQuality()`.

### Behaviour notes

- Markers are GL points sized in whole art pixels: normal 3, route stop 5, focused 7, selected 9 (ring with
  centre dot). They are shown or hidden as a whole, from their centre only (see "Marker clipping fix" below);
  picking and labels use the same answer, so hidden markers can be neither seen nor clicked.
- Routes: only the lines in the `routes` prop are drawn, as great-circle arcs lifted above the surface through
  the route's ordered points. All routes are drawn complete and static; only the route that contains the
  newly selected place plays the 2.2 s draw-on, and only when motion is allowed. The route containing the
  selected place is matched by coordinates (the seam type has no slugs on routes) and its stops get the
  5 px marker.
- Borders: hidden below zoom 3.0, 50% dither to 3.3, solid above (thresholds from the renderer decision).
- Labels: HTML overlay (`aria-hidden`, no tab stops: a visual duplicate of the places list, extra tab stops
  would only repeat it). Labels are `pointer-events: none`; the canvas pointer handler hit-tests them
  (grown by 2 px for mouse, 12 px for touch), so a drag that starts on a label still rotates, and a click
  or tap on a label selects. Collision layer: priority order, selected and focused forced, markers are
  obstacles, front hemisphere only. A zoom-dependent priority floor (60 on the whole globe, 0 from zoom 3.0)
  reveals lower-priority places as you zoom in.
- Input: drag (inertia stops cleanly; none under reduced motion; none after a pinch), wheel and trackpad pinch,
  two-finger pinch, tap/click. `touch-action: none` is set on the canvas only; the container, the places list and the
  panel keep default touch behaviour. There is no keyboard handling on purpose (the canvas is not focusable).
- Debug introspection: `window.__globeDebug` exists only with `?globe-debug` in the URL or
  `sessionStorage["globe-debug"] = "1"`; the browser checks use it.

### Framing and cut checks (`scripts/globe/framing.mjs`)

`BASE_URL=http://localhost:5173 [SHOTS=1] node apps/web/scripts/globe/framing.mjs [reload|flight|cut|panel|reduced|mobile]`
(real OpenFreeMap tiles; `SHOTS=1` writes `docs/screenshots/framing-<slug>-{light,dark,mobile}.png`). `reload`: reload of
`/locations/{lisbon,paris,ho-chi-minh-city}`, light and dark, camera identical on every animation frame from the first,
one cut; `flight`: a list selection ends at the reload view; `cut`: through a flight in and back out, per frame the
street root and the globe labels are only ever 0 or 1, never both and never neither, Three.js suspended whenever the
street map shows; `panel`: framing with the panel open is wider by log2(900/720); `reduced`; `mobile`.

### Handover checks (`scripts/globe/handover-*.mjs`)

Need Chrome for Testing and the app on `BASE_URL` (default :5175) with `CATALYST_TILES_FALLBACK_URL=http://127.0.0.1:5240/places.pmtiles`
(`pnpm dev` with that variable, or a build started with `NODE_ENV=development`: production refuses plain-http tile
URLs); the scripts start the local PMTiles server themselves. The fallback source is pinned by default (deterministic,
offline); `SOURCE=auto` runs the real chain (OpenFreeMap).

```
node apps/web/scripts/globe/handover-drills.mjs [direct wheel click failover retreat capped recover reduced keyboard mobile-slideover]
node apps/web/scripts/globe/handover-perf.mjs  flight|frames|idle|leaks|all [desktop|mobile]
OUT_DIR=/tmp/shots node apps/web/scripts/globe/handover-shots.mjs dissolve|seam|flight [desktop|mobile]
```

`?globe-debug` (or `sessionStorage["globe-debug"]`) also exposes `window.__handoverDebug` (both renderers, dissolve,
overlay owner, limit, registration error, `forceBlend`, `fly`); `street-opts` (JSON in the URL or sessionStorage)
passes options to the street engine; `?no-street` runs the globe alone (the older Three.js-only scripts below do).

### Browser checks (`scripts/globe/`)

Need a Chrome binary (Playwright "Chrome for Testing") and the production server running with demo content:

```
pnpm --filter @catalyst/web build
CATALYST_CONTENT=demo PORT=5174 pnpm --filter @catalyst/web start
CHROME_PATH=/path/to/chrome OUT_DIR=/tmp/shots node apps/web/scripts/globe/check.mjs    # desktop behaviours (JSON)
CHROME_PATH=/path/to/chrome OUT_DIR=/tmp/shots node apps/web/scripts/globe/mobile.mjs   # 390x844@3x touch, unmount/restore, 20 cycles
CHROME_PATH=/path/to/chrome node apps/web/scripts/globe/bench.mjs desktop|mobile [seconds] [panel]
CHROME_PATH=/path/to/chrome node apps/web/scripts/globe/markers.mjs [quick]              # markers whole-or-absent regression (exit 1 on failure)
```

These Three.js-only scripts run with the street map off (`no-street`). `BASE_URL` overrides `http://localhost:5174`. The places list is visually hidden, so the scripts open places like a
keyboard user (`page.focus` on `[data-place-link]` + Enter). `bench.mjs ... panel` opens `/locations/kyoto` with the
panel open and repeats both passes with the scissor off. `check.mjs` also covers the inset (direct load, animation vs
panel position, picking, close, reduced motion) and the ocean colour in both schemes. The scripts install their instrumentation before app code runs:
a rAF call counter, WebGL context created/lost counters and a counter on `gl.clear` (Three issues one per frame).

## Production globe measurements

Environment: Apple M4 (macOS 27.0.1), Chrome for Testing 153.0.8010.12, headless, ANGLE Metal
(`ANGLE (Apple, ANGLE Metal Renderer: Apple M4)`), 60 Hz, WebGL2. Production build served by `react-router-serve`
with `CATALYST_CONTENT=demo` (11 places, 1 route). The "mobile" run is the same desktop GPU with a 390x844
viewport at DPR 3, touch and an iPhone user agent: **emulation, not a phone**. A fast desktop GPU at 60 Hz
vsync hits the cap, so the informative numbers are the JS and GPU-sync times, not fps. Not Safari.

Scenario: scripted continuous rotation (36 deg/s) plus a zoom oscillation across the border threshold, one view
change and synchronous render per rAF, 1.5 s warm-up then 10 s measured (600 frames). Times in ms, p50 / p95 / max.

| Viewport (drawing buffer) | fps | rAF interval | `renderer.render` JS | Render + labels JS | Render + labels + 1px `readPixels` (GPU sync) |
| --- | --- | --- | --- | --- | --- |
| 1440x900 @2x (480x300) | 60 | 16.7 / 16.7 / 16.8 | 0.2 / 0.3 / 0.6 | 0.4 / 0.5 / 1.2 | 2.3 / 2.5 / 3.0 |
| 1440x900 @2x, panel open (inset 720, scissor on) | 60 | 16.7 / 16.8 / 16.8 | 0.2 / 0.3 / 0.6 | 0.4 / 0.5 / 1.2 | 2.0 / 2.3 / 2.6 (second run 1.8 / 2.8 / 4.4) |
| 1440x900 @2x, panel open, scissor off | 60 | 16.7 / 16.8 / 16.8 | 0.2 / 0.3 / 0.4 | 0.3 / 0.4 / 0.5 | 2.0 / 2.3 / 5.4 |
| 390x844 @3x, emulated (195x422) | 60 | 16.7 / 16.7 / 16.8 | 0.2 / 0.3 / 0.6 | 0.4 / 0.5 / 1.2 | 2.0 / 2.9 / 4.5 |

The scissor changes nothing measurable on this GPU: the GPU-synced time with the panel open is 2.0 ms p50 with it
and without it (run to run noise is larger than the difference). The buffer is only 480x300 and the scene is
vertex-bound, so skipping the covered strip saves almost no fragment work. The panel itself adds the CSS cost of a
backdrop blur over the canvas, which does not show in these numbers (they time the WebGL path only) and which only
matters while the canvas repaints, since an idle page does no work.

Draw calls per frame: 7 (disc, graticule, borders, coastlines, route, markers, outline); 9,024 triangles
(the disc) and 13,557 line segments at zoom 3.6. JS heap about 8.5 to 11.5 MB. These match the prototype
(`docs/renderer-decision.md`: 0.3 / 0.4 / 0.6 ms JS, 2.3 / 3.0 / 5.5 ms GPU sync) within noise.

Measured behaviour (same build, same environment):

| Check | Result |
| --- | --- |
| Idle, 4 s without input (also after moving the pointer) | 0 rAF calls, 0 `gl.clear` (no frames), `isAnimating() === false` |
| Drag with fling, then rest | frames while flinging, then 0 rAF over the next 1.5 s |
| Route draw-on | animating while drawing; idle again after it ends |
| Reduced motion (`emulateMedia`) | selecting Hanoi landed on its exact coordinates in under two frames, `isAnimating() === false`, 0 rAF over 2.5 s, route static |
| Rotate to place | places list (keyboard) on Kyoto: view ends at `135.77, 35.01`, zoom 3.2; about 60 frames for the flight |
| Far side | at `lon 100, lat 10`, 7 of 11 places report `visible: false`; clicking each of them navigated nowhere; labels shown: Kyoto only |
| Context loss | `WEBGL_lose_context`: status message shown, 0 rAF while lost; after restore `data-state="ready"`, same view, correct background (screenshot) |
| `visibilitychange` | hidden: 0 rAF, 0 frames after a view change; shown: 1 repaint |
| No WebGL | status message, 0 canvases, 11 list links, the list is visible (288 px wide) and navigates, no console output |
| Mobile unmount | tapping a marker opened the dialog and removed the canvas (live contexts 0); closing restored the globe with the identical view (`2.35, 48.86, zoom 4`) |
| 20 open/close cycles (mobile) | WebGL contexts created 23 / lost 22 (live 1), canvases in the DOM 1, view unchanged; 23 = 1 WebGL probe (lost at once) + 22 globes (initial, one restore, 20 cycles) |
| Panel, direct load (`/locations/kyoto`, 1440x900) | inset 720, centre shift 120 buffer px, Kyoto drawn at (362, 452) CSS px: the middle of the left half is (360, 450); the 2 px offset is the snap to the 3 px art grid |
| Panel opening from `/` | inset ramps 0, 390, 607, 698, 720 at 0, 88, 173, 257, 343 ms while the panel's left edge goes 1440, 1052, 834, 742, 720: the two sum to 1440 throughout |
| Panel closing | inset back to 0, scissor off, Kyoto returns to (722, 452), the middle of the full width |
| Panel, reduced motion | after two frames: inset 720 at once and the panel at x = 720 (no animation) |
| Panel, idle | 0 rAF over 2.5 s with the panel open |
| Panel, picking | a click at the marker's shifted position keeps the place selected (no navigation elsewhere) |
| Keyboard flow | Tab order: Skip to content, Skip to places, logo, Projects, Articles, Artworks, then the places (list revealed, 288x528 px); Enter on Reykjavík opens it and focus moves to its heading (list hidden again); Escape closes and focus returns to its link (list revealed); tabbing out hides it |
| Reduced transparency | with `prefers-reduced-transparency: reduce` (CDP) the blur layers are `display: none` and the gradient is the longer solid one |
| Mobile (390x844) | panel is a modal dialog (`aria-modal`, body scroll locked, focus on the heading), globe unmounted |
| Console | no errors or warnings in any scenario, no hydration warnings (production and dev server) |
| Touch (CDP touch events) | one-finger drag rotates, pinch out zooms in, pinch in stops at the minimum zoom, tap on a marker selects; the places list and the globe root keep `touch-action: auto` |
| Built-in browser pane (Chrome 152, pane hidden) | globe renders, marker click opens `/locations/paris`; `document.hidden` was true, and the globe correctly produced no frames |

Not verified: Safari / iOS (including `image-rendering: pixelated` on canvas), real phone frame times, thermal
behaviour, a real `devicePixelRatio` change (the emulation does not raise the `resolution` media-query
event; the watcher is unit-tested with a fake `matchMedia` and the resize path was checked by changing size and
DPR together: buffer 375x250 at pixel size 3.2), real GPU context loss.

Also not verified for the floating UI: a real screen reader (VoiceOver/NVDA) on the places list, Safari and Firefox rendering of `:has(:focus-visible)`, CSS `mask-image` on a pixelated canvas and progressive `backdrop-filter`, and the cost of the panel's backdrop blur on weak GPUs. The `/articles` scrim screenshot repeats the single demo article in the DOM (test-only) so the page can scroll.

Screenshots (1280x800, demo content): `docs/screenshots/overview-light.png`, `overview-dark.png`, `panel-open.png`, `scrim-articles.png`.

### Marker clipping fix

Bug: markers were depth-tested against the globe disc (radius 0.998; markers at 1.0). A GL point has ONE depth
for all its pixels, while the disc's depth changes across the footprint, and on a surface tilted toward the
camera that change is larger than the 0.002 gap. The pixels on the side nearer the screen centre failed the test, so
markers in the upper half lost their bottom and those in the lower half their top (the 9 px selected ring lost
whole edges), and the cut also disagreed with the CPU test used for labels and picking. Measured on the old build over
about 1,150 views of the 11 demo places, 512 of 805 on-screen markers were missing 1 to 7 of their 9 pixels.

Fix (`engine/visibility.ts`, `marker-layer.ts`, `renderer.ts`): the renderer projects each place on the CPU (the
projection labels and picking already used), snaps it to its art pixel, and decides visibility from the CENTRE only:
front hemisphere and at least `TUNING.markerLimbClearance` (4 art pixels, the half-size of the selected ring) inside the
globe's silhouette, so a drawn marker never reaches the limb. The marker is then drawn at that pixel centre with no
depth test, last of all (after the horizon outline), so nothing can cut it; a hidden one is clipped away entirely.
`project()` returns that same cell and flag, so drawing, label anchors and picking cannot disagree (before, the GPU
point was unsnapped and could sit one pixel off the label anchor). The decision uses the unsnapped centre, so it does not
flicker with pixel snapping, and the markers are placed on a pixel centre, so a 3, 5, 7 or 9 px point always covers its
whole block. Markers are hidden about 12 css px before the limb: earlier than the geometric horizon, later than labels
(which drop at `facing < 0.08`).

Routes had the same cause in a milder form (1 to 3 route pixels missing in 26 of 100 tilted views). They now
skip the depth test and are hidden by an analytic ray-vs-disc test on the centre line (`routeMaterial`), so a dash is
cut across its length or not at all; the pixel set equals the depth-off render in every sampled view and is empty beyond
the horizon. Not changed: the graticule, borders and coastlines (1 px, no footprint), and the GL scissor under the detail
panel, which cuts at the panel edge by design (masked there).

Evidence and checks: `docs/screenshots/markers-before.png` / `markers-after.png` (same 9 views, 3x enlarged crops:
centre, north, south, near the limb, selected, high zoom; before and after). `scripts/globe/markers.mjs` draws markers
in pure red/blue (`__globeDebug.setMarkerProbe`) and compares the whole drawing buffer pixel for pixel with the expected
block of every shown marker (and nothing for hidden ones) over 9,252 views per run: full rotations at 7 latitudes and
three zooms, each place walked from 50 to 100 degrees off-centre along four bearings, desktop and 2 px mobile art pixels,
nothing selected and Reykjavik, Cape Town and Hanoi (route stops) selected. Old build (quick mode): 1,440 failures over
2,256 views; new build (full mode): 0 over 46,260 views. Unit tests: `visibility.test.ts`. Frame time unchanged (bench desktop, GPU-synced
p50 2.1 to 2.4 ms before and after, JS render p50 0.2 to 0.3 ms); idle still 0 rAF, 0 `gl.clear`.
