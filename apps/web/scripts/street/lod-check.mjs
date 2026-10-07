// Binary layers at rest on the real pipeline (docs/street-architecture.md, "Level of detail" and "Temporal ease"; docs/web-architecture.md,
// "Binary visibility"). A class, a fill, the graticule and the sea texture are ON or OFF (style/layer-switch.ts, decided from the camera with
// a hysteresis) and the temporal ease fades the cells by time. This runs the real app (the handover controller, the street map, local
// PMTiles or OpenFreeMap) through a zoom sweep, in and out, and at every zoom, once the camera has stopped and the ease has settled:
//   - the layers that are on are the ones the table says (outside the hysteresis band), and the sea texture and the graticule are the two
//     sides of the flatness of the view (never both, never neither)
//   - the always-on layers (coast, country borders, the erasing road interiors) are visible and the map is never empty
//   - the presented image IS the classified one, cell for cell (no half-faded cell rests on screen), and nothing is still easing
// then the same through bursts of wheel events (a trackpad that lets go) landing near a threshold. Exit code 1 on a violation.
//   BASE_URL=http://localhost:5290 [SOURCE=primary|fallback] node scripts/street/lod-check.mjs [--zooms=3.8,5,...]
import { DESKTOP, launch, openApp, settleApp, setCamera, waitStreetOk, ensureTiles } from "../globe/handover-lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const t = a.replace(/^--/, ""); const i = t.indexOf("="); return i < 0 ? [t, "1"] : [t.slice(0, i), t.slice(i + 1)]; }));
const PLACE = { lon: 107.2, lat: 10.3 }; // the coast east of Ho Chi Minh City: sea, land, roads in one view
const zooms = (args.zooms ?? "3.9,4.6,5.5,6.5,7.5,8,8.2,8.4,9,10,11,12,13,14,15").split(",").map(Number);
const failures = [];
const expect = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
};

const tiles = await ensureTiles();
const browser = await launch();
const { page, logs } = await openApp(browser, DESKTOP, { path: "/" });
await waitStreetOk(page);

const rest = async (label) => {
  await settleApp(page, 60000);
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const d = window.__handoverDebug;
    const s = d.street();
    if (!s || d.owner() !== "street") return { street: false };
    const dbg = s.debug();
    const codes = dbg.readCodes();
    const T = Uint8Array.from(codes.levels);
    const P = dbg.readPresentedLevels();
    let differ = 0;
    for (let i = 0; i < T.length; i++) if (T[i] !== P[i]) differ++;
    const m = dbg.map();
    const hidden = ["water-edge", "boundary-country", "road-major-fill", "road-medium-fill"].filter((id) => m.getLayer(id) && m.getLayoutProperty(id, "visibility") === "none");
    let lit = 0;
    for (const v of T) if (v) lit++;
    return { street: true, hidden, lit, mapZoom: d.mapZoom(), layers: dbg.layers(), differ, cells: T.length, easing: dbg.easing(), animating: dbg.isAnimating(), nodes: dbg.lod().filter((n) => n.alpha !== 1).length };
  });
};

for (const dir of ["in", "out"]) {
  for (const z of dir === "in" ? zooms : [...zooms].reverse()) {
    await setCamera(page, { ...PLACE, zoom: z });
    const r = await rest(`${dir} ${z}`);
    if (!r.street) continue; // the globe owns the view below the cut: its own checks are scripts/globe/groups.mjs
    const sea = r.layers.on.includes("water-fill");
    const grid = r.layers.on.includes("graticule");
    expect(`${dir} z${z} (map ${r.mapZoom.toFixed(2)}): sea texture XOR graticule (flat ${r.layers.flat}), ${r.layers.on.length} layers on`, sea !== grid && sea === r.layers.flat, r.layers);
    // content is continuously present along the whole path (regression: the switch once hid the always-on layers, so from space only the graticule, the outline and the boxes were left until the switched layers came back one by one) and the always-on layers are never hidden (without the erasing road interiors every road is a solid band: no hierarchy at street scale)
    expect(`${dir} z${z}: the always-on layers are visible (hidden: ${r.hidden.join(",") || "none"}) and the map is not empty (${r.lit} lit cells)`, r.hidden.length === 0 && r.lit > 1000, { hidden: r.hidden, lit: r.lit });
    expect(`${dir} z${z}: presented == classified (${r.differ} of ${r.cells} cells differ), nothing easing, boxes all at full opacity`, r.differ === 0 && r.easing === 0 && !r.animating && r.nodes === 0, r);
  }
}

// bursts of wheel events near thresholds, then let go
await setCamera(page, { ...PLACE, zoom: 7 });
await settleApp(page, 60000);
await page.mouse.move(720, 450);
for (const [dir, n] of [[-1, 10], [1, 10]]) {
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < 14; i++) {
      await page.mouse.wheel(0, dir * (50 + ((k * 31) % 90)) * Math.exp(-i / 5));
      await page.waitForTimeout(16);
    }
    const r = await rest(`wheel ${dir} ${k}`);
    if (!r.street) continue;
    if (r.differ !== 0 || r.easing !== 0 || r.animating || r.nodes !== 0) expect(`wheel ${dir < 0 ? "in" : "out"} burst ${k} (map z${r.mapZoom.toFixed(2)}): resolved at rest`, false, r);
  }
}
expect("wheel bursts in and out: every resting frame fully resolved (presented == classified, no ease pending, boxes at full opacity)", !failures.some((f) => f.startsWith("wheel")), null);
expect("no console errors", logs.length === 0, logs);
await browser.close();
await tiles.stop();
if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n - ${failures.join("\n - ")}`);
  process.exit(1);
}
console.log("\nall binary-layer checks passed");
