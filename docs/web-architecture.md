# Web app architecture (`apps/web`, `@catalyst/web`)

React 19 + TypeScript (strict), React Router v7 framework mode with SSR, Tailwind CSS 4, shadcn/ui
(Button only, trimmed), Motion for React (`motion/react`). No LLM features. Deployed as its own Vercel
project (root directory `apps/web`, `apps/web/vercel.json` pins the React Router preset); the `@vercel/react-router`
preset is applied only when `VERCEL` is set, so local builds keep the plain `build/server/index.js` layout.

## Commands

Run from the repo root with `pnpm --filter @catalyst/web <script>` or inside `apps/web`.

| Script | What it does |
| --- | --- |
| `dev` | dev server on :5173 via `scripts/dev.mjs`: the local **preview** when `packages/published/data/preview.projection.json` exists, else the published snapshot (empty) with a one-line hint. Never demo. Extra args go to `react-router dev` (`pnpm dev --port 5180`). An explicit `CATALYST_CONTENT` wins |
| `dev:demo` | dev server with `CATALYST_CONTENT=demo` (made-up placeholder places; the only way to get them) |
| `dev:published` | dev server with the real bundled snapshot (empty until the content repo publishes) |
| `build` / `start` | production build / `react-router-serve` (set `PORT`) |
| `typecheck` | `react-router typegen && tsc` |
| `test` | vitest (pure logic only; `vitest.config.ts` does not boot the React Router plugin) |
| `test:street-lines` | the line regression gate of the street pass (needs the dev routes, `docs/pixel-line-rules.md`) |
| `perf` | performance budgets against a production build, exit 1 when exceeded (`docs/performance.md`; `-- --headed` for the real display) |

## Environment

| Variable | Meaning |
| --- | --- |
| `CATALYST_CONTENT` | `published` (default), `preview` (the git-ignored local file of the owner's real places incl. drafts; dev only; ignores `CATALYST_API_URL`; re-read on every request) or `demo` (placeholder fixture). See the content modes table in `architecture.md` |
| `CATALYST_ALLOW_PREVIEW` | `1` lets a production-mode process read the preview file, for local `react-router-serve` testing only; without it `preview` is refused when `NODE_ENV=production` (the server logs why and serves the empty state) |
| `CATALYST_API_URL` | optional. If set, `${url}/v1/projection` is fetched (2s timeout, validated with `parsePublishedProjection`); any failure logs one warning and serves the bundled snapshot |

## Structure

```
app/
  root.tsx            html shell, SkipLinks, page-wide nav scrim, Navbar, MotionConfig, global 404 ErrorBoundary; dev-only content badge (loader returns the mode only when import.meta.env.DEV)
  routes.ts           pathless layout (shell) wrapping `/`, `/locations/:slug` and the entries `/{articles,projects,artworks,poems}/:slug`;
                      the lists /projects /articles /artworks /poems (no globe)
  routes/shell.tsx    layout: full-bleed globe + PlacesNav + detail panel; owns focusedSlug, the saved GlobeViewState,
                      the panel inset passed to the globe and the container of an entry (`?view=full`)
  routes/home.tsx     `/` (renders nothing in the panel slot; meta only)
  routes/location.tsx `/locations/:slug` loader (404 via data()), meta, PlaceDetail, route ErrorBoundary
  routes/entry-{article,project,artwork,poem}.tsx   `/<kind>/:slug`: loader (lib/entry-loader.server.ts), meta, EntryRoute; no error boundary (404 -> root)
  routes/{projects,articles,artworks,poems}.tsx     the lists: summaries -> EntryListPage
  routes/dev-design.tsx   DEV ONLY `/dev/design`: the UI system's styleguide (guarded like `/dev/street`; docs/design-system.md)
  components/         navbar, nav-scrim, skip-links, places-nav, detail-panel, place-detail, entry-list-page,
                      not-found-page, ui/ (the UI system: Frame, MicroLabel, KindTag, Button, CoverArt, ... see docs/design-system.md)
  components/entry/   entry-view (the one view for both containers), blocks (the body renderer), entry-route (route glue), entry-list-card
  lib/content.server.ts   ContentSource + bundled/API sources + cache (server only)
  lib/projection.ts       pure selectors: place index, routes -> points, place detail (with its entries)
  lib/entries.ts          pure selectors of entries: lists (summaries), one entry with body/places/related/neighbours, entries of a place, `?view`/panel-path parsing
  lib/entry-blocks.ts     pure parts of the body renderer: grouping, outline numbering, ids/keys, safe media and https URLs
  lib/entry-meta.ts, entry-revalidate.ts, entry-loader.server.ts   head tags of entry/list routes, the no-refetch-on-query rule, the entry loader
  lib/dates.ts            authored-date formatting; lib/meta.ts; lib/tokens.ts; lib/utils.ts (cn)
  lib/{entry-kind,labelling,cover-art,contrast}.ts   pure helpers of the UI system (kinds, micro-label formatters, seeded cover art, WCAG contrast)
  lib/layout.ts           `panelInset()`: CSS px of the globe covered by the desktop panel (half the viewport)
  hooks/use-is-mobile.ts  matchMedia via useSyncExternalStore (server snapshot: false)
  hooks/use-viewport-width.ts  layout viewport width via useSyncExternalStore (server snapshot: 0)
  globe/              the renderer seam + the production Three.js globe (see below); imports nothing from the rest of the app
  scripts/entries/    Playwright check of the entry views (demo content): panel, full screen, place panel, 404s, lists, 390 px
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
- The list pages (`/projects`, `/articles`, `/artworks`, `/poems`) are plain pages outside the shell: an `EntryCard` grid (cover, kind,
  code, date, places, summary, tags) whose cards keep `id={slug}` anchors (`/projects#slug`) and link to the entry route; an empty
  collection shows the intentional `StatePanel` ("Nothing here yet"). Loaders return summaries only (`listEntries`: no body).
- Loaders return only what the page needs; optional sections (dates, summary, body, images, related) are
  omitted when empty. Dates are shown as authored (`label`, else `start–end`), never reformatted.
- `content.server.ts`: `getProjection()` -> `ContentSource`. Validated projections are cached in module scope
  (API success 60s, fallback 15s, concurrent callers share one request). Meta tags: title, description and
  Open Graph text tags only (`lib/meta.ts`); `<html lang="en">`.

## Layout, navigation and panel

### Floating navbar and scrim

- `Navbar` has no background, border or blur. Left: the `Orbit` icon (lucide-react, shadcn's icon set) as a link home,
  accessible name "Catalyst, home". Right: text links Projects, Articles, Artworks, Poems (`aria-current="page"` on the
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

- Desktop (`md`, 768px and up): the panel is a non-modal complementary region (a `div role="complementary"`) over the right half of the viewport (`md:w-1/2`,
  full height), above the globe and below the navbar layer. It slides in from the right with Motion over
  `duration.slow` (360 ms, the same duration and easing as the globe's re-centring). The header row (Close, and for entries the
  expand toggle) sits in the nav row at the panel's left, so it cannot collide with the nav links on the right; content starts below the nav row. The
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

- Open: focus moves to the panel heading (`#panel-heading`, `tabIndex -1`, the view's one h1) always on mobile, and on desktop
  only after a user action: a places link, a globe marker, or any link inside the panel (an entry card, a place link; they navigate
  with PUSH, which the panel reads through `useNavigationType`). Back/forward (POP) and direct loads do not steal focus. The
  effect is keyed on `routeKey` (the pathname), so toggling the container (a query change) never moves focus: it stays on the toggle.
- Close (button, Escape, or history): for a place, focus returns to its link in the places list (which reveals the overlay
  when the user is on the keyboard); for an entry, to the page's `main`. Skipped if the user already moved focus elsewhere.
- Escape closes (document listener while open), in both containers. Close navigates to `/` (history-correct; back reopens).

### Entries in the shell: routes, containers, URL scheme

| URL | Shows |
| --- | --- |
| `/articles/:slug`, `/projects/:slug`, `/artworks/:slug`, `/poems/:slug` | the entry in the side panel over the globe (SSR; the globe stays interactive on the left half) |
| the same with `?view=full` | the same entry in the full-screen container |
| `/locations/:slug` | the place panel: its linked entries as cards grouped by kind |
| `/articles`, ... `/poems` | the list pages (outside the shell, no globe) |
| unknown slug, or a slug under the wrong kind (`/projects/demo-poem`) | a real 404 through the root boundary and the site's not-found page |

- **The container is the URL.** `?view=full` was chosen over a nested route: the route tree stays one route per kind, the URL is
  shareable and SSR-friendly (the server reads the query: a reload or a pasted link renders the full view at once), and the query
  is not part of the loader's identity: `entryShouldRevalidate` returns false when only the query changes, so toggling never
  refetches the entry. The toggle (`ExpandToggle` in the panel header, desktop only: the phone's slide-over is full screen already)
  navigates with PUSH, so Back collapses. The router state is kept across the toggle.
- **One component, two layouts.** `components/entry/entry-view.tsx` gets `layout="panel" | "full"` and nothing else differs: the
  same data, the same DOM and focus order (header, details, cover, body, places/related/neighbours). In `panel` every block spans the
  12 columns; in `full` the title (8) and the details frame (4) share the first row, the cover and body (8) and the places/related
  aside (4) the second, in a `max-w-6xl` column. A render test asserts the two layouts have the same text in the same order.
- **One container element.** `DetailPanel` does not remount when the layout changes: only `md:w-1/2` becomes `md:w-full` (a width
  transition on `--duration-base` and `--ease-standard`, collapsed to ~0 by the global reduced-motion rule) and the background
  loses its translucency and blur (no blur of a live canvas over the whole screen). Closing from full screen keeps the layout it
  was shown with during the exit animation.
- **The globe is untouched.** The shell passes the same `insetRight` (half the viewport) in both containers, so the globe does not
  re-centre or resize while the panel widens; `scripts/entries/check.mjs` asserts the `[data-globe]` node and the canvases are the
  same objects after toggling. Under the full view the globe's `main` is `inert` (no tab stops in the places list behind it).
- **Landmarks.** Panel: `role="complementary"` labelled by the h1. Full: the same element becomes `role="main"` with `id="main"`
  (the globe's `main` gives up the id), so "Skip to content" lands on the full view and there is one `main`. One h1 per view: the
  entry's (or the place's) title while the panel is open; a visually hidden "Catalyst" h1 on the globe page when it is closed. Body
  headings are h2/h3 (an h3 before any h2 is drawn as h2: the outline never skips a level); the sections after the body are h2.
- **Place -> entry -> place.** The place panel's cards link with `state={{ from: "<place slug>" }}`; the entry shows "Back to
  <place>" (read and validated against the shell's places by `resolveBackTarget`) and the shell keeps that place selected on the globe
  so the camera does not move. History state survives a reload; without it the entry simply has no back link (its Places section
  links to `/locations/:slug` anyway).
- **Data.** `lib/entries.ts`: `listEntries` (summaries: cover, tags, meta, places, no body), `getEntryDetail` (body, places, related,
  previous/next in the kind), `entriesOfPlace` (a place's `related` and the entries' `placeSlugs`, each once, grouped by kind). Both
  directions of the entry/place link are merged everywhere. The index code (`ARTICLE / 0004`) is the 1-based position of the entry in
  its kind's collection in authored order: deterministic and decorative (it shifts if entries are inserted before it; the slug is the
  id). A project's `Status` fact is drawn as the entry's status tag; a poem's `Language` fact sets `lang` on the body.
- **Head.** `entryMeta`: title, summary as description, `og:type` article for articles, and `og:image` (made absolute with the
  request's origin) only when the entry has an authored cover on a safe `/media/` path.
- **Browser check:** `apps/web/scripts/entries/check.mjs` (demo content; see the file header). Run against `pnpm dev:demo`.

## Globe seam (`app/globe/`)

`types.ts` defines `GlobeViewState`, `GlobePlace`, `GlobeRoute`, `GlobeTiles` and `GlobeProps` (renderer-agnostic).
`index.tsx` exports `Globe`: `React.lazy` of `globe-canvas.tsx`, mounted only on the client, with NO Suspense fallback
(nothing but the page colour shows until the first pixel-art frame fades in; see "Reload fade"). `globe-canvas.tsx` is the production globe: Three.js for world to regional
scale (decision and tuned constants in `docs/renderer-decision.md`) and, when `tiles` is given, a lazily loaded street
map it hands over to (see "Handover" below). The seam extends compatibly:

- `GlobeViewState.zoom` stays in [0, 1] (fit zoom to the Three.js globe's closest view); the optional `street` field
  carries extra zoom LEVELS beyond that (street scale, about 0 to 11). It is absent on every view that has not gone
  past the regional scale, so older saved views are valid. (`zoom`, `street`) is one continuous scale.
- `GlobeProps.tiles?: GlobeTiles | null` (primary URL, optional fallback PMTiles URL, max fallback zoom: the shell
  loader's `tiles`). Absent or null = world and regional scale only, exactly as before.
- `GlobeProps.attribution?: ComponentType<GlobeAttributionProps>`: the map's credits control (the credits line with its
  "See more" button, and the dialog behind it) is app UI, so the app hands it in and the globe renders it in its box (bottom right, clear of
  `insetRight`); the globe never imports it. `StreetMapCanvas` takes the same prop. The app passes
  `components/attribution-slot.tsx` (a lazy wrapper around `attribution-button.tsx`, so the button stays out of the
  main bundle) in `routes/shell.tsx` and `routes/dev-street.tsx`. Omitted = no credits control: pass it wherever the
  maps are shown, the credits are licence-required.

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
`types.ts` (other than additive optional props such as `attribution`) or import app code from `globe/`.

### Layering

```
engine/    framework-free Three.js globe          imports neither handover/ nor street/
street/    the MapLibre pass                       imports engine/, not handover/
handover/  owns both renderers, one camera         imports engine/ and street/
globe/*    the seam (index.tsx, types.ts) and the React canvases (globe-canvas.tsx, street/street-map-canvas.tsx)
           imports nothing from the rest of the app (components, routes, lib, hooks)
```

`app/globe/layering.test.ts` scans the import specifiers and fails on a violation of the three rules above (test files
are exempt from the first two: a test may read another layer's constants). Shared maths lives at the lowest layer that
needs it: `zoomCorrection` (`log2 cos lat`) in `engine/geo.ts` (re-exported by `street/core/registration.ts`),
`routeLift` in `engine/view.ts` with its constants `TUNING.routeFlat` (`HANDOVER.routeFlat` aliases it).

Known exceptions, in the other direction (app code reaching past the `globe/index.tsx` seam), pinned by the same test so a
new one is a decision: `components/attribution-button.tsx` and `components/credits-dialog.tsx` use the credits data (`street/core/attribution`);
`lib/projection.ts` uses `engine/framing`; `lib/tiles-config.server.ts` uses `street/types`; the dev routes use
`engine/geo` and `street/harness/synthetic`. Inside `street/`, `core/` is "pure" but still imports the constant and type
files `../tuning` and `../../types`.

## Production globe

### Modules (`app/globe/`)

| File | Role |
| --- | --- |
| `globe-canvas.tsx` | React lifecycle only: root `div[data-globe="three"][data-state]`, geodata import, prop forwarding, status message, the street-unavailable notice and the app-supplied `attribution` slot |
| `handover/controller.ts` | `createHandover()`: owns the globe AND the lazily created street map; one camera, the dissolve, overlays, tile-state reactions |
| `handover/maths.ts` | pure handover maths and the `HANDOVER` constants (bands, hysteresis, slew, overlay owner, ceilings); `maths.test.ts` |
| `layering.test.ts` | pins the layering rules of this directory (see "Layering") |
| `street/**` | the street map (docs/street-architecture.md); only `street/engine.ts` and what it imports are in its lazy chunk |
| `engine/index.ts` | `createGlobe()`: wires renderer + labels + view reporting; `WebGLUnavailableError`; debug introspection |
| `engine/renderer.ts` | `GlobeRenderer`: WebGLRenderer, camera, sizing (ResizeObserver, DPR), frame scheduling, context loss, visibility, picking |
| `engine/scene.ts`, `materials.ts`, `route-layer.ts` | what is drawn: disc, graticule, borders, coastlines, routes (only those through the selected place), horizon outline; GLSL. Places and groups are NOT drawn here: they are rectangles on the pixel overlay (below) |
| `engine/controls.ts` | pointer input: drag, wheel, pinch, tap (canvas only) |
| `engine/motion.ts` | pure flight and inertia maths |
| `engine/framing.ts` | pure camera framing: `placeFraming(place)` (centre and radius of the place's bounding box, else its point and `viewRadiusKm`) and the zoom that fits that circle in the free area |
| `engine/inset.ts` | pure maths of the right-hand inset (`insetRight`): the projection centre shifted by whole buffer pixels |
| `engine/sky.ts`, `sky-layer.ts` | the skybox behind the earth: the pure maths (frames, the baked Milky Way map, the star list, fade, tones, Bayer dither, on/off rule; `sky.test.ts`) and the Three.js objects that draw it ("Skybox" below) |
| `engine/idle-spin.ts` | pure idle rotation of the unzoomed world view: the idle clock, when it may run, the yaw step and the redraw period, the page flags ("Idle rotation" below) |
| `engine/governor.ts` | adaptive frame-budget governor: steps render quality down on slow frames and back up (docs/performance.md) |
| `engine/palette.ts` | the one grey palette of both renderers (`PALETTE_LEVELS`, `MAP_CONTRAST`, `BOX_CONTRAST`, roles `wash` .. `coast`, `peak`, `ink`) built from the CSS tokens |
| `engine/visibility.ts` | whole-marker visibility: front hemisphere and footprint inside the silhouette, one answer for picking, labels and GPU |
| `engine/perf.ts` | opt-in phase timers for the performance scripts (`window.__perf`, off unless the debug hooks are on) |
| `engine/lod-stress.ts` | deterministic synthetic place hierarchy for the performance checks only (`?globe-debug&lod-stress=N`) |
| `engine/geo.ts`, `geometry.ts`, `view.ts`, `tuning.ts` | pure projection/zoom maths, vertex builders, `GlobeViewState` <-> internal zoom, tuned constants |
| `engine/lod-tree.ts`, `box-scene.ts`, `pixel-labels.ts`, `pixel-buffer.ts`, `pixel-font/`, `country-names.ts`, `group-square.ts`, `node-screen.ts` | the detection boxes: the cut of the place hierarchy, the pixel-art drawing of the BOXES (`pixel-labels.ts`, `pixel-buffer.ts`), the pixel font and text drawing (kept for text that is part of the map itself, not used by the box labels any more), the country names, the box scene that ties boxes, labels and hit targets together ("Detection boxes" below) |
| `engine/open-sweep.ts`, `open.test.ts` | measurements and tests of the EARLY OPENING of groups ("Opening a group into its most important children" below): the sweeps over view centres, the metrics (boxes on screen, free label room, overlapping pairs), the opening zoom of a group, `nodesFromProjection` (a published projection to tree nodes without the app's modules); `OPEN_REPORT=1 pnpm --filter @catalyst/web exec vitest run open` prints the table |
| `engine/fade.ts` | the one animation primitive: timed on/off transitions (`FadeArray`, `FADE_MS` 200, the ease, the hysteresis switch); "Binary visibility" below |
| `engine/hit-area.ts`, `label-plan.ts`, `label-track.ts`, `label-text.ts`, `label-sub.ts`, `label-dom.ts` | what is a click and hover target (the convex hull of a box and its label, plus slop; innermost wins); the BOX LABELS, which are HTML text in device pixels: their type and measured size (`label-text.ts`), the second line's text and the entry kinds (`label-sub.ts`), where every label goes (`label-plan.ts`: every drawn box has one, candidate positions, a shorter label, then drawn on top), WHEN it is re-planned and how labels keep their place (`label-track.ts`) and the pooled DOM elements, a plate and its feather (`label-dom.ts`): "Labels in device pixels" below |
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
| `globe-canvas` with the skybox (2026-10-08, measured on a production build of the stacked branch) | 641.0 KB | 171.4 KB |
| geodata coastlines 110m / borders 50m | 37 KB / 37 KB | 15.0 KB / 14.1 KB |
| street engine (MapLibre, PMTiles, pass), lazy | 1,096 KB | 304 KB |
| MapLibre worker, lazy | 508 KB | (146 KB) |

The initial JS of the world view grew by 11.8 KB raw, 3.9 KB gzip (the handover controller and the extended
engine); every other initial chunk is byte-identical. `grep WebGLRenderer build/client/assets/*.js` matches only
`globe-canvas`; `grep -l maplibre build/server -r` matches nothing.

### Lifecycle

1. Server and first client render: `Globe` renders `null`. After hydration `React.lazy` loads `globe-canvas`
   (nothing is shown meanwhile, `data-state="loading"`, root veiled).
2. Effect (deps `places`, `routes`): load engine + geodata in parallel. If the effect was cleaned up meanwhile
   (React StrictMode, fast unmount) nothing is created. `createGlobe` probes WebGL once per page
   (`isWebGLAvailable`, a throwaway context that is released at once); without WebGL the root shows a calm
   status message (`data-state="unavailable"`, `role="status"`) and the places list is shown permanently (CSS) so pointer users can still navigate.
3. `GlobeRenderer` creates the WebGLRenderer (antialias off, drawing buffer `css / pixelSize`, canvas upscaled
   with `image-rendering: pixelated`). If the container has no size yet it waits for the `ResizeObserver` and
   only then fits the minimum zoom and applies the start view (so a remount never fits a 1px globe).
   Start view: `initialView` if given, else the selected place at the select zoom, else the default.
4. Frames are on demand: `requestRender()` schedules at most one rAF; the tick advances flight, inertia and
   route draw-on and reschedules only while something is still animating. Idle = no rAF, no GL calls, until the idle rotation starts (8 s of rest on the unzoomed world view; `engine/idle-spin.ts`).
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
9. Theme: colours are resolved from the two CSS variables `--background` and `--foreground` through a probe element
   (every other colour is a level of the shared grey palette derived from them, `engine/palette.ts`, see
   `docs/pixel-line-rules.md` section 7; `--globe-limb` and `--globe-grid` are no longer read), and re-read on `prefers-color-scheme` changes (the clear colour, the disc
   and every material are updated). Labels use the same variables directly in CSS.
   **The ocean is the page colour**: the disc is drawn in exactly `--background` (opaque, depth-writing, so the far
   side never shows through) and the clear colour is the same, so the canvas has no seam against the page, light or
   dark. Everything else is linework drawn on top: coastlines in the ink, borders stepping up through the palette levels
   as you zoom in (below), the graticule in the `faint` level, and a 1 px horizon line in the `soft` level (kept
   because it still reads as the globe's edge). Verified: the screenshot pixel in open ocean, at the page edge and inside the disc is
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
    - Fade: while an inset is set, the canvas and the label layer get a CSS `mask-image` gradient that dissolves the
      map across a margin beyond the panel edge (`renderMargin`: 10% of the width, 96 to 240 px), so it looks like the
      map continues under the translucent panel and fades instead of being cut. The zone is anchored on the panel's
      edge and grows with the inset, so it is continuous while the panel slides. The whole buffer is always drawn:
      there used to be a GL scissor limited to the free area plus the margin, which measured no gain (below) and is
      gone, with its `setScissor` hook.
    - **Stale edge (fixed).** At street scale with the panel open the soft edge showed an image that did not move with
      the zoom, with borders in it. Cause: the Three.js canvas is suspended while the street map is shown (cut), but it
      kept its last frame on screen, and the street canvas dissolves into whatever is underneath at the same edge. A
      suspended canvas is now `opacity: 0` (not `visibility: hidden`: the canvas is the pointer target at every scale and
      hidden elements get no pointer events; shown again by the next frame it draws, `GlobeRenderer.setSuspended` and
      `renderNow`). `scripts/globe/stale-check.mjs` removes the Three.js canvas from the page and requires the strip
      to be pixel-identical (the old build changes 3,114 pixels), and requires the edge to follow the zoom.

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
Past `cutZoom` (3.7; back below `cutBackZoom` 3.45, hysteresis) the controller renders the street map synchronously for
the exact camera and waits until its tiles for it are loaded (`map.areTilesLoaded()`, polling frames; after
`cutMaxWaitMs` = 1200 it swaps anyway, so the globe never stalls), then swaps in a single task, hence one paint:
street root visible, globe labels hidden, street markers and labels shown, Three.js suspended, all transitions off. The
swap is a ~300 ms tone cross-fade of the picture (`HANDOVER.crossfadeMs`, `seedFrom` / `crossfadeTo`; instant under
reduced motion), not a click. Going
back, the Three.js frame (and its labels) is drawn synchronously for the current camera BEFORE the street map is hidden.
No frame ever shows both label layers or neither (asserted per animation frame by `scripts/globe/framing.mjs cut`).
The two renderers are registered to under a pixel, so only the line style changes at the cut.

**Bands** (`HANDOVER`, zoom `zu`; hysteresis everywhere, a function of position, not a state machine). Rows marked
(dissolve) apply only with `HANDOVER.dissolve = true`:

| zu | |
| --- | --- |
| below `mountZoom` 2.6 (`unmountZoom` 1.9 on the way back, after 2.5 s) | street map not loaded / released |
| 2.6 | chunk requested, map created (also when a place is selected) |
| `followZoom` 3.0 | the map follows the camera while invisible (trailing 140 ms), so its tiles are ready |
| `blendStart` 3.3 to `blendEnd` 4.1 (dissolve) | pixel-grid dither dissolve: `blendAt(zu)` (smoothstep) drives `StreetMap.setBlend`, slew-limited to 450 ms per full swing |
| 3.7 and up (cut; 4.1 with the dissolve) | the street map alone; the Three.js scene is suspended (no draw calls, the camera still ticks) |
| 2.5 to 3.3 (`HANDOVER.routeFlat`) | the globe's lifted route arcs flatten onto the ground (`routeLift`), ahead of the dissolve |

The dissolve is on the art-pixel grid (Bayer, the street pass's `blend`), so lines morph rather than cross-fade:
the same coastline in both renderers is simply the same cells. Measured at several zooms and three regions
(`handover-shots.mjs seam`, art pixels of 3 CSS px, DPR 2): 95.9 to 99.9 % of the globe's ink cells have street ink
within one art pixel of the same view, no doubled lines (the missing few percent are the dotted graticule and the
route's different dash phase); the other way round (street to globe) 77 to 96 %, the rest being street-only detail.
The route stroke was made 2 art pixels with the globe's 7 px dash period so its weight survives the handover.

**Overlay**: markers and labels are one behaviour. The street map's overlay uses the globe's look when embedded
(`OverlayLook "globe"`: same marker sizes and ring, same type, same box and pixel-label drawing (`engine/box-scene.ts`, `pixel-labels.ts`), same
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

**Framing: the bounding box.** A place with a published `bbox` (`[west, south, east, north]`, the true extent of the city or area
it sits in) is framed on that box, and the camera CENTRES ON THE CENTRE OF THE BOX, not on the recorded GPS point (which can
sit anywhere in the city). `placeFraming(place)` (`engine/framing.ts`, pure) returns the centre and the radius to fit: the
centre of the box (the plain mean of its longitudes and latitudes; boxes crossing the antimeridian are not supported and
are rejected as invalid) and `bboxFitRadiusKm` (the box's larger half extent, so the whole box is on screen with the 25 %
margin, fed to the formula below unchanged). Every camera move to a place takes its centre and zoom from it: the selection
flight, the direct-load fit view (`routes/shell.tsx`, `handover/controller.ts`), the retreat and the reduced-motion jump, the
street map's coverage test (`covers`) and the latitude correction of the street zoom. `lib/projection.ts` also hands the same
radius to the globe as the place's `viewRadiusKm`. The marker, its label and the routes stay on the recorded point
(`GlobePlace.lat` / `lon`); only the camera moves to the box. Without a (valid) `bbox`, `placeFraming` returns the point and
its view radius, and the next paragraph applies, as before.

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
happens when the street map is ready (never a flight, never a blank). A saved view (mobile remount) wins over the fit view. With the panel open (`insetRight`), both renderers use the same shifted centre; the selected place's
bounding box (its framing centre; the point when it has no box) lands in the middle of the free left half. Mobile: the slide-over unmounts the globe, so there is no flight with the panel open
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
mid-dissolve and street scale; the follow debounce is a timer, not a frame loop). The one exception is the world view after 8 s without input: the idle rotation ("Idle rotation" below), off in every debug page. **Phones**: art pixel 2 CSS px
(both renderers use the globe's rule); the street map renders at native art resolution by default (`renderScale` 3);
`highResolution` is the device-resolution path (see docs/street-architecture.md).

**Accessibility**: unchanged. All overlays and canvases are `aria-hidden` and inert (the street root is `inert`
while it is not visible); the one exception is the map credits button, a sibling of those layers (not inside an
`aria-hidden` subtree) that is always focusable, and the places list is the keyboard path to
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

- The street map is created at unified zoom 2.6 (`mountZoom`, or at the click of a place) and released 2.5 s after the camera leaves its range. While the globe is the shown renderer the map is **inactive** (`StreetMap.setActive(false)`): tiles keep loading, but there is no canvas copy, no pass and no overlay work, and the camera is only pushed to it once the camera rests (140 ms debounce). From the cut it is pushed on every tick, snapped to the art-cell grid (`street/core/snap.ts`) while the zoom is steady.
- The street map renders at native art resolution (3 map pixels per cell per axis), like the globe. `highResolution` follows `HANDOVER.revealFocus` (off).
- The street chunk is fetched and evaluated in an idle period 2.5 s after the globe is up (not on data-saver/2g connections), so the first flight or zoom does not pay for it.
- `engine/governor.ts` watches what frames COST while the camera moves and lowers the quality on a device that cannot keep up (street render scale 3 to 2, then a larger art pixel), with hysteresis; it recovers (see `docs/performance.md`, "Adaptive frame-budget governor"), logs every change (`console.info`) and keeps them in `history`; `__handoverDebug.quality()` / `forceQuality()`. The art pixel size is otherwise a function of the viewport only: `TUNING.pixelSize(minSide, dpr)` (test `engine/tuning.test.ts`).

### Behaviour notes

- There are no dot markers any more: every place and group is a RECTANGLE on the pixel overlay ("Detection boxes"). A
  rectangle is shown or hidden as a whole, from its place's centre only (see "Marker clipping fix" below, which still
  describes the rule); picking and labels use the same answer, so a hidden place can be neither seen nor clicked.
- Routes: only the lines in the `routes` prop are drawn, as great-circle arcs lifted above the surface through
  the route's ordered points, and ONLY the routes that have the SELECTED place as one of their stops
  (`routesForPlace`, engine/geometry.ts; the stop is matched by coordinates, the seam type has no slugs on routes):
  none on the world view, none while nothing is selected, in the globe and the street map alike. The shown route plays
  the 2.2 s draw-on once when motion is allowed; under reduced motion it is complete and static. Its stops are drawn
  even inside a closed group (`LodTree.setExtraForced`). Hidden lines are not rendered at all (`RouteLayer.show`).
- Borders: ON from internal zoom 3.25 (a hysteresis of 0.05 each side), off below; the fade between is a timed TONE ramp (the faintest palette
  level stepping up to full ink over 200 ms, and the same backwards), never a dither and never a grey at rest (`TUNING.borderZoom`,
  `engine/palette.ts bordersWanted / borderLevel`, `GlobeScene.syncCamera`; "Binary visibility" below).
- Labels: drawn on the pixel overlay canvas (`aria-hidden`, no tab stops: a visual duplicate of the places list, extra tab
  stops would only repeat it), see "Detection boxes". The canvas is `pointer-events: none`; the canvas pointer handler
  hit-tests the targets of the drawn nodes (`BoxScene.hit`: the convex hull of a box and its label plus slop, "Targets and labels"),
  so a drag that starts on a label or a box still rotates, and a click or tap on one selects (a place) or flies to frame it (a group).
- Input: drag (inertia stops cleanly; none under reduced motion; none after a pinch), wheel and trackpad pinch,
  two-finger pinch, tap/click. `touch-action: none` is set on the canvas only; the container, the places list and the
  panel keep default touch behaviour. There is no keyboard handling on purpose (the canvas is not focusable).
- Debug introspection: `window.__globeDebug` exists only with `?globe-debug` in the URL or
  `sessionStorage["globe-debug"] = "1"`; the browser checks use it.

### Idle rotation (2026-10-08)

When the globe is **fully unzoomed** and nobody has touched anything for **8 s** (`SPIN.idleMs`), the earth turns slowly **eastward** (its surface moves to the right, like the planet; the view's longitude decreases) at **1.2 degrees a second** (one turn in five minutes, `SPIN.degPerSec`). Code: the pure decisions in `engine/idle-spin.ts` (`spinBlock`, `yawStepDeg`, `spinFrameMs`, `IdleSpin`), wired in `engine/renderer.ts` (`stepSpin`, `armSpin`, `noteActivity`); tests `engine/idle-spin.test.ts`; browser check `scripts/globe/idle-spin.mjs`.

- **When it may run** (`spinBlock`, first reason wins): rotation not disabled (`?no-rotate`, below); no reduced motion; the tab visible; the GL context alive; the globe not suspended (the street map does not own the picture); no place selected; no place focused from the list; no inset (detail panel closed; the mobile slide-over unmounts the globe anyway); **zoom at most 0.15 levels above the whole-globe fit** (`SPIN.unzoomedSlack`: a wheel at the minimum lands exactly on the fit, the slack absorbs rounding; the fit zoom is per screen and per inset, 2.70 at 1440x900, so "unzoomed" means the whole globe in the window); no drag, pressed pointer, flight, inertia or inset slide.
- **The idle clock** restarts on any pointer down, move, up or cancel, wheel, touch start or key press anywhere on the window (passive capture listeners, `renderer.onInput`), on every camera change (`setView`, `flyTo`, a tick that advances a flight, inertia or the inset slide) and on every change of a condition above (selection, focus, inset, reduced motion, visibility, suspension, zoom limit, context loss and restore). Transitions of the boxes that the rotation itself causes are NOT activity.
- **Stopping is instant**: the input handler clears the turning flag and its timer in the same task, so the next tick moves nothing and no easing is involved; the view is exactly where the last frame left it. The next start is a full delay later. A pointer held down keeps it from starting; a hover highlight is dropped when it starts (the box would slide away from the pointer).
- **Cost, through the existing on-demand loop**: no rAF chain. A `setTimeout` wakes the loop for the idle delay (a timer is not a frame: rest stays at zero frames before it) and then once per `spinFrameMs` (the time the disc's centre takes to move one art pixel: 180 to 230 ms at 1440x900, bounded to 50 to 500 ms; about 4 to 5 frames a second including the 200 ms box transitions that the limb crossings start, against 60 for a running animation). Each frame is the normal one with the camera's longitude changed: the cut, the borders and the labels follow as for any camera move. The step is wall-clock based (`dt` capped at 1 s), so a throttled timer never jumps the globe. The frame governor sees these frames as non-continuous (cost = their own work) with gaps over 100 ms, which restart its window: it neither degrades nor is disturbed, and its level stays as it was.
- **Flags** (`applySpinFlags`, `?`-param or sessionStorage key): `no-rotate` switches it off on any page. Pages in debug mode (`?globe-debug`, which every browser check runs in) have it OFF by default, because the checks assert zero frames at rest for longer than 8 s; `rotate` turns it back on there, `spin-idle=MS` (100 to 600000, debug pages only) turns it on with a shorter delay. `__globeDebug.spin()` reports `{ spinning, blockedBy, timerArmed, idleMs, degPerSec, enabled }`.
- **The zero-frame idle checks** (`perf` idle, `groups.mjs idle`, `handover-perf.mjs idle`, `check.mjs` section 9) therefore run unchanged and still assert zero frames: they run in debug mode with the rotation off. `idle-spin.mjs` asserts the new behaviour with the delay shortened to 1.5 s: zero frames and zero rAF calls before the delay, an eastward turn at the configured speed in slow redraws after it, stops on a pointer move, a key, a wheel notch and a click, no start while a pointer is held, never with a place selected or focused, with the panel open (direct load), zoomed past the slack (and it turns inside it), under reduced motion (Chromium's emulation) or in a hidden tab, `?no-rotate`, and a tap on a phone viewport.

### Skybox (2026-10-08)

Owner: a skybox around the earth in the globe view, like Google Earth's Milky Way and stars, but pixel art and very faint. Code: the pure parts in `engine/sky.ts` (tests `sky.test.ts`), the Three.js objects in `engine/sky-layer.ts` (`SkyLayer`, owned by `GlobeScene`), the tuned numbers in `SKY` (`engine/tuning.ts`, table in [design-tokens.md](design-tokens.md), "Sky"), the renderer's `era`; browser check `scripts/globe/sky.mjs`.

**What it is.** A band (the Milky Way) and a star field, drawn in the globe's own drawing buffer, which IS the art grid, so every pixel is a cell and every tone a palette level: the band is a baked map looked up per pixel and quantised to the sky's two palette tones with a 4x4 Bayer dither anchored to the cell (the stipple of `pixel-line-rules.md` section 3.7: a function of the screen cell and the tone only, so it does not swim); the stars are single cells. No gradient exists anywhere. The band's two tones are palette levels 1 and 2 (`skyTop`: one below the graticule's `faint`, level 3), so the band is dimmer than the graticule in both themes: dark 20 and 31 on the page's 10 (graticule 43), light 240 and 227 on 251 (graticule 213). The stars have a third tone, the graticule's own level (`starTop`, `starTones`): the cap of the whole sky (2026-10-08, owner: the band looked like one gradient and the stars were too few and too even, 'not super bright, just a bit brighter'). Everything is deterministic (seeded noise lattice, seeded star list, integer hash, so the picture is the same on every machine and in every browser).

**Frames and what moves what** (`sky.ts` header, tested). The sky lives in the INERTIAL celestial equatorial frame: north up is celestial north, a point has a right ascension and a declination. The app's earth-fixed axes (`geo.ts`: lon 0 / lat 0 is +Z, lon 90 is +X, north +Y; one handedness for the whole app) are the same axes turned about the polar axis by the earth rotation angle (ERA, the GMST, the right ascension of the Greenwich meridian): a direction of right ascension `ra` has the earth-fixed longitude `ra - ERA`. The chain per pixel is view ray -> earth-fixed (`x east + y north + z c`, the view basis) -> inertial (longitude plus ERA) -> galactic (the Hipparcos matrix, published constants: the galactic pole at RA 192.86 / Dec +27.13, the centre toward RA 266.40 / Dec -28.94, the plane inclined 62.87 degrees to the earth's equator; all asserted in `sky.test.ts`) -> a lookup by galactic longitude and latitude. One 3x3 matrix per frame (`viewToGalactic`) does all of it. Sky handedness is not mirrored: behind the earth, right ascension grows toward the LEFT of the picture, as on a star chart (tested).
- A **camera orbit** (drag, inertia, flights, the places list) changes the view's longitude and latitude and leaves ERA alone: the camera moves through inertial space, the stars behind the earth turn on the screen with the view, as for an observer going round the planet. The ray through the middle of the picture points at RA `lon + ERA + 180`, Dec `-lat`.
- The **earth's own rotation** (the idle rotation, "Idle rotation" above) turns the earth under a camera that stays where it is: `stepSpin` takes the yaw off the view's longitude AND adds it to ERA, so the camera's inertial longitude (view + ERA) is constant and the sky does not move on the screen at all (checked: not one sky pixel differs across a 3.5 s rotation, `sky.mjs spin`). The stars are not dragged. The slow redraws of the rotation draw an identical sky.
- ERA starts at `SKY.eraDeg` (70), a constant: the sky is the same on every visit and in every screenshot, it is NOT the real sidereal time. At the opening view (lon 15, lat 28) the band crosses the wings of the globe on a slant. A saved view that comes back from the mobile slide-over remounts the globe with ERA at its constant again (the earth was unseen meanwhile); ERA is not part of `GlobeViewState`.
- Under a sky at infinity the camera's distance does not matter, only its orientation (no parallax): zooming changes how much of the sky the earth covers, never the stars' directions.

**Shape of the band** (`bandValue`, baked once into a 256 x 64 byte map over galactic longitude 0..360 and latitude +-45 degrees, about 16,000 noise evaluations, a few ms at start, memoised for remounts): brightness and thickness fall off from the galactic centre (brightest and thickest at l = 0, 5.5 degrees sigma at the anticentre against 10 at the centre), an extra nuclear bulge, the Great Rift (a thin wavy dust lane down the middle from l = -25 to 80), coarse 3-octave value noise for mottling and dust breaks, zero beyond the map. Stars: `SKY.stars.count` (20,000, about 430 to 510 in view at the whole-globe view on a desktop: the visible sky is a 56 x 37 degree window minus the earth) uniform directions (seeded, no grid: tested by the spread of nearest-neighbour distances) thinned by the same map so the density along the band is up to 1.8 times that away from it, each with one of three tones by a heavy-tailed share (`SKY.stars.tierShares`, 60 % level 1, 28 % level 2, 12 % level 3, the graticule's: many faint, some middling, a few brighter; `starTier`). One cell each: no 2-cell sparkles (the owner found them too much). The brightest real stars are NOT embedded: I could not cite or check a catalogue offline and a wrong constellation is worse than none.

**Dimming towards the earth.** The sky is drawn right up to the earth's silhouette and only DIMMED there (2026-10-08; it was removed inside 1.06 radii and faded in to 1.55, which the owner found read as masking out the background around the planet). `skyFade(rho)` is `SKY.fade.limb` (0.55) from the silhouette (`fade.from` = 1) and eases up to 1 at `fade.to` (1.55 radii from the centre of the disc, measured on the screen from the silhouette's circle `f / sqrt(d^2 - 1)`, `skyGeometry`), a smoothstep: the band's brightness is multiplied by it BEFORE the quantisation (so it dims through the dither, density falling away, and at the limb the band only reaches level 1) and a star is kept while the factor exceeds its fixed random rank (a thinning, never a dimmer star: 55 % of the field at the limb). The disc's pixels fail the depth test, so the sky ends exactly at the silhouette; the horizon outline (level 2, `outlineLevel`) is drawn over it and keeps its contrast because the band is level 1 and the rare stars thin out there. The projection centre of the inset (detail panel) is taken into account.

**Binary, timed, zero idle cost.** The layer is on while the farthest corner of the picture is more than `SKY.onRho.rho` (1.75) earth radii from the globe's centre, off when it comes within 1.70 (hysteresis; measured: at 1440 x 900 it goes off at internal zoom 3.14 (rho 1.7; 2.14 at the whole-globe fit), on a 390 x 844 phone at 2.07 (2.71 at the fit)), so the sky is gone before the street map takes over at 3.7 and a globe that fills the picture draws no sky. The on/off value runs by TIME (`FadeArray`, `FADE_MS`, same primitive and clock handling as the borders, instant under reduced motion): a resting frame is fully on (drawn) or fully off (not drawn, no draw call), never half; `GlobeScene.animating` keeps the frame loop alive until the transition ends. The sky adds no frame to an idle page: it is drawn only inside frames that happen anyway, and nothing in it is time-based but that switch (verified: `sky.mjs rest`, `groups.mjs idle at-rest` and `handover-perf.mjs idle` with `SKY=1`: zero rAF, zero frames, zero `gl.clear`). It disappears with the globe at the cut (the globe canvas is suspended and transparent while the street map shows).

**Cost** (docs/performance.md, "Skybox"). One full-buffer triangle with a short fragment shader (a matrix, an `atan` and an `asin`, one 8-bit texture fetch, a Bayer lookup) plus 20,000 one-pixel GL points, drawn after the earth's disc with the depth test on at the far plane: the pixels the disc covers fail the depth test before the shader runs, a globe that fills the picture hides the layer entirely, and a zoomed-out view pays for about 50 to 80 % of a buffer of 576 x 360 (desktop) or 195 x 422 (phone) pixels. Measured (GPU-synced `renderNow` + `readPixels`, 360 frames of a turning globe, ANGLE Metal on an M4, p50): 0.4 to 0.5 ms with and without the sky on desktop and 0.5 to 0.6 ms on the phone viewport, differences inside the noise of the timer (0.1 ms). Not measured on a real low-end phone. No cache texture is used: a cached sky would have to be redrawn on every orientation change, which is every frame in which the sky moves, and the direct pass is cheaper than the copy would be. Memory: a 16 KB texture and 20,000 x 5 floats (the star list grew from 7,000 on 2026-10-08; one-pixel points, the vertex work is the same few instructions, not re-measured).

**Flags** (`applySkyFlags`): `?no-sky` (or sessionStorage `no-sky` = 1) switches it off on any page; a page in debug mode (`?globe-debug`) has it OFF by default because the older checks assert palette-only pixels, nothing outside the boxes and markers (`markers.mjs` compares the whole buffer pixel for pixel), and `?sky` (or sessionStorage `sky` = 1) turns it on there. `SKY=1` runs any of the scripts with it on (`_lib.mjs`, `handover-lib.mjs`). `__globeDebug.sky()` reports `{ era, value, on, rhoMax, drawn, cx, cy, radius, fadeFrom }` (null when off), `setSkyEra(deg)` moves the sky against the earth.

**Checks** (`node apps/web/scripts/globe/sky.mjs [flags|rest|pixels|parity|spin|orbit|timed|reduced|mobile]`): flags; zero frames at rest; only the page colour and the sky's tones outside the globe (the band's two fainter than the graticule's level, the brightest stars AT it and nothing above), lit pixels all the way to the silhouette (no blank halo), the brightest tone the rarest, desktop dark and light and mobile; GPU equals the CPU twin pixel for pixel (16 of 125,037, 0 of 125,088, 2 of 125,106 band pixels differ at three views; 507/507, 450/450, 426/428 projected stars lit, 505, 446 and 426 of them in the tone of their tier (>= 95 % required); needs a dev server because it imports the engine's modules); no sky pixel moves during the idle rotation; an orbit changes the sky and going back restores it bit for bit; the timed switch (a ramp of several frames, a stopped loop, fully on or off at every settled zoom from the whole globe to the cut); reduced motion.

Not verified: Safari / iOS and any GPU but the M4's (the GLSL uses 3.00 ES features: array constants and integer vector bitwise `&`, which every WebGL2 implementation must support), a real phone's frame time, real reduced motion in a browser (Chromium's emulation only).

### Framing and cut checks (`scripts/globe/framing.mjs`)

`BASE_URL=http://localhost:5173 [SHOTS=1] node apps/web/scripts/globe/framing.mjs [reload|flight|cut|panel|reduced|mobile]`
These browser checks (this one and the street ones) look up the demo fixture's places by slug (`lisbon`, `paris`, ...): serve the app with `pnpm dev:demo`, not `pnpm dev` (which shows your preview or the empty published state).
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
panel open. `check.mjs` also covers the inset (direct load, animation vs
panel position, picking, close, reduced motion) and the ocean colour in both schemes. The scripts install their instrumentation before app code runs:
a rAF call counter, WebGL context created/lost counters and a counter on `gl.clear` (Three issues one per frame).

## Detection boxes and pixel text (2026-10-06)

Owner: the map should read like a classifier's output. EVERYTHING is a rectangle, there are no dot markers, and the text is
pixel type on the same grid as the map. Code: `app/globe/engine/{lod-tree,box-scene,pixel-labels,pixel-buffer,country-names,group-square,node-screen}.ts`
and `engine/pixel-font/`, shared by the Three.js globe and the street map's `overlay/hud-layer.ts` (one `BoxScene` class, so
both draw exactly the same thing on both sides of the handover).

**Geometry** (`LodTree`, pure, unit tested). A place is the bounding box of its extent. With a published `bbox` it is that
box (`GlobePlace.bbox`): the box's own width and height in km at the local scale of the unified camera, centred on the box's
centre, not on the recorded point (a city's rectangle is the whole city, wherever the entry's point is). Without one it is a
square around the point, half side `viewRadiusKm / 1.25` (12 km by default), so the box of a place the camera is framed on fits
the free area with the framing's 25 % margin. A group is the union of the TRUE boxes of the visible places below it. All are
axis aligned in screen space, hollow, one art pixel thick, snapped to whole cells (`snapBox`), at least `LOD.minBoxCells`
across on each axis.

**Box outline and colour by state** (2026-10-07, sized by the box 2026-10-08, anchored and coloured by state 2026-10-08; `drawBox`, `edgeLit`, `dashingFor`, `labelTones` in `engine/pixel-labels.ts`). The stroke is the line style, and only SELECTION changes it. At rest AND hovered or focused the four corners are full lines: each corner has a solid ARM along both of its edges and the rest of each edge is dashes, `BOX_STYLE.dashOn` 2 cells lit then a gap of dark cells; the selected box is ONE uninterrupted solid line. The width never changes (one cell in every state, no inner ring, the interior mask always starts one cell inside the outline). **Dash origin** (owner: the dashes slid in from the middle of an edge while the box resized, because the pattern was symmetric): each edge counts its pattern from ONE corner, the top edge from its left corner, the bottom edge from its right corner, the left edge from its top and the right edge from its bottom (`edgeLit(i, n, ..)` counts from cell 0; `drawBox` mirrors the index of the bottom and right edges). So the box is rotationally symmetric (half a turn gives the same picture), the arm at the far end is the only thing that follows the end of an edge, and resizing a box by 1..N cells changes only the far end of each edge (tests: `pixel-labels.test.ts`, including a drawn box grown from each of its four sides). The arm and the gap still scale with the box's on-screen size, by its smaller side in cells (so the four corners match): arm 10 % of it between 3 and 14 cells, gap 3.5 % between 2 and 9; they are whole numbers, so a box that grows across one of those steps re-lays its dashes once (a handful of times over the whole size range) and not at any other moment. An edge too short to hold two arms and one gap (7 cells and under) is a plain solid outline: the arms never overflow or overlap. **Colour is the state, as a palette LEVEL (never opacity)**: at rest the outline is the palette's `peak` level (the loudest map tone: 5.2:1 light, 5.5:1 dark against the page, so a box is at least as visible as a coastline and 3:1 for a graphical object by a margin), hovered or focused it is the full ink (`ink`, 19:1 / 18:1), selected it is the ink and the solid line. The label follows the box (next paragraph). Same code in the globe and the street overlay (one `BoxScene`). The line-grid rules of `docs/pixel-line-rules.md` hold: whole cells, one cell thick, palette levels at the node's opacity, the dashes are cells that are simply not written. Tests: `pixel-labels.test.ts` (geometry at sizes 1 to 1000, rotational symmetry, anchoring, monotonic growth, limits, tiny boxes, the colour of every state).
**Minimum size and mask.** A box smaller than `LOD.minBoxCells` (9 cells, 22.5 CSS px at 2.5 px; was 14, the owner found it too big) is drawn at that size, outlined, with its interior MASKED in the page colour (the colour of the ocean and the background: black in the dark theme, white in the light one, never a grey), so the small area reads as an outlined area that is empty and the fill does not catch the eye. As its true side grows from 1x to 1.6x the minimum (`fillFadeFrom/To`) the mask is SWITCHED OFF (a binary state with a hysteresis band, `fillHyst`; the way out is a timed 200 ms opacity transition, "Binary visibility"), and only the outline stays, so you can see through it (`LodTree.fillAlpha`). A box bigger than 2.2x the smaller free side is hidden (shown again below 1.6x: you are inside it), also a timed transition with a hysteresis. Reduced motion: the same states, switched instantly.

**Fades are opacity, state is colour.** A node that is fully visible draws at opacity 1 in both themes; its colour is its state (above), so the map beneath, a recessive grey, is never dimmed by a box and a resting box is never a half-transparent grey. A fade is NEVER a darker or lighter shade of grey: shades have a visible minimum that occludes the map right after a node appears and right before it goes, which breaks the fade. Everything a node draws (outline, interior mask, label plate, text) is composited at the node's alpha (`LodTree.alpha`, the node's own timed opacity, never a function of the camera or of its parent, quantised to 1/64 for drawing) over what is underneath, per art cell: `PixelBuffer` holds straight-alpha RGBA per cell and does the "over" blend, the canvas composites it over the map. The art-pixel grid is untouched (no sub-pixel position, no smoothing). Fades are driven by TIME ("Binary visibility"), and the on-demand frame loop runs until the last one has ended (idle = zero rAF); under reduced motion they are switches. The hovered, focused or selected box is drawn on top, in the ink, at full opacity; it is never thicker than another box.
**The cut** (declutter, not a hierarchy overlay). The published group tree is the cluster tree and a dynamic, screen-space cut decides which nodes are WANTED drawn: only places that pass the visibility rule (front hemisphere, clear of the limb) count; a group is shown as ONE box until two of its most important children can be drawn, each as the box and the label it would be drawn with, clear of every other box and label, and then it is REPLACED by the children that fit (never drawn together with them: "Opening a group into its most important children" below); the size rule still opens it, with all its children, when its box covers `LOD.boxMaxTo` (0.6) of the screen, and every group is open from street scale. It closes again with an easier test and a zoom hysteresis, so a camera jittering around a threshold cannot flap. The decision is BINARY (a node is wanted or not): the cross-fade between a group and its places is two timed transitions that start together over the same 200 ms, their opacities summing to exactly 1 on the way (a smoothstep of a linear progress), whatever the camera does. A lone place is its own rectangle at every zoom, a country with two distant places shows two rectangles, ten places 50 km apart are one box ("10 places") until two of them fit, continents and subregions only appear on crowded views. A node's opacity never depends on its parent's: a node with no drawn ancestor is at full opacity ("Binary visibility"). Reduced motion: no transition, the same decisions. Cost: one projection of every place plus the trials of the groups whose box can hold two boxes and is near the screen (193 nodes of the preview 24 us, 1,000 nodes 35 us, 5,000 nodes 200 us per evaluation on the synthetic hierarchy, the size rule alone 22 / 31 / 182 us; the retargeting pass is one more loop over the nodes); cached until the camera, the forced nodes or the theme change; idle map = zero frames and zero canvas draws.

**Labels** (2026-10-08: moved off the pixel grid, see "Labels in device pixels" below; the boxes stay pixel art). A label is HTML text in the app's monospace stack on a PLATE of the page colour with a feathered edge, two lines: the NAME (14 px, weight 500) and a smaller SECOND LINE (11 px, regular): for a place its country (always, when known: `Intl.DisplayNames(["en"], {type: "region"})` of the place's `countryCode`; a missing or unknown code adds nothing, silently) followed by its linked entries split by kind with zero kinds omitted ("France · 2 articles · 1 artwork · 3 software"), for a group "<N> places" followed by the entries below it ("12 places · 2 articles"). Nothing is invented: today no entry is linked in the owner's preview, so the line is the country or "N places". Its place is one of 18 candidates around the box with 3 px of clear room (`LABEL_TYPE.boxGap`) between the label and the box's outline and the plate's left edge ON the box's outer left edge (the text starts 6 px inside it). Places and groups look identical (same colours, same states). The pixel-art label of the earlier versions (Fusion Pixel on the art grid, `LABEL_PAD`, `TEXT_GAP`, the level tones) is described under "Pixel text" below and kept in the code for text that IS part of the map.
**Label colour** (`.map-label`, `.map-halo` in `app.css`, 2026-10-08; replaces the levels of the pixel label): the name is the page's `--foreground` (19:1 / 18:1 against the page), the second line the `--muted-foreground` (6.8:1 light, 7.9:1 dark on the plate: AA at 11 px), never an opacity. EVERY label has a plate of the page colour, resting, hovered or selected, with a feathered edge (below), so it reads over coastlines, borders and the graticule in both schemes. Hovered or focused: the label does not change at all (no underline, no plate change: the box's own colour logic, the ink, is what shows; only its stacking order rises); selected: INVERTED, the foreground as the plate and the page colour as the text (second line the page colour mixed 28 % toward the foreground, 10:1 light / 7.9:1 dark), no feather (high contrast already), the box in the ink with its solid line. A label drawn over another because nothing was free is on top on its plate. `readability.test.ts` pins the colours from `app.css` (plate in every state, no underline, no text-shadow, no opacity, the contrast of both lines in both schemes).
A place opens its page, a group flies to frame it; which labels are drawn and what is clickable is "Targets and labels" below. The places list (`PlacesNav`) stays the dependable keyboard path and nests the places under their groups as headings.

**Targets and labels** (`engine/label-plan.ts`, `engine/label-track.ts`, `engine/hit-area.ts`, tests `label-plan.test.ts`, `label-track.test.ts`, `hit-area.test.ts`, check `scripts/globe/groups.mjs targets` and `flicker`). The rule, in one sentence: EVERY box that is drawn is clickable and EVERY box that is drawn shows its label (owner, 2026-10-08: a box without a name, or a dimmed one, is a UX failure). There is no label that loses a collision and no dimmed box (`LOD.unlabelledAlpha`, the `dim` and `label` timed values and `labelHold` are gone).
- Placement (`planLabels`, pure, deterministic, in CSS px since 2026-10-08: `PX_UNITS`). Nodes are placed in priority order: a selected node first (its score is boosted), then the score (priority, places before groups), then the bigger box, then the slug, so the order of the input never matters. For each node, widest label first, the FIRST of its candidate positions whose plate collides with no plate already placed (`clearance` 4 px) wins; among the positions of one wording, one that also keeps clear of the BOXES of the other nodes near it (`PlanItem.avoid`, `boxesToAvoid`, 3 px wider) comes first, and one that touches a box is still taken before the label is shortened or goes over another plate. Candidates (`labelCandidates` / `spotAt` in `pixel-labels.ts`, unit-free, priority order, each entirely on the screen, ids in `SPOT` are stable): above-left (the first choice), above-right, above the visible part of the top edge when a corner is off screen, nested inside the box in each inner corner (only when the plate fits inside the box; `inset` = the outline plus 3 px), below-left, below-right, left of the box, right of the box, and shifted along the top and the bottom edges at a quarter, a half and three quarters. Outside positions keep `boxGap` (3 px) of clear room to the box and the plate's edge is the box's edge (`bleed` 0; the text starts 6 px inside it). A box bigger than the screen is positioned against its VISIBLE part, so its label is on screen. If no position is free the label is SHORTENED and every position tried again (`labelVariants` in `label-text.ts`: the whole two-line label, without its entries, without its country / number of places, then the name truncated one character at a time with an ellipsis `…`, narrower each time, down to `MIN_LABEL_CHARS` = 6 characters including the ellipsis, never fewer; a name of six characters or less is never truncated; widths are measured with the real font, so a monospace's wide letters shorten sooner than the pixel font did). If even the shortest is free nowhere, it is the LAST RESORT: the label is drawn ANYWAY, on top, on a page-colour plate (`data-over`), at the position, among all the candidates and the displacements of the first one in steps of 6 px, that overlaps the placed plates least (then the smallest displacement). Hover, focus and selection are NOT inputs of the plan (below).
- Stable (no flicker, no hopping, binary and timed as in "Binary visibility": a label is on with its node and has no fade of its own, its CSS opacity follows the node's). A label has a SLOT (candidate id and way of writing, kept in `SlotMemory`, shared by the globe's and the street overlay's scenes so a handover keeps the labels where they were) and the plate is put at its slot's place around the box's CURRENT rectangle every frame (`spotAt`, O(1), no collision test): while the camera moves labels cannot hop. The plan runs again for ALL labels once the camera has SETTLED (no box rectangle changed for `TRACK.settleMs` 160 ms; a timer, because an idle map draws no frames) and, as a safety, once per `TRACK.maxFrozenMs` (3 s) of an endless motion; that plan is sticky (a choice that is still free is kept, and is given up for a better one only when that one is free with `upgradeMargin` 10 px of room) and the labels it moves GLIDE to their new place (`data-glide`, a 150 ms transform transition; none for reduced motion, which also gets the global 0.01 ms rule). A node that appears is labelled AT ONCE in the free places left by the labels that stay (no other label moves); a slot that becomes impossible (it would leave the screen, a nested label no longer fits) is replaced at once; at the left and right edges of the screen a plate slides along its box instead of changing slot. A shortened label becomes whole again at the next plan that has room (hysteresis `upgradeMargin`). A node that is fading out keeps the slot it had and goes with its node.
- Targets. A node's target is the CONVEX HULL of its box and its label plate (wherever the plate went), grown by `HIT.slop` (4 px mouse, 14 px touch, so a touch target is at least about 44 px across even for a minimum box): the box including its interior, the label, and the gap between them (the 3 px of clear room are inside the hull) (when a label is wider than its box the hull fills the triangle under the label's right end down to the box's bottom corner; a nested label is inside the box). Hover over the whole target shows the pointer cursor and the hover state (the box in the ink with the same dashes; the label does not change); a click selects. A BIG box (wider or taller than `HIT.bigBoxFrac` = 0.45 of the map's smaller side, where a group opens anyway) is an outline you are inside, not an object: its interior is not a target, only its border band (6 px mouse, 12 px touch) and its label.
- Overlaps. Of the targets that contain the point the SMALLEST (by box area) wins, so a group never steals a click on a place inside it; when none contains it, the NEAREST within the slop wins, then the smallest, then the highest priority, then the slug (so the order of the nodes never matters). A node below `LOD.pickAlphaMin` (0.3) is not a target, and one on its way OUT (the cut no longer wants it) only while it is at least `LOD.pickFadingMin` (0.5) opaque (`pickAlpha`), so a group that cross-fades into its children never takes a click that belongs to a child.
- Regression. `label-plan.test.ts` (every item gets a plate in a crowd, priority order and its independence of the input order, nesting, shortening, the last resort, hysteresis in both directions, determinism), `label-track.test.ts` (slots follow the box, the plan runs once at rest and on the safety interval, new boxes in the gaps, impossible slots, shared memory, and the flicker sweep below), `label-text.test.ts`, `label-dom.test.ts`, `pixel-labels.test.ts` (the candidates, the pixel text's variants, spacing and tones), `hit-area.test.ts` (hull, gap triangle, slop, nesting, big boxes, order independence) and, in a browser, `groups.mjs targets`, `at-rest` and `flicker`: over 288 views (the world, continents, Europe, the Balkans, a city cluster, and a sweep of lon / lat / zoom) 100 % of the drawn boxes have a label that is a real element in the DOM with the planned text and place, fully opaque, none is half-faded, no two plates overlap unless one is the last resort, and hovering the box, the label and the gap shows the pointer and the hover state. On the owner's preview: 701 boxes, 7 labels shortened, 6 drawn over another as the last resort, 38 nested. Root cause of the earlier Houston / New York bug (a priority floor withheld names) and its negative control are in the 2026-10-08 history of this section: the floor is gone for good.
**Pixel text (kept, but no longer used for the box labels).** The box LABELS left the pixel grid on 2026-10-08 ("Labels in device pixels" below); `PixelBuffer`, `PixelOverlay`, `pixel-font/`, `drawLabel`, `labelLayout`, `labelVariants` and the level tones of `pixel-labels.ts` stay, with their tests, for text that is part of the map itself (route labels, later). The boxes are still drawn with this pipeline. `PixelBuffer` is a level image whose cells are the art pixels; `PixelOverlay` shows it on a `cols x rows`
canvas upscaled with `image-rendering: pixelated`. Boxes, plates and glyphs are written into it at whole-cell positions, one
cell thick, as a palette level and an opacity: no sub-pixel position, no anti-aliasing grey. The canvas is only touched when the
set of boxes and labels, their cells or their tones changed (frame signature), and only the changed region is uploaded.
- Font: **Fusion Pixel 10px Proportional** (TakWolf, github.com/TakWolf/fusion-pixel-font, version 2024.05.12, SIL Open Font License 1.1 with the Reserved Font Name 'Fusion Pixel', from `@fontsource/fusion-pixel-10px-proportional-sc`, a pinned dev dependency; licence text in `engine/pixel-font/OFL.txt`, no attribution needed at runtime; the baked table does not use the reserved name). Owner (2026-10-08): the Tiny5 type, stretched taller, read as condensed and was not suited to this kind of text. It is drawn natively on a 10 px em with 7 rows for a capital, 5 for a lowercase letter, 2 below the baseline, 1-cell stems, and it is proportional (a letter advances its width plus one cell: 5 for most lowercase, 6 for a capital), so "London, United Kingdom" is 109 cells (272 CSS px at 2.5 px) wide and nothing is stretched: `stretch.ts` is gone. `scripts/font/bake-pixel-font.mjs` (`pnpm --filter @catalyst/web bake:font`, reproducible: the same file gives the same table) rasterises the outlines at the pixel centres (100 font units per pixel) for Latin, Greek, Cyrillic, punctuation and currency ranges into `pixel-font/pixel-font-data.ts` (460 glyphs, 14 KB; the baked bitmaps are a derivative of the font and fall under the same OFL, kept with `OFL.txt`). The package ships the whole CJK font (928 KB) as a single file, which cannot be subset without making a Modified Version that may not carry the Reserved Font Name, so the font itself is a lockfile-pinned dev dependency, as Tiny5 was, and not vendored; the licence text is vendored.
  Candidates rendered on the real label pipeline (box, plate, name and counter, light and dark: `font-candidates-light.png` / `-dark.png`, kept out of the repo): Tiny5 as it was (5 rows stretched to 7, bold name: condensed), **Fusion Pixel 10px** (chosen: 7 / 5 rows, light 1-cell stems, proportional, real lowercase, accents drawn on the grid), Fusion Pixel 12px (9 / 6 rows: the same design, 29 % taller and wider than the art grid wants), Pixelify Sans (OFL; designed on a half-pixel grid, so at the art resolution its accents collapse to one dot and several letters lose their shape), Jersey 10 (OFL; 10-row capitals, heavy and tall: the bold the owner removed), Press Start 2P (OFL with a Reserved Font Name; 8-cell monospace, about twice as wide), Silkscreen (OFL; capitals only, 5 rows) and DotGothic16 (OFL; 13 rows, thin and tall, 7 wide). Fusion Pixel's limits: it has about half of Latin Extended-A (see the next bullets) and Greek and Cyrillic only in their basic ranges.
- One weight. There is no bold: the derived double strike (`emboldened`, `glyphWeight`) and the `bold` flags of `measureText`, `forEachInk` and `PixelBuffer.text` are removed. The hierarchy between a name and its counter is colour (above), not weight.
- Coverage (`pixel-font.ts`): the font's own glyphs (Latin-1, the Latin Extended-A letters Ă ć č ě ğ ń ž ..., Greek and Cyrillic letters, the dashes, apostrophes and the ellipsis; é è ê ç ã ñ ï ü ö ô ø å and their capitals are all its own). What it lacks is COMPOSED here from its own glyphs, in its style, with a donor letter per mark: the caron of š ř ž (cut out of č), acute, ring, circumflex and breve for any letter, the cedilla and comma below of ş ș ţ ț (cut out of ç), the ogonek of ą ę, the double acute of ő ű, the dotless ı and the dotted İ, the strokes of ł Ł, the apostrophe-like caron of ď ť ľ, the ligatures œ Œ ĳ Ĳ, the Ukrainian letters that are look-alikes or mirrors (і ї є Ґ ...) and Vietnamese letters (Huế, Hà Nội: base letter, horn and tone marks, stacked above the circumflex or breve). Missing glyphs after that (Arabic, CJK, the rest of Latin Extended-B and Greek extended, Serbian Cyrillic ђ ћ ...) fall back to the system font rasterised at 8 px and thresholded at 50 % at art resolution, no grey, uneven strokes: documented, rare in place names. On the owner's preview this affects only the Arabic names; every other letter of its 193 names is the font's own or composed (tests: `pixel-font.test.ts`, 36 names).
**Art pixel size** (`ART_PIXEL` in `engine/tuning.ts`, the ONE constant the globe, the street map, the pixel text and the
frame governor read; the street pass takes it through `STREET_TUNING.pixelSize`). Owner: "a little higher resolution, the pixel
effect a little less visible". 3 CSS px (6 device px at DPR 2) became **2.5 px** on desktop (5 device px at DPR 2, 2 px at DPR 1
because ties go down, never coarser) and stays 2 px on phones; `pixelSize()` always rounds to whole device pixels, so
nearest-neighbour scaling never shimmers (DPR 1.25, 1.5, 2.625 get the nearest whole device size). One line to change it;
`?globe-debug&art-px=3` overrides it for comparisons. `docs/screenshots/resolution-comparison.png` compares 3, 2.5 and 2 px on
the demo (map and text): 2 px reads almost smooth and makes the type small; 2.5 px keeps the character and the text is clearer
than at 3. GPU-synced globe frame on an M4, p50 over 60 frames: 0.6 / 0.7 to 1.3 / 0.8 to 1.1 ms for 3 / 2.5 / 2 px, all noise at this
level; `pnpm --filter @catalyst/web perf` passes every frame-time budget at 2.5 px (see `docs/performance.md`). The street pass
internals (line gate thresholds, crawl budget) belong to the street style: after the change `perf` reports
`desktop crawl(snapped) changedShare 0.35 > 0.35` (the budget sits exactly on the value) and nothing else.

**Far-zoom border flicker (investigated).** At far zoom the Alaska / Canada border flickered and the middle of the USA / Canada
border was missing, and it came back when zooming in. Cause: a GL line is a straight chord through the globe and the occluder disc
is 0.002 under the surface, so any border segment longer than about 7 degrees sank into the disc in its middle; the globe's border
data had 10 to 40 degree segments (the 49th parallel is one straight segment), and which pixels survived changed with the camera:
flicker. It is a DATASET cause first (fixed in `packages/geodata`, whose borders now have no segment over 4 degrees), and the
engine now also cuts every segment into pieces of at most 1 degree (`engine/geometry.ts MAX_CHORD_DEG`, tested in
`geometry.test.ts`), so it no longer depends on the data. `scripts/globe/borders.mjs` samples the 49 N border (122.5 W to
97 W) and the 141 W meridian over 96 views per theme and size and over 60-frame drags, and requires a pixel at every sample and no
blink; on the current dataset it passes with and without the engine cut (the data no longer has long chords), so
the unit tests are the regression guard for the engine part.

### Binary visibility, timed transitions (2026-10-08)

Owner: appearance and disappearance of boxes, labels and other map content was driven continuously by the camera, so a camera that came to rest between two states left labels half transparent and greyish. The rule now, everywhere in the map:

1. **A thing is on or off.** The camera only decides a TARGET, from the camera with a HYSTERESIS band wherever a threshold exists (no flicker when the camera jitters around it).
2. **Its opacity runs to the target by TIME** (`engine/fade.ts`: `FADE_MS` 200 ms, a smoothstep of a linear progress, so two things that swap and start together sum to exactly 1 on the way), whatever the camera does. A reversal turns around from where the value is. A pause (a hidden tab) counts as one frame, not as the whole transition.
3. **The resting frame is always fully on or fully off.** The on-demand frame loop keeps running until every transition has ended (`LodTree.animating`, `GlobeScene.animating`; the street engine asks MapLibre for repaints while `HudLayer.animating`), then stops: idle is still zero frames. While the street map owns the view the globe's loop does not spin on transitions it cannot advance.
4. **Reduced motion** is an instant switch (`step(.., instant)`), the same decisions.
5. **Geometry is not faded.** A place that crosses the globe's limb, or a group left without a visible place, vanishes at once (a fading box would be drawn mirrored behind the globe); positions and sizes follow the camera continuously.
6. **A node's opacity never depends on its parent's, and a group and the children it opens into are one cross-fade.** A node with no drawn ancestor is at full opacity (London under an open Europe); a group that is opening does not count as an ancestor of the places replacing it. No node is ever drawn together with a drawn ancestor at rest, with no exemption (a place that is selected or is a stop of a shown route opens the groups above it: `LodTree.mustOpen`). A group and its children are retargeted in the same `update`, so they start together and run on one clock, one duration and one ease: the group goes 1 -> 0 exactly as its children go 0 -> 1, the opacity of a group plus that of any child below it is at most 1 all along (a smoothstep of a linear progress; a child that starts later only lags), and a reversal keeps the pair in step. The labels follow: a label has no fade of its own and no CSS opacity transition, the box, its mask and its label are all drawn at the node's own `alpha`, whatever is hovered or selected.

Per node the tree keeps two timed values (`LodTree.life`, `mask`): the node itself and its interior mask (both set by the cut). A label is on with its node and has no transition of its own (the former `label` and `dim` values and the `born` flag went with the rule that dropped and dimmed labels: every drawn box has its label). Hysteresis values: group open/close the gap to every other box and label `LOD.open.gapPx` 8 / 3 and the zoom `stickyZoom` 0.4 (and the size rule's `boxMaxFrom/To` 0.45 / 0.6), box hidden for being bigger than the screen `sizeFadeTo` 2.2 / back `sizeFadeFrom` 1.6, mask off at 1.6x the minimum / on again at `fillHyst` (0.3 / 0.7 of its smoothstep), label position and wording kept with `UPGRADE_MARGIN` 2 cells of room, borders `TUNING.borderZoom` 3.25 +- 0.05, street layers 0.05 zoom each side (`street/style/layer-switch.ts`). Tests: `fade.test.ts` (every property of the primitive), `lod-tree.test.ts` ("timed transitions": opening over the fade time, a camera that stops mid-way still ends resolved, frame-length independence, reversal, pause, idle), `open.test.ts` ("the cross-fade": the sum of a group and of a node below it never exceeds 1, over a scripted opening, a reversal and random camera paths with random frame times, on a synthetic and on the real tree), `label-plan.test.ts` (the label hysteresis), `layer-switch.test.ts`, `flatness.test.ts`, `palette.test.ts`. Browser: `groups.mjs timed` (a camera that opens a crowd and stops: 12 frames mid-transition, done at 204 ms, the last frame resolved and the loop stopped) and `groups.mjs at-rest` (wheel bursts with momentum, flings, every threshold of four paths landed on from both sides, the borders' threshold: every box, mask, label and layer fully on or off, nothing dimmed, no frame pending), `street/lod-check.mjs` for the street map.

**Sea texture and graticule: the flatness of the view.** The street map is a MapLibre globe up to its zoom 12, so the earth is visibly curved for a long stretch of the street map's zoom range (the street map takes over from the Three.js globe at the cut, internal zoom 3.7). The sea texture (dashes in rows, anchored to the screen) used to ease in from map zoom 5.2 while the graticule eased out between 6.5 and 9.5: both showed together on a curved earth, a weird flat look. Now the graticule (parallels and meridians) is on while the earth is curved and the sea texture takes over once the view is close to flat, one binary swap that the street map's temporal ease cross-fades by time. "Close to flat" is a measure on the screen, not a bare zoom: the BULGE, `(h/2)^2 / (2R)` CSS px, the height by which the surface falls away at the top or bottom edge of a view `h` px high (R the apparent radius of the globe at the unified zoom). The view is flat at a bulge of 4 px or less (`FLAT.flatPx`), curved again at 6 px or more (`curvedPx`, the hysteresis): unified zoom 8.28 on a 900 px tall view (the latitude cancels in the unified zoom: map zoom 8.28 at the equator, 7.78 at 45 degrees), 8.1 on a 844 px phone, 9.6 on a 1400 px screen. `street/core/flatness.ts`, `layer-switch.ts`; the sea texture is further held back to `handoff + 0.7` for a tile source that only covers a place.

**Inventory of every continuous function of the camera that controls opacity, width, tone or visibility of map content, and what was decided** (2026-10-08):

| Where | Was | Decision |
| --- | --- | --- |
| Detection boxes: group to places (`lod-tree.ts`) | opacity a smoothstep of the camera ("openness"), partition of unity | binary cut with hysteresis, timed 200 ms swap (sum 1 on the way) |
| Box bigger than the screen | opacity fade between 1.6x and 2.2x | binary with hysteresis (hidden at 2.2x, back below 1.6x), timed |
| Interior mask of a minimum box | opacity fade between 1x and 1.6x the minimum | binary with hysteresis, timed |
| Labels (`box-scene.ts`, `label-plan.ts`) | label alpha followed the node's, dim applied to every collision loser | no dim and no label transition: every drawn box has its label (candidate positions, a shorter label, then drawn on top), kept between frames with a margin (hysteresis in cells) |
| Globe country borders (`scene.ts`) | grey level a staircase over zoom 3.0 to 3.5 | on/off at 3.25 +- 0.05, tone ramp run by time |
| Street road, river, lake, border classes (`street/style/lod.ts`) | tone a staircase over a zoom range (12 classes, up to 4 zoom levels long) | binary layer switch at `on` with hysteresis, the ease fades the cells by time |
| Street fills: parks, green, buildings | tone ramps | the same |
| Street sea texture | tone ramp from map zoom 5.2 to 10 | binary, by the flatness of the view |
| Street graticule | tone ramp out between 6.5 and 9.5 | binary, on while curved, off when flat |
| Tile arrival and departure (`street/core/ease.ts`) | already timed: a level per 24 ms, run to the end by the settle loop | kept; verified to converge (`lod-check.mjs`, `tile-fade.mjs`, `cut-fade.mjs`) |
| Globe to street cut and back (`handover/`) | cross-fade of 300 ms by time, hysteresis 3.7 / 3.45 | kept (already binary and timed) |
| Overlay owner switch, reload fade, panel inset | CSS transitions or time-based tweens | kept (time) |
| Line widths along their ramps, the 1 to 2 px step of main roads at z9, hollow roads from z16 | continuous in zoom | legitimately continuous: geometry. The z9 step is within 0.01 of zoom (a width, never an intermediate one) |
| Sea outline and country borders: world lines to tile lines at the hand-over zoom | a hard switch between two data sources | kept: binary, cross-faded by the ease |
| World placeholder lines while tiles load | binary on `areTilesLoaded()` | kept |
| Lift of route arcs on the globe (`routeLift`), route draw-on (2.2 s) | geometry, and a time-based animation | kept |

Fixed on the way: (a) the first version of the street layer switch set `layout.visibility` on EVERY tile layer from the switch's `on` set, so the always-on layers (coast, country borders, the erasing interiors of hollow roads) were hidden: from space only the graticule, the outline and the boxes were left, layers came back one by one while zooming in, and at street scale every big road was a solid band with no hierarchy. Only the switched layers (`switched(spec)`) take the state now; regression tests in `lod.test.ts` and, on the real app, `scripts/street/lod-check.mjs` (always-on layers visible, map never empty, along the whole path). (b) While the street map owns the view the globe's frame loop is suspended; the new transitions must not keep it spinning (a stuck border fade did, found by `settleApp` timing out).

### Labels in device pixels (2026-10-08)

Owner: the pixel labels were too big (a capital was 17 px tall), too heavy and flickered while the camera moved. The boxes stay pixel art (the map's own grid); the LABELS are HTML text. Code: `engine/label-text.ts` (type constants, measurement, variants), `label-sub.ts` (the second line: entry kinds and counts), `label-plan.ts` (the planner), `label-track.ts` (when it runs, slots), `label-dom.ts` (pooled elements), `box-scene.ts` (ties them to the boxes and to `hit()`), CSS `.map-label` and `.map-halo` in `app.css`. Shared by the globe and the street overlay (one `BoxScene`).

**Type and spacing** (`LABEL_TYPE`, one place; the CSS takes the family from `--font-mono`, the monospace stack of the credits line and the dev badge). Two lines (owner feedback, 2026-10-08, after a screenshot in the light scheme where the labels were illegible over coastlines and borders): line 1 the NAME, 14 px, weight 500, tracking 0.01 em, line height 18 px; line 2 the SECOND LINE, 11 px, weight 400, tracking 0.02 em, line height 14 px (`LABEL_TYPE.name` / `.sub`). Plate: 6 px padding left and right, 3 px above and below, so 24 px high with one line and 38 px with two (`LABEL_H_ONE`, `LABEL_H_TWO`), as wide as the wider line. Spacing: the plate's left edge IS the box's outer left edge (`bleed` 0; the text starts `padX` inside it; the right-aligned candidates likewise on the right edge, the left and right ones top-aligned with the box); 3 px of clear room between a label and its box (`boxGap`, above, below, beside; it was 7 px); a nested label 3 px (`nestInset`) beyond the outline; 4 px of clearance between two labels. The hit hull and the cut (`LodTree.labelW/H`) follow these numbers. The 12, 13 and 14 px sizes were compared on screenshots of the first monospace version; the name is now 14 px because the plate has a real ground and a second, smaller line gives the hierarchy.

**The plate and its feather** (`app.css` `.map-label`, `.map-halo`, `label-dom.ts`). Every label has a plate of the page colour behind its text (so the text never sits on a map line) and a soft edge around it: `.map-halo`, a transparent twin of the plate with `box-shadow: 0 0 8px 3px var(--background), 0 0 16px 3px var(--background)` (`LABEL_TYPE.feather` blur 8, spread 3; two layers so the falloff has no visible step), which fades the map out over about 8 to 12 px around the text. The feather is a SEPARATE element in a layer BELOW the boxes' canvas (first child of the label root): it dims coastlines and the graticule but never a box's outline, which stays crisp 3 px from the label; a single element with a shadow would have washed out the box edge next to every label. Two elements per label, moved by the same `transform` (one write): the cost is a second compositor layer per label (not measured; no performance run). A selected label has no feather (the plate is inverted, high contrast). Checked on screenshots of the owner's preview, light and dark, over the Mediterranean, the Balkans (about 35 labels), a selected place and a phone-width view (390 px): the names and the second lines stay legible over dense coastlines and borders.

**The second line** (`engine/label-sub.ts`, pure, tested in `label-sub.test.ts`). A place: its country (when known), then its linked entries split by kind; a group: "<N> places" ("1 place"), then the entries of the places below it; kinds with no entry are left out, the line itself when nothing is left (no invented data; today no entry is linked, so a place says its country and a group "N places"). The kinds are a TABLE, `ENTRY_KINDS`: articles, artworks, software (the project kind's word), in that order, each with a singular and a plural ("2 articles · 1 artwork · 3 software"); poems are the next kind: add one row. A kind that is not in the table is ignored by the labels. The entries come from the web app's own projection, no contract or API change: `lib/projection.ts` `placeEntries` collects, per place, the content items whose `placeSlugs` name it and its own `related` refs, each (kind, slug) once, only for items that exist (`PlaceSummary` has no `related`, so the full projection is read), and `buildPlaceIndex` hands them to the globe as `GlobePlace.entries` (optional). `LodTree` counts them (`nodeEntryCounts`: a group counts the DISTINCT entries below it, so an article about two of its cities counts once). When there is no room the plan shortens the label in this order (`labelVariants`): drop the entries, then the country / number of places (one line), then truncate the name with an ellipsis down to 6 characters; a step that would not make the plate any smaller (a name wider than its second line) is skipped. Hover and selection never change the text (the old "Name, Country" expanded label and `anchored` are gone).

**Measurement.** Widths come from a 2D canvas `measureText` in the resolved `--font-mono` family, once per string and run (cached; tracking added per character, rounded up to half a px), so the plan, the cut (`LodTree.labelW/H`: a label counts as part of its node, now in CSS px with the clear room) and the hit hull use numbers in CSS px; the DOM is never read back per frame. Without a canvas (the unit tests, a server) a deterministic monospace approximation is used (`setTextMeter` replaces it).

**DOM, not canvas.** Both were built and measured (Chrome for Testing, headless, M-series Mac, 1440x900 at device pixel ratio 2, CDP `Performance.getMetrics` per frame over 300 frames, every label moving every frame): main-thread task per frame (script + style + layout + the browser's own rAF overhead) 100 labels 1.38 ms DOM / 1.46 ms canvas, 200 labels 1.80 / 1.17, 400 labels 1.75 / 2.48; style recalculation 0.4 to 0.6 ms and layout 0.00 ms for the DOM (a label moves by `transform: translate3d` only, so the browser rasterises each label once and the compositor moves it), the frame interval stayed 16.7 ms (p95 16.8 to 17.3) in every case. So at 100 to 200 labels the two are equal on the main thread, the canvas wins by a little at 200 and loses at 400, and the canvas additionally uploads a full 2880x1800 texture whenever a label moves (not visible in these numbers; GPU cost unmeasured). The DOM was kept: it has real text (selection and find-in-page are disabled on purpose, the overlay is `aria-hidden` because the places list is the accessible path and a screen reader should not read every place twice), CSS states and transitions come for free (hover plate, inverted selection, the glide), the theme is the page's own CSS variables with no JS plumbing, and its cost does not grow with the screen's pixel count. On the real app (the preview, 5 to 26 labels in view) one frame of the label scene writes 4 to 17 elements and costs about 0.1 to 0.25 ms of script plus 0.1 ms of style. Not measured: phone GPU and CPU (a phone-size viewport was only run on a desktop machine).

**Inertia and flicker.** Mechanics: "Targets and labels" above. Metric (`label-track.test.ts`, a deterministic sweep of 72 labelled boxes over a swinging pan and breathing zoom, 180 frames then 30 at rest): a CHANGE is a label shown in two consecutive frames with another slot (candidate position or way of writing it), a JUMP a plate that moved in one frame by more than its box did plus 4 px; appearances and disappearances are counted apart (the camera and the cut decide them: 202 for both). The plan run on EVERY frame with the pixel version's own distances (what the overlay did before): 219 slot changes (3.04 per label), 81 jumps, up to 6 labels changing in one frame; the tracked plan: 0 slot changes, 0 jumps, none glided when the camera stopped (an earlier version that gave up a slot when its plate would leave the screen had 133 changes; the plate now stays at the screen's edge over its box, `slide`; with the settle plan only and a 1 s safety re-plan it had 16). In the browser (`groups.mjs flicker`, the same metric on the real app, a scripted pan and zoom of 181 frames over crowded views of the owner's preview): Europe 11 labels 0 slot changes and 0 jumps, the Balkans 12 labels 0 and 0 (22 boxes appeared or disappeared), the Atlantic / Iberia / Morocco 26 labels 1 slot change (0.04 per label) and 1 jump, at most 1 label changing in a frame, 7 to 17 element writes per frame, 2 full plans (the camera stopping, and the 3 s safety); every view ends with a label element for each box, none overlapping another. Hover never re-plans: `groups.mjs flicker` hovers 11 labels one after the other and requires that no other label changes slot, text or place and that no plan runs.

**Country in labels: why London said it and New York did not.** The text of a label was composed in `LodTree` by `placeLabelTexts` (`engine/country-names.ts`): the country was appended only to a place that is the ONLY place of its country in the whole projection. London is the only British place of the preview (`GB`, 1 place), New York has Houston next to it (`US`, 2 places): the rule, not the data, made the difference. The data is clean: the editorial files (`catalyst-content/editorial/places/london.json`, `new-york.json`) store the plain name from the Polarsteps step ("London", "New York") and the preview projection has `countryCode` GB and US (146 of 146 places have a code, no name contains a comma). The rule is gone: the country is the first part of the second line of EVERY place whose code is known (it was shown only on hover, focus or selection between 2026-10-08 and the two-line label). `stripCountry(name, code)` (`country-names.ts`, used by `lib/projection.ts` `toGlobePlace`) removes a trailing ", <own country>" from a name that already carries it ("London, United Kingdom" with `GB`; case-insensitive on the country; another country, a different position or no code leave the name alone), for the globe only: the list, the page and the content are untouched. A normalisation in the private content repo (names without the country, the code in `countryCode`) would be cleaner than the display-side strip.

### Opening a group into its most important children (2026-10-08)

Owner, on seeing the peeks (a first answer to "Western Europe stays a group with nothing visible inside until you zoom drastically onto France and it nearly occupies half the screen"): "I can see both the Western Europe bounding box and the cities inside it visible at the same time. That is confusing: a group is supposed to open up and show its cities. It seems to be a sync issue: when the parent bounding box fades out, the cities inside it must fade in. This is really important." The peeks (places drawn INSIDE a closed group) are removed, `LodTree.peekPass`, `LOD.peek`, `peeksToDrop`, the host and ban machinery and the `peek` flag of the debug hooks with them; their ranking, gap and budget measurements, hysteresis helpers and sweep metrics live on below. The rule now: a group opens EARLY into the most important of its children that fit, its box and label fade out exactly as those children fade in, and the rest of its children come in as the zoom goes on. The measured cause of the owner's complaint (a group closed until its box was 60 % of the screen: the children are 7 to 30 km apart, their labels cannot fit, and lowering the thresholds only moves the clutter, 3x to 8x more overlapping pairs) is unchanged; it is the all-or-nothing cut that goes.

**The rule** (`LodTree.cut`, `engine/lod-tree.ts`). A closed group OPENS when its first `LOD.open.quota` (2; all of them when it has fewer) children, in order of importance, can all be drawn, each as the box and the label it would carry, with the plate at one of the planner's own positions (above and below on each side, right, left; the whole label), `gapPx.enter` (8 px, the larger of the gaps along x and y) clear of every other drawn box and label, and the screen under its box budget. When it opens ONLY the children that pass that test are drawn, the others stay hidden (still counted in the group's total, "6 places") and come in one by one as the zoom lets them in, until the group's box covers `boxMaxTo` of the screen and the size rule shows all of them (as before). Importance is `labelPriority`, then the true size of the place in km, then the slug (camera independent, so the result never depends on the order of the input); a child group is as important as the most important place below it, and it is judged by the same rule: it is tried as soon as its parent opens, and a child group that does not fit as a box but whose own top children fit opens "through" (at zoom 3.6 Iberia shows Portugal's box with Barcelona and Seville, Spain's box is never drawn; France's box is never drawn when Paris and Toulouse fit). The first two must be taken together: a group never opens leaving out its most important child for lesser ones. The old size trigger stays as the upper bound (a group is always open by the time its box covers 60 % of the smaller side of the free area, `boxMaxFrom` 0.45 to close again, every group from zoom 13), and the old nearest-gap trigger (`sepPx`, `sepClosedPx`) is gone: it is a special case of the rule. A group with one visible child is that child's rectangle, as before. A place that is selected, focused or a stop of a shown route opens every group above it (`mustOpen`, even when its children found no room), so no group is ever drawn together with a place below it, at rest, with no exemption.

**Two sweeps, so that what is drawn is never displaced by what is new.** The cut is a depth-first walk in importance order with a trial per group (obstacles, plan and budget are rolled back when a trial fails): (1) KEEP, the groups that were open and the extras (the children after the first two) that were drawn in the last evaluation, with the LEAVE thresholds; then (2) GROW, the groups that are boxes try to open with the ENTER thresholds (most important first, the groups that just opened tried in the next round), then the other children are added in importance order across the whole screen (a less important child never takes the place of a more important one in the group next to it). The decision of a group never depends on a group decided after it, and the extras never decide whether a group opens.

**Parameters** (`LOD.open`, one table; every length in CSS px):

| What | Value |
| --- | --- |
| Quota | 2 children (or all of them when it has fewer) |
| Clear gap to every other box and label | 8 to take a child (`gapPx.enter`), 3 to keep it (`leave`); the label's plate is clear by the same |
| Box budget | 30 per 1440 x 900 free area, scaled by the free area, 8 to 60 (`budget`, `budgetMin`, `budgetMax`); a kept child may go up to `budget + budgetKeep` (4). It limits what the early opening adds: the size rule opens its groups with all their children, budget or not |
| Zoom hysteresis | a drawn child is kept WITHOUT a geometry test while the zoom is at most `stickyZoom` (0.4) below the zoom it came in at (the true extents of two neighbours grow into each other faster than the gap grows, so a test at every frame would take places away on a zoom-in); below that it keeps while it passes the LEAVE test |
| Judged | groups whose box is within `judgeMarginPx` (160) of the free area and can hold two boxes (`2 * minBoxCells + gapPx.leave`); a child off the screen is judged like any other (the screen only counts for the budget), so a box that pans in is already there |
| Candidates | at most `maxTried` (64) children per group |

**Hysteresis, per number.** Gap 8 / 3, budget 30 / 34, zoom 0.4, and the size rule's own band 0.45 / 0.6. Zooming in never takes a node away (a place stays, a group box goes only by opening), checked on the real tree over every centre and group, 0.01 of zoom at a time; zooming out, a group merges back once its places no longer pass the LEAVE test below the sticky zoom. The label position an incumbent took is tried first (`plateCand`), and while the incumbents are judged their boxes are reserved against each other's plates, which removed the two flaps the stress runs of the peeks found.

**The cross-fade, in lockstep** (owner: "when the parent bounding box fades out, the cities inside it must fade in"). The group's box and label and the children it opens into are retargeted in the same `update` (`LodTree.retarget`), so they start in the same frame and run on one clock: the node's `FadeArray` value, `FADE_MS` (200 ms), the same smoothstep of a linear progress, instant for reduced motion. The group goes 1 -> 0 exactly as its children go 0 -> 1; the opacity of a group plus that of any node below it is at most 1 all along (a child that starts later only lags; a reversal turns both around from where they are). The tests prove it with a scripted opening, a reversal, and a random camera walk with random frame times (4000 steps on a synthetic deep tree, 6000 on the preview), the pair sum never above 1 + 1e-6, with a negative control that the checker does see two nodes at full opacity. The label layer follows the same state: `BoxScene` draws the box, its mask and the label at `lod.alpha` in EVERY state (a hovered, focused or selected node used to be drawn at 1 whatever its fade), a label has no CSS opacity transition (only its position glides), and the browser check reads the CSS opacity of the label elements against the nodes' (largest difference 0.008, the quantum 1/64). Hit areas: a node on its way out is a click target only while it is at least `LOD.pickFadingMin` (0.5) opaque, a node on its way in from `pickAlphaMin` (0.3), and the smallest target wins, so a fading group never steals a click from the children that replace it (`pickAlpha`, `hit-area.test.ts`).

**Label planner.** The opening test reserves a plate position that is clear of every other BOX and label by 8 px, but the planner picks its positions by score and only looked at plates, so a label could land on a neighbour's outline (the cause of most of the overlapping pairs the first version of this rule produced). `PlanItem.avoid` (kept from the peeks, now for every node) lists the boxes of the other nodes within reach of a plate (`boxesToAvoid`, 3 px wider, built only for the nodes that are planned); a position that touches one comes AFTER every position of the same wording that does not, and is still taken rather than shortening the label or going over another plate (so the number of shortened labels and of labels drawn over another as the last resort does not rise: `groups.mjs targets` on the preview, 288 views, 100 % of the boxes labelled: size rule alone 620 boxes, 10 shortened, 7 last resorts; early opening 1234 boxes, 31 shortened, 9 last resorts, labels nested in their box 85 -> 29).

**Measured** (the owner's preview, 146 places, 1440 x 900 free area; the opening zoom of `groups.mjs open` in a real browser, a slow zoom in steps of 0.05 at rest, with the app's label metrics; before = the size rule alone, which is the old behaviour to within 0.01 of zoom):

| Group (view centred on it) | Opens at zoom, before to now | Places drawn at the opening (of the total) |
| --- | --- | --- |
| Western Europe | 5.75 to 3.50 | 3 of 6 |
| Balkans | 5.50 to 3.45 | 4 of 32 |
| Iberia | 5.40 to 4.55 | 4 of 11 |
| Central Europe | 6.05 to 4.40 | 4 of 6 |
| Italy | 6.99 (the unit sweep's label sizes) to 4.30 | 2 of 3 |

The unit sweeps (`open.test.ts`, label sizes estimated, zoom 2 to 9 in steps of 0.01, a fresh tree per group) say the same with other numbers, because a group's opening depends on what was drawn when it was tried: Western Europe 5.72 to 4.25 (4 of 6 places, boxes on screen 16 to 17, overlapping pairs 5 to 2), Balkans 5.50 to 3.42 (4 of 32; 15 to 8; 8 to 0), Iberia 5.40 to 3.83 (4 of 11; 11 to 16; 2 to 1), Central Europe 6.02 to 3.32 (2 of 6; 14 to 7; 2 to 0), Italy 6.99 to 4.30 (2 of 3; 7 to 24; 0 to 0). Over six view centres (Western Europe, Europe, Iberia, the Balkans, the Andes, the Maghreb) and 29 zooms each (2 to 9 in steps of 0.25), the size rule alone to the early opening: boxes on screen, mean 5.3 to 9.8, 5.1 to 9.9, 5.3 to 8.9, 7.3 to 14.1, 4.6 to 8.2, 7.9 to 10.2 (the most at any view 30, the budget; before 21); free label room (share of 100 x 18 probe plates on a 20 px lattice touching no plate and no box outline) 0.869 to 0.884, 0.869 to 0.886, 0.871 to 0.888, 0.802 to 0.821, 0.902 to 0.908, 0.865 to 0.872 (it rises: fewer big boxes); overlapping pairs (box over box, plate over box, plate over plate; real planner) mean 1.17 to 0.34, 1.38 to 0.66, 1.21 to 0.38, 2.62 to 1.14, 1.69 to 0.62, 2.41 to 2.00, 304 pairs over the 174 views to 149 (86 views fewer, 83 equal, 5 more: four by one pair, one by three, two incumbents whose true boxes have grown into each other or a label with no box-clear position), plate over plate unchanged (1 to 1). Before the early opening each of these groups was one box with nothing in it for one to two zoom levels.

**Tests.** `open.test.ts`: synthetic country of six places (opens as soon as the two most important fit, only those that fit are drawn, the box 8 px clear of everything when they come in; the rest come in and none goes away on a zoom-in; the first two are BOTH there, a blocked top place keeps the group closed although the others fit; fewer than two children; importance order and input order independence; a child group opens by the same rule, and a child group that does not fit as a box opens into its own places; every group kind; the size rule shows all places; jitter in zoom and position never flaps; it closes later than it opens; the budget and its scaling with the free area); the cross-fade (lockstep, reversal, reduced motion, random walks, the negative control); and on the owner's preview, skipped without the git-ignored file: the six-centre sweep (boxes within the budget, fewer overlapping pairs, free room), the five groups open at least half a level earlier with two or more places, Western Europe is never drawn with a place of it and two or more of its places are drawn once its box is gone, at rest no node has a drawn ancestor and every node is fully on or off, zooming in never closes a group or takes a place away, determinism against a shuffled input, jitter stability over every sweep view (`OPEN_STRESS=1`: 16 times more views), a random walk of 6000 steps on the real tree. `lod-tree.test.ts` has the strict invariant back (no node drawn together with a drawn ancestor, no exemption) and the selected place / route stop under a closed group; `hit-area.test.ts` the pick rule of a fading group; `label-plan.test.ts` `avoid`. Browser, `groups.mjs open` (the preview): 535 resting frames over the five groups, no node with a drawn ancestor, every box fully drawn with its label element opaque, no plate over another, at most 30 boxes on screen; a scripted zoom through the opening of Western Europe with the clock running, the pair sum 1.000 at every sampled frame, the cross-fade seen mid-way, the label elements within 0.008 of the nodes' opacity, a click on a child that is fading in never picks the group fading out; a zoom on the way in takes nothing on the screen away except by opening its group. The other modes of `groups.mjs` (`targets`, `at-rest`, `flicker`, `timed`, `idle`, `pick`, `reduced`; `lod`, `cases`, `pixels`, `empty` on the demo) and `sky.mjs` pass.

**Not verified**: Safari/iOS, a real touch screen and phones (the budget scales to 8 boxes on a 390 px wide free area, by arithmetic; not driven), the cost on a real device (the CPU numbers above are Node on the laptop; no GPU or phone performance run), the street scale and `groups.mjs handover` (they need the local tile server; the shared `BoxScene` path is the same), the label widths of other fonts than the app's monospace stack, content other than the owner's preview (the Western Europe of a real publication has other places and priorities). An opening depends on history (a group is tried against what was drawn when it was tried, and a drawn node is kept): the same zoom reached by a jump, a slow zoom and a fine one can differ by up to about a level for a group that sits next to others (Western Europe 3.5 to 4.25 in the two kinds of sweep above).

### Checks of the boxes (`scripts/globe/groups.mjs`, `markers.mjs`)

`idle-spin.mjs [start|input|blocked|reduced|hidden|flags|mobile]` checks the idle rotation (above; any content). `groups.mjs [lod|cases|pixels|empty|timed|at-rest|reduced|pick|targets|flicker|open|cost|idle|handover|shots]` (demo content: `pnpm dev:demo`, `lod`, `cases` and `handover` need it; `targets` and `at-rest` run on any content, your preview included; `handover` also
needs the local tile server) checks the cut (`open`: the early opening of "Opening a group into its most important children" above, needs groups of several places, your preview included; `flicker`: a scripted pan and zoom, the slot changes and jumps of the labels, one plan when the camera stops, hover re-plans nothing; at rest every node fully drawn, exactly one level per branch, 10 close places = one box
that opens, a lone place, two distant places, the timed transitions), the pixels (every outline cell present, only palette colours), reduced motion,
picking (border and label plate yes, interior no), the label rule (`targets`: at rest 100 % of the drawn boxes have a label on a sweep of 288 views of the preview and of the demo), cost, idle (0 frames, 0 canvas draws) and that the globe and the street overlay
draw the same boxes in the same tones at one camera. `SHOTS=1 ... groups.mjs shots` writes `docs/screenshots/clusters-world-{light,dark}.png`
and `clusters-opening.png` (a cluster opening through a zoom). `markers.mjs [quick]` is the whole-or-nothing sweep for rectangles:
thousands of views rotating every place across the limb, at overview, mid and high zoom, desktop and phone, nothing selected and
selected: every shown outline complete, nothing on the canvas outside the shown boxes and label plates, the far side never drawn,
every box centred on the cell the place projects to.

## Reload fade (direct load of a place)

A direct load or reload of `/locations/:slug` used to show the whole planet for a moment and then jump to the framed city.
Now the first paint is the page colour only (black in the dark theme, `--background` in the light one), and the stage
fades in once the final framed view is drawn. No camera motion, no layout shift.

- `Globe` renders nothing on the server and on the first client render; for a fit view (`isFitView(initialView)`, i.e. a
  direct load of a place or of the home page: `startsVeiled(initialView)`) the `Suspense` fallback is `null` and there is no
  placeholder of any kind (the old full-resolution disc outline, shown for a few frames before the pixel-art globe was ready,
  is gone), and `GlobeCanvas` renders its root with `opacity: 0` (`veil`, decided on the first render, so the server markup and
  the hydrated one agree). The WebGL canvas is itself created with `opacity: 0` and only made visible by the first frame it
  draws (`renderer.renderNow`), so an undrawn (black) or unfinished canvas can never be presented whatever the stage does.
  Only a saved view (the globe coming back from the mobile slide-over) is not veiled.
- The handover controller calls `onReveal` ONCE (`tryReveal`): when the street map has been cut in (a start at street
  scale: `restoring`, `shown >= 1`), or at the globe's first frame when the start needs no street map; a start that needs
  the street map waits at most `HANDOVER.revealWaitMs` (1500 ms), then reveals whichever correct frame exists (the globe at
  its own maximum, centred on the place); if the street map becomes ready later, the usual cut applies. A dead street
  map (no tiles, failure) reveals the globe at once. WebGL unavailable also reveals (the status message must show).
- The fade is `opacity` over `HANDOVER.fadeInMs` (500 ms, `--ease-standard`); under reduced motion there is no
  transition (instant). The place panel is untouched.
- Check: `scripts/globe/first-frames.mjs [path] [scheme]` samples every animation frame of a load of the home page: no
  placeholder or loading element at any frame, the stage and the WebGL canvas never on screen before the first drawn frame,
  and the globe does appear (also with reduced motion). `scripts/globe/reload-fade.mjs` samples every animation frame from navigation: first paint transparent; never
  visible away from the final framing; no camera motion; 450 ms fade (instant with reduced motion); the final frame is the
  street map; with the street chunk delayed by 4 s the globe frame is revealed after the wait (1.9 s), not before.
  Measured on the M4 (local PMTiles): reveal at 0.62 to 0.65 s after navigation.

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
| 1440x900 @2x, panel open (inset 720, scissor on; historical) | 60 | 16.7 / 16.8 / 16.8 | 0.2 / 0.3 / 0.6 | 0.4 / 0.5 / 1.2 | 2.0 / 2.3 / 2.6 (second run 1.8 / 2.8 / 4.4) |
| 1440x900 @2x, panel open, scissor off (the shipped state) | 60 | 16.7 / 16.8 / 16.8 | 0.2 / 0.3 / 0.4 | 0.3 / 0.4 / 0.5 | 2.0 / 2.3 / 5.4 |
| 390x844 @3x, emulated (195x422) | 60 | 16.7 / 16.7 / 16.8 | 0.2 / 0.3 / 0.6 | 0.4 / 0.5 / 1.2 | 2.0 / 2.9 / 4.5 |

(Historical, the reason the scissor was removed.) The scissor changes nothing measurable on this GPU: the GPU-synced time with the panel open is 2.0 ms p50 with it
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
| Idle, 4 s without input (also after moving the pointer) | 0 rAF calls, 0 `gl.clear` (no frames), `isAnimating() === false` (measured in debug mode; a visitor's page starts the idle rotation after 8 s, see "Idle rotation") |
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
| Panel closing | inset back to 0, Kyoto returns to (722, 452), the middle of the full width |
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
the horizon. Not changed: the graticule, borders and coastlines (1 px, no footprint), (the GL scissor under the detail panel that
was listed here is gone, see "Stale edge").

Evidence and checks: `docs/screenshots/markers-before.png` / `markers-after.png` (same 9 views, 3x enlarged crops:
centre, north, south, near the limb, selected, high zoom; before and after). `scripts/globe/markers.mjs` draws markers
in pure red/blue (`__globeDebug.setMarkerProbe`) and compares the whole drawing buffer pixel for pixel with the expected
block of every shown marker (and nothing for hidden ones) over 9,252 views per run: full rotations at 7 latitudes and
three zooms, each place walked from 50 to 100 degrees off-centre along four bearings, desktop and 2 px mobile art pixels,
nothing selected and Reykjavik, Cape Town and Hanoi (route stops) selected. Old build (quick mode): 1,440 failures over
2,256 views; new build (full mode): 0 over 46,260 views. Unit tests: `visibility.test.ts`. Frame time unchanged (bench desktop, GPU-synced
p50 2.1 to 2.4 ms before and after, JS render p50 0.2 to 0.3 ms); idle still 0 rAF, 0 `gl.clear`.
