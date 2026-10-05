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
5. **Adaptive frame-budget governor** (`engine/governor.ts`, pure and unit tested; wired in `handover/controller.ts`). It watches the intervals between consecutive moving frames: when the p95 of 90 frames is above 26 ms it steps down, one level at a time, at most one change per 4 s: level 1 renders the street map at 2 instead of 3 map pixels per cell (less than half the map pixels, short dashes soften), level 2 makes the art pixel one CSS pixel larger in both renderers (3 to 4, 2 to 3 on phones). It steps back up only after 10 s of p95 below 18.5 ms, and a step up undone within 20 s locks the level for 90 s (no flapping). Idle gaps (>100 ms) restart the window, so they are never read as slow frames. With the DPR already folded into whole-device-pixel cells, "a DPR cap" is moot: the render is already at art resolution at any DPR. Debug: `__handoverDebug.quality()` / `forceQuality(level)`; `--street-opts '{"governor":false}'` disables it.
6. **Smaller**: `texSubImage2D` instead of `texImage2D` when the size is unchanged; phase timers (`engine/perf.ts`); the palette table (below); `highResolution` only when `HANDOVER.revealFocus` is on.

### Palette table (later phase: richer greys)

`app/globe/street/core/palette.ts` is the one table. `PALETTE_LEVELS` (now 2, up to `MAX_LEVELS` 10) is the number of ramp levels between the page colour and the ink; `paletteLevels(n)` names them (`bg`, `ramp-1` ... `ramp-(n-2)`, `ink`, then `muted`), `buildPalette(theme, n)` gives the colours (`mix(bg, ink, k/(n-1))`) and `codeLevel` (class code to level). The shader gets `uPal[MAX_LEVELS]` and `uCodeLevel[8]`, and the fill tone is quantised to `TONE_STEPS` against the Bayer lattice. Today n = 2, so the look is unchanged (verified by the gate and the cell comparison). A richer palette raises `PALETTE_LEVELS` and routes the fill tone to ramp levels in the tone stage of `FRAG_POOL`/`CODE_LEVEL`; **the line rules never look at levels**: lines are the classes `thin`/`solid` and always draw in the ink level (1 art-pixel floor, centre sampling, no antialiased grey, stair removal), whatever the level count.

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

## Budgets

`budgets.mjs`, checked by `pnpm perf` (exit 1 when exceeded). Headless limits (headed runs are lower, they meet the same numbers): idle 0 draws and 0 app rAF calls; S1 main <= 2.8 ms, raf <= 0.9, GPU mean <= 0.6, at most 1 missed vsync, 0.5 % dropped; S4 main <= 3.4, raf <= 2.3, GPU mean <= 4.5 / p95 <= 8, max interval <= 1.8 periods; S2/S3 max interval <= 80/90 ms and at most 4 missed vsyncs; mobile S1/S4 main <= 3/5 ms; pan crawl residual 0 with at most 35 % of frame pairs changing (and the unsnapped control must show crawl). The GPU limits sit between the native value and the device-resolution value they replaced, so the negative control works: the script fails on the `938a1a8` build (S4 GPU mean 7.1 > 4.5, p95 10.3 > 8, crawl residual 0.30). Run it before and after any change to the renderer, the style, the pass or the handover; if a limit is exceeded by noise, rerun with `--repeat 5` before touching it.

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
| `GOVERNOR` (window 90, slow 26 ms, fast 18.5 ms, dwell 4 s, calm 10 s) | `engine/governor.ts` | the adaptive quality steps |
| `HANDOVER.mountZoom / followZoom / followDebounceMs / unmountDelayMs` | `handover/maths.ts` | when the street map exists and follows while hidden |
| `HANDOVER.revealFocus` | same | true restores the device-resolution render (and its cost) for the sharp reveal |
| `PALETTE_LEVELS` (8) | `globe/engine/palette.ts` | the grey ramp (both renderers); `?levels=N` with `?globe-debug` overrides it for checks |
| `TILE_FADE` (`steadyMs` 100, `tickMs` 32), `StreetMapOptions.tileFade` | `street/gl/compositor.ts` | the tile fade |
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
