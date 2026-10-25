# Spec: the globe's remount on a phone (paused 2026-10-22)

Status: partly done, paused. The memoised network build is written and measured but not committed; the rest is design only.
Context: [performance.md](performance.md) ("A phone's CPU on a Mac", "First finding"), [paths.md](paths.md).

## Problem

On a phone (Pixel 7 is the reference; the owner saw the lag there) closing a place's slide-over makes the page stutter. The globe is unmounted while the
slide-over is open and mounted again on close (`globeActive = !(isMobile && isOpen)` in `routes/shell.tsx`; a deliberate memory choice, kept).
The mount is one long task: 355 ms on the main thread at a 4x CPU slowdown, worst frame 450 ms (550 ms at 6x), 42 % of frames dropped.

## What the measurements say

Method: `pnpm --filter @catalyst/web perf:phone` (production build, Pixel 7 viewport and density, CPU throttle 1 / 4 / 6), scenario `s5-panel-anim`,
plus a CPU profile of the close and a hook on `getContext` (see performance.md). The GPU is the Mac's: the numbers below are CPU-side only.

| Where the 320 ms of the globe's constructor goes (4x) | ms | share |
| --- | --- | --- |
| `RouteLayer` constructor: `buildNetwork` (decode and simplify every leg into 5 levels) and `buildBuffers` | 235 | 73 % |
| the rest of the scene, the caption's own WebGL context, the ring, the labels | about 85 | 27 % |

The paths are not even drawn on the home screen (presence 0), so this is work for a layer nobody sees at that moment.

## Done (uncommitted, in the working tree)

- `buildNetwork` and `buildBuffers` in `paths/network.ts` keep their result: keyed by a hash of the routes' content (the loader's array is a new object at each
  revalidation, so the array's identity is not a usable key), shared by every mount. Test in `paths.test.ts`.
- Result, same scenario, 3 repeats: worst frame 450 to 133 ms at 4x, 550 to 217 ms at 6x, 100 to 33 ms on the Mac; dropped frames 42 % to 18 % at 4x;
  main-thread work over the scenario about halved at 4x.
- Tooling: `scripts/perf/phone.mjs`, the `pixel7` profile in `scripts/perf/lib.mjs`, `perf:phone` in package.json.

## Left, in the order I would do it

1. **The first mount still builds the network once** (about 235 ms at 4x, at page load, during the caption's entrance). Move it behind the first frame, in idle slices:
   - `RouteLayer` creates its material, geometry shell and `line` at once (so every setter keeps working: uniforms, theme, presence, pixel size) with an empty network
     (`legs: []`) and a 1 x 1 state texture, the line invisible. Data arrives later: `buildNetwork` becomes a generator (one yield per leg, or per few ms) driven by
     `requestIdleCallback` (a `setTimeout` fallback), then `buildBuffers` in one slice, then the attributes, index, state texture and `uTexSize` are swapped in.
   - Replay at the end: the last `select(key)` (a place chosen before the data was there), `thinSig = ""`, the draw level, and a `requestRender`.
   - Nothing may change when the data is already cached (the mount after the first stays synchronous and instant).
   - Risk: `RouteLayer` is 370 lines of guarded setters (`if (!this.material) return`); an early-returning setter that drops a value is the failure mode. Test: build
     with a deferred network and assert the same uniforms and draw range as a synchronous build.
2. **The other ~85 ms of the remount.** Candidates, to be profiled first (the profile is minified; build with `build.minify: false` or use the dev server's
   timings): the caption layer's own `WebGLRenderer` and texture build (`new CaptionLayer` in `renderer.ts`) could wait for the first frame, as the caption only
   enters after the showcase turns on; `TrailDotsLayer` (leg icons) and the sky build are the other suspects.
3. **Not mounting less often**: keeping the globe mounted (paused, hidden) on mobile while a place is open would remove the remount altogether, at the cost of the
   memory the unmount was chosen to save. A product decision for the owner, not an optimisation; measure the memory on the phone first.

## Acceptance

- `perf:phone --scenarios s5-panel-anim --throttle 1,4,6 --repeat 3`: worst frame at 4x under 50 ms (one dropped frame at most), no frame over 100 ms at 6x.
- The same on the first load (a new scenario: `load` to first idle, long tasks over 50 ms during the caption's entrance).
- No visible change: paths, selection, theme change, the draw-on of a selected place, the Paths layer on the street map identical (existing `scripts/paths/check.mjs`
  checks, which need the `?globe-debug` page; note that script still calls a removed `setPaths`).
- All unit tests green; add the deferred-build equivalence test above.

## Caveats and open questions

- A throttled Mac is not a Pixel 7: the CPU is scaled, the GPU is not. The check that clears it is a trace recorded on the phone (`chrome://inspect`, USB,
  Performance panel). Worth doing once, now that the CPU-side cause is known, to see what the GPU side adds (shader compile at the first draw of the path layer is
  the one thing this setup cannot show).
- The first draw of the path layer (program compile and a 1.9 MB upload) is not in the numbers above: it happens at the first frame the layer is visible. Pre-warm it
  with the slicing in 1, or with `renderer.compileAsync` where available.
- Do the leg-icon layer (`legFeatures`, `dotLegs`) and the thinning (`thinLegs`, about 0.5 ms for 165 legs on the Mac, linear in legs) matter on a phone? Not
  measured to matter; revisit if the leg count grows by an order of magnitude.
