// Line-integrity regression gate (docs/pixel-line-rules.md). Exit code 1 if a threshold is violated, so CI can run it.
//
//   node scripts/line-regression.mjs [--serve] [--query="rule=centre&thin=1&widths=art"] [--quick] [--json=out.json]
//
//   --serve   start `vite` on :5190 for the run (otherwise a server must already answer on :5190)
//   --quick   synthetic checks only (no hcmc.pmtiles needed, ~30 s)
//
// Needs Chrome for Testing (CHROME_PATH or the Playwright cache) and, without --quick, public/hcmc.pmtiles.
// Checks (thresholds below are the contract; the numbers measured when they were set are in the doc):
//   1. synthetic polylines, 24 angles x 16 sub-pixel offsets x 3 zooms x DPR 1, 1.5 and 2: every one-pixel line is ONE
//      8-connected component, both ends covered, ~one cell per step (no doubling), none missing; hollow roads are TWO
//      outlines; dotted lines never vanish at any angle
//   2. real map, high-resolution reference: per line class no missing line, no fragmentation, no thickness doubling
//   3. slow pan: frame-to-frame change no worse than 1.5x the native raster, fill stipples do not swim
//   4. idle = zero frames
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { launch, open } from "./lib.mjs";
import { runSynthetic } from "./synthetic.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const t = a.replace(/^--/, "");
    const i = t.indexOf("=");
    return i < 0 ? [t, "1"] : [t.slice(0, i), t.slice(i + 1)];
  }),
);
const QUERY = args.query ?? "";
const BASE = "http://localhost:5190/";

/** Contract. Fractions are 0..1. */
export const LIMITS = {
  synthetic: {
    broken: 0, // fraction of lines that are not exactly the expected number of components
    endMiss: 0.005,
    doubled: 0.005, // 1 px classes only: > 1.25 cells per major-axis step
    thin: 0.005, // < 0.85 cells per step
    dashZero: 0, // dotted lines with no ink at all
    dashMin: 0.2, // lowest cells-per-step over all angles and offsets
    dashSpread: 4, // max / min density over angles and offsets
    hollowPerStep: 2.6, // two one-pixel outlines: ~1 cell per step each (a measure-zero tie may double one of them)
  },
  real: {
    idealLineMiss: 0.002, // ideal cells with no output ink within one cell
    fragmentationSlack: 2, // output components <= 1.15 * native raster components + this
    sizeRatioMax: 1.1, // output ink cells / native raster ink cells (one-pixel classes)
    blocks: 0.06, // share of ink cells inside 2x2 blocks (roads-minor, buildings)
  },
  motion: { ratio: 1.15, ratioPlain: 1.15, reversals: 0.03, fillChurn: 0.0 },
};

const failures = [];
const rows = [];
function check(name, value, limit, op = "<=") {
  const ok = op === "<=" ? value <= limit : value >= limit;
  rows.push({ name, value, limit: `${op} ${limit}`, ok });
  if (!ok) failures.push(`${name}: ${value} (limit ${op} ${limit})`);
}

async function up() {
  try {
    return (await fetch(BASE)).ok;
  } catch {
    return false;
  }
}

let server;
if (args.serve && !(await up())) {
  server = spawn("pnpm", ["exec", "vite", "--port", "5190", "--strictPort"], { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname });
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
}
if (!(await up())) {
  console.error("no server on :5190 (start `pnpm dev` or pass --serve)");
  process.exit(2);
}

try {
  // ---- 1. synthetic ----------------------------------------------------------------------------------------------
  const L = LIMITS.synthetic;
  for (const dpr of [1, 1.5, 2]) {
    const r = await runSynthetic({
      query: QUERY,
      w: 800,
      h: 560,
      dpr,
      classes: ["road-minor", "building-outline", "road-major-case", "road-medium-case"],
      zooms: [13, 15, 17.5],
      bend: 25,
      expected: { "road-major-case": { 17.5: 2 }, "road-medium-case": { 17.5: 2 } },
      dashed: ["road-minor-dotted", "boundary-region"],
    });
    for (const s of r.rows) {
      // road-*-case are 1.3 to 5 px bands below the hollow zoom: only connectivity is asserted there, and the
      // two one-pixel outlines of a hollow road above it
      const onePx = ["road-minor", "building-outline"].includes(s.cls);
      const tag = `synthetic dpr${dpr} ${s.cls} z${s.zoom}`;
      check(`${tag} broken`, s.brokenFrac, L.broken);
      if (onePx) {
        check(`${tag} endMiss`, s.endMissFrac, L.endMiss);
        check(`${tag} doubled`, s.doubledFrac, L.doubled);
        check(`${tag} thin`, s.thinFrac, L.thin);
      } else if (s.zoom >= 17.5) {
        check(`${tag} cells per step (two outlines)`, s.perStepMax, L.hollowPerStep);
      }
    }
    for (const d of r.dash) {
      const tag = `synthetic dpr${dpr} ${d.cls} z${d.zoom}`;
      check(`${tag} lines with no ink`, d.zeroFrac, L.dashZero);
      check(`${tag} min cells/step`, d.densityMin, L.dashMin, ">=");
      check(`${tag} max/min density`, d.densityMax / Math.max(d.densityMin, 1e-6), L.dashSpread);
    }
  }

  // ---- 2 + 3 + 4. real map ----------------------------------------------------------------------------------------
  if (!args.quick) {
    const VIEWS = {
      "z14.5": { lon: 106.698, lat: 10.774, zoom: 14.5 },
      "z16.5": { lon: 106.6995, lat: 10.7765, zoom: 16.5 },
      "z17.5": { lon: 106.6995, lat: 10.7765, zoom: 17.5 },
    };
    const thin = ["roads-minor", "water-edge", "buildings"];
    for (const dpr of [1, 2]) {
      const { browser, page } = await launch({ w: 800, h: 560, dpr });
      try {
        await open(page, `theme=light&bench=1&reveal=off&${QUERY}`);
        for (const [name, view] of Object.entries(VIEWS)) {
          const stats = await page.evaluate((v) => window.__app.integrity.static({ view: v, classes: ["roads-major", "roads-medium", "roads-minor", "water-edge", "buildings"] }), view);
          for (const s of stats) {
            if (s.touch < 60) continue; // too little to measure
            const tag = `real dpr${dpr} ${name} ${s.cls}`;
            if (s.ideal) {
              check(`${tag} idealLineMiss`, s.ideal.lineMiss, LIMITS.real.idealLineMiss);
              check(`${tag} extra components (fragmentation)`, Math.max(0, s.components.out - 1.15 * s.ideal.components), LIMITS.real.fragmentationSlack);
            }
            if (thin.includes(s.cls) && s.ideal && !(s.cls === "water-edge" && view.zoom < 16)) check(`${tag} sizeRatio`, s.ideal.sizeRatio, LIMITS.real.sizeRatioMax);
            if (["roads-minor", "buildings"].includes(s.cls)) check(`${tag} 2x2 blocks`, s.blocks, LIMITS.real.blocks);
          }
        }
        if (dpr === 2) {
          for (const name of ["z14.5", "z16.5"]) {
            const m = await page.evaluate((v) => window.__app.integrity.motion({ view: v, dir: [0.7071, 0.7071], stepArt: 0.25, steps: 20, classes: ["roads-major", "roads-minor", "water-edge", "buildings"] }), VIEWS[name]);
            check(`motion ${name} changed vs native (same thinning)`, m.ratio, LIMITS.motion.ratio);
            check(`motion ${name} changed vs plain native`, m.ratioPlain, LIMITS.motion.ratioPlain);
            check(`motion ${name} reversals`, m.reversalsOut, LIMITS.motion.reversals);
          }
          const f = await page.evaluate((v) => window.__app.integrity.fillChurn({ view: v, steps: 12, stepArt: 0.5 }), { lon: 106.7, lat: 10.78, zoom: 12.8 });
          check("fill stipple churn inside fills during pan", f.churn, LIMITS.motion.fillChurn);
          const idle = await page.evaluate(() => window.__app.bench.idle(1500));
          check("idle renders", idle.renders, 0);
          check("idle rAF calls", idle.rafCalls, 0);
        }
      } finally {
        await browser.close();
      }
    }
  }
} finally {
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
