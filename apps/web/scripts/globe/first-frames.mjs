// First frames of a reload (docs/web-architecture.md, "Reload fade"): from the first animation frame of a load of the home
// page (no place selected) to the revealed globe, nothing but the page colour or the faded-in pixel-art globe may be on
// screen. Samples every animation frame from document start and fails on:
//   - any placeholder (a `[data-globe=loading]` element, any bordered full-radius circle) in the DOM,
//   - any frame where the stage is visible (opacity > 0.02) before a frame has been drawn,
//   - any frame where the WebGL canvas is visible on screen (its opacity times the stage's) before its first drawn frame,
//   - a stage that never becomes visible.
//
//   CHROME_PATH=... BASE_URL=http://localhost:5181 [OUT_DIR=dir] node apps/web/scripts/globe/first-frames.mjs [path] [scheme]
// Shots: <OUT_DIR>/first-<scheme>-<k>.png of the first frames, when OUT_DIR is set.
import { DESKTOP, OUT_DIR, BASE_URL, launch } from "./_lib.mjs";

const path = process.argv[2] ?? "/";
const scheme = process.argv[3] ?? "dark";
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${detail}`);
  if (!ok) failures.push(name);
};

const browser = await launch();
try {
  for (const reduced of [false, true]) {
    const ctx = await browser.newContext({ ...DESKTOP, colorScheme: scheme, reducedMotion: reduced ? "reduce" : "no-preference" });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      sessionStorage.setItem("globe-debug", "1");
      window.__first = [];
      const t0 = performance.now();
      const loop = () => {
        const stage = document.querySelector("[data-globe=three]");
        const canvas = document.querySelector("[data-globe=three] canvas");
        const circles = [...document.querySelectorAll("main *, [data-globe] *")].filter((el) => {
          const cs = getComputedStyle(el);
          return /^(50%|9999px|100%)/.test(cs.borderTopLeftRadius) && parseFloat(cs.borderTopWidth) > 0 && el.getBoundingClientRect().width > 200;
        }).length;
        window.__first.push({
          t: Math.round(performance.now() - t0),
          loading: !!document.querySelector("[data-globe=loading]"),
          circles,
          stage: stage ? +getComputedStyle(stage).opacity : null,
          canvas: canvas ? +getComputedStyle(canvas).opacity : null,
          frames: window.__globeDebug ? window.__globeDebug.frames() : 0,
        });
        if (performance.now() - t0 < 5000) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await page.goto(new URL(path, BASE_URL).toString());
    const tag = `${scheme}${reduced ? "-reduced" : ""}`;
    for (let k = 0; k < 8 && OUT_DIR !== "."; k++) {
      await page.screenshot({ path: `${OUT_DIR}/first-${tag}-${k}.png` });
      await page.waitForTimeout(90);
    }
    await page.waitForTimeout(5200);
    const rows = await page.evaluate(() => window.__first);
    check(`${tag}: no placeholder circle or loading element at any frame`, rows.every((r) => !r.loading && r.circles === 0), `(${rows.length} frames)`);
    const early = rows.filter((r) => r.stage !== null && r.stage > 0.02 && r.frames === 0);
    check(`${tag}: the stage is never visible before the first drawn frame`, early.length === 0, `(${early.length} frames)`);
    const raw = rows.filter((r) => r.canvas !== null && (r.stage ?? 1) * r.canvas > 0.02 && r.frames === 0);
    check(`${tag}: the WebGL canvas is never on screen before it has drawn`, raw.length === 0, `(${raw.length} frames${raw.length ? ": " + JSON.stringify(raw.slice(0, 3)) : ""})`);
    const shown = rows.find((r) => r.stage !== null && r.stage > 0.02);
    check(`${tag}: the globe does appear`, !!shown, `(first visible at ${shown?.t} ms)`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`\n${failures.length} FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\nfirst frames ok");
