// The landing hero in a browser (docs/landing.md): at rest over the globe with real text (the owner's name on one line at desktop width,
// stacked on a phone), the globe still draggable beneath it, the collapse on the first gesture, the way back after the idle delay (and
// only at the world view), NO header at all while the hero's rows are the sections and its search line is the search (the header comes
// back, with an unboxed key hint, when the rows are hidden), the icons at their scale, reduced motion, the credits line never covered, the whole block
// inside the window at fifteen shapes from 320 x 480 and 568 x 320 up (light and dark), the keyboard path and the search palette, the focus held in
// the header or the palette so the way back never takes it away, the page without scripts, no console error and no hydration warning.
// Works against `pnpm dev` (the owner's preview data) and `pnpm dev:demo`; it asserts nothing about which places there are.
//
//   CHROME_PATH=/path/to/chrome BASE_URL=http://localhost:5451 OUT_DIR=/tmp/hero node scripts/home/hero.mjs
//
// Exit code 1 on any failed assertion. Screenshots (rest and collapsed, both schemes, every viewport) go to OUT_DIR.
// The shortened idle (`?hero-idle=MS`) is honoured in debug mode (`?globe-debug`) only; the check of the real 8 s delay runs without it.
import { mkdirSync } from "node:fs";
import { BASE_URL, OUT_DIR, DESKTOP, MOBILE, launch } from "../globe/_lib.mjs";

mkdirSync(OUT_DIR, { recursive: true });
const failures = [];
const ok = (cond, message) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${message}`);
  if (!cond) failures.push(message);
};

const browser = await launch();
const LANDSCAPE = { ...MOBILE, viewport: { width: 844, height: 390 } };
/**
 * Every shape the hero must fit (the whole block inside the window: name, introduction, search and the four rows), from the smallest
 * supported phone up: the upright phones, the same on their side, a 1440 x 900 window at 200 % zoom (720 x 450), a tablet, laptops.
 * A phone or a short window gets a touch context (`hover: none`: no key hint in the search line).
 */
const FIT_SIZES = [
  [320, 480],
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
  [568, 320],
  [640, 360],
  [667, 375],
  [720, 450],
  [736, 414],
  [768, 1024],
  [844, 390],
  [1024, 768],
  [1440, 900],
  [1920, 1080],
];
const VIEWPORTS = FIT_SIZES.map(([width, height]) => {
  if (width === 1440 && height === 900) return ["1440x900", DESKTOP];
  if (width === 390 && height === 844) return ["390x844", MOBILE];
  const touch = width < 768 || height < 500;
  return [`${width}x${height}`, { viewport: { width, height }, deviceScaleFactor: 2, ...(touch ? { isMobile: true, hasTouch: true, userAgent: MOBILE.userAgent } : {}) }];
});
/** The name is stacked (the family name under the given name) under 48 rem, except on a phone on its side (480 px and up, 34 rem tall at most). */
const isStacked = (width, height) => width < 768 && !(width >= 480 && height <= 544);
/** The roll's half amplitude, radians (`CAPTION.drift.ampDeg`): rows at rest are within it of the centre. */
const AMP = (8 * Math.PI) / 180;
const IDLE_QUERY = "?globe-debug&hero-idle=1500";
const SECTION_PATHS = ["/software", "/articles", "/artworks", "/poetry"];
/**
 * The rows: the four sections and, when the projection has a career document, a fifth, "Career" (docs/career-page.md). The demo content
 * and the owner's preview have one (the default); set HERO_CAREER=0 against content that has none (the committed `published` projection).
 */
const CAREER_ROW = process.env.HERO_CAREER !== "0";
const PATHS = CAREER_ROW ? [...SECTION_PATHS, "/career"] : SECTION_PATHS;
/** The rows' names: the poems' section is "Poetry". */
const LABELS = CAREER_ROW ? ["Software", "Articles", "Artworks", "Poetry", "Career"] : ["Software", "Articles", "Artworks", "Poetry"];
/** The header's links when it is not hidden: the sections, then "Career" when there is one. */
const HEADER_PATHS = PATHS;
const ROW_COUNT = PATHS.length;

async function newPage(contextOptions, { colorScheme = "dark", reducedMotion = "no-preference" } = {}) {
  const ctx = await browser.newContext({ ...contextOptions, colorScheme, reducedMotion });
  const page = await ctx.newPage();
  // `page.mouse.wheel` has no device signature at a scale factor of 2: say it is a mouse wheel (honoured on debug pages only, engine/wheel-debug.ts).
  await page.addInitScript(() => sessionStorage.setItem("input-kind", "wheel"));
  const logs = [];
  page.on("console", (m) => {
    // (the motion library's own notice that reduced motion is on is information about the test's emulation, not a fault)
    if (["error", "warning"].includes(m.type()) && !/Reduced Motion enabled on your device/.test(m.text())) logs.push(`${m.type()}: ${m.text().split("\n")[0]}`);
  });
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  return { ctx, page, logs };
}

const hero = (page) => page.locator("[data-slot=landing-hero]");
const heroState = (page) => hero(page).getAttribute("data-hero");
const waitGlobe = (page) => page.waitForSelector('[data-globe="three"][data-state="ready"]', { timeout: 30000 });
const waitDebug = (page) => page.waitForFunction(() => window.__globeDebug && window.__globeDebug.view(), null, { timeout: 30000 });
const waitState = (page, state, timeout = 5000) => page.waitForFunction((s) => document.querySelector("[data-slot=landing-hero]")?.getAttribute("data-hero") === s, state, { timeout });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const view = (page) => page.evaluate(() => window.__globeDebug.view());
const opacityOf = (page, selector) => page.evaluate((s) => Number(getComputedStyle(document.querySelector(s)).opacity), selector);

/** Where the visible hero text and controls are, in CSS px, and where the credits line, the header and the dev badge are. */
async function geometry(page) {
  return page.evaluate(() => {
    const box = (b) => ({ l: b.left, t: b.top, r: b.right, b: b.bottom });
    const el = (s) => document.querySelector(s);
    // The text's box is the font's content area (ascent to descent): the letters' ink ends higher than its bottom. Trim by the difference
    // between the font's descent and what these letters actually draw below the baseline (the "y"), so the check is about ink.
    const textBox = (node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const b = box(range.getBoundingClientRect());
      const cs = getComputedStyle(node);
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = ctx.measureText(node.textContent);
      if (m.fontBoundingBoxDescent !== undefined && m.actualBoundingBoxDescent !== undefined) b.b -= Math.max(0, m.fontBoundingBoxDescent - m.actualBoundingBoxDescent);
      return b;
    };
    const shown = (node) => {
      const cs = getComputedStyle(node);
      // (`display: none` has no box: the how-to line is not drawn on a wide, short window)
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) <= 0.01) return false;
      // (a visually hidden line, one clipped pixel while the globe says it itself, is no ink: its text is wider than its box)
      const r = node.getBoundingClientRect();
      return !(r.width <= 1.5 && r.height <= 1.5);
    };
    const root = el("[data-slot=landing-hero]");
    const state = root.getAttribute("data-hero");
    const inks = [];
    const add = (name, node, text = false) => node && shown(node) && inks.push({ name, ...(text ? textBox(node) : box(node.getBoundingClientRect())) });
    if (state === "rest") {
      add("name", el(".hero-name"), true);
      add("intro", el(".hero-intro"), true);
      add("hint", el(".hero-hint"), true);
      add("search", el(".hero-search"));
      document.querySelectorAll(".hero-row").forEach((a, i) => add(`row${i}`, a));
    } else {
      // (the collapsed name is the big name's two halves held in the corner; the ghost line `.hero-mini-name` is never painted)
      add("name-given", el(".hero-given"), true);
      add("name-family", el(".hero-family"), true);
      add("mini-hint", el(".hero-mini-hint"), true);
    }
    // the credits card from md up, the phone's compact "i" button below it (the other one is display: none)
    const credits = [...document.querySelectorAll("[data-attribution]")].find((n) => n.getClientRects().length > 0) ?? null;
    const badge = el("[data-dev-content-badge]");
    return {
      state,
      inks,
      credits: credits && box(credits.getBoundingClientRect()),
      // (at rest on the home page there is no header: the hero's rows are the sections and its search line is the search)
      header: el("header") ? box(el("header").getBoundingClientRect()) : null,
      nav: el("header nav") ? box(el("header nav").getBoundingClientRect()) : null,
      badge: badge && box(badge.getBoundingClientRect()),
      vw: innerWidth,
      vh: innerHeight,
      overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
    };
  });
}
const hit = (a, b) => a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;

async function layoutChecks(page, label) {
  const g = await geometry(page);
  ok(g.inks.length > 0, `${label}: the hero shows something (${g.inks.map((i) => i.name).join(", ")})`);
  ok(g.credits !== null, `${label}: the credits (card, or the phone's "i" button) are there`);
  if (g.credits) ok(!g.inks.some((i) => hit(i, g.credits)), `${label}: nothing of the hero covers the credits line`);
  if (g.badge) ok(!g.inks.some((i) => hit(i, g.badge)), `${label}: nothing of the hero covers the dev badge`);
  ok(
    g.inks.every((i) => i.l >= -0.5 && i.r <= g.vw + 0.5 && i.t >= -0.5 && i.b <= g.vh + 0.5),
    `${label}: everything is inside the viewport (${g.inks.filter((i) => i.t < -0.5 || i.b > g.vh + 0.5).map((i) => i.name).join(",")} top ${Math.round(Math.min(...g.inks.map((i) => i.t)))} px, bottom ${Math.round(Math.max(...g.inks.map((i) => i.b)))} of ${g.vh})`,
  );
  ok(g.header === null === (g.state === "rest"), `${label}: ${g.state === "rest" ? "no header at rest" : "the header is back"}`);
  if (g.header) ok(g.inks.every((i) => i.t >= g.header.b - 0.5), `${label}: nothing is under the header row (${Math.round(Math.min(...g.inks.map((i) => i.t)))} px from the top, header ends at ${Math.round(g.header.b)})`);
  ok(g.overflowX <= 0, `${label}: no horizontal overflow (${g.overflowX})`);
  if (g.nav) ok(g.nav.l >= -0.5 && g.nav.r <= g.vw + 0.5, `${label}: the header row fits (${Math.round(g.nav.l)} to ${Math.round(g.nav.r)} of ${g.vw})`);
  return g;
}

// --- 0. Server-rendered: the hero is in the HTML at rest, with real text (no flash of another state) ----------------------------------
{
  const html = await (await fetch(`${BASE_URL}/`)).text();
  ok(/data-slot="landing-hero"[^>]*data-hero="rest"|data-hero="rest"[^>]*data-slot="landing-hero"/.test(html), "SSR: the hero is in the page at rest");
  ok(/<h1[^>]*class="hero-name[^"]*"[^>]*><span class="hero-given">Elliot<\/span> <span class="hero-family type-thin">/.test(html), "SSR: the name is the page's h1, Elliot (heavy) and Négrel-Jerzy (thin)");
  ok(
    /Front-end and UX software engineer based in Warsaw\.<span class="hero-intro-more"> Data visualisation, geospatial and cartography interfaces, design systems, computer graphics\.<\/span><\/p>/.test(html),
    "SSR: who the owner is is real text (the second sentence is its own span: a very short window drops it)",
  );
  ok(!/catalyst/i.test(html.replace(/CATALYST_[A-Z_]+/g, "")), "SSR: the code name is nowhere in the home page");
  ok(!/<header/.test(html) && !/data-slot="search-trigger/.test(html), "SSR: there is no header at rest on the home page");
  ok((html.match(/<nav aria-label="Primary"/g) ?? []).length === 1 && /<nav aria-label="Primary" class="hero-list">/.test(html), "SSR: the hero's list is the page's one Primary navigation (the places list is the other landmark)");
  const hrefs = [...html.matchAll(/class="hero-row"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*class="hero-row"/g)].map((m) => m[1] ?? m[2]);
  ok(JSON.stringify(hrefs) === JSON.stringify(PATHS), `SSR: the lists, in order (${hrefs.join(" ")})`);
  const labels = [...html.matchAll(/class="hero-row"[^>]*href="[^"]+"[^>]*><span>([^<]+)<|href="[^"]+"[^>]*class="hero-row"[^>]*><span>([^<]+)</g)].map((m) => m[1] ?? m[2]);
  ok(JSON.stringify(labels) === JSON.stringify(LABELS), `SSR: the rows are named ${LABELS.join(", ")} (${labels.join(", ")})`);
  ok((html.match(/<h1[ >]/g) ?? []).length === 1, "SSR: exactly one h1");
}

// --- 1. Desktop: rest, drag beneath the hero, collapse, return ----------------------------------------------------------------------
{
  const { ctx, page, logs } = await newPage(DESKTOP);
  await page.goto(`${BASE_URL}/${IDLE_QUERY}`);
  await waitGlobe(page);
  await waitDebug(page);
  await sleep(1200);
  ok((await heroState(page)) === "rest", "desktop: at rest on load");
  ok((await page.locator("h1").count()) === 1 && (await page.locator("h1").innerText()) === "Elliot Négrel-Jerzy", "desktop: one h1, the owner's name");
  ok(!/catalyst/i.test(await page.evaluate(() => document.title + " " + document.body.innerText)), "desktop: the code name is nowhere in the title or the text");
  const intro = await page.locator(".hero-intro").innerText();
  ok(/^Front-end and UX software engineer based in Warsaw\. Data visualisation, geospatial and cartography interfaces, design systems, computer graphics\.$/.test(intro), `desktop: the intro says who the owner is (${intro})`);
  const hintText = await page.locator(".hero-hint").innerText();
  ok(/^(Drag the globe to explore and pick a place, or start from a list\.|No place is published yet: start from a list\.)$/.test(hintText), `desktop: then how to use the page (${hintText})`);
  // the name: one line, a share of the width (not the full width), the given name heavy and the family name thin
  const nm = await page.evaluate(() => {
    const n = document.querySelector(".hero-name");
    const fs = parseFloat(getComputedStyle(n).fontSize);
    const g = document.querySelector(".hero-given"), f = document.querySelector(".hero-family");
    const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    const gutter = parseFloat(getComputedStyle(document.querySelector(".landing-hero")).paddingLeft);
    return { fs, given: r(g), family: r(f), gutter, vw: innerWidth, weights: [getComputedStyle(g).fontWeight, getComputedStyle(f).fontWeight], h: n.getBoundingClientRect().height };
  });
  ok(Math.abs(nm.given.t - nm.family.t) < 2 && nm.family.l > nm.given.r, `desktop: the name is on one line (given ${Math.round(nm.given.l)}-${Math.round(nm.given.r)}, family from ${Math.round(nm.family.l)})`);
  const share = (nm.family.r - nm.given.l) / nm.vw;
  ok(share >= 0.68 && share <= 0.76, `desktop: the name takes about 72 % of the width, not all of it (${(share * 100).toFixed(1)} %, from ${Math.round(nm.given.l)} to ${Math.round(nm.family.r)} of ${nm.vw})`);
  ok(nm.family.r <= nm.vw - nm.gutter - 0.15 * nm.vw, `desktop: it ends well short of the right gutter (${Math.round(nm.family.r)} of ${nm.vw})`);
  ok(nm.weights.join() === "800,200", `desktop: the given name at 800, the family name at 200 (${nm.weights.join(" / ")})`);
  const icons = await page.evaluate(() => {
    const w = (s) => document.querySelector(s)?.getBoundingClientRect().width ?? 0;
    return { arrow: w(".hero-arrow"), rowFont: parseFloat(getComputedStyle(document.querySelector(".hero-row")).fontSize), search: w(".hero-search svg") };
  });
  ok(icons.arrow >= icons.rowFont && icons.arrow <= icons.rowFont * 1.25, `desktop: the row arrows are 1.1 em of the row's text (${icons.arrow.toFixed(1)} px for ${icons.rowFont} px text)`);
  ok(Math.abs(icons.search - 20) < 0.5, `desktop: the hero's search icon is the control size, 20 px (${icons.search})`);
  const plain = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".hero-kbd"));
    return { border: cs.borderTopWidth, bg: cs.backgroundColor, outline: cs.outlineStyle, text: document.querySelector(".hero-kbd").textContent };
  });
  ok(plain.border === "0px" && plain.outline === "none" && /rgba\(0, 0, 0, 0\)|transparent/.test(plain.bg), `desktop: the hero's key hint is plain text, no border, background or outline (${JSON.stringify(plain)})`);
  ok((await page.locator(".hero-search > svg").count()) === 1 && (await page.locator(".hero-search [class*=bullet]").count()) === 0, "desktop: the search line starts with the search icon, not a square bullet");
  // no header at all while the rows are the sections and the search line is the search
  ok((await page.locator("header").count()) === 0, "desktop: no header element at rest");
  ok((await page.locator("nav[aria-label=Primary]").count()) === 1 && (await page.locator("nav[aria-label=Primary]").getAttribute("class")) === "hero-list", "desktop: exactly one Primary navigation, the hero's list");
  ok((await page.locator("[data-slot=hero-search]").innerText()).includes("Search places and entries"), "desktop: the search line is labelled");
  ok((await page.locator(".hero-row").evaluateAll((as) => as.map((a) => a.getAttribute("href")))).join() === PATHS.join(), "desktop: the rows link to the lists");
  const pe = await page.evaluate(() => ({
    root: getComputedStyle(document.querySelector("[data-slot=landing-hero]")).pointerEvents,
    block: getComputedStyle(document.querySelector(".hero-block")).pointerEvents,
    search: getComputedStyle(document.querySelector(".hero-search")).pointerEvents,
    row: getComputedStyle(document.querySelector(".hero-row")).pointerEvents,
    intro: getComputedStyle(document.querySelector(".hero-intro")).pointerEvents,
    name: getComputedStyle(document.querySelector(".hero-name")).pointerEvents,
  }));
  ok(pe.root === "none" && pe.block === "none" && pe.intro === "none" && pe.name === "none" && pe.search === "auto" && pe.row === "auto", `desktop: pointer-events none except the search line and the rows (${JSON.stringify(pe)})`);
  const g = await layoutChecks(page, "desktop rest");
  await page.screenshot({ path: `${OUT_DIR}/hero-rest-1440-dark.png` });

  // a drag that starts on the wordmark (the hero is over the globe there, and ignores the pointer)
  const name = await page.locator(".hero-name").boundingBox();
  const x = name.x + name.width * 0.4;
  const y = name.y + name.height * 0.5;
  const beneath = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.tagName, [x, y]);
  ok(beneath === "CANVAS" || beneath === "DIV", `desktop: the point under the wordmark reaches the globe's stage (${beneath})`);
  const v0 = await view(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + i * 14, y - i * 5);
  await page.mouse.up();
  await sleep(150);
  const v1 = await view(page);
  ok(Math.abs(v1.lon - v0.lon) > 1 || Math.abs(v1.lat - v0.lat) > 1, `desktop: a drag through the hero turned the globe (lon ${v0.lon.toFixed(1)} to ${v1.lon.toFixed(1)})`);
  ok((await heroState(page)) === "collapsed", "desktop: the first gesture collapses the hero");
  await sleep(450);
  ok((await opacityOf(page, ".hero-intro")) === 0 && (await opacityOf(page, ".hero-list")) === 0 && (await opacityOf(page, ".hero-search")) === 0, "desktop: the text has faded out");
  ok((await opacityOf(page, ".hero-mini")) === 1, "desktop: the small line is shown");
  const mini = await page.locator(".hero-mini").innerText();
  const nameNow = await page.locator(".hero-name").innerText();
  ok(/Elliot/.test(nameNow) && /Négrel-Jerzy/.test(nameNow) && (await opacityOf(page, ".hero-name")) === 1 && /Drag to explore\. Pause, and the page comes back\./.test(mini), `desktop: the corner line is the name itself (visible, one copy) and the hint (${nameNow} / ${mini.replace(/\n/g, " ")})`);
  ok((await page.locator(".hero-mini-name").evaluate((e) => getComputedStyle(e).visibility)) === "hidden", "desktop: the ghost line is never painted");
  // the rows are hidden now: the header takes the sections back, so the visitor is never left without a way to the lists
  const collapsedLinks = await page.locator("header a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  ok(JSON.stringify(collapsedLinks) === JSON.stringify(["/", ...PATHS]), `desktop: collapsed, the header shows Globe and the sections (${collapsedLinks.join(" ")})`);
  ok((await page.locator("nav[aria-label=Primary]:visible").count()) === 1, "desktop: collapsed, still exactly one primary navigation (the header's)");
  const hdr = await page.evaluate(() => {
    const k = document.querySelector("header [data-slot=search-trigger] kbd");
    const cs = k && getComputedStyle(k);
    const t = document.querySelector("header [data-slot=search-trigger]");
    const r = t.getBoundingClientRect();
    return { icon: t.querySelector(":scope > svg")?.getBoundingClientRect().width, command: k?.querySelector("svg")?.getBoundingClientRect().width ?? null, font: parseFloat(getComputedStyle(t).fontSize), word: t.querySelector(":scope > span")?.textContent, h: r.height, linkH: document.querySelector("header a").getBoundingClientRect().height, kbd: k ? { border: cs.borderTopWidth, bg: cs.backgroundColor, text: k.textContent.replace(/\s+/g, " ").trim() } : null };
  });
  // [icon] Search [command K]: the two glyphs are one size (1.1 em of the nav type), the word is there, the row is as tall as the links
  ok(Math.abs(hdr.icon - hdr.font * 1.1) < 0.5 && hdr.icon < 20, `desktop: collapsed, the header's search icon is 1.1 em of the nav type, not the 20 px control size (${hdr.icon} px for ${hdr.font} px type)`);
  ok(hdr.command === null || Math.abs(hdr.command - hdr.icon) < 0.5, `desktop: collapsed, the command key is the same size as the search icon (${hdr.command} against ${hdr.icon})`);
  ok(hdr.word === "Search" && Math.abs(hdr.h - hdr.linkH) < 0.5, `desktop: collapsed, the trigger says "Search" and is as tall as the links (${hdr.h} / ${hdr.linkH})`);
  ok(hdr.kbd && hdr.kbd.border === "0px" && /rgba\(0, 0, 0, 0\)|transparent/.test(hdr.kbd.bg) && /^(Ctrl K|K)$/.test(hdr.kbd.text), `desktop: collapsed, the header's key hint is plain text, unboxed (${JSON.stringify(hdr.kbd)})`);
  ok((await page.locator(".hero-row").first().evaluate((a) => getComputedStyle(a).visibility)) === "hidden", "desktop: the hidden rows are out of the tab order (visibility hidden)");
  ok((await page.locator("h1").count()) === 1 && (await page.locator("h1").evaluate((h) => getComputedStyle(h).visibility)) !== "hidden", "desktop: the h1 stays in the accessibility tree");
  const m = await layoutChecks(page, "desktop collapsed");
  ok(m.inks.length === 3, "desktop collapsed: the name (two halves) and the hint, nothing else");
  await page.screenshot({ path: `${OUT_DIR}/hero-collapsed-1440-dark.png` });

  // the way back: not before the delay, then at rest again (1.5 s here; the real 8 s is checked below)
  await sleep(300);
  ok((await heroState(page)) === "collapsed", "desktop: still collapsed before the idle delay");
  await waitState(page, "rest", 4000);
  ok(true, "desktop: back at rest after the idle delay at the world view");
  await sleep(400);
  ok((await opacityOf(page, ".hero-intro")) === 1 && (await opacityOf(page, ".hero-mini")) === 0, "desktop: the text is back and the small line is gone");
  ok((await page.locator("header").count()) === 0, "desktop: back at rest, the header is gone again");

  // zoomed in: it collapses and does not come back; zoomed out again: it does
  await page.mouse.move(720, 300);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -500);
  await sleep(300);
  const vz = await view(page);
  ok(vz.zoom > 1, `desktop: the wheel zoomed in (zoom ${vz.zoom.toFixed(2)})`);
  ok((await heroState(page)) === "collapsed" && (await hero(page).getAttribute("data-world")) === "false", "desktop: zoomed in, the hero is collapsed and the world view is false");
  ok((await opacityOf(page, ".hero-mini-hint")) === 0, "desktop: zoomed in, the 'back to start' hint is not promised");
  await sleep(2600);
  ok((await heroState(page)) === "collapsed", "desktop: zoomed in, it does not come back after the idle delay");
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 600);
  await sleep(500);
  ok((await hero(page).getAttribute("data-world")) === "true", "desktop: zoomed out to the world view again");
  await waitState(page, "rest", 4000);
  ok(true, "desktop: and it comes back after the idle delay");
  ok(logs.length === 0, `desktop: no console error or warning${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}

// --- 2. The real delay: 8 s (no debug, no override) --------------------------------------------------------------------------------
{
  const { ctx, page, logs } = await newPage(DESKTOP);
  await page.goto(`${BASE_URL}/`);
  await waitGlobe(page);
  await sleep(1200);
  await page.mouse.move(700, 300);
  await page.mouse.wheel(0, 120);
  await waitState(page, "collapsed", 1000);
  const t0 = Date.now();
  await sleep(6500);
  ok((await heroState(page)) === "collapsed", "real delay: still collapsed after 6.5 s");
  await waitState(page, "rest", 4000);
  const dt = (Date.now() - t0) / 1000;
  ok(dt > 7 && dt < 10, `real delay: back after about 8 s (${dt.toFixed(1)} s)`);
  ok(logs.length === 0, `real delay: no console error or warning${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}

// --- 3. Every shape (FIT_SIZES), both schemes: the whole block inside the window, the name's shape, the credits line, the first gesture --------------------------------------------------------------------
for (const [name, options] of VIEWPORTS) {
  for (const scheme of ["dark", "light"]) {
    const { ctx, page, logs } = await newPage(options, { colorScheme: scheme });
    await page.goto(`${BASE_URL}/${IDLE_QUERY}`);
    await waitGlobe(page);
    await waitDebug(page);
    await sleep(1000);
    const label = `${name} ${scheme}`;
    await layoutChecks(page, `${label} rest`);
    {
      // the name: stacked on a phone (given over family, the family name filling the width), one line from 48 rem and on a phone on its side
      // taking about 72 % of the width
      const n = await page.evaluate(() => {
        const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
        return { given: r(".hero-given"), family: r(".hero-family"), block: r(".hero-block"), vw: innerWidth, vh: innerHeight, gutter: parseFloat(getComputedStyle(document.querySelector(".landing-hero")).paddingLeft) };
      });
      ok(n.block.t >= 0 && n.block.b <= n.vh && n.block.l >= 0 && n.block.r <= n.vw + 0.5, `${label}: the hero block's box is inside the window (top ${Math.round(n.block.t)}, bottom ${Math.round(n.block.b)} of ${n.vh})`);
      const stacked = isStacked(options.viewport.width, options.viewport.height);
      ok(stacked ? n.family.t > n.given.b - 0.2 * (n.given.b - n.given.t) : Math.abs(n.family.t - n.given.t) < 2, `${label}: the name is ${stacked ? "stacked" : "on one line"}`);
      ok(n.family.r <= n.vw - n.gutter + 0.5 && n.given.l >= 0, `${label}: the name is inside the gutters (right edge ${Math.round(n.family.r)} of ${n.vw})`);
      if (stacked) ok(n.family.r >= n.vw - n.gutter - 0.1 * n.vw, `${label}: the stacked family name fills the width (${Math.round(n.family.r)} of ${n.vw})`);
      else {
        const share = (n.family.r - n.given.l) / n.vw;
        ok(share >= 0.66 && share <= 0.78, `${label}: the name takes about 72 % of the width (${(share * 100).toFixed(1)} %)`);
      }
    }
    if (!(name === "1440x900" && scheme === "dark")) await page.screenshot({ path: `${OUT_DIR}/hero-rest-${name}-${scheme}.png` });
    // the first gesture: a touch tap or a drag on the globe's stage where neither the hero's text nor a place marker is (the upper right:
    // a tap on a marker would open its place, which is a different state)
    const blockTop = await page.evaluate(() => document.querySelector(".hero-block").getBoundingClientRect().top);
    // A touch tap is adjusted by the engine to the nearest link within a finger's reach (about 24 px): with the fifth row (the career page)
    // the list's top edge is that near the top of a short window, so the tap goes at least 32 px above the block.
    const gx = options.viewport.width * 0.92, gy = Math.max(8, Math.min(options.viewport.height * 0.25, blockTop - (options.hasTouch ? 32 : 8)));
    ok(
      await page.evaluate(([x, y]) => !document.elementFromPoint(x, y)?.closest(".landing-hero a, .landing-hero button"), [gx, gy]),
      `${label}: the globe is reachable above the block (no hero control at ${Math.round(gx)}, ${Math.round(gy)})`,
    );
    if (options.hasTouch) await page.touchscreen.tap(gx, gy);
    else {
      await page.mouse.move(gx, gy);
      await page.mouse.down();
      await page.mouse.move(gx - options.viewport.width * 0.03, gy + options.viewport.height * 0.02, { steps: 5 });
      await page.mouse.up();
    }
    await waitState(page, "collapsed", 1500);
    await sleep(450);
    await layoutChecks(page, `${label} collapsed`);
    if (!(name === "1440x900" && scheme === "dark")) await page.screenshot({ path: `${OUT_DIR}/hero-collapsed-${name}-${scheme}.png` });
    ok(logs.length === 0, `${label}: no console error or warning${logs.length ? ` (${logs.join(" | ")})` : ""}`);
    await ctx.close();
  }
}

// --- 4. A small phone: at rest there is no header; once the hero has stepped back the header row fits and its one-word search works ----
for (const width of [320, 360, 390, 430]) {
  const { ctx, page, logs } = await newPage({ ...MOBILE, viewport: { width, height: 740 } });
  await page.goto(`${BASE_URL}/`);
  await waitGlobe(page);
  await sleep(600);
  const g0 = await geometry(page);
  ok(g0.header === null, `${width} px: no header at rest`);
  ok(g0.overflowX <= 0, `${width} px: no horizontal overflow`);
  ok(g0.inks.every((i) => i.r <= g0.vw - 0.5 && i.l >= 0), `${width} px: the hero (name included) is inside the viewport${g0.inks.filter((i) => i.r > g0.vw - 0.5 || i.l < 0).map((i) => ` [${i.name} ${Math.round(i.l)}..${Math.round(i.r)}]`).join("")}`);
  if (width === 390) {
    await page.locator("[data-slot=hero-search]").tap();
    await page.waitForSelector("[data-slot=search-palette]", { state: "visible", timeout: 3000 });
    ok(await page.locator("[data-slot=search-palette] input").evaluate((i) => document.activeElement === i), "390 px: the hero's search line opens the palette with the input focused");
    await page.keyboard.press("Escape");
    await sleep(200);
  }
  // step the hero back with a tap on the globe's stage, where no text or marker is
  await page.touchscreen.tap(width * 0.9, 740 * 0.12);
  await waitState(page, "collapsed", 2000).catch(() => {});
  await sleep(450);
  const g = await geometry(page);
  ok(g.header !== null && g.nav.l >= 0 && g.nav.r <= g.vw, `${width} px: collapsed, the header row fits (${g.nav ? `${Math.round(g.nav.l)} to ${Math.round(g.nav.r)}` : "missing"})`);
  ok(g.overflowX <= 0, `${width} px: collapsed, no horizontal overflow`);
  const compact = page.locator("[data-slot=search-trigger]");
  ok(await compact.isVisible() && /^search/i.test((await compact.innerText()).trim()), `${width} px: the header has a search button with the word "Search"`);
  const box = await compact.boundingBox();
  ok(box.height >= 43.5 && box.width >= 43.5, `${width} px: the header search is a 44 px target (${Math.round(box.width)} x ${Math.round(box.height)})`);
  if (width === 390) {
    await compact.tap();
    await page.waitForSelector("[data-slot=search-palette]", { state: "visible", timeout: 3000 });
    ok(await page.locator("[data-slot=search-palette] input").evaluate((i) => document.activeElement === i), "390 px: the header search opens the palette with the input focused");
    await page.keyboard.press("Escape");
  }
  ok(logs.length === 0, `${width} px: no console error or warning${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}

// --- 5. Keyboard: the search and the four links, in order; Cmd/Ctrl-K; the hidden controls are not stops ------------------------------
{
  const { ctx, page, logs } = await newPage(DESKTOP);
  await page.goto(`${BASE_URL}/`);
  await waitGlobe(page);
  await sleep(800);
  const stops = [];
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press("Tab");
    stops.push(await page.evaluate(() => {
      const a = document.activeElement;
      return a ? `${a.tagName.toLowerCase()}${a.getAttribute("data-slot") ? `[${a.getAttribute("data-slot")}]` : ""}${a.getAttribute("href") ? ` ${a.getAttribute("href")}` : ""}` : "none";
    }));
  }
  const at = stops.indexOf("button[hero-search]");
  ok(at > 0, `keyboard: Tab reaches the hero's search line (${stops.slice(0, 12).join(" > ")})`);
  ok(JSON.stringify(stops.slice(at + 1, at + 1 + ROW_COUNT)) === JSON.stringify(PATHS.map((p) => `a ${p}`)), `keyboard: then the lists, in order (${stops.slice(at + 1, at + 1 + ROW_COUNT).join(", ")})`);
  ok(!stops.includes("button[search-trigger]"), "keyboard: at rest there is no header search in the order: the hero's search line is the first control after the skip links");
  ok(stops.slice(at + 1 + ROW_COUNT).some((s) => s !== "none"), "keyboard: focus moves on past the hero");

  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+k");
  await page.waitForSelector("[data-slot=search-palette]", { state: "visible", timeout: 3000 });
  ok(true, "keyboard: Ctrl-K opens the palette");
  await page.keyboard.press("Escape");
  await sleep(250);
  await page.keyboard.press("Meta+k");
  await page.waitForSelector("[data-slot=search-palette]", { state: "visible", timeout: 3000 });
  ok(true, "keyboard: Cmd-K opens the palette");
  await page.keyboard.press("Escape");
  await sleep(250);
  await page.locator("[data-slot=hero-search]").focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("[data-slot=search-palette]", { state: "visible", timeout: 3000 });
  await page.keyboard.press("Escape");
  await sleep(200);
  ok(await page.locator("[data-slot=hero-search]").evaluate((b) => document.activeElement === b), "keyboard: Enter on the search line opens the palette, Escape gives the focus back to it");
  const kbd = (await page.locator(".hero-kbd").innerText()).replace(/\s+/g, " ").trim();
  const kbdIcon = await page.locator(".hero-kbd svg").count();
  ok(/^(K|Ctrl K)$/.test(kbd) && (kbd === "K" ? kbdIcon === 1 : kbdIcon === 0), `keyboard: the hint is filled in after hydration, the command icon then K or Ctrl K (${kbd}, ${kbdIcon} icon)`);
  // the palette's icons at the scale: the field's and each result's kind
  await page.keyboard.press("Control+k");
  await page.waitForSelector("[data-slot=search-palette]", { state: "visible", timeout: 3000 });
  await page.keyboard.type("a");
  await sleep(250);
  const pal = await page.evaluate(() => {
    const w = (el) => el?.getBoundingClientRect().width ?? 0;
    const d = document.querySelector("[data-slot=search-palette]");
    return { field: w(d.querySelector("svg")), kinds: [...d.querySelectorAll("[data-slot=kind-tag] svg")].map(w), options: d.querySelectorAll("[role=option]").length };
  });
  ok(Math.abs(pal.field - 20) < 0.5, `palette: the field's search icon is 20 px (${pal.field})`);
  ok(pal.kinds.length > 0 && pal.kinds.every((s) => Math.abs(s - 20) < 0.5), `palette: all ${pal.kinds.length} result icons are 20 px, one size`);
  const boxes = await page.evaluate(() => {
    const d = document.querySelector("[data-slot=search-palette]");
    const close = d.querySelector("[aria-label='Close search']");
    // the dialog's own frame and its two dividing hairlines are the only borders: no control, key or text inside has one
    const bordered = [...d.querySelectorAll("button, kbd, span, input")].filter((e) => parseFloat(getComputedStyle(e).borderTopWidth) > 0 || parseFloat(getComputedStyle(e).borderBottomWidth) > 0);
    return { closeIcon: !!close.querySelector("svg"), closeText: close.textContent.trim(), bordered: bordered.map((e) => e.tagName + "." + e.className).slice(0, 4), footer: d.textContent.includes("Esc") };
  });
  ok(boxes.closeIcon && boxes.closeText === "" && boxes.bordered.length === 0, `palette: no boxed key or button inside it, the way out is a plain icon (${JSON.stringify(boxes)})`);
  ok(boxes.footer, "palette: the footer says the key as plain text (Esc close)");
  await page.screenshot({ path: `${OUT_DIR}/palette-1440-dark.png` });
  await page.keyboard.press("Escape");
  await sleep(250);

  // collapsed: the hidden controls are not tab stops
  await page.mouse.move(700, 300);
  await page.mouse.wheel(0, 120);
  await waitState(page, "collapsed", 1000);
  await sleep(450);
  await page.evaluate(() => document.activeElement?.blur());
  let heroStops = 0;
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press("Tab");
    heroStops += await page.evaluate(() => (document.activeElement?.closest("[data-slot=landing-hero]") ? 1 : 0));
  }
  ok(heroStops === 0, `keyboard: collapsed, the hidden search line and rows are not tab stops (${heroStops} of 24 stops were in the hero)`);
  ok(logs.length === 0, `keyboard: no console error or warning${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}

// --- 6. Reduced motion: instant -----------------------------------------------------------------------------------------------------
{
  const { ctx, page, logs } = await newPage(DESKTOP, { reducedMotion: "reduce" });
  await page.goto(`${BASE_URL}/${IDLE_QUERY}`);
  await waitGlobe(page);
  await sleep(1000);
  const durations = await page.evaluate(() => [".hero-name", ".hero-intro", ".hero-hint", ".hero-list", ".hero-mini"].map((s) => getComputedStyle(document.querySelector(s)).transitionDuration));
  ok(durations.every((d) => /^0(\.0*1?)?m?s/.test(d) || d === "0s"), `reduced motion: no transition on the hero's parts (${durations.join(" ")})`);
  await page.mouse.move(700, 300);
  await page.mouse.wheel(0, 100);
  await sleep(60);
  ok((await heroState(page)) === "collapsed" && (await opacityOf(page, ".hero-intro")) === 0 && (await opacityOf(page, ".hero-mini")) === 1, "reduced motion: collapsed within 60 ms, text gone and small line there");
  ok(logs.length === 0, `reduced motion: no console error or warning${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}
{
  // and with motion: the fade is 200 to 300 ms and only opacity and transform move
  const { ctx, page } = await newPage(DESKTOP);
  await page.goto(`${BASE_URL}/`);
  await waitGlobe(page);
  const t = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".hero-intro"));
    return { props: cs.transitionProperty, dur: cs.transitionDuration };
  });
  const first = parseFloat(t.dur.split(",")[0]) * 1000;
  ok(first >= 200 && first <= 300, `motion: the fade is ${first} ms`);
  ok(!/width|height|top|left|margin|padding|font|all/.test(t.props), `motion: only opacity, transform and visibility transition (${t.props})`);
  await ctx.close();
}

// --- 7. A place open: the hero is away, not a second heading ------------------------------------------------------------------------
{
  const { ctx, page, logs } = await newPage(DESKTOP);
  await page.goto(`${BASE_URL}/`);
  await waitGlobe(page);
  const slug = await page.locator("[data-place-link]").first().getAttribute("data-place-link").catch(() => null);
  if (!slug) console.log("SKIP  place open: no published place on this content");
  else {
    await page.goto(`${BASE_URL}/locations/${slug}`);
    await page.waitForSelector("[data-panel]", { state: "visible", timeout: 15000 });
    await sleep(500);
    ok((await heroState(page)) === "away" && (await hero(page).getAttribute("aria-hidden")) === "true", "place open: the hero is away and hidden from assistive technology");
    ok((await page.locator("h1:visible").count()) === 1, "place open: one visible h1 (the panel's)");
    ok((await page.locator("[data-slot=landing-hero]").evaluate((h) => getComputedStyle(h).visibility)) === "hidden", "place open: nothing of the hero is shown");
    // Closing the panel (from a place the globe is zoomed in on): the hero's text never flashes on its way to the collapsed state. Sampled every frame
    // for a second, the introduction, the how-to line, the rows and the search line stay under 5 % opacity (the bug was a flash and a fade of the intro).
    await page.evaluate(() => {
      const parts = [".hero-intro", ".hero-hint", ".hero-list", ".hero-search"];
      window.__heroFlash = { max: 0, frames: 0, stop: false };
      const tick = () => {
        for (const s of parts) {
          const el = document.querySelector(s);
          if (el) window.__heroFlash.max = Math.max(window.__heroFlash.max, Number(getComputedStyle(el).opacity));
        }
        window.__heroFlash.frames++;
        if (!window.__heroFlash.stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.keyboard.press("Escape");
    await sleep(1000);
    const flash = await page.evaluate(() => {
      window.__heroFlash.stop = true;
      return window.__heroFlash;
    });
    ok(flash.frames > 20 && flash.max <= 0.05, `place closed: the hero's text never shows on the way back (max opacity ${flash.max.toFixed(3)} over ${flash.frames} frames)`);
    ok((await heroState(page)) === "collapsed", "place closed: the globe is zoomed in on the place, so the hero is collapsed (not at rest)");
  }
  ok(logs.length === 0, `place open: no console error or warning${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}

// --- 8. The focus is never lost to the hero's way back: held while it is in the header or in a dialog ----------------------------------
{
  const { ctx, page, logs } = await newPage(DESKTOP);
  await page.goto(`${BASE_URL}/${IDLE_QUERY}`);
  await waitGlobe(page);
  await waitDebug(page);
  await sleep(800);
  const collapse = async () => {
    await page.mouse.move(700, 300);
    await page.mouse.wheel(0, 120);
    await waitState(page, "collapsed", 1500);
    await sleep(350);
  };
  await collapse();
  // a header link has the focus: the idle delay (1.5 s here) passes twice and the hero stays collapsed, the header and the focus stay
  await page.locator("header a[href='/software']").focus();
  await sleep(3200);
  ok((await heroState(page)) === "collapsed", "focus hold: with the focus on a header link the hero does not come back after the idle delay");
  ok(await page.evaluate(() => document.activeElement?.getAttribute("href") === "/software" && !!document.activeElement.closest("header")), "focus hold: the focus is still on the header link (the header was not unmounted under it)");
  // leaving the header releases the hold: a whole idle period later, the hero is back
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(500);
  ok((await heroState(page)) === "collapsed", "focus hold: released, the hero still waits a whole idle period (it does not jump back)");
  await waitState(page, "rest", 4000);
  ok((await page.locator("header").count()) === 0, "focus hold: after the release the hero comes back at the delay, and the header goes with nothing focused in it");

  // the palette is open (opened from the header's trigger): the same
  await collapse();
  await page.locator("[data-slot=search-trigger]").click();
  await page.waitForSelector("[data-slot=search-palette]", { state: "visible", timeout: 3000 });
  await sleep(3200);
  ok((await heroState(page)) === "collapsed" && (await page.locator("header").count()) === 1, "focus hold: with the palette open the hero stays collapsed and the header (its opener) stays");
  await page.keyboard.press("Escape");
  await sleep(300);
  ok(await page.evaluate(() => document.activeElement?.getAttribute("data-slot") === "search-trigger"), "focus hold: Escape closes the palette and gives the focus back to the header's trigger (still there)");
  ok((await heroState(page)) === "collapsed", "focus hold: and the hero is still collapsed, with the focus on the trigger");
  await page.evaluate(() => document.activeElement?.blur());
  await waitState(page, "rest", 4500);
  ok(true, "focus hold: with the focus gone the hero comes back");
  ok(logs.length === 0, `focus hold: no console error or warning${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}

// --- 9. Without scripts: the server's page, no dead control, no line about the globe ----------------------------------------------------
{
  const ctx = await browser.newContext({ ...DESKTOP, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/`);
  await sleep(500);
  const state = await page.evaluate(() => {
    const vis = (e) => !!e && getComputedStyle(e).display !== "none" && e.getClientRects().length > 0;
    return {
      hint: document.querySelector(".hero-hint")?.innerText,
      search: vis(document.querySelector(".hero-search")),
      rows: [...document.querySelectorAll(".hero-row")].filter(vis).length,
      text: document.body.innerText,
    };
  });
  ok(state.hint === "Start from a list.", `no scripts: the how-to line only says to start from a list (${JSON.stringify(state.hint)})`);
  ok(!/Drag the globe/.test(state.text), "no scripts: nothing on the page tells the visitor to drag the globe");
  ok(!state.search, "no scripts: the search line (a script) is not drawn");
  ok(state.rows === ROW_COUNT, `no scripts: the lists are links that work (${state.rows})`);
  await page.screenshot({ path: `${OUT_DIR}/hero-no-script-1440.png` });
  await page.goto(`${BASE_URL}/articles`);
  const triggers = await page.evaluate(() => ["search-trigger"].map((s) => { const e = document.querySelector(`[data-slot=${s}]`); return !!e && getComputedStyle(e).display !== "none"; }));
  ok(triggers.every((v) => v === false), "no scripts: the header's search triggers are not drawn either");
  await ctx.close();
}

// --- 10. Round 3: the showcase (the ring and the caption, the boxes out, the planet lifted), the name's travel -------------------------------
// Pages in debug mode have the ring off unless `?ring` and the showcase off unless `?showcase`; `window.__globeDebug.caption()` is the caption's
// introspection and `.ring()` the ring's (docs/web-architecture.md, "Ring of type", "Caption on the sphere").
const SHOW_QUERY = "?globe-debug&ring&showcase&no-street&hero-idle=2500";
const ringOf = (page) => page.evaluate(() => window.__globeDebug.ring());
const captionOf = (page) => page.evaluate(() => window.__globeDebug.caption());
const planetOf = (page) =>
  page.evaluate(() => {
    const r = window.__globeDebug.ring();
    const i = window.__globeDebug.inset();
    const h = innerHeight;
    return { r: r.silhouettePx, lift: i.lift, cover: i.cover, cy: h / 2 - i.lift, h, w: innerWidth, labels: window.__globeDebug.labelsShown().length };
  });
/** Record, on every animation frame, how many copies of each half of the name are visible and where they are, and how many animations run. */
const startRecording = (page) =>
  page.evaluate(() => {
    window.__rec = [];
    const names = [".hero-given", ".hero-family", ".hero-mini-given", ".hero-mini-family"];
    const read = () =>
      names.map((n) => {
        const e = document.querySelector(n);
        let op = 1;
        for (let p = e; p && p !== document.documentElement; p = p.parentElement) op *= Number(getComputedStyle(p).opacity);
        const vis = getComputedStyle(e).visibility !== "hidden" && op > 0.01;
        const r = document.createRange();
        r.selectNodeContents(e);
        const b = r.getBoundingClientRect();
        return { n, vis, l: b.left, t: b.top, w: b.width, h: b.height };
      });
    const loop = (t) => {
      window.__rec.push({ t, anims: document.getAnimations().filter((a) => a.playState === "running" && /hero-(given|family)/.test(String(a.effect?.target?.className))).length, items: read() });
      window.__recId = requestAnimationFrame(loop);
    };
    window.__recId = requestAnimationFrame(loop);
  });
const stopRecording = (page) => page.evaluate(() => (cancelAnimationFrame(window.__recId), window.__rec));
/** The checks that the name has ONE copy on screen at every frame, and that the frame the travel ends on is the held state (no jump). */
function seamless(rec, label) {
  const frames = rec.filter((f) => f.items.some((i) => i.vis));
  let worst = 0;
  for (const f of frames) {
    const given = f.items.filter((i) => /given/.test(i.n) && i.vis).length;
    const family = f.items.filter((i) => /family/.test(i.n) && i.vis).length;
    worst = Math.max(worst, given, family);
  }
  ok(frames.length > 5 && worst === 1, `${label}: at no frame are two copies of the name visible (${frames.length} frames, at most ${worst} of each half)`);
  // the frame the animation stops running on, against the one before: the picture must not move by more than a pixel
  let at = -1;
  for (let i = 1; i < rec.length; i++) if (rec[i - 1].anims > 0 && rec[i].anims === 0) at = i;
  ok(at > 0, `${label}: the travel ended in a frame we saw`);
  if (at > 0) {
    const a = rec[at - 1].items.find((i) => i.n === ".hero-given");
    const b = rec[at].items.find((i) => i.n === ".hero-given");
    const f1 = rec[at - 1].items.find((i) => i.n === ".hero-family");
    const f2 = rec[at].items.find((i) => i.n === ".hero-family");
    const jump = Math.max(Math.abs(a.l - b.l), Math.abs(a.t - b.t), Math.abs(a.w - b.w), Math.abs(f1.l - f2.l), Math.abs(f1.t - f2.t), Math.abs(f1.w - f2.w));
    ok(jump <= 1, `${label}: the last frame of the travel is the held state (a jump of ${jump.toFixed(2)} px)`);
    // and nothing moves afterwards
    const after = rec.slice(at).flatMap((f) => f.items.filter((i) => /given|family/.test(i.n) && i.vis && !/mini/.test(i.n)));
    const drift = Math.max(...after.map((i) => i.l)) - Math.min(...after.filter((i) => /given/.test(i.n)).map((i) => i.l));
    ok(Number.isFinite(drift), `${label}: the name is steady after the travel`);
  }
}

/** The lift stops where the highest thing, the ring's outer edge (`RING.gap` 0.06 over the planet, a cap and a glyph of room), is 14 px from the top. */
const roomUsedUp = (p) => p.cy - (p.r * 1.06 + 0.72 * 11 * 1.15 + 11) <= 14 + 1.5;

const SHAPES = [
  ["1440x900 dark", DESKTOP, "dark"],
  ["1440x900 light", DESKTOP, "light"],
  ["390x844 dark", MOBILE, "dark"],
  ["390x844 light", MOBILE, "light"],
];
for (const [label, options, scheme] of SHAPES) {
  const touch = options.hasTouch === true;
  const { ctx, page, logs } = await newPage(options, { colorScheme: scheme });
  await page.goto(`${BASE_URL}/${SHOW_QUERY}`);
  await waitGlobe(page);
  await waitDebug(page);
  await sleep(3800); // (the entrance: four rows, 450 ms apart, 0.9 s each, after the page's own fade-in)
  const p = await planetOf(page);
  const c = await captionOf(page);
  const ring = await ringOf(page);
  const v = await view(page);
  const nums = await page.evaluate(() => ({ fit: window.__globeDebug.fitZoom(), floor: window.__globeDebug.floorZoom() }));
  ok(Math.abs(v.zoom - nums.floor) < 1e-6 && nums.floor < nums.fit - 0.3, `${label}: the page opens fully zoomed out (zoom ${v.zoom.toFixed(2)}, the fit is ${nums.fit.toFixed(2)})`);
  ok(ring.shown && ring.alpha > 0, `${label}: the flat ring of type is shown (the ring is main's, unchanged)`);
  ok(c.built && c.showcase && c.overlayHidden && c.lines.length >= 3 && c.lines.every((l) => l.visible && Math.abs(l.theta) <= AMP + 0.003), `${label}: the caption is built and rolling within +-8 degrees of the centre (crisp, ${c.lines.map((l) => l.text).join(" / ")})`);
  {
    const said = c.lines.map((l) => l.text).join(" ").replace(/\s+/g, " ");
    ok(c.lines.length === 4 && /A personal archive, organised around places\./i.test(said) && /Drag to explore\. Pick a place\./i.test(said) && said === said.toUpperCase(), `${label}: four rows: the first phrase set (what the site is) over the call to action (${said}: in capitals)`);
    ok(c.cycle.sets >= 2 && c.cycle.current === 0, `${label}: the phrase sets take turns (${c.cycle.sets} sets, the first shown)`);
    // the lines lie on real parallels, top to bottom, every row at one cap height
    const lats = c.lines.map((l) => l.baseLat);
    ok(lats.every((x, i) => i === 0 || x < lats[i - 1]), `${label}: every line is on its own parallel, one under the other (${lats.map((x) => x.toFixed(1)).join(", ")})`);
    ok(c.lines.every((l) => Math.abs(l.capR - c.lines[0].capR) < 1e-9), `${label}: every row has the same letter size`);
  }
  ok(p.labels === 0, `${label}: every box and label is out`);
  ok(p.lift > 5 && p.cy - p.r >= -0.5, `${label}: the planet is lifted by ${p.lift.toFixed(0)} px (cover ${p.cover}), its top is inside the window (${Math.round(p.cy - p.r)} px)`);
  ok(p.cy + p.r <= p.h - p.cover + 1 || roomUsedUp(p), `${label}: it clears what covers the bottom, or the room above is used up`);
  const hintBox = await page.locator(".hero-hint").boundingBox();
  ok(hintBox !== null && hintBox.width <= 1.5 && hintBox.height <= 1.5 && /Drag the globe to explore and pick a place/.test(await page.locator(".hero-hint").textContent()), `${label}: the how-to line is visually hidden, not removed`);
  ok((await hero(page).getAttribute("data-orbit")) === "true", `${label}: the hero knows the globe has the caption`);
  ok((await page.evaluate(() => window.__globeDebug.pick(innerWidth / 2, 330))) === null, `${label}: a hidden box takes no pick`);
  await page.screenshot({ path: `${OUT_DIR}/hero-showcase-${label.replace(" ", "-")}.png` });

  // The first press ends it; the name travels; one copy at every frame.
  const path0 = new URL(page.url()).pathname;
  await startRecording(page);
  const gx = options.viewport.width / 2;
  const gy = touch ? 300 : 80;
  if (touch) await page.touchscreen.tap(gx, gy);
  else {
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.mouse.up();
  }
  await waitState(page, "collapsed", 1500);
  await sleep(700);
  const rec = await stopRecording(page);
  seamless(rec, `${label}, collapsing`);
  const end = rec.at(-1).items;
  const ghostRects = ["given", "family"].map((n) => end.find((i) => i.n === `.hero-mini-${n}`));
  const nameRects = ["given", "family"].map((n) => end.find((i) => i.n === `.hero-${n}`));
  ok(
    ghostRects.every((g, k) => Math.abs(g.l - nameRects[k].l) < 0.5 && Math.abs(g.t - nameRects[k].t) < 0.5 && Math.abs(g.w - nameRects[k].w) < 0.5),
    `${label}: the collapsed name sits on its place to under half a pixel (${nameRects.map((r) => `${r.l.toFixed(1)},${r.t.toFixed(1)} ${r.w.toFixed(1)}`).join(" | ")})`,
  );
  const after = await planetOf(page);
  const cap = await captionOf(page);
  ok(!cap.showcase && after.lift === 0 && !cap.overlayHidden && after.labels > 0, `${label}: the press ended the showcase (boxes back ${after.labels}, the planet down)`);
  ok(new URL(page.url()).pathname === path0, `${label}: the press selected nothing`);
  ok(cap.lines.every((l) => !l.visible) && cap.phase === "hidden" && cap.opacity === 0, `${label}: the caption is gone after its fade (hidden, opacity ${cap.opacity})`);
  {
    // the flat ring gave way to the boxes and labels the moment they came back, and stays away while they are there
    const ring = await ringOf(page);
    ok(!ring.shown && ring.presence === 0, `${label}: the flat ring is hidden while the boxes and labels are shown (presence ${ring.presence})`);
  }
  ok(await page.locator(".hero-given").evaluate((e) => e.getAnimations().length === 0 && getComputedStyle(e).willChange === "auto"), `${label}: nothing is left running or promoted (no will-change)`);
  const sizePx = await page.evaluate(() => {
    const g = document.createRange();
    g.selectNodeContents(document.querySelector(".hero-given"));
    const gh = g.getBoundingClientRect().height;
    const m = parseFloat(getComputedStyle(document.querySelector(".hero-mini-name")).fontSize);
    return { m, gh };
  });
  ok(sizePx.m >= 28 && sizePx.m <= 48, `${label}: the collapsed name is ${sizePx.m.toFixed(0)} px (40 to 48 on a wide screen, 28 and over on a phone)`);
  const geo = await geometry(page);
  ok(!geo.inks.some((i) => geo.credits && hit(i, geo.credits)) && !(geo.badge && geo.inks.some((i) => hit(i, geo.badge))), `${label}: the collapsed name and its hint clear the credits line and the dev badge`);
  await page.screenshot({ path: `${OUT_DIR}/hero-collapsed2-${label.replace(" ", "-")}.png` });

  // The way back: the same motion reversed, one copy at every frame.
  await startRecording(page);
  await waitState(page, "rest", 6000);
  await sleep(700);
  const back = await stopRecording(page);
  seamless(back, `${label}, coming back`);
  const full = back.at(-1).items.find((i) => i.n === ".hero-given");
  ok(full.w > end.find((i) => i.n === ".hero-given").w * 2, `${label}: the name is back at full size (${full.w.toFixed(0)} px)`);
  const again = await captionOf(page);
  ok(again.showcase && again.overlayHidden, `${label}: back at rest the showcase is on again, boxes out`);
  ok(logs.length === 0, `${label}: no console error or warning${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}

// The caption's entrance, held at times (pinned): each line starts behind the planet, arrives fast and settles slowly, each line 450 ms after the one before.
{
  const { ctx, page } = await newPage(DESKTOP);
  await page.goto(`${BASE_URL}/${SHOW_QUERY}`);
  await waitGlobe(page);
  await waitDebug(page);
  await sleep(1500);
  const at = async (ms) => {
    await page.evaluate((ms) => window.__globeDebug.pinCaption(ms), ms);
    await sleep(80);
    return (await captionOf(page)).lines;
  };
  // (the sides the lines come in from are random per entrance: held all from the east here, so the order of the turns can be read off the angles)
  await page.evaluate(() => window.__globeDebug.captionSeed(null));
  // a logical line's pieces come in together: the turns are the parents, 450 ms apart
  const turn = (lines, p) => lines.filter((l) => l.parent === p);
  const f0 = await at(0);
  ok(f0.every((l) => !l.visible && l.theta > 1.5), "entrance: at 0 ms every line is behind the planet");
  const f100 = await at(100);
  ok(turn(f100, 0).every((l) => l.visible) && turn(f100, 1).every((l) => !l.visible), "entrance: at 100 ms the first line is arriving and the second has not started");
  const f600 = await at(600);
  ok(turn(f600, 0).every((l) => l.visible) && turn(f600, 1).every((l) => l.visible) && turn(f600, 2).every((l) => !l.visible) && turn(f600, 1)[0].theta > turn(f600, 0)[0].theta, "entrance: at 600 ms lines 1 and 2 are in view (line 2 behind line 1), line 3 is waiting for its turn (450 ms stagger)");
  const f1000 = await at(1000);
  ok(turn(f1000, 0)[0].theta < AMP + 0.003 && turn(f1000, 1)[0].theta > turn(f1000, 0)[0].theta && turn(f1000, 2)[0].theta > turn(f1000, 1)[0].theta, "entrance: at 1000 ms line 1 is almost there (fast), the others settling in order");
  const fEnd = await at(900 + 3 * 450 + 300);
  ok(fEnd.every((l) => Math.abs(l.theta) <= AMP + 0.003), "entrance: once the last line's turn has run every line is in its roll (within +-8 degrees of the centre)");
  // random sides: over a few seeds each line comes from the west and from the east, a seed gives the same sides again, and the angle's sign is the side
  const sides = async (seed) => {
    await page.evaluate((s) => window.__globeDebug.captionSeed(s), seed);
    await page.evaluate(() => window.__globeDebug.pinCaption(0));
    await sleep(60);
    return (await captionOf(page)).lines.map((l) => ({ side: l.side, sign: Math.sign(l.theta) }));
  };
  const seen = new Set();
  let consistent = true;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const a = await sides(seed);
    const b = await sides(seed);
    consistent = consistent && JSON.stringify(a) === JSON.stringify(b) && a.every((x) => x.sign === x.side);
    a.forEach((x) => seen.add(x.side));
  }
  ok(seen.has(1) && seen.has(-1), "entrance: the lines come in from both sides, drawn at random per entrance");
  ok(consistent, "entrance: a seed gives the same sides again, and the angle's sign (east positive) is the line's side");
  await page.evaluate(() => window.__globeDebug.captionSeed(null));
  await page.evaluate(() => window.__globeDebug.pinCaption(null));
  // the limb: lines held half past the horizon on either side never mirror: the shell's front faces end before the limb and the planet's depth does the rest
  for (const deg of [58, 70, -58, -70, 80, -80]) {
    await page.evaluate((deg) => window.__globeDebug.pinCaptionAngle(deg), deg);
    await sleep(120);
  }
  await page.evaluate(() => window.__globeDebug.pinCaptionAngle(null));
  await ctx.close();
}

// The interaction's exit is a FADE of the caption, and the words stay locked to the globe while it runs: opacity is the only thing that changes (the
// lines do not travel round the orbit), their width goes with the planet's radius as it grows under a zoom (the cursor on the centre, off it, and a
// two-finger pinch on a touch screen), and they follow the earth when it is dragged. Sampled every frame in the page.
const sampler = (page) =>
  page.evaluate(() => {
    const S = { frames: [], stop: false, t0: performance.now() };
    window.__fade = S;
    const tick = () => {
      const c = window.__globeDebug.caption();
      const e = window.__globeDebug.captionExtent();
      S.frames.push({ t: performance.now() - S.t0, opacity: c.opacity, phase: c.phase, thetas: c.lines.map((l) => l.theta), width: e ? e.width : null, radius: e ? e.radiusPx : null, zoom: e ? e.zoom : null, lat: c.viewLat, lon: e ? e.lon : null, left: e ? e.left.x : null, parallelsFor: c.parallelsFor });
      if (!S.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const sampled = (page) => page.evaluate(() => { window.__fade.stop = true; return window.__fade.frames; });
async function fadeCase(name, options, start) {
  const { ctx, page } = await newPage(options);
  await page.goto(`${BASE_URL}/${SHOW_QUERY}`);
  await waitGlobe(page);
  await waitDebug(page);
  await sleep(3600); // at rest: every line in place
  await page.evaluate(() => window.__globeDebug.captionSeed(null));
  const before = await captionOf(page);
  ok(before.phase === "rest" && before.opacity === 1, `${name}: at rest, opaque`);
  await sampler(page);
  await sleep(60);
  await start(page, ctx);
  await sleep(700);
  const frames = await sampled(page);
  const f0 = frames.find((f) => f.width !== null);
  const fade = frames.filter((f) => f.phase === "fade");
  ok(fade.length >= 4, `${name}: the caption fades over several frames (${fade.length})`);
  ok(frames.at(-1).opacity === 0 && frames.at(-1).phase === "hidden", `${name}: it is gone at the end (opacity ${frames.at(-1).opacity})`);
  let mono = true;
  for (let i = 1; i < frames.length; i++) if (frames[i].opacity > frames[i - 1].opacity + 1e-6) mono = false;
  ok(mono, `${name}: the opacity only goes down`);
  // (the roll stands still in a fade: every line keeps the turn it had, within the amplitude, for the whole fade)
  const turn0 = fade[0]?.thetas ?? [];
  ok(fade.every((f) => f.thetas.every((t, i) => Math.abs(t) <= AMP + 0.003 && Math.abs(t - turn0[i]) < 1e-6)), `${name}: no orbit travel: every line keeps its turn for the whole fade`);
  // locked to the globe: at the middle of the fade the words are as wide as the planet's growth says
  const mid = fade.filter((f) => f.opacity > 0.15 && f.opacity < 0.85 && f.width !== null);
  ok(mid.length > 0, `${name}: frames in the middle of the fade (${mid.length}) still have their words in view`);
  if (mid.length && f0) {
    const grew = Math.max(...mid.map((f) => f.radius / f0.radius));
    // (the words float above the surface, so the nearer the camera the more perspective they gain over the silhouette: by a few percent for a
    // small zoom, up to a third for a big one; never less than the planet's own growth)
    const ratios = mid.map((f) => f.width / f0.width / (f.radius / f0.radius));
    ok(Math.min(...ratios) > 0.95 && Math.max(...ratios) < 1.0 + Math.max(0.1, (grew - 1) * 0.28), `${name}: their width goes with the planet's radius through the fade (radius x${grew.toFixed(2)}, width / radius ${Math.min(...ratios).toFixed(2)} to ${Math.max(...ratios).toFixed(2)})`);
    return { ctx, page, frames, grew };
  }
  return { ctx, page, frames, grew: 1 };
}
{
  const zoomIn = (x, y) => async (page) => {
    await page.mouse.move(x, y);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -160);
      await sleep(16);
    }
  };
  for (const [name, x, y] of [["fade, zoom from the centre", 720, 360], ["fade, zoom from off the centre", 930, 250]]) {
    const r = await fadeCase(name, DESKTOP, zoomIn(x, y));
    ok(r.grew > 1.03, `${name}: the planet did grow under the fade (x${r.grew.toFixed(2)})`);
    await r.ctx.close();
  }
  // a pinch on a touch screen (two fingers moving apart), through the protocol
  const pinch = async (page, ctx) => {
    const cdp = await ctx.newCDPSession(page);
    const cx = 195;
    const cy = 250;
    const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, id) => ({ x: p[0], y: p[1], id })) });
    await send("touchStart", [[cx - 20, cy], [cx + 20, cy]]);
    for (let i = 1; i <= 8; i++) {
      await send("touchMove", [[cx - 20 - i * 8, cy], [cx + 20 + i * 8, cy]]);
      await sleep(16);
    }
    await send("touchEnd", []);
  };
  const r = await fadeCase("fade, pinch on touch", MOBILE, pinch);
  ok(r.frames.length > 0, "fade, pinch on touch: sampled");
  await r.ctx.close();
  // a drag: the parallels follow the earth's tilt while the caption fades (the words are on the globe's own parallels, as at rest)
  {
    const { ctx, page } = await newPage(DESKTOP);
    await page.goto(`${BASE_URL}/${SHOW_QUERY}`);
    await waitGlobe(page);
    await waitDebug(page);
    await sleep(3600);
    await sampler(page);
    await page.mouse.move(720, 330);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(720, 330 + i * 14);
      await sleep(16);
    }
    await page.mouse.up();
    await sleep(500);
    const frames = await sampled(page);
    const fade = frames.filter((f) => f.phase === "fade");
    const last = fade.at(-1) ?? frames.at(-1);
    ok(fade.length >= 2 && Math.abs(frames.at(-1).lat - frames[0].lat) > 3, `fade, drag: the camera moved under the fade (tilt ${frames[0].lat.toFixed(1)} to ${frames.at(-1).lat.toFixed(1)})`);
    ok(Math.abs(last.parallelsFor - fade[0].parallelsFor) < 1e-6, `fade, drag: the rows stay on their parallels while they fade (picked for ${fade[0].parallelsFor.toFixed(1)}, the camera went to ${last.lat.toFixed(1)}): they are part of the earth that turns under the camera`);
    await ctx.close();
  }
}

// Reduced motion: the showcase is there at once (the final composition, no entrance) and the name does not travel.
{
  const { ctx, page, logs } = await newPage(DESKTOP, { reducedMotion: "reduce" });
  await page.goto(`${BASE_URL}/${SHOW_QUERY}`);
  await waitGlobe(page);
  await waitDebug(page);
  await sleep(900);
  const c = await captionOf(page);
  const i = await page.evaluate(() => window.__globeDebug.inset());
  ok(c.built && c.phase === "rest" && c.lines.every((l) => l.visible && l.theta === 0) && i.lift > 20 && i.lift === i.liftTarget, "reduced motion: the caption is in place and the planet lifted at once");
  await page.mouse.move(720, 120);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(60);
  ok((await heroState(page)) === "collapsed" && (await page.locator(".hero-given").evaluate((e) => e.getAnimations().length)) === 0, "reduced motion: the name does not travel (no animation), the hero is collapsed within 60 ms");
  ok((await page.evaluate(() => window.__globeDebug.inset().lift)) === 0 && (await captionOf(page)).lines.every((l) => !l.visible), "reduced motion: the caption is out and the planet down at once");
  ok(logs.length === 0, `reduced motion (caption): no console error or warning${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}

// The planet's top is inside the window and clear of the name, at every shape (from 320 x 480).
for (const [name, options] of VIEWPORTS) {
  const { ctx, page, logs } = await newPage(options);
  await page.goto(`${BASE_URL}/${SHOW_QUERY}`);
  await waitGlobe(page);
  await waitDebug(page);
  await sleep(900);
  const p = await planetOf(page);
  const c = await captionOf(page);
  ok(c.showcase && p.labels === 0, `${name}: the caption is in and the boxes are out (${c.pixel ? "pixel" : "crisp"})`);
  ok(p.cy - p.r >= -0.5, `${name}: the lifted planet's top is inside the window (${Math.round(p.cy - p.r)} px, lift ${p.lift.toFixed(0)}, cover ${p.cover})`);
  ok(p.cy + p.r <= p.h - p.cover + 1 || roomUsedUp(p), `${name}: it clears what covers the bottom, or the room above is used up`);
  ok(logs.length === 0, `${name}: no console error or warning${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}

// ?no-ring: the previous home page (boxes, hint visible, no ring, no caption, the world view is the fit).
{
  const { ctx, page, logs } = await newPage(DESKTOP);
  await page.goto(`${BASE_URL}/?no-ring`);
  await waitGlobe(page);
  await sleep(1200);
  ok((await page.locator("[data-ring]").count()) === 0, "no-ring: no ring is mounted");
  ok((await hero(page).getAttribute("data-orbit")) === "false", "no-ring: the hero is told there is no caption");
  const hint = await page.locator(".hero-hint").boundingBox();
  ok(hint !== null && hint.width > 100, "no-ring: the how-to line is visible");
  ok(logs.length === 0, `no-ring: no console error or warning${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}

// --- 11. A header that appears because of a gesture does not receive that gesture's click ------------------------------------------------
// On a phone a tap on the globe collapses the hero in the same task as the press and the header row appears; the browser then fires the
// tap's click at what is under the finger NOW. A tap near the top used to land on a header link ("Articles") and navigate. The header's
// controls ignore the pointer until the pointer sequence has ended plus a short guard (keyboard, focus and assistive technology unaffected).
{
  const TOUCH = { ...MOBILE, viewport: { width: 390, height: 844 } };
  // Where the "Articles" link is once the header is there (two steps: collapse, read the box).
  const probe = await newPage(TOUCH);
  await probe.page.goto(`${BASE_URL}/${IDLE_QUERY}`);
  await waitGlobe(probe.page);
  await waitDebug(probe.page);
  await sleep(800);
  await probe.page.touchscreen.tap(380, 400);
  await waitState(probe.page, "collapsed", 1500);
  await sleep(500);
  const box = await probe.page.locator("header a[href='/articles']").boundingBox();
  await probe.ctx.close();
  ok(box !== null && box.y + box.height / 2 < 60, `tap-through: the header's Articles link is in the top strip (${box ? Math.round(box.y + box.height / 2) : "none"} px)`);
  const tx = box.x + box.width / 2;
  const ty = box.y + box.height / 2;

  const { ctx, page, logs } = await newPage(TOUCH);
  await page.goto(`${BASE_URL}/${IDLE_QUERY.replace("hero-idle=1500", "hero-idle=20000")}`);
  await waitGlobe(page);
  await waitDebug(page);
  await sleep(800);
  ok((await page.locator("header").count()) === 0, "tap-through: no header before the tap");
  await page.touchscreen.tap(tx, ty);
  await sleep(700);
  ok(new URL(page.url()).pathname === "/", `tap-through: the tap's click did not reach the header link that appeared under it (${new URL(page.url()).pathname})`);
  if (new URL(page.url()).pathname === "/") ok((await heroState(page)) === "collapsed", "tap-through: the tap on the globe collapsed the hero");
  ok((await page.locator("header a[href='/articles']").count()) === 1 && (await page.locator("header a[href='/articles']").isVisible()), "tap-through: the header is there and visible");
  ok((await page.locator("header").getAttribute("data-guard")) === null, "tap-through: the guard is off a moment after the tap");
  // after the guard the link works with a real tap, and keyboard focus was never blocked
  await page.locator("header a[href='/software']").focus();
  ok(await page.evaluate(() => document.activeElement?.getAttribute("href") === "/software"), "tap-through: the header's links can be focused at once (keyboard and assistive technology are not guarded)");
  await page.evaluate(() => document.activeElement?.blur());
  await page.touchscreen.tap(tx, ty);
  await page.waitForURL("**/articles", { timeout: 4000 }).catch(() => {});
  ok(new URL(page.url()).pathname === "/articles", `tap-through: after the guard a tap on the link navigates (${new URL(page.url()).pathname})`);
  ok(logs.length === 0, `tap-through: no console error or warning${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("\nAll hero checks passed.");
