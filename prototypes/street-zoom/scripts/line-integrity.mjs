// usage: node scripts/line-integrity.mjs [--variants=name:query;name2:query2] [--views=z12.8,z14.5,...] [--classes=a,b] [--motion] [--size=800x560] [--dpr=2] [--json=out.json]
// Dropout / thickness / connectivity per line class and zoom, plus (with --motion) frame-to-frame stability during a
// slow pan. Needs a server on :5190 and Chrome for Testing (CHROME_PATH or the Playwright cache).
import { writeFileSync } from "node:fs";
import { launch, open } from "./lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const t = a.replace(/^--/, ""); const i = t.indexOf("="); return i < 0 ? [t, "1"] : [t.slice(0, i), t.slice(i + 1)]; }));
export const VIEWS = {
  "z12.8": { lon: 106.7, lat: 10.78, zoom: 12.8 },
  "z14.5": { lon: 106.698, lat: 10.774, zoom: 14.5 },
  "z15.5": { lon: 106.698, lat: 10.774, zoom: 15.5 },
  "z16.5": { lon: 106.6995, lat: 10.7765, zoom: 16.5 },
  "z17.5": { lon: 106.6995, lat: 10.7765, zoom: 17.5 },
};
const variants = (args.variants ?? "legacy:rule=legacy&widths=legacy").split(";").map((v) => { const i = v.indexOf(":"); return { name: v.slice(0, i), query: v.slice(i + 1) }; });
const views = (args.views ?? Object.keys(VIEWS).join(",")).split(",");
const [w, h] = (args.size ?? "800x560").split("x").map(Number);
const dpr = Number(args.dpr ?? 2);
const classes = args.classes ? args.classes.split(",") : undefined;
const out = { size: `${w}x${h}`, dpr, variants: {} };

for (const v of variants) {
  const { browser, page } = await launch({ w, h, dpr });
  try {
    await open(page, `theme=light&bench=1&reveal=off&${v.query}`);
    const res = { static: {}, motion: {} };
    for (const name of views) {
      const view = VIEWS[name];
      res.static[name] = await page.evaluate(([vw, cl]) => window.__app.integrity.static({ view: vw, classes: cl }), [view, classes]);
      if (args.motion) {
        res.motion[name] = {
          h: await page.evaluate((vw) => window.__app.integrity.motion({ view: vw, dir: [1, 0], stepArt: 0.25, steps: 24 }), view),
          d: await page.evaluate((vw) => window.__app.integrity.motion({ view: vw, dir: [0.7071, 0.7071], stepArt: 0.25, steps: 24 }), view),
        };
      }
    }
    out.variants[v.name] = res;
  } finally {
    await browser.close();
  }
}
if (args.json) writeFileSync(args.json, JSON.stringify(out, null, 1));

const pct = (x) => (x * 100).toFixed(1).padStart(5);
for (const [name, res] of Object.entries(out.variants)) {
  console.log(`\n== ${name}`);
  console.log("view   class         out  touch touchMiss% lineMiss% | vs native raster: lineMiss% strictMiss% spurious% size frag | comps(o/t) blocks%");
  for (const [vn, stats] of Object.entries(res.static)) {
    for (const s of stats) {
      const id = s.ideal;
      console.log(
        `${vn.padEnd(6)} ${s.cls.padEnd(12)} ${String(s.out).padStart(5)} ${String(s.touch).padStart(5)} ${pct(s.touchMiss)}     ${pct(s.lineMiss)}    | ` +
          (id ? `${pct(id.lineMiss)}          ${pct(id.strictMiss)}      ${pct(id.spurious)}    ${id.sizeRatio.toFixed(2)} ${s.fragmentation ?? "-"}` : "-".padEnd(44)) +
          ` | ${s.components.out}/${s.components.touch}  ${pct(s.blocks)}`,
      );
    }
  }
  for (const [vn, m] of Object.entries(res.motion)) {
    for (const [d, r] of Object.entries(m)) console.log(`motion ${vn} ${d}: changed/frame/ink out ${r.changedOut} ideal ${r.changedIdeal} plain ${r.changedPlain} | ratio ${r.ratio} (vs plain ${r.ratioPlain}) | reversals out ${r.reversalsOut} ideal ${r.reversalsIdeal} plain ${r.reversalsPlain}`);
  }
}
