// The moon (docs/landing.md, "The moon") in a browser: a body in the globe's space, on an orbit about the planet, that is a link to the first version of the site. It is in
// front of the planet and then behind it (and the planet hides it), is a sixth of the planet's radius, holds still with its card out under the pointer and the keyboard,
// stands still under reduced motion, takes two taps on a touch screen, and is gone once zoomed in. Works against `pnpm dev:demo`; asserts nothing about which places there are.
//
//   CHROME_PATH=/path/to/chrome BASE_URL=http://localhost:5451 OUT_DIR=/tmp/moon node scripts/home/moon.mjs
//
// Exit code 1 on any failed assertion. The page is the debug one with the ring, the caption and the sky on (`?globe-debug&ring&showcase&sky`): the moon is pinned
// (`__globeDebug.pinMoon(deg)`) where a check needs it. Screenshots go to OUT_DIR.
import { mkdirSync } from "node:fs";
import { BASE_URL, OUT_DIR, DESKTOP, MOBILE, launch } from "../globe/_lib.mjs";

mkdirSync(OUT_DIR, { recursive: true });
const failures = [];
const ok = (cond, message) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${message}`);
  if (!cond) failures.push(message);
};
const URL = `${BASE_URL}/?globe-debug&ring&showcase&sky&moon`;
const moon = (page) => page.evaluate(() => window.__globeDebug.moon());
const pin = async (page, deg) => {
  await page.evaluate((d) => window.__globeDebug.pinMoon(d), deg);
  await page.waitForTimeout(250);
  return moon(page);
};

const browser = await launch();
const open = async (options) => {
  const page = await (await browser.newContext(options)).newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  return page;
};

{
  const page = await open(DESKTOP);
  const first = await moon(page);
  const link = page.locator("a.globe-moon");
  ok((await link.count()) === 1, "desktop: exactly one moon");
  ok((await link.getAttribute("href")) === "https://v1.bsodium.fr" && (await link.getAttribute("rel")) === "noopener" && (await link.getAttribute("target")) === "_blank", "desktop: it is a link to the first version, in a new tab, noopener");
  ok(/Memory lane/.test((await link.getAttribute("aria-label")) ?? ""), "desktop: its accessible name says what it is");
  const probe = await page.evaluate(() => window.__globeDebug.captionProbe());
  const planet = probe?.radius ?? 0;
  const centre = probe?.centre ?? [0, 0];
  // an Easter egg: not in the picture when the page opens (a fresh page, the orbit's start is on the camera's side, behind the camera)
  ok(!first.live, "desktop: the moon is not in the picture when the page opens");
  const side = await pin(page, 245);
  ok(side.live && side.unhidden === 1, "desktop: coming round the planet's left, behind it, it is in the sky and a target");
  ok(side.x < centre[0] - planet * 0.9 && side.y < centre[1], "desktop: it is beside the planet, above its middle line, outside its disc");
  ok(side.radius > 0 && side.radius < planet * 0.12, "desktop: it is small in the picture (a sixth of the planet's radius, far behind it): under an eighth of it on screen");
  const behind = await pin(page, 270);
  ok(!behind.live && behind.unhidden < 0.05, "desktop: in the middle of the far half the planet is in front of it and hides it");
  const gone = await pin(page, 90);
  ok(!gone.live, "desktop: on the camera's side of its orbit it is behind the camera and not in the picture");
  // a real body: from the other side of the earth the planet hides it (the orbit is fixed in space, not in the picture)
  await pin(page, 180);
  await page.evaluate(() => window.__globeDebug.setView({ lon: 90, lat: 0 }));
  await page.waitForTimeout(500);
  const hidden = await moon(page);
  ok(!hidden.live && hidden.unhidden < 0.05, "desktop: from the side it is behind, the planet hides it");
  await page.evaluate(() => window.__globeDebug.setView({ lon: 0, lat: 0 }));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__globeDebug.pinMoon(null));
  await page.evaluate(() => window.__globeDebug.setMoonAngle(232));
  await page.waitForTimeout(400); // (the sprite settles on its size for the new place)
  const a = await moon(page);
  // smooth: the sprite is moved by device pixels at the display's rate, not by whole art cells (2 to 3 CSS px) ten times a second
  const track = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const el = document.querySelector("canvas[data-moon-sprite]");
        const at = () => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41 + parseFloat(el.style.width) / 2; // the sprite's centre: it does not move when the sprite's size changes by a cell
        const xs = [at()];
        const t0 = performance.now();
        const step = () => {
          xs.push(at());
          if (performance.now() - t0 < 1500) requestAnimationFrame(step);
          else resolve(xs);
        };
        requestAnimationFrame(step);
      }),
  );
  const cell = await page.evaluate(() => window.__globeDebug.cell());
  const moves = track.slice(1).filter((x, i) => x !== track[i]).length;
  // (a frame here can be late, so the size of one step says nothing; where the sprite STANDS does: on the art grid it would be on one of a few places a cell apart)
  const residues = new Set(track.map((x) => (((x % cell) + cell) % cell).toFixed(2)));
  ok(moves >= 12 && residues.size >= 4, `desktop: the sprite glides: ${moves} moves in 1.5 s over ${residues.size} different places in an art cell of ${cell} px (a whole-cell move would be on one)`);
  const b = await moon(page);
  ok(b.angle > a.angle, "desktop: it moves on its own");
  await pin(page, 245);
  const at = await moon(page);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(350);
  ok((await moon(page)).open, "desktop: the pointer on it shows the card");
  await page.screenshot({ path: `${OUT_DIR}/moon-card.png` });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__globeDebug.setMoonAngle(240));
  await page.waitForTimeout(300);
  {
    // (it is moving: put the pointer where it is now, in the same breath)
    for (let i = 0; i < 6 && !(await moon(page)).open; i++) {
      const m = await moon(page);
      await page.mouse.move(m.x, m.y);
      await page.waitForTimeout(250);
    }
  }
  const h0 = await moon(page);
  await page.waitForTimeout(1500);
  ok((await moon(page)).angle === h0.angle, "desktop: it holds still while the card is out");
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  ok(!(await moon(page)).open, "desktop: the card goes when the pointer does");
  await page.close();
}

{
  const page = await open({ ...DESKTOP, reducedMotion: "reduce" });
  const a = await moon(page);
  await page.waitForTimeout(2000);
  const b = await moon(page);
  ok(a.shown && a.x === b.x && a.y === b.y, "reduced motion: it stands still, in view");
  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    await page.keyboard.press("Tab");
    found = await page.evaluate(() => document.activeElement?.classList.contains("globe-moon") === true);
  }
  ok(found, "keyboard: Tab reaches the moon");
  await page.waitForTimeout(250);
  ok((await moon(page)).open, "keyboard: with the focus on it the card is out");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  ok(!(await moon(page)).open, "keyboard: Escape closes the card");
  await page.close();
}

{
  const page = await open({ ...MOBILE, reducedMotion: "reduce" });
  const st = await moon(page);
  ok(st.shown, "phone: the moon shows");
  ok(st.x + st.size / 2 > 0 && st.x - st.size / 2 < 390, "phone: it is in the window (at its edge: it is passing)");
  await page.touchscreen.tap(st.x, st.y);
  await page.waitForTimeout(400);
  ok((await moon(page)).open && page.context().pages().length === 1, "phone: the first tap shows the card and goes nowhere");
  await page.screenshot({ path: `${OUT_DIR}/moon-phone.png` });
  await page.close();
}

{
  const page = await open(DESKTOP);
  await page.evaluate(() => window.__globeDebug.pinMoon(90));
  await page.evaluate(() => window.__globeDebug.setView({ zoom: window.__globeDebug.fitZoom() + 2 }));
  await page.waitForTimeout(600);
  ok(!(await moon(page)).shown, "zoomed in: the moon is gone");
  await page.close();
}

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
