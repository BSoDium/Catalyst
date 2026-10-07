// usage: node scripts/measure.mjs [--src=pm|ofm] [--views=world,region,street] [--comps=none,copy-art,...] [--size=1440x900] [--dpr=2] [--throttle=1] [--dur=8000] [--mobile]
// One browser session per (comp, scale) row; views are measured in sequence inside it. Prints one JSON object.
import { launch, open } from "./lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? "1"]; }));
const src = args.src ?? "pm";
const views = (args.views ?? "world,region,street").split(",");
const rows = (args.rows ?? "none:2,copy-art:1,copy-device:1,copy-device:2,inline:2").split(",").map((r) => { const [comp, scale] = r.split(":"); return { comp, scale: Number(scale) }; });
const [w, h] = (args.size ?? "1440x900").split("x").map(Number);
const dpr = Number(args.dpr ?? 2);
const throttle = Number(args.throttle ?? 1);
const dur = Number(args.dur ?? 8000);
const px = (args.px ? `&px=${args.px}` : "") + (args.extra ? `&${args.extra}` : "");

const VIEWS = {
  world: { lon: 100, lat: 14, zoom: 2.4 },
  asia: { lon: 106, lat: 14, zoom: 4 },
  region: { lon: 106.7, lat: 10.8, zoom: 8.5 },
  city: { lon: 106.7, lat: 10.78, zoom: 11.5 },
  street: { lon: 106.698, lat: 10.774, zoom: 14.5 },
  block: { lon: 106.6995, lat: 10.7765, zoom: 16.5 },
};

const out = { env: {}, src, size: `${w}x${h}`, dpr, throttle, durMs: dur, rows: [] };
for (const row of rows) {
  const { browser, page } = await launch({ w, h, dpr, throttle, mobile: !!args.mobile });
  try {
    await open(page, `theme=dark&src=${src}&comp=${row.comp}&scale=${row.scale}&bench=1&view=${JSON.stringify(0) && "100,14,2.4"}${px}`);
    if (!out.env.userAgent) {
      out.env = await page.evaluate(() => {
        const c = document.createElement("canvas").getContext("webgl2");
        const ext = c.getExtension("WEBGL_debug_renderer_info");
        return { userAgent: navigator.userAgent, gl: ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "?", dpr: devicePixelRatio, projection: window.__app.street.projectionName() };
      });
    }
    const r = { comp: row.comp, scale: row.scale, views: {} };
    for (const v of views) {
      const res = await page.evaluate(async ([view, d]) => window.__app.bench.run({ view, durationMs: d, motion: "pan" }), [VIEWS[v], dur]);
      const proj = await page.evaluate(() => window.__app.street.projectionName());
      const idle = await page.evaluate(() => window.__app.bench.idle(3000));
      const iso = await page.evaluate(() => window.__app.bench.isolated(30));
      r.views[v] = { ...res, projection: proj, idle, isolated: iso };
    }
    out.rows.push(r);
  } catch (e) {
    out.rows.push({ comp: row.comp, scale: row.scale, error: String(e.message ?? e) });
  } finally {
    await browser.close();
  }
}
console.log(JSON.stringify(out, null, 1));
