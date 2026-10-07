// usage: node scripts/synthetic.mjs "query" [--classes=a,b] [--zooms=13,15,17] [--size=800x560] [--dpr=2] [--bend=20] [--json=file]
// Connectivity / thickness of known polylines (24 angles x 16 sub-pixel offsets) through the real style and pass.
import { writeFileSync } from "node:fs";
import { launch } from "./lib.mjs";

const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const t = a.replace(/^--/, ""); const i = t.indexOf("="); return i < 0 ? [t, "1"] : [t.slice(0, i), t.slice(i + 1)]; }));
const query = pos[0] ?? "rule=legacy&widths=legacy";
const [w, h] = (args.size ?? "800x560").split("x").map(Number);
const dpr = Number(args.dpr ?? 2);
const classes = (args.classes ?? "waterway-major,road-minor,building-outline").split(",");
const zooms = (args.zooms ?? "13,15,17").split(",").map(Number);
const bend = args.bend ? Number(args.bend) : undefined;
// --expected=road-major-case@17=2,road-major-case@18=2 : expected component count (default 1; a hollow road is 2 outlines)
const expected = {};
for (const e of (args.expected ?? "").split(",").filter(Boolean)) { const [k, n] = e.split("="); const [c, z] = k.split("@"); (expected[c] ??= {})[Number(z)] = Number(n); }

export async function runSynthetic({ query, w, h, dpr, classes, zooms, bend, expected = {}, dashed = [] }) {
  const { browser, page } = await launch({ w, h, dpr });
  const out = { info: null, rows: [], dash: [] };
  try {
    await page.goto(`http://localhost:5190/synthetic.html?theme=light&${query}`);
    await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 60000 });
    out.info = await page.evaluate(async () => { await window.__synthetic.ready(); return window.__synthetic.info(); });
    for (const cls of classes) {
      for (const zoom of zooms) {
        const exp = expected[cls]?.[zoom];
        const s = await page.evaluate(([c, z, b, e]) => window.__synthetic.sweep(c, z, { bend: b, expected: e }), [cls, zoom, bend, exp]);
        out.rows.push(s);
      }
    }
    for (const cls of dashed) {
      for (const zoom of zooms) out.dash.push(await page.evaluate(([c, z]) => window.__synthetic.dashSweep(c, z), [cls, zoom]));
    }
  } finally {
    await browser.close();
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dashed = args.dash ? args.dash.split(",") : [];
  const r = await runSynthetic({ query, w, h, dpr, classes: args.classes === "" ? [] : classes, zooms, bend, dashed, expected });
  console.log(JSON.stringify(r.info));
  console.log("class               zoom  lines  broken%  endMiss%  doubled%  thin%  cells/step mean min max");
  for (const s of r.rows) {
    console.log(`${s.cls.padEnd(19)} ${String(s.zoom).padEnd(5)} ${String(s.lines).padEnd(6)} ${(s.brokenFrac * 100).toFixed(1).padStart(6)}  ${(s.endMissFrac * 100).toFixed(1).padStart(7)}  ${(s.doubledFrac * 100).toFixed(1).padStart(7)}  ${(s.thinFrac * 100).toFixed(1).padStart(5)}  ${s.perStepMean.toFixed(2)} ${s.perStepMin.toFixed(2)} ${s.perStepMax.toFixed(2)}`);
  }
  for (const d of r.dash) console.log(`dashed ${d.cls.padEnd(18)} z${d.zoom}: cells/step min ${d.densityMin.toFixed(2)} max ${d.densityMax.toFixed(2)} mean ${d.densityMean.toFixed(2)}, lines with ~no ink ${(d.zeroFrac * 100).toFixed(1)}%`);
  if (args.json) writeFileSync(args.json, JSON.stringify(r, null, 1));
}
