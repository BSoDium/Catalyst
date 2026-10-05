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
  // World view, street map not mounted: must stay at the pre-street cost (headless: main 2.15, raf 0.5, GPU 0.3 at the commit before the street work).
  s1: { missed: 1, maxRatio: 1.6, mainMs: 2.8, rafMs: 0.9, gpuMean: 0.6, gpuP95: 1.5, dropPct: 0.5, heapMB: 40 },
  "s2-hcmc": { missed: 4, maxMs: 80, mainMs: 4.2, rafMs: 2.4, gpuMean: 4.5, gpuP95: 9, dropPct: 3, heapMB: 90 },
  "s3-in": { missed: 4, maxMs: 90, mainMs: 3.2, rafMs: 1.8, gpuMean: 3.5, gpuP95: 8, dropPct: 4, heapMB: 90 },
  "s3-out": { missed: 3, maxMs: 50, mainMs: 3.0, rafMs: 2.0, gpuMean: 3.0, gpuP95: 7, dropPct: 1, heapMB: 100 },
  s4: { missed: 1, maxRatio: 1.8, mainMs: 3.4, rafMs: 2.3, gpuMean: 4.5, gpuP95: 8, dropPct: 0.5, heapMB: 90 },
  "s5-open": { missed: 1, maxRatio: 1.8, mainMs: 3.6, rafMs: 2.3, gpuMean: 5, gpuP95: 8, dropPct: 1.5, heapMB: 90 },
};
/** Emulated 390x844 @3 (headless, 60 Hz). No GPU budget: the timer query is too noisy on this path to separate anything. */
export const MOBILE_BUDGETS = {
  s1: { missed: 1, maxRatio: 1.6, mainMs: 3, dropPct: 0.5, heapMB: 40 },
  s4: { missed: 1, maxRatio: 1.8, mainMs: 5, rafMs: 3.2, dropPct: 0.5, heapMB: 100 },
};
/** Idle: not one frame, not one animation-frame request of the app. */
export const IDLE_BUDGET = { draws: 0, appRafCalls: 0 };
/** Pan stability (crawl.mjs), snapped: the picture only translates. */
export const CRAWL_BUDGET = { snapResidualMean: 0, snapChangedShare: 0.35, unsnappedMustExceed: 0.1 };
