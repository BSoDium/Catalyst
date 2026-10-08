# Performance (globe + street renderer)

Owner's report: "the performance has tanked; it used to be extremely fluid and clean and now it is a bit more stuttery, you can feel the frames taking more time" (MacBook M4). This document is the investigation, the fixes, the numbers, and the tooling to keep it fixed. Scripts live in `apps/web/scripts/perf/`; the budget check is `pnpm --filter @catalyst/web perf`.

## Why the first measurements missed it

Earlier headless runs looked at `requestAnimationFrame` intervals: always 16.7 ms, because on a 60 Hz compositor a frame that costs 3 ms and a frame that costs 15 ms both land on the next vsync. Two things hid the problem:

1. **The display is 120 Hz.** The M4's built-in screen is ProMotion; the budget is 8.3 ms, not 16.7. A headed run (real display) shows it: the same frames that were "perfect" at 60 Hz miss vsyncs at 120 Hz. Headless Chrome cannot show this.
2. **Interval statistics are not cost.** The scripts now also record, per active frame, the GPU time (`EXT_disjoint_timer_query_webgl2` per context: map, pass, globe), main-thread busy time and animation-frame callback time (Chrome trace), long animation frames, GC, heap, and dropped compositor frames, with attribution to named phases inside the app (`window.__perf`, on with `?globe-debug`).

## Methodology

- **Tools**: Playwright (`playwright-core`) driving Chrome for Testing 153 with ANGLE/Metal and the real GPU; headless-new by default, `--headed` for the real display. Input is real (trusted mouse and wheel events through CDP), so inertia, the on-demand frame loop and event handling are measured.
- **Per scenario**: p50/p95/p99/max of the frame intervals of *active* frames (frames in which the app drew), the display period (median interval) and `missed` = intervals above 1.5 periods, counts above 16.7 and 25 ms, GPU ms per frame (mean, p95, per context), a CDP Tracing recording (`devtools.timeline`, `gpu`, `cc`, `v8.gc`, `blink.user_timing`) summarised to main-thread busy ms per frame, `FireAnimationFrame` ms per frame, GPU process task time, presented/dropped frames, GC pauses; `PerformanceObserver` long tasks and long-animation-frames with script attribution; JS heap; per-GL-call CPU time; in-app phase timers.
- **Scenarios** (`scenarios.mjs`): `idle` (zero frames), S1 world view with a 5 s slow drag rotation plus inertia (street map not mounted), S2 world to Ho Chi Minh City (`s2-hcmc`, local archive) and to Lisbon (`s2-lisbon`, real OpenFreeMap) by place link, S3 wheel zoom through the handover both ways (`s3-in` creates the street map during the gesture, `s3-out` is warm), S4 circular pan at street zoom, S5 street pan with the detail panel open (`s5-open`, direct load) and the panel open/close animation at world view (`s5-panel-anim`). `--device mobile` is 390x844 @3 emulation (touch UA), `--scheme dark`, `--throttle N` CPU slowdown. The world scenarios wait 4.5 s after load so the street chunk warm-up (below) has happened; `PERF_COLD=1` skips that wait.
- **Environment of the numbers below**: Apple M4 MacBook (14", 3024x1964 @2, 120 Hz), macOS, Chrome for Testing 153.0.8010.12, viewport 1440x900 @2, production build (`react-router build`) served with `NODE_ENV=development` at run time only to allow the local http PMTiles fallback (production refuses it), local HCMC archive on :5240. Medians of 3 repeats unless noted. Other apps were running (this is a laptop, not a lab): treat differences under about 20 % as noise. GPU timer values have the GPU's own frequency ramp in them, hence a wide spread between runs.

### Running it

```
pnpm --filter @catalyst/web build
pnpm --filter @catalyst/web perf                 # headless, all budgets, exits 1 when one is exceeded
pnpm --filter @catalyst/web perf -- --headed     # real display (120 Hz on a MacBook Pro): the number to trust for "feel"
pnpm --filter @catalyst/web perf -- --quick      # idle, S1, S4, one repeat
node apps/web/scripts/perf/run.mjs --base URL --scenarios s4 --headed --out DIR --label x   # one scenario, JSON + trace to DIR
node apps/web/scripts/perf/summary.mjs DIR/a.json DIR/b.json                                  # compare reports (medians)
node apps/web/scripts/perf/crawl.mjs --base URL                                              # pan stability, snapped vs not
```

A headed run opens a Chrome window; leave the machine alone while it runs (about 6 minutes for everything). `--street-opts '{"snapPan":false}'`, `'{"governor":false}'`, `'{"highResolution":true}'` switch features off to A/B them; `--throttle 6` slows the main thread 6x.

### Reading a trace

`--out DIR` saves one `*.trace.json` per scenario. Open it at https://ui.perfetto.dev (or `chrome://tracing`). Find the renderer process, thread `CrRendererMain`: each `RunTask` is a main-thread task and `FireAnimationFrame` is our rAF callback (the globe tick, then the handover, then the street map render). In the `GPU Process` track, `GPUTask` slices are the GPU commands of the frame; a frame whose `GPUTask` ends after the next vsync is a dropped one. `PipelineReporter` slices carry the compositor's verdict (`STATE_DROPPED`). `node scripts/perf/trace.mjs file.trace.json` prints the same summary the scripts use. For a hitch: sort `RunTask` by duration, then look for `v8.compile`/`EvaluateScript` (a chunk), `Layout` / `UpdateLayoutTree` (DOM), `MinorGC`, or one long `FunctionCall` (the report's `loaf` entries name the script and invoker).

## Bisect: where the frame time went

Same scripts, same machine, four builds (worktrees of the commits), headed 120 Hz, medians of 3 (`8b400dc`: one run without a trace, so no main-thread figure). `main` = main-thread busy ms per active frame, `gpu` = GPU timer ms per frame (all contexts). "Frames" is the number of active frames in the scenario (more frames = more drawing after the camera stopped).

| Build | S1 world rotation (main / gpu / p95 / max ms) | S2 flight to HCMC (frames, main / gpu, p95 gpu, max ms) |
|---|---|---|
| `0ffa027` before the street work | 0.9 / 0.1 / 9.2 / 9.4 | 265, 1.1 / 0.9, 1.8, 9.4 |
| `8c721b1` street module (not mounted) | 0.8 / 0.1 / 9.2 / 9.4 | 265, 1.3 / 0.6, 1.2, 9.4 |
| `8b400dc` handover | n/a / 0.1 / 9.2 / 9.4 | 737, n/a / 3.7, 9.4, 40.8 |
| `938a1a8` HEAD | 1.0 / 0.2 / 10.1 / 10.4 | 435, 2.3 / 4.1, 9.5, 41.3 |
| this work | 1.0 / 0.2 / 10.1 / 10.4 | 435, 2.2 / 1.5, 3.2, 48 (map creation, see below) |

Findings:

- **The street module itself costs nothing** (`8c721b1` equals the commit before it) and **the world view is unchanged at every commit** (S1: same cost, same frame spread; the 9.2 vs 10.1 ms p95 between machines' runs is the noise floor of the headed window). Fix (a) of the brief therefore needed no change in the globe: it is at parity with the pre-street build.
- **The regression is the handover commit and everything it drives**: from `8b400dc` the street map is created at unified zoom 4.0 and, from 4.3, rendered on every camera tick although hidden, with a copy to a second WebGL context and a full pass. In S2 that adds about 3 ms of GPU per frame (`pixel-pass` 2.5 to 3.3 ms, `map` 0.7 to 1.2 ms), 1 ms of main thread, 3x the active frames (the hidden map keeps drawing as tiles arrive), heap 13 to 35-49 MB, and one 33 to 67 ms frame when the map is created. S4 (pan at street zoom, headed): GPU 2.9 ms mean / 7.5 p95 per frame, versus the globe's 0.1.
- The felt stutter is therefore at **street scale and in the transition**, at 120 Hz: the p95 frame interval at S4 was 10.0 ms (period 8.3) on HEAD against 9.2 after, equal to the world view's 9.2; the GPU p95 of 7.5 ms (and 9.5 in S2/S3) leaves no room in an 8.3 ms frame once the compositor and the other renderer take their share.

### Suspects: confirmed or refuted

| Suspect | Verdict | Evidence |
|---|---|---|
| Street map created at 4.0 and driven invisibly every tick from 4.3 | **Confirmed, largest** | hidden-map GPU 3 to 4 ms per frame in S2/S3 (copy + pass of a full-resolution map nobody sees); now hidden = no copy, no pass, no overlay work, camera pushes debounced (140 ms) |
| `texImage2D` copy + full-resolution render + downscale | **Confirmed on the GPU, refuted on the CPU** | `pixel-pass` 3.1 to 7.6 ms and `map` 1 to 2 ms of GPU per frame at DPR 2 (2880x1800 source, 5.2 MP, copied every frame); the CPU side of the upload is 0.03 ms per frame |
| ~14 ramp layers (about 125 draw calls a frame) | Partly: main-thread cost, not changed | `street.setCamera(sync)` (the map's synchronous render) is 2.3 ms per frame headless, 1.0 headed, 75 % of the street frame's main thread; fewer layers would cut that, a later step |
| Per-frame label/marker DOM layout | Refuted | `street.overlay` 0.06 ms per frame; 0 layouts in S4, 217 style recalcs over a whole S2 flight (60 ms total) |
| React re-renders per `onViewChange` | Refuted | 0.7 ms over 363 frames |
| Inset animation re-fits | Refuted | S5 panel animation at world view equals the pre-street build apart from the one-off street creation |
| ResizeObserver loops | Refuted | no layout in S4; no RO callbacks outside resizes |
| `backdrop-filter` over WebGL (navbar scrim) | Not a regression | exists since the first commit, S1 at parity |
| Shader cost at DPR 2 | **Confirmed** (same as the pass line above) | the pass is fill-rate bound: GPU time scales with the output pixels; native art resolution cuts them 36x per cell |
| Extra rAF loops | Refuted | one app rAF per frame in every build (the probe's own is the other) |
| GC | Small, not a cause | street scenarios allocate (MapLibre tile parsing): 70 to 80 ms of GC over a 6 s flight against 3 ms before, but the longest pause is 3.5 ms |

## What was changed

1. **Native art-resolution street render** (the biggest win). MapLibre renders at `STREET_TUNING.renderScale` (3) map pixels per art cell per axis; the pass classifies, removes stairs and presents on the art grid itself (`cols x rows` canvas), scaled up by the browser with `image-rendering: pixelated`. The device-resolution render + downscale stays available as `highResolution` (needed only for the sharp reveal/dissolve, both off). At DPR 2 desktop this is 1440x900 map pixels instead of 2880x1800 (9 map pixels per cell instead of 36), at 390x844 @3 about 585x1266 instead of 780x1688. Why 3 and not 2 or 1: the line gate (`pnpm test:street-lines`) and a cell-by-cell comparison with the device-resolution render. At 3 the classify sample is exactly one texel and the art image agrees with the device-resolution one on 99.8 % of cells (ink IoU 0.988 to 0.994 at z12.5, 14.5, 16.5, `scripts/street/native-compare.mjs`). At 2 (the average of a 2x2 block) IoU drops to 0.79 to 0.89, dotted roads lose a fifth of their cells, the 2x2-block check fails. Scale 1 loses dashes. Same visual, same rules, 171 of 171 gate checks (see Limits for the one gate change).
2. **A hidden street map costs nothing visible**: `StreetMap.setActive(false)` while the globe is the shown renderer. Tiles keep loading (the map renders at art resolution, cheap), but there is no copy, no pass, no overlay/label work. The handover only pushes the camera to a hidden map once the camera rests (debounced), and every tick once it is shown (dissolve off: the cut).
3. **Street chunk warm-up** in an idle period 2.5 s after load (skipped for data-saver/2g): the fetch and evaluation of MapLibre (a 35-40 ms task) no longer lands on the first flight or zoom.
4. **Pan snapping to the art grid** (`street/core/snap.ts`). While the zoom is steady (a drag, its inertia) the map centre is quantised to whole cells in Web Mercator world pixels, so the picture translates rigidly. Pan stability, measured by `perf/crawl.mjs` (36 px/s drag, best whole-cell registration of consecutive art images, residual = cells that are not explained by a pure shift): not snapped, 98 % of frame pairs change and 30 % of the ink cells flicker between consecutive frames (about 2,540 cells); snapped, 19 to 30 % of frame pairs change (the ones that cross a cell boundary), and each change is an exact whole-cell shift with a residual of exactly 0. **What cannot be snapped**: a zoom change (every feature moves by a different amount; there is no common translation) and, were it enabled, rotation. Between map zoom changes below 3e-4 the zoom is held so the latitude correction of the unified zoom does not drift the grid; the frame a zoom ends on settles on the grid (a nudge of at most half a cell). The cost is a lag of at most half a cell (1.5 to 3 CSS px) behind the pointer and 3 px steps at very slow drags, exactly like scrolling pixel art. `STREET_TUNING.snapPanFromZoom = 0` turns it off.
5. **Adaptive frame-budget governor** (`engine/governor.ts`, pure and unit tested; wired in `handover/controller.ts`, fed by `engine/renderer.ts`). It watches what frames cost while the camera moves: a frame that is part of a running animation (a flight, inertia, the inset slide) costs the interval since the previous one (or its own main-thread work when longer); any other frame (a wheel notch, a drag event, a resize) costs its own work only, because its interval is the user's, not the device's. It steps down, one level at a time, at most one change per 4 s, when over a window of 90 frames the p95 is above 26 ms AND the median is above 18.5 ms (a few hitches, such as the street map mounting, are not a slow device): level 1 renders the street map at 2 instead of 3 map pixels per cell (less than half the map pixels, short dashes soften), level 2 makes the art pixel one CSS pixel larger in both renderers (2.5 to 3.5, 2 to 3 on phones). It steps back up when a full window has p95 below 18.5 ms and 10 s have passed since the last slow evidence or change; idle time counts as calm, so the first calm gesture after a rest restores the level. A step up undone within 20 s locks the level for 90 s, doubling each time it happens again (up to 8x), so a really slow device settles. Idle gaps (>100 ms) restart the window. Every change is logged (`console.info`, "[globe] render quality level ...") and kept in `FrameGovernor.history`. With the DPR already folded into whole-device-pixel cells, "a DPR cap" is moot: the render is already at art resolution at any DPR. Debug: `__handoverDebug.quality()` / `forceQuality(level)`; `--street-opts '{"governor":false}'` disables it.
   **The bug this fixed (2026-10-07): "the map pixels double in size for no reason while zooming and stay that way until a reload".** Two causes, both in the governor. (a) It read the INTERVAL between consecutive frames as the frame time. A wheel or trackpad zoom produces one frame per input event (every 50 to 100 ms), so a healthy machine zooming looked like 10 to 20 fps, the window filled with "slow" frames and the governor stepped down twice (a larger art pixel and a coarser street map) within seconds. (b) It could not come back: stepping up needed 10 s of UNINTERRUPTED motion with a full fast window, and any idle gap over 100 ms reset that clock, so a real gesture (a few seconds, then rest) never got there; the level then stayed until the page was reloaded (`QUALITY.cellBoost` is module state). Regression tests: `engine/governor.test.ts` ("regression: ..."). The art pixel size is otherwise a function of (smaller viewport side, DPR) only (`engine/tuning.test.ts`).
6. **Smaller**: `texSubImage2D` instead of `texImage2D` when the size is unchanged; phase timers (`engine/perf.ts`); the palette table (below); `highResolution` only when `HANDOVER.revealFocus` is on.

### Palette table (richer greys)

`app/globe/engine/palette.ts` owns the grey ramp for both renderers: `PALETTE_LEVELS` 12 (= `MAX_LEVELS`, the capacity of the shader's `uPal[]`) levels between the page colour and the ink, the map levels only reaching `MAP_CONTRAST` (0.55) of the way to the ink, and the roles `wash` .. `ink` that resolve to levels (`roleLevel`). `app/globe/street/core/palette.ts` only encodes a level and a fill pattern into the style colours (`lineColor`, `fillColor`, `codeOf`) and builds the colours the pass presents (`buildPalette`); the pass writes one level per art cell and the presenter looks it up in `uPal` (see `street-architecture.md`, "Palette and tone"). This replaced the first 2-level table (the look then was unchanged, verified by the gate and the cell comparison). **The line rules never look at levels**: a line is a class (`thin` / `solid`) with a tone that comes from its role, and the 1 art-pixel floor, centre sampling, no antialiased grey and stair removal apply whatever the level count.

## Before and after

Headed (120 Hz), Apple M4, medians of 3 (S4 p95 from the same runs). GPU = timer-query ms per frame.

| Scenario | Before (HEAD `938a1a8`) | After |
|---|---|---|
| S1 world rotation | main 1.0, gpu 0.2, p95 10.1 | same (parity with `0ffa027`: 0.9 / 0.1) |
| S2 flight to HCMC | gpu 4.1 (p95 9.5), heap 35 MB, 435 frames, 0.8 % dropped | gpu 1.5 (p95 3.2), heap 35 MB, 435 frames, 0.9 % dropped; one 33 to 48 ms frame at map creation in both |
| S3 wheel zoom in | gpu 2.8 (p95 9.4), max 67 ms, 2.7 % dropped | gpu 1.0 (p95 3.6), max 57 ms, 2.6 % dropped |
| S3 wheel zoom out | gpu 1.5 (p95 7.1), max 26 ms | gpu 0.8 (p95 3.3), max 17 ms |
| S4 street pan | gpu 2.9 (p95 7.5), p95 interval 10.0 ms | gpu 1.4 (p95 2.9), p95 interval 9.2 ms |
| S5 street pan, panel open | gpu 2.3 (p95 5.5), 48 MB | gpu 1.0 (p95 2.6), 38 MB |
| S4 crawl (churn per frame) | 2,540 cells | 0 cells (snapped), 19 to 30 % of frames change |

Headless (60 Hz) medians of the budget run, for the same scenarios, are in `budgets.mjs`; the `S4` GPU there is 2.8 ms after against 8.9 before (the GPU timer reads about twice as high headless because the GPU downclocks between 60 Hz frames). The remaining stalls are the one-off street map creation (section below).

## Skybox

The Milky Way and stars behind the earth (web-architecture.md, "Skybox") are drawn inside frames that happen anyway and add none. Idle: zero rAF, zero frames, zero `gl.clear` with the sky on (`sky.mjs rest`, `groups.mjs idle at-rest` and `handover-perf.mjs idle`, all run with `SKY=1` and without). Per frame: one full-buffer triangle (a matrix, `atan`, `asin`, one 8-bit texture fetch, a Bayer lookup per pixel) and 20,000 one-pixel points (vertex work only; 7,000 until 2026-10-08, not re-measured), drawn after the disc with the depth test at the far plane, so the pixels the earth covers fail early and a globe that fills the picture switches the layer off. The GPU-synced `renderNow` (400 frames of a turning globe, p50): 0.4 to 0.5 ms with and without it at 1440 x 900 @2, 0.5 to 0.6 ms at 390 x 844 @3, equal within the 0.1 ms resolution of the timer (p95 noise 1 to 3.8 ms either way). Memory: a 16 KB texture, 400 KB of star attributes (140 KB at 7,000 stars). Bundle: the globe chunk grew by 11.2 KB raw and 3.7 KB gzip (the main chunk is byte-identical). Not measured: a real low-end phone; no performance budget was run for this change.

## Testing on a phone

The scripts above cannot show a slow GPU (see "Limits"), so the real check is a real phone on the dev server.

**Connect.** `pnpm dev` binds every interface and prints where it can be reached: the LAN URL (`http://192.168.x.y:5173/`, phone on the same Wi-Fi, no client isolation on the router) and, when `tailscale` is installed and running, the Tailscale IP and MagicDNS name (`http://<machine>.<tailnet>.ts.net:5173/`, phone with the Tailscale app, works from any network). Vite only answers `localhost` and IP addresses by default; `*.ts.net`, `*.local`, `*.lan`, `*.home.arpa` and the machine's own hostname are allowed in `vite.config.ts` (`scripts/dev-host.mjs`), more through `CATALYST_DEV_ALLOWED_HOSTS=name.example,.corp.example`. Hot reload needs no setting: the client connects back to whatever host the page was loaded from.

**Plain http.** WebGL 2, pointer and touch events, `devicePixelRatio` and the frame governor all work over plain http, so the globe, the handover and the street map behave as in production. Secure-context-only APIs do not (service workers, `navigator.clipboard`, geolocation, `crypto.subtle`; Safari is stricter than Chrome here): none is used by the app today. For https on the tailnet only, run `tailscale serve --bg 5173` (the machine's `https://<machine>.<tailnet>.ts.net/`, certificate by Tailscale; stop it with `tailscale serve reset`). Combine it with `CATALYST_DEV_HOST=localhost pnpm dev` and nothing but the tailnet reaches the server. Do not use `tailscale funnel`: it publishes the dev server on the internet.

**Content.** With a local preview file the phone shows your real places, drafts included. Anyone who can reach the port can read them (the API of the dev server is the page itself). On a network you do not trust (a hotel, a conference) run `CATALYST_DEV_HOST=localhost pnpm dev`, or `pnpm dev:demo` for placeholder data (it still listens on every interface unless the variable is set).

**Tiles.** The street map's tile URLs are absolute and come from the server's environment, so nothing depends on the page's origin: OpenFreeMap is public with open CORS, and a self-hosted archive sends `Access-Control-Allow-Origin: *` by default (`CORS_ALLOW_ORIGINS`). One trap: `CATALYST_TILES_FALLBACK_URL=http://localhost:8080/places.pmtiles` is valid for the dev server but is sent to the phone, where `localhost` is the phone, so the fallback fails its probe and the map degrades to the globe floor when the primary is unreachable. For a phone use an `https://` URL (a deployed tile server, or `tailscale serve` on the tile server's port). Plain-http LAN addresses are refused by the tile configuration on purpose.

**Read the state.** There is no on-screen overlay. Add `?globe-debug` to the URL (it sets the same flag for the street map) and open the page from the phone; then, in the remote inspector (Safari on a Mac: Settings, Advanced, Show features for web developers, then Develop, the iPhone, and on the iPhone Settings, Safari, Advanced, Web Inspector; Chrome on Android: `chrome://inspect`), the console has:

- `__handoverDebug.quality()`: the frame governor's level (0 full quality, 1 the street map at one map pixel fewer per art cell, 2 a larger art pixel). A phone that settles above 0 while panning is a phone that cannot hold the frame budget; note which gesture and zoom.
- `__perf.snapshot()` (after `__perf.reset()`): CPU ms per phase (`react.onViewChange`, the globe frame, the street render ...), and `__streetDebug.passTimings()`, `.lastPassMs()` and `.tile()` (tile source, state, failures) for the GPU passes and the tile chain.
- `__handoverDebug.blend()` / `.streetState()`: whether the street map is shown or still loading.

**What to look at.** (1) Frame pacing while dragging the globe at world view, then pinch-zooming through the handover (zoom about 4 to 6, where the street map is created: one late frame once per mount is known, see "Limits"). (2) Panning at street scale in a dense city: the map's native render is the main-thread cost; `quality()` going up is the signal. (3) The first load over mobile data: tiles from OpenFreeMap and the street chunk. (4) Thermal throttling after a minute of use, and the art pixel size (2 CSS px on phones). Record the device, browser, `quality()` after the gesture and the `passTimings()` in the numbers table above when a result is worth keeping. Real-phone results are not in this document yet: everything above is emulation.

## Budgets

`budgets.mjs`, checked by `pnpm perf` (exit 1 when exceeded). Headless limits (headed runs are lower, they meet the same numbers): idle 0 draws and 0 app rAF calls; S1 main <= 2.8 ms, raf <= 0.9, GPU mean <= 0.6, at most 1 missed vsync, 0.5 % dropped; S4 main <= 3.4, raf <= 2.3, GPU mean <= 4.5 / p95 <= 8, max interval <= 1.8 periods; S2/S3 max interval <= 80/90 ms and at most 4 missed vsyncs; mobile S1/S4 main <= 3/5 ms; pan crawl residual 0 and at most 1.05 changed frames per art cell the map travelled (and the unsnapped control must show crawl; see "Temporal ease" below for why this replaced the 35 % share). The GPU limits sit between the native value and the device-resolution value they replaced, so the negative control works: the script fails on the `938a1a8` build (S4 GPU mean 7.1 > 4.5, p95 10.3 > 8, crawl residual 0.30). Run it before and after any change to the renderer, the style, the pass or the handover; if a limit is exceeded by noise, rerun with `--repeat 5` before touching it.

## Limits and what remains

- **One-off hitch when the street map is created** (about 17 to 19 ms inside `createStreetMap`: MapLibre 7, compositor and shader link 7, HUD 1; plus about 13 ms for its first render), at zoom 4.0 or at the click of a place: one to three late frames at 120 Hz, once per mount. The chunk warm-up removed the module evaluation from it. Pre-creating the map at idle would remove it but keeps two more WebGL contexts and tile requests alive at world view and contradicts "street not mounted at world view"; not done. The map is released 2.5 s after the camera leaves street range (`unmountDelayMs`), so a back-and-forth pays it again.
- The street map's own synchronous render is the main-thread cost at street scale (2.3 ms headless / 1.0 headed per frame, ~125 draw calls): fewer ramp layers or merged line layers would cut it. Not done.
- GPU timer queries are noisy (frequency ramp, other apps on the GPU): single numbers below about 20 % are not differences.
- Not measured: a real phone or Safari/iOS (simulator off limits); mobile figures are the 390x844 @3 emulation on the M4 and cannot show a slow GPU. The governor is tested with CPU throttling and forced levels (screenshots of levels 0, 1, 2 checked), not on a slow device. Mobile S2 is not in the suite (the places list is not reachable by a click on the phone layout).
- Two gate changes: the hollow-road check "two outlines" now allows 2 of 384 lines (at most 0.6 %) to double one outline up to 3.0 cells per step (at 3 map pixels per cell a horizontal outline that lies exactly on a cell boundary lights both rows; the threshold prefers two cells to none) instead of a hard 2.6 maximum; the `LINES_QUERY=hires=1` environment variable runs the gate against the device-resolution path (165 of 165 with the old limits).
- Display scale: 120 Hz means 8.3 ms per frame for everything (Chrome compositor and WindowServer included); the app's own cost is now about 1 ms of main thread and 1 to 1.5 ms of GPU at street scale on this machine.

## Knobs

| Knob | Where | Effect |
|---|---|---|
| `STREET_TUNING.renderScale` (3) | `street/tuning.ts` | map pixels per cell per axis; 2 is cheaper and fails the line gate |
| `STREET_TUNING.snapPanFromZoom` (12; 0 = off) | same | pan snapping |
| `GOVERNOR` (window 90, slow 26 ms with a median above fast, fast 18.5 ms, dwell 4 s, calm 10 s) | `engine/governor.ts` | the adaptive quality steps |
| `HANDOVER.mountZoom` (2.6) `/ followZoom` (3.0) `/ followDebounceMs / unmountDelayMs` | `handover/maths.ts` | when the street map exists and follows while hidden (earlier since the cut moved from 5.05 to 3.7: the chunk and tiles must be ready by then) |
| `HANDOVER.cutZoom` (3.7) `/ cutBackZoom` (3.45) `/ cutMaxWaitMs` (1200) `/ crossfadeMs` (300) | same | the globe <-> street cut and its tone cross-fade (0 = instant) |
| `HANDOVER.revealFocus` | same | true restores the device-resolution render (and its cost) for the sharp reveal |
| `PALETTE_LEVELS` (12) | `globe/engine/palette.ts` | the grey ramp (both renderers); `?levels=N` with `?globe-debug` overrides it for checks |
| `EASE` (`msPerLevel` 24, `radius` 2, `jumpCells` 30), `TILE_FADE` (`idleGapMs` 250), `StreetMapOptions.tileFade` | `street/core/ease.ts`, `street/gl/compositor.ts` | the temporal ease: fade speed, match radius of moving lines, the camera jump that drops the previous image; `tileFade: false` turns it off |
| `?globe-debug` + `sessionStorage street-opts` | | `{"snapPan":false}`, `{"governor":false}`, `{"highResolution":true}`, `{"renderScale":2}` for A/B runs |
| Tile cache / workers | MapLibre defaults | left as is: tiles are not the bottleneck (parse happens in the worker); revisit with a phone |

## Palette, tone ramps and tile fade (2026-10-05)

What changed for the frame: the pass writes a palette level per cell instead of a class code (same texture reads), the lattice maths for fills is gone (flat washes), the fade-in ramp layers are gone (one MapLibre layer per class instead of two: about a third fewer layers drawn when a class is ramping), and there is one more tiny pass at art resolution (pass E, 480x300 cells at 1440x900: one texel read and one write per cell, a ping-pong pair of RGBA8 textures) that runs every map frame. The Three.js scissor is gone (it measured no gain, `web-architecture.md`). The tile fade loop (rAF, one pass per 32 ms for at most `levels - 1` ticks) runs only after content changed at a resting camera and ends by itself.

A/B on the same machine and session, production builds of HEAD `ef74d89` (before) and this work (after), headless (60 Hz), `run.mjs --repeat 2`, two interleaved rounds, GPU timer queries (noisy, frequency ramp), medians of the two rounds:

| Scenario | before: main / raf ms per frame, GPU mean / p95 ms | after |
|---|---|---|
| S2 flight to HCMC | 2.9 / 1.8, 2.5 / 5.7 | 3.2 / 1.8, 2.9 / 7.1 (max interval 33 to 50 ms in both: the one-off map creation) |
| S4 street pan | 2.2 / 1.3, 2.9 / 4.1 | 2.3 / 1.4, 2.9 / 3.6 |
| S5 street pan, panel open | 2.5 / 1.3, 3.5 / 4.4 | 2.7 / 1.4, 3.4 / 4.7 |

No difference outside the noise (about 20 %); no missed vsync in S4 and S5, 0.8 % dropped frames in S5 in both. `pnpm --filter @catalyst/web perf` (clean production build, one pass of every scenario): all budgets pass, idle 0 draws and 0 app rAF; S1 main 2.10 ms, GPU 0.26; S4 main 2.41 / raf 1.48 / GPU 2.90 (p95 3.61); S5-open main 2.74 / GPU 3.09; mobile S4 main 2.41. The street engine chunk is unchanged in size within 1 % (total client JS gzip 837 KB against 845 KB, the latter built with the dev routes).

A bug the budget run caught during this work: hiding the suspended Three.js canvas with `visibility: hidden` also removed it as the pointer target (no pan at street scale, S4/S5 recorded zero frames); it is `opacity: 0` now and `scripts/globe/stale-check.mjs` drags the map to prove it.

Reload fade: the stage is transparent until the final frame is drawn (opacity only, no extra frame work); the page colour is painted first. Reveal 0.62 to 0.65 s after navigation with the local archive.

## Palette contrast and fill patterns (2026-10-06)

The pass gained a cleanest-texel scan for fill codes (up to 9 reads per cell, only for cells whose centre carries a fill or any red; empty cells return at once) and the fills are evaluated as lattices (two integer tests). `pnpm --filter @catalyst/web perf` (headless, 3 repeats) meets every budget, e.g. desktop s4 gpuMean 2.84 ms (budget 4.5), gpuP95 3.77 (8), s5-open gpuMean 3.20 (5), mobile s4 mainMs 2.51 (5), crawl residual 0. Not run against a second build, so there is no A/B for the scan itself; the budget margin is the evidence.

## Temporal ease, cut fade and road hierarchy (2026-10-07)

What changed for the frame (`docs/street-architecture.md`, "Temporal ease"): pass E now runs on every map frame, not only after the camera rests: it reads four small textures (T, Tp, P and the warp mesh) and writes two (the presented image and the classified one kept as the next frame's Tp, in one pass through a second render target), looking at up to 25 warped neighbours per line cell and 81 per fill cell; the loops only run for cells that are lit in the target or in the presented image, an empty cell costs a few fetches. The CPU side is the warp mesh (a 16-cell mesh, 0.1 ms per frame) and the settle loop (rAF, only while a fade runs). The cut adds `levelsFromCanvas` (one pass classifying the Three.js canvas: once at the globe-to-street cut, and on each frame of the 300 ms street-to-globe fade) and keeps the street map on screen 300 ms when going back to the globe. The road hierarchy changes the style only: two-pixel motorways, trunks and primaries from z9 add cells to classify and to ease, not passes.

Cost of the ease, same session, interleaved with `tileFade: false` (which presents the classified image as before the ease: one trivial pass), `run.mjs --scenarios s4 --repeat 2`, headless, GPU timer queries: S4 GPU mean 2.8 and 2.9 ms against 1.9 ms (map 0.8 against 0.6, pixel pass 2.0 against 1.35), main thread 2.7 to 2.8 against 2.6 to 2.9 ms, raf 1.8 to 1.9 against 1.7 to 1.9 ms. The pass-level timers (`debug().profile`, Paris z12.4, 1440x900 @2, 120 pan frames with a zoom wobble) say the same: ease 1.3 to 1.5 ms against 0.8 to 1.2, classify 1.2 to 1.9 against 0.8 to 1.0 (about 20 % noise). So the temporal ease costs about 0.7 to 0.9 ms of GPU per moving frame at DPR 2 headless (headed 120 Hz values are lower), 0.1 ms of main thread, and nothing at rest or idle (the settle loop ends by itself; asserted). The S4 budget (GPU mean 4.5) keeps its margin: 2.2 to 2.9 ms measured on a quiet GPU, against 2.9 (p95 3.6) before this work.

**The pan crawl budget** was "at most 35 % of frame pairs change" (snapped, 36 px/s drag, 60 Hz) and sat exactly at its limit: measured 0.35 to 0.36. That share is not a quality number: a rigid whole-cell pan changes the art image only in the frames in which a cell boundary is crossed, so it is the drag speed over the art pixel size and the frame rate, (36 + 18 px/s) / (2.5 px x 60 Hz) = 0.36 at the 2.5 px art pixel (0.30 at the 3 px of the day the limit was set). The owner's change of the art pixel moved it onto the limit; the temporal ease did nothing to it (the crawl metric reads the classified codes, which the ease does not touch). The budget is now `changedPerCell`: changed frames per art cell the map travelled (read from the map centre), at most 1.05. A rigid pan can change at most one frame per cell crossed, so 1.0 means "a frame changes exactly when a boundary is crossed and never otherwise"; a re-sampled line or a flickering dash adds changes without crossings and raises it. Measured 0.71 to 1.00 over four runs (less than 1 when a frame crosses two boundaries at once; the sampling of the drag by Playwright decides which). `residualMean` 0 (nothing but a whole-cell shift) still guards the picture; the unsnapped control (changedShare 0.93 to 0.99, residual 0.30) must still show crawl. The share itself is printed as an `info` row.

**Reading GPU failures** (`budget.mjs` now prints the GPU's utilization before the run and a note when it is above 30 %): GPU timer queries include other processes' work on the same GPU. On the day of this work another process held it at 60 to 78 % for hours, and the very same build measured S1 0.3 ms (quiet) and 1.4 ms (busy), S4 2.2 to 2.9 ms (quiet) and 5.4 to 9.8 ms (busy, p95 up to 32 ms). Main thread, raf, missed frames and dropped frames do not move with it. A GPU failure with a note above is not a regression: rerun when the machine is idle (`ioreg -r -d 1 -c IOAccelerator | grep Utilization`).

Results of this work (production build, headless, medians of 3, quiet GPU, first full run; `pnpm perf`): idle 0 draws and 0 app rAF; S1 main 1.44 ms, raf 0.38; S2 HCMC main 2.31, GPU 2.53 (p95 7.33), max interval 16.8 ms; S3 in main 2.15, GPU 2.45; S3 out main 1.50, GPU 2.17; S4 main 1.95, raf 1.22, GPU 2.24 (p95 3.84), heap 60 MB; S5 open main 2.19, GPU 3.10; mobile S4 main 2.49, 0 missed; crawl residual 0, 0.95 to 1.00 changed frames per cell. S1 GPU read 1.16 in that run (a busy GPU: see above; it is the globe alone, which this work does not touch; 0.2 to 0.3 ms when quiet). The handover idle drill (`scripts/globe/handover-perf.mjs idle`) reads 0 rAF calls, 0 ticks, 0 renders and 0 passes at world scale, just past the cut (zoom 3.75) and at street scale.

Harness changes that came with it: `settleApp` (`scripts/globe/handover-lib.mjs`) no longer waits for `shown == target` in the cut mode inside the dissolve band (the target is a function of zoom there, `shown` is 0 or 1); it waits for the cut (`cutPending`) and the cross-fade (`easing`). `handover-drills.mjs` clicks a place by its box border (boxes are picked by their band, not their interior). `handover-perf.mjs` samples "just past the cut" at zoom 3.75 (the old "mid-dissolve at 5.05" is street scale now).

Not measured: Safari / iOS, a real phone or a GPU weaker than the M4: the temporal ease raises the per-frame GPU work by the amount above, which a phone feels more; the frame governor (`engine/governor.ts`) steps the render scale and then the art pixel; the second step also shrinks the ease's grid (1.4 times fewer cells at 3 px instead of 2.5), but there is no step that only drops the ease. A cheaper variant (one neighbour lookup from a locally affine warp instead of 25 mesh lookups) is the first thing to try if a phone needs it.

## Idle rotation (2026-10-08)

"Idle = zero frames" now has one exception: the unzoomed world view after 8 s without input (and no place selected, no panel, no reduced motion, tab visible) turns slowly (1.2 degrees a second, eastward). Design in [web-architecture.md](web-architecture.md), "Idle rotation"; code `engine/idle-spin.ts`, `engine/renderer.ts`.

- **Before the delay the cost is unchanged**: zero rAF calls, zero frames (one `setTimeout` is armed; it is not a frame). Asserted by `scripts/globe/idle-spin.mjs start` with the delay shortened to 1.5 s.
- **While turning**: no rAF chain. A timer asks for one frame every `spinFrameMs` (the time the disc's centre takes to move one art pixel: 224 to 234 ms at 1440x900@2, bounded to 50 to 500 ms) and each frame is the ordinary one with the camera longitude changed (JS `render()` about 0.2 ms, the same per-frame GPU work as any other world frame, 0.2 to 0.3 ms quiet GPU in S1). Measured in headless Chrome with a real preview (66 frames in 10 s: 41 timer frames, 24 frames in the 200 ms box transitions that the limb crossings start): **about 4 to 5 frames a second on average**, against 60 for a running animation, so the duty cycle is about 1 to 2 % of a frame budget. GPU time was NOT measured (no `pnpm perf`, no timer queries).
- **The governor keeps working**: the frames are non-continuous with gaps over 100 ms, so its window restarts and it neither steps down nor is fooled (level stayed 0, no console output).
- **The perf budgets and the zero-frame checks are unchanged**: `pnpm perf` idle, `groups.mjs idle`, `handover-perf.mjs idle` and `check.mjs` run in debug mode (`?globe-debug`), where the rotation is off by default (`?rotate` or `?spin-idle=MS` turn it on, `?no-rotate` turns it off anywhere). Add `?rotate` to measure the rotation's own GPU cost with the usual scripts (`flags: { rotate: "1" }` in `scripts/perf/lib.mjs` `openPage`).
- **Not measured**: the GPU cost per frame, a phone, Safari/iOS, battery. If it matters, the speed (`SPIN.degPerSec`) and the delay (`SPIN.idleMs`) in `engine/idle-spin.ts` are the knobs; a lower speed makes the period longer in proportion.
