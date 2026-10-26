// The moon (docs/landing.md, "The moon") in a browser: a real link to the first version of the site that circles the planet at the world view, goes behind the
// planet and away from the hero's text, holds still with its card out under the pointer and the keyboard, stands still under reduced motion, takes two
// taps on a touch screen, and stays out of the way of a place being open. Works against `pnpm dev:demo`; asserts nothing about which places there are.
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
const URL = `${BASE_URL}/?globe-debug&ring&showcase&sky`;
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
  const link = page.locator("a.globe-moon");
  ok((await link.count()) === 1, "desktop: exactly one moon");
  ok((await link.getAttribute("href")) === "https://v1.bsodium.fr" && (await link.getAttribute("rel")) === "noopener" && (await link.getAttribute("target")) === "_blank", "desktop: it is a link to the first version, in a new tab, noopener");
  ok(/Memory lane/.test((await link.getAttribute("aria-label")) ?? ""), "desktop: its accessible name says what it is");
  const near = await pin(page, 90);
  const far = await pin(page, 270);
  ok(near.shown && near.size > 40, "desktop: in front it shows, larger");
  ok(!far.shown, "desktop: behind the planet it is hidden");
  const side = await pin(page, 335);
  ok(side.shown && side.size < near.size, "desktop: beyond the limb the far half shows again, smaller");
  await page.evaluate(() => window.__globeDebug.pinMoon(null));
  const a = await moon(page);
  await page.waitForTimeout(2500);
  const b = await moon(page);
  ok(a.angle !== b.angle, "desktop: it moves on its own");
  await pin(page, 60);
  const at = await moon(page);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(350);
  ok((await moon(page)).open, "desktop: the pointer on it shows the card");
  await page.screenshot({ path: `${OUT_DIR}/moon-card.png` });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__globeDebug.pinMoon(null));
  // (it is moving: wait for it to be on the near half, then put the pointer where it is, in the same breath)
  for (let i = 0; i < 400 && !(await moon(page)).open; i++) {
    const m = await moon(page);
    const turn = ((m.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (m.shown && turn > 0.3 && turn < 2.8) {
      await page.mouse.move(m.x, m.y);
      await page.waitForTimeout(200);
    } else await page.waitForTimeout(250);
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
  ok(st.x - st.size / 2 >= 0 && st.x + st.size / 2 <= 390, "phone: it is inside the window");
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
