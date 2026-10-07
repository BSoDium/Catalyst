// Line regression gate for the production street module (port of prototypes/street-zoom/scripts/line-regression.mjs;
// spec: docs/pixel-line-rules.md section 6). Exit code 1 on any violation.
//
//   pnpm --filter @catalyst/web test:street-lines [-- --quick] [--json=out.json]
//
// Needs Chrome for Testing (CHROME_PATH) and the dev server (BASE_URL, default http://localhost:5231; the script
// starts `react-router dev` on that port when nothing answers and --serve is given). Checks:
//   1. synthetic polylines through the PRODUCTION style and pass: 24 angles x 16 sub-pixel offsets x 3 zooms at DPR 1,
//      1.5 and 2 - every one-pixel line is ONE 8-connected component, both ends covered, about one cell per step (no
//      doubling, none missing); hollow roads are TWO outlines; dashed lines never vanish at any angle
//   2. real map (local PMTiles, pinned fallback source): idle = zero renders and zero rAF calls; thin lines show no 2x2
//      blocks (the stair remover ran); the art grid holds ink
// Not ported from the spike: the high-resolution reference comparison of the real map (per-class missing / fragmentation
// against a native raster) and the pan stability metrics; the synthetic part is the contract that carries the rules.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { BASE_URL, FALLBACK_URL, ensureTiles, launch, open, dev } from "./_lib.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const t = a.replace(/^--/, "");
    const i = t.indexOf("=");
    return i < 0 ? [t, "1"] : [t.slice(0, i), t.slice(i + 1)];
  }),
);

// LINES_QUERY=hires=1 (or scale=3): run the gate against another render path (the defaults are the production ones).
const EXTRA = process.env.LINES_QUERY ?? "";

export const LIMITS = {
  synthetic: { broken: 0, endMiss: 0.005, doubled: 0.005, thin: 0.005, dashZero: 0, dashMin: 0.2, dashSpread: 4, hollowPerStep: 3.0, hollowDoubled: 0.006, hollowBroken: 0.005, wrongLevel: 0.005 },
  // z14.5 downtown HCMC: main roads are one-pixel (thin class) lines there since the LOD thinning of the style, and dual
  // carriageways, river banks and junctions put thin lines side by side (measured 0.28-0.30); 2x2 blocks that are real
  // adjacency cannot be thinned. The synthetic sweep above stays the contract for the stair remover.
  // fillMaxLevel: the `soft` role at the default 12 levels (engine/palette.ts): water and park patterns never get louder than the paths
  real: { blocks: 0.06, blocksCity: 0.35, fillMaxLevel: 4, fillStray: 0.005 },
};

const failures = [];
const rows = [];
function check(name, value, limit, op = "<=") {
  const ok = op === "<=" ? value <= limit : value >= limit;
  rows.push({ name, value, limit: `${op} ${limit}`, ok });
  if (!ok) failures.push(`${name}: ${value} (limit ${op} ${limit})`);
}

const up = async () => {
  try {
    return (await fetch(BASE_URL)).ok;
  } catch {
    return false;
  }
};
let server;
if (args.serve && !(await up())) {
  const port = new URL(BASE_URL).port || "5231";
  server = spawn("pnpm", ["exec", "react-router", "dev", "--port", port], { stdio: "ignore", cwd: new URL("../..", import.meta.url).pathname, env: { ...process.env, CATALYST_CONTENT: "demo" } });
  for (let i = 0; i < 90 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
}
if (!(await up())) {
  console.error(`no dev server at ${BASE_URL} (start \`pnpm --filter @catalyst/web dev\` on that port or pass --serve)`);
  process.exit(2);
}

const classes = ["road-minor", "building-outline", "road-major-case", "road-medium-case"];
const zooms = [13, 15, 17.5];
const expected = { "road-major-case": { 17.5: 2 }, "road-medium-case": { 17.5: 2 } };
const dashed = ["road-minor-dotted", "boundary-region"];

async function synthetic(browser, dpr) {
  const { page, logs } = await open(browser, { viewport: { width: 800, height: 560 }, deviceScaleFactor: dpr });
  try {
    await page.goto(`${BASE_URL}/dev/street-lines${EXTRA ? "?" + EXTRA : ""}`);
    await page.waitForFunction(() => window.__synthetic, null, { timeout: 90000 });
    await page.evaluate(() => window.__synthetic.ready());
    const L = LIMITS.synthetic;
    for (const cls of classes) {
      for (const zoom of zooms) {
        const s = await page.evaluate(([c, z, e]) => window.__synthetic.sweep(c, z, { expected: e }), [cls, zoom, expected[cls]?.[zoom]]);
        const onePx = ["road-minor", "building-outline"].includes(cls);
        const tag = `synthetic dpr${dpr} ${cls} z${zoom}`;
        // hollow roads: two outlines that touch at a measure-zero angle/offset tie (1 line of 384) are tolerated, 0.5 % like the ends
        check(`${tag} broken`, s.brokenFrac, onePx ? L.broken : L.hollowBroken);
        // the palette level is the class's whatever the angle and offset (quantisation has no smoothing between cells)
        check(`${tag} lines with a cell at the wrong palette level`, s.wrongLevelFrac, L.wrongLevel);
        if (onePx) {
          check(`${tag} endMiss`, s.endMissFrac, L.endMiss);
          check(`${tag} doubled`, s.doubledFrac, L.doubled);
          check(`${tag} thin`, s.thinFrac, L.thin);
        } else if (cls === "road-major-case" && zoom < 16) {
          // The road hierarchy (motorway, trunk and primary are 2 art px wide from z9): a two-pixel band sampled at cell centres is 2 cells per
          // step along an axis and 2 / cos(angle) = 2.83 at 45 degrees; it never breaks, is never one cell thin and never a three-cell smear.
          check(`${tag} cells per step (a two-pixel band, 2 to 2.83)`, s.perStepMin, 1.8, ">=");
          check(`${tag} cells per step (a two-pixel band, 2 to 2.83), max`, s.perStepMax, 3.1);
        } else if (zoom >= 17.5) {
          // The two outlines of a hollow road: ~2 cells per step. At 3 map pixels per cell a horizontal outline that sits exactly on
          // a cell boundary lights both rows (the 0.49 threshold prefers two cells to none): 2 of 384 lines, never more.
          check(`${tag} lines with a doubled outline (> 2.6 cells per step)`, s.hollowDoubledFrac, L.hollowDoubled);
          check(`${tag} cells per step (two outlines)`, s.perStepMax, L.hollowPerStep);
        }
      }
    }
    for (const cls of dashed) {
      for (const zoom of zooms) {
        const d = await page.evaluate(([c, z]) => window.__synthetic.dashSweep(c, z), [cls, zoom]);
        const tag = `synthetic dpr${dpr} ${cls} z${zoom}`;
        check(`${tag} lines with no ink`, d.zeroFrac, L.dashZero);
        check(`${tag} min cells/step`, d.densityMin, L.dashMin, ">=");
        check(`${tag} max/min density`, d.densityMax / Math.max(d.densityMin, 1e-6), L.dashSpread);
      }
    }
    if (logs.length) console.error(logs.join("\n"));
  } finally {
    await page.context().close();
  }
}

async function real(browser, dpr) {
  const { page } = await open(browser, { viewport: { width: 800, height: 560 }, deviceScaleFactor: dpr });
  try {
    for (const view of ["106.698,10.774,14.5", "106.6995,10.7765,16.5", "106.6995,10.7765,17.5"]) {
      await page.goto(dev("/dev/street", { source: "fallback", fallbackUrl: FALLBACK_URL, hud: 0, view, theme: "light", ...Object.fromEntries(new URLSearchParams(EXTRA)) }));
      await page.waitForFunction(() => window.__streetDebug?.map().loaded() && document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state") === "fallback", null, { timeout: 60000 });
      await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded(); });
      await page.waitForTimeout(500);
      const r = await page.evaluate((FILL_MAX) => {
        const dbg = window.__streetDebug;
        const art = dbg.readCodes();
        const { cols, rows, codes } = art;
        // palette: how many distinct levels the picture uses, and whether the tile fade has settled on the classified image
        const seen = new Set(art.levels);
        const presented = dbg.readPresentedLevels();
        let unsettled = 0;
        for (let i = 0; i < art.levels.length; i++) if (presented[i] !== art.levels[i]) unsettled++;
        const at = (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows ? 0 : codes[y * cols + x] === 1 ? 1 : 0);
        // thin ink cells (class 1) in a fully inked 2x2 block: the stair remover must have left none
        let thin = 0, blk = 0, ink = 0;
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
          const c = codes[y * cols + x];
          if (c === 1 || c === 2) ink++;
          if (!at(x, y)) continue;
          thin++;
          if ((at(x + 1, y) && at(x, y + 1) && at(x + 1, y + 1)) || (at(x - 1, y) && at(x, y - 1) && at(x - 1, y - 1)) || (at(x + 1, y) && at(x, y - 1) && at(x + 1, y - 1)) || (at(x - 1, y) && at(x, y + 1) && at(x - 1, y + 1))) blk++;
        }
        // fills (code 3) are screen-anchored patterns (core/palette.ts PATTERN): at city scale there are no flat building washes yet, so
        // every lit fill cell must sit on the dot lattice of the parks or on the dash rows of the water (mirrors `patternLit` in the pass)
        const green = (x, y) => ((x & 3) === 0 && (y & 3) === 0) || ((x & 3) === 2 && (y & 3) === 2);
        const water = (x, y) => (y & 3) === 0 && (x + ((y >> 2) & 1) * 3) % 6 < 3;
        let fill = 0, offLattice = 0, loud = 0;
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
          if (codes[y * cols + x] !== 3) continue;
          fill++;
          if (!green(x, y) && !water(x, y)) offLattice++;
          if (art.levels[y * cols + x] > FILL_MAX) loud++;
        }
        return { ink, thin, blk, distinct: seen.size, unsettled, fill, offLattice, loud };
      }, LIMITS.real.fillMaxLevel);
      const tag = `real dpr${dpr} z${view.split(",")[2]}`;
      check(`${tag} has ink`, r.ink, 200, ">=");
      check(`${tag} palette levels in use`, r.distinct, view.endsWith("14.5") ? 3 : 2, ">=");
      check(`${tag} cells still fading after the map settled`, r.unsettled, 0);
      check(`${tag} thin-ink cells in 2x2 blocks`, r.thin ? r.blk / r.thin : 0, view.endsWith("14.5") ? LIMITS.real.blocksCity : LIMITS.real.blocks);
      if (view.endsWith("14.5")) {
        check(`${tag} lit fill cells (water / park patterns)`, r.fill, 100, ">=");
        // A cell inside the anti-aliased fringe of a route halo can read a scaled code (a handful per view, next to the route), hence a share, not zero.
        check(`${tag} fill cells off the pattern lattices (screen-anchored), share`, r.offLattice / Math.max(1, r.fill), LIMITS.real.fillStray);
        check(`${tag} fill cells above the dimmed fill level (soft), share`, r.loud / Math.max(1, r.fill), LIMITS.real.fillStray);
        // pan by a fractional number of cells: the patterns are a function of the screen cell, so the lattices still hold
        await page.evaluate(() => window.__streetDebug.map().jumpTo({ center: [106.7015, 10.7762] }));
        await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded(); });
        await page.waitForTimeout(500);
        const p2 = await page.evaluate(() => {
          const { cols, rows, codes } = window.__streetDebug.readCodes();
          const green = (x, y) => ((x & 3) === 0 && (y & 3) === 0) || ((x & 3) === 2 && (y & 3) === 2);
          const water = (x, y) => (y & 3) === 0 && (x + ((y >> 2) & 1) * 3) % 6 < 3;
          let fill = 0, off = 0;
          for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (codes[y * cols + x] === 3) { fill++; if (!green(x, y) && !water(x, y)) off++; }
          return { fill, off };
        });
        check(`${tag} after a pan: fill cells off the pattern lattices, share`, p2.off / Math.max(1, p2.fill), LIMITS.real.fillStray);
        check(`${tag} after a pan: lit fill cells`, p2.fill, 100, ">=");
        await page.evaluate(() => window.__streetDebug.map().jumpTo({ center: [106.698, 10.774] }));
        await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded(); });
        await page.waitForTimeout(500);
      }
      if (dpr === 2 && view.endsWith("14.5")) {
        const before = await page.evaluate(() => ({ r: window.__streetDebug.renders(), raf: window.__raf.calls, p: window.__streetDebug.passes() }));
        await page.waitForTimeout(1500);
        const after = await page.evaluate(() => ({ r: window.__streetDebug.renders(), raf: window.__raf.calls, p: window.__streetDebug.passes() }));
        check("idle renders", after.r - before.r, 0);
        check("idle pass runs", after.p - before.p, 0);
        check("idle rAF calls", after.raf - before.raf, 0);
      }
    }
  } finally {
    await page.context().close();
  }
}

const tiles = await ensureTiles();
const browser = await launch();
try {
  for (const dpr of [1, 1.5, 2]) await synthetic(browser, dpr);
  if (!args.quick) for (const dpr of [1, 2]) await real(browser, dpr);
} finally {
  await browser.close();
  await tiles.stop();
  server?.kill();
}

const w = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name.padEnd(w)}  ${typeof r.value === "number" ? r.value.toFixed(4) : r.value}  (${r.limit})`);
if (args.json) writeFileSync(args.json, JSON.stringify(rows, null, 1));
console.log(`\n${rows.length - failures.length}/${rows.length} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
