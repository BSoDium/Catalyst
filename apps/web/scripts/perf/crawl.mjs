// Pan stability ("crawl") at street scale: how much of the art image changes from one frame to the next beyond a rigid
// translation. A slow drag moves the map by a fraction of a cell per frame; unsnapped, every frame re-samples the lines at
// a new phase (thin lines and dashes crawl); snapped to the cell grid (street/core/snap.ts) the picture only ever shifts by
// whole cells and nothing else changes.
//
//   node apps/web/scripts/perf/crawl.mjs --base http://localhost:5320 [--snap on|off|both] [--speed 36] [--headed]
//
// Metric per changed frame pair (A -> B): best whole-cell shift (dx, dy) of A onto B, then the share of A's ink cells that
// are not ink at the shifted place in B (+ B's ink cells that were not ink in A), over A's ink cells. Reported: share of
// frame pairs that changed at all, mean and p95 of the residual over changed pairs, and "churn" = residual cells per frame.
import { DESKTOP, launch, openPage, sleep, waitQuiet } from "./lib.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
const base = args.base ?? "http://localhost:5320";
const speed = Number(args.speed ?? 36); // css px / s
const modes = args.snap === "both" || args.snap === undefined ? ["off", "on"] : [args.snap];

async function run(browser, snap) {
  const { ctx, page } = await openPage(browser, DESKTOP, base, {
    flags: { "globe-debug": "1", "street-opts": JSON.stringify({ forceSource: "fallback", snapPan: snap === "on" }) },
  });
  await page.waitForFunction(() => document.querySelector('[data-globe="three"][data-state="ready"]'), null, { timeout: 30000 });
  await page.evaluate((v) => window.__handoverDebug.fly(v), { lon: 106.7009, lat: 10.7769, zoom: 14.5 });
  await sleep(500);
  await waitQuiet(page, { quietMs: 1500, minMs: 500, maxMs: 60000 });
  await page.evaluate(() => {
    const dbg = window.__handoverDebug.street().debug();
    const frames = [];
    window.__crawl = { frames, stop: false };
    const tick = () => {
      if (window.__crawl.stop) return;
      const r = dbg.readCodes();
      if (r) frames.push({ cols: r.cols, rows: r.rows, codes: r.codes.slice(), lng: dbg.map().getCenter().lng, passes: dbg.passes() });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const v = page.viewportSize();
  const c = { x: v.width / 2, y: v.height / 2 };
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  const t0 = Date.now();
  for (let i = 1; ; i++) {
    const t = (Date.now() - t0) / 1000;
    if (t > 3) break;
    await page.mouse.move(c.x + speed * t, c.y + speed * 0.5 * t);
    await sleep(Math.max(0, i * 16 - (Date.now() - t0)));
  }
  await page.mouse.up();
  const res = await page.evaluate(() => {
    window.__crawl.stop = true;
    const fr = window.__crawl.frames;
    const ink = (code) => code === 1 || code === 2; // thin, solid
    const out = { pairs: 0, changed: 0, residual: [], churn: [], shifts: {} };
    const M = 8;
    for (let i = 1; i < fr.length; i++) {
      const A = fr[i - 1];
      const B = fr[i];
      if (A.cols !== B.cols || A.rows !== B.rows) continue;
      out.pairs++;
      let same = true;
      for (let k = 0; k < A.codes.length; k++) if (A.codes[k] !== B.codes[k]) { same = false; break; }
      if (same) continue;
      out.changed++;
      const { cols, rows } = A;
      let best = null;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          let bad = 0;
          for (let y = M; y < rows - M; y++)
            for (let x = M; x < cols - M; x++) {
              const a = ink(A.codes[y * cols + x]);
              const b = ink(B.codes[(y + dy) * cols + (x + dx)]);
              if (a !== b) bad++;
            }
          if (!best || bad < best.bad) best = { bad, dx, dy };
        }
      let inkA = 0;
      for (let y = M; y < rows - M; y++) for (let x = M; x < cols - M; x++) if (ink(A.codes[y * cols + x])) inkA++;
      out.residual.push(best.bad / Math.max(1, inkA));
      out.churn.push(best.bad);
      const key = `${best.dx},${best.dy}`;
      out.shifts[key] = (out.shifts[key] ?? 0) + 1;
    }
    out.trace = fr.slice(0, 12).map((f) => `${f.lng.toFixed(7)}/${f.passes}`);
    return out;
  });
  if (args.debug) console.error(res.trace.join(" "));
  await ctx.close();
  const s = [...res.residual].sort((a, b) => a - b);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return {
    snap,
    pairs: res.pairs,
    changedShare: +(res.changed / Math.max(1, res.pairs)).toFixed(3),
    residualMean: +mean(res.residual).toFixed(4),
    residualP95: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(4),
    churnCellsPerChangedFrame: +mean(res.churn).toFixed(1),
    shifts: res.shifts,
  };
}

const browser = await launch({ headed: !!args.headed });
const out = [];
for (const m of modes) out.push(await run(browser, m));
await browser.close();
console.log(JSON.stringify(out, null, 1));
