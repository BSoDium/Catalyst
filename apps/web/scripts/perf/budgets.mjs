// Performance budgets (docs/performance.md, "Budgets"). Every number is a MEDIAN over the repeats of a scenario, measured
// on an Apple M4 (the owner's machine class) with Chrome for Testing + ANGLE Metal.
//
// The limits are set for the HEADLESS run (a 60 Hz compositor, which also makes the CPU numbers about twice those of a
// headed run on the 120 Hz built-in display: the same code, idle gaps between frames let the cores clock down). A headed run
// meets them with room to spare. Headroom over the measured value is 1.3x to 1.6x for CPU numbers (noise on a laptop that is
// doing other things). The GPU numbers (a timer query: they include the GPU's own frequency ramp, so they are the noisiest)
// are set between the native-resolution value and the value of the device-resolution render this work replaced
// (s4: 2.8 now, 8.9 before; s5-open 3.3 now, 9.5 before), so they catch that regression and nothing finer.
//
// Re-fit of the CPU limits, 2026-10-09 (docs/performance.md, "Budgets re-fitted 2026-10-09"): the old main-thread limits of s1 and s3 and the raf
// limit of s3 no longer held on this machine even for the code they were set on (the commit of 2026-10-07, 409d213, measured s1 main 2.5 to 2.6
// ms and s3 main 3.0 to 3.1 on 2026-10-09 against the 1.44 and 2.15 recorded then: the same laptop, a later OS / Chrome state and thermals; the
// check had been passing on that day's numbers only). On top of that the polish work added about 0.7 ms of main thread to the world view
// (idle rotation and sky 0.3, DOM labels 0.2, early opening of groups 0.1, label glide 0.1). The new limits are the 2026-10-09 medians (5 to 6
// repeats, quiet GPU: s1 3.4 main / 0.9 raf, s3-in 3.6 / 2.2, s3-out 3.5 / 2.3, mobile s1 3.5) with the same 1.25 to 1.3 times of headroom the
// others have. The GPU limits, the frame limits (missed, maxRatio, maxMs) and the heap limits are NOT changed: they still hold.
//
// Metrics (see lib.mjs for how each is measured):
//   missed     frame intervals above 1.5 display periods (the period is detected, so 60 and 120 Hz screens both work)
//   maxRatio   largest frame interval / display period (steady scenarios)
//   maxMs      largest frame interval, ms (scenarios with a one-off street map creation)
//   mainMs     main-thread busy ms per active frame (Chrome trace: RunTask)
//   rafMs      time in animation-frame callbacks per active frame
//   gpuMean    GPU time per frame, ms (EXT_disjoint_timer_query: map + pass + globe contexts)
//   gpuP95     the same, 95th percentile
//   dropPct    share of compositor frames reported dropped by the trace
//   heapMB     JS heap at the end
export const BUDGETS = {
  // World view, street map not mounted. Was: the pre-street cost (headless: main 2.15, raf 0.5, GPU 0.3 at the commit before the street work), limits 2.8 / 0.9.
  // Now (2026-10-09): main 3.4, raf 0.9, GPU 0.2 to 0.3 (see the re-fit note above); the GPU is still the pre-street one.
  s1: { missed: 1, maxRatio: 1.6, mainMs: 4.4, rafMs: 1.2, gpuMean: 0.6, gpuP95: 1.5, dropPct: 0.5, heapMB: 40 },
  "s2-hcmc": { missed: 4, maxMs: 80, mainMs: 4.2, rafMs: 2.4, gpuMean: 4.5, gpuP95: 9, dropPct: 3, heapMB: 90 },
  "s3-in": { missed: 4, maxMs: 90, mainMs: 4.6, rafMs: 2.8, gpuMean: 3.5, gpuP95: 8, dropPct: 4, heapMB: 90 }, // main / raf were 3.2 / 1.8
  "s3-out": { missed: 3, maxMs: 50, mainMs: 4.5, rafMs: 2.9, gpuMean: 3.0, gpuP95: 7, dropPct: 1, heapMB: 100 }, // main / raf were 3.0 / 2.0
  // s4 heapMB 110 (was 90): the heap is the UNCOLLECTED size at the end of the run, so it depends on when the GC last ran: the same
  // build measured 55 to 96 MB over runs at a 2.5 px art pixel and 94 MB three times at 3 px (2026-10-06), i.e. it did not move with
  // the art pixel size; frame time (gpu, main, raf) is what the budget protects.
  s4: { missed: 1, maxRatio: 1.8, mainMs: 3.4, rafMs: 2.3, gpuMean: 4.5, gpuP95: 8, dropPct: 0.5, heapMB: 110 },
  "s5-open": { missed: 1, maxRatio: 1.8, mainMs: 3.6, rafMs: 2.3, gpuMean: 5, gpuP95: 8, dropPct: 1.5, heapMB: 90 },
};
/** Emulated 390x844 @3 (headless, 60 Hz). No GPU budget: the timer query is too noisy on this path to separate anything. */
export const MOBILE_BUDGETS = {
  s1: { missed: 1, maxRatio: 1.6, mainMs: 4.5, dropPct: 0.5, heapMB: 40 }, // main was 3 (measured 3.5 on 2026-10-09, see the re-fit note)
  s4: { missed: 1, maxRatio: 1.8, mainMs: 5, rafMs: 3.2, dropPct: 0.5, heapMB: 100 },
};
/** Idle: not one frame, not one animation-frame request of the app. */
export const IDLE_BUDGET = { draws: 0, appRafCalls: 0 };
/**
 * Pan stability (crawl.mjs), snapped: the picture only translates. `snapChangedPerCell`: frames whose art image changed, per art cell the
 * map travelled. A rigid whole-cell pan changes a frame only when a cell boundary is crossed, so this is at most 1 (about 0.7 to 0.95 measured:
 * frames that cross both axes at once count once); a frame that changes without a crossing (a re-sampled line, a flickering dash) raises it.
 * It replaces a limit on the SHARE of changed frames (was 0.35): that share is the drag speed over the art pixel size and the frame rate
 * ((36 + 18 px/s) / (2.5 px x 60 Hz) = 0.36 at the 2.5 px art pixel), a property of the test and the display, not of the renderer.
 */
export const CRAWL_BUDGET = { snapResidualMean: 0, snapChangedPerCell: 1.05, unsnappedMustExceed: 0.1 };
