// The career page in a browser (docs/career-page.md). Uses the DEMO content (a made-up career with a portrait): run against
// `CATALYST_CONTENT=demo react-router dev --port N` or a demo build, never against real content. Optionally ABSENT_URL points at a
// server whose projection has NO career (the committed `published` content): `/career` must be a 404 there and no link may exist.
//
//   CHROME_PATH=/path/to/chrome BASE_URL=http://localhost:5250 ABSENT_URL=http://localhost:5251 OUT_DIR=/some/dir node scripts/career/check.mjs
//
// Layout shift must stay under 0.01 (Core Web Vitals "good" is 0.1; the dev server shows about 0.002: the mono face swapping in a tag line).
// Checks: 200 and the head tags; ONE h1 and heading levels in order; the languages line directly under the head and before the
// experience; the timelines are ordered lists, newest first, each period a <time>; the portrait (size attributes, eager, high
// priority, no layout shift measured), the page without horizontal scroll at 320, 390 and 1440 px in both schemes; no mailto/tel
// link and no "@" in the text; the keyboard order and a visible focus; reduced motion (no animation or transition on the page's
// content); print emulation (no chrome, one column, ink on white, no horizontal overflow, a PDF that is a few pages); the header,
// hero and search entries exist with a career and none without. Screenshots go to OUT_DIR. Exit code 1 on any failed assertion.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { BASE_URL, OUT_DIR, DESKTOP, MOBILE, launch } from "../globe/_lib.mjs";

mkdirSync(OUT_DIR, { recursive: true });
const ABSENT_URL = process.env.ABSENT_URL;
const FIXTURE = JSON.parse(readFileSync(new URL("../../../../packages/published/fixtures/demo.json", import.meta.url), "utf8"));
const CAREER = FIXTURE.career;

const failures = [];
const ok = (cond, message) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${message}`);
  if (!cond) failures.push(message);
};

const browser = await launch();

async function open(contextOptions, colorScheme, path = "/career", base = BASE_URL) {
  const ctx = await browser.newContext({ ...contextOptions, colorScheme });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  // Layout shift is measured from the first byte: the observer is installed before any page script.
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cls += e.value;
        (window.__shifts ??= []).push({ v: e.value, at: Math.round(e.startTime), src: e.sources.map((s) => (s.node?.nodeName ?? "?") + "." + (s.node?.className ?? "")) });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  const response = await page.goto(`${base}${path}`, { waitUntil: "load" });
  await page.waitForTimeout(600);
  return { ctx, page, logs, response };
}

// The page's own content must not be wider than the screen. The faint bleeds behind the portrait and the logos are decoration that may spill
// past the screen's edge (the root clips it: `overflow-x: clip`, so nobody can scroll to it), so they are left out of the measure.
const overflow = (page) =>
  page.evaluate(() => {
    const bleeds = [...document.querySelectorAll(".career-glow, .career-portrait-glow")];
    const was = bleeds.map((b) => b.style.display);
    bleeds.forEach((b) => (b.style.display = "none"));
    const over = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth;
    bleeds.forEach((b, i) => (b.style.display = was[i]));
    return over;
  });

// --- 1. Structure (desktop, light) ------------------------------------------------------------------------------------------------
{
  const { ctx, page, logs, response } = await open(DESKTOP, "light");
  ok(response?.status() === 200, "/career: 200 with the demo content");
  ok((await page.title()) === "Career · Elliot Négrel-Jerzy", "the title is `Career · <name>`");
  ok(((await page.locator('meta[name="description"]').getAttribute("content")) ?? "").length > 20, "has a description");
  ok(((await page.locator('link[rel="canonical"]').getAttribute("href")) ?? "").endsWith("/career"), "has the canonical URL");
  ok(((await page.locator('meta[property="og:image"]').getAttribute("content")) ?? "").endsWith("/og-default.png"), "the share image is the site's default, not the portrait");

  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  const json = ld.length === 1 ? JSON.parse(ld[0]) : null;
  ok(json?.["@type"] === "ProfilePage" && json.mainEntity?.["@type"] === "Person", "one JSON-LD ProfilePage with a Person");
  ok(json && !/@[a-z0-9-]+\.[a-z]|tel:|mailto:|\+\d{2}/i.test(JSON.stringify(json)) && !("image" in json.mainEntity) && !("worksFor" in json.mainEntity), "the JSON-LD has no contact detail, no image and no employer");

  const levels = await page.evaluate(() => [...document.querySelectorAll("main h1, main h2, main h3, main h4")].map((h) => +h.tagName[1]));
  ok(levels[0] === 1 && levels.filter((l) => l === 1).length === 1 && levels.every((l, i) => i === 0 || l - levels[i - 1] <= 1), `one h1 and the levels in order (${levels.join("")})`);
  ok((await page.locator("main h1").innerText()) === "Elliot Négrel-Jerzy", "the h1 is the owner's name");

  const order = await page.evaluate(() => {
    const y = (s) => document.querySelector(s)?.getBoundingClientRect().top ?? -1;
    const pos = (a, b) => !!(document.querySelector(a).compareDocumentPosition(document.querySelector(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      head: y('[data-slot="career-head"]'),
      languages: y('[data-slot="career-languages"]'),
      experience: y("#experience"),
      langBeforeExp: pos('[data-slot="career-languages"]', "#experience"),
      expBeforeEdu: pos("#experience", "#education"),
      eduBeforeSkills: pos("#education", "#skills"),
      skillsBeforeLinks: pos("#skills", '[data-slot="career-links"]'),
      headBottom: document.querySelector('[data-slot="career-head"]').getBoundingClientRect().bottom,
    };
  });
  ok(order.langBeforeExp && order.expBeforeEdu && order.eduBeforeSkills && order.skillsBeforeLinks, "order: head, languages, experience, education, skills, links");
  ok(order.languages - order.headBottom < 120 && order.languages < order.experience, "the languages line sits directly under the head");

  const timeline = await page.evaluate(() => {
    const ol = document.querySelector("#experience ol");
    const items = [...ol.children];
    return {
      tag: ol.tagName,
      starts: items.map((li) => li.querySelector("time")?.getAttribute("datetime")),
      allHaveTime: items.every((li) => li.querySelector("time")),
      hasEducation: !!document.querySelector("#education ol"),
    };
  });
  ok(timeline.tag === "OL" && timeline.allHaveTime, "the experience is an <ol> and every item has a <time>");
  ok(JSON.stringify(timeline.starts) === JSON.stringify(CAREER.roles.map((r) => r.start)), "the roles are newest first, as authored");
  ok(timeline.hasEducation, "the education is an <ol> too");

  const avail = await page.locator('[data-slot="career-availability"]').innerText();
  ok(/as of September 2026/i.test(avail), `the availability shows its date as "as of Month YYYY" (${avail.replace(/\n/g, " ")})`);

  const text = await page.locator("main").innerText();
  ok(!/@/.test(text), 'no "@" anywhere in the page text');
  const hrefs = await page.evaluate(() => [...document.querySelectorAll("main a[href]")].map((a) => a.getAttribute("href")));
  ok(!hrefs.some((h) => /^(mailto|tel|sms):/i.test(h)), "no mailto: or tel: link");
  ok(hrefs.filter((h) => h.startsWith("http")).every((h) => h.startsWith("https://")), "every external link is https");

  const portrait = await page.evaluate(() => {
    const img = document.querySelector('[data-slot="career-portrait"] img:not([aria-hidden])');
    const r = img?.getBoundingClientRect();
    return img && { w: img.getAttribute("width"), h: img.getAttribute("height"), loading: img.getAttribute("loading"), priority: img.getAttribute("fetchpriority"), alt: img.getAttribute("alt"), box: [Math.round(r.width), Math.round(r.height)], cover: getComputedStyle(img).objectFit, pos: getComputedStyle(img).objectPosition };
  });
  ok(portrait && portrait.w === "800" && portrait.h === "1000" && portrait.loading === "eager" && portrait.priority === "high" && portrait.alt.length > 10, "the portrait has its size attributes, loads eagerly with high priority and has alt text");
  ok(portrait && portrait.cover === "cover" && /^50% 30%/.test(portrait.pos) && Math.abs(portrait.box[1] / portrait.box[0] - 1) < 0.02, `the portrait is a square, object-fit cover, centred on the face (${portrait?.box.join("x")}, ${portrait?.pos})`);
  const cls = await page.evaluate(() => window.__cls);
  ok(cls < 0.01, `no layout shift (CLS ${cls.toFixed(4)})`);
  ok(logs.length === 0, `no console error or warning${logs.length ? `: ${logs.join(" | ")}` : ""}`);
  await ctx.close();
}

// --- 2. Screens: both schemes, three widths -------------------------------------------------------------------------------------------
for (const [name, opts] of [["desktop", DESKTOP], ["phone", MOBILE], ["narrow", { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  for (const scheme of ["light", "dark"]) {
    const { ctx, page, logs } = await open(opts, scheme);
    const over = await overflow(page);
    ok(over <= 0, `${name}/${scheme}: no horizontal scroll (${over}px)`);
    const headerOk = await page.evaluate(() => {
      const nav = document.querySelector('[data-slot="site-header"] nav');
      if (!nav) return false;
      const r = nav.getBoundingClientRect();
      return r.left >= -0.5 && r.right <= window.innerWidth + 0.5;
    });
    ok(headerOk, `${name}/${scheme}: the header row (with the career link) fits the viewport`);
    const cls = await page.evaluate(() => window.__cls);
    ok(cls < 0.01, `${name}/${scheme}: no layout shift (${cls.toFixed(4)}) ${cls >= 0.001 ? JSON.stringify(await page.evaluate(() => window.__shifts)) : ""}`);
    await page.screenshot({ path: `${OUT_DIR}/career-${name}-${scheme}.png`, fullPage: true });
    ok(logs.length === 0, `${name}/${scheme}: no console error${logs.length ? `: ${logs.join(" | ")}` : ""}`);
    await ctx.close();
  }
}

// --- 2b. The head across widths: the portrait is a square of its own size that never hangs over the line below nor squeezes the text -
// (a regression: at about 820 px the square took its width from the height of the text beside it, grew to 300 px and overlapped the languages)
for (const width of [641, 700, 768, 820, 900, 1024, 1280, 1440]) {
  const { ctx, page } = await open({ viewport: { width, height: 1043 }, deviceScaleFactor: 1 }, "light");
  const m = await page.evaluate(() => {
    const q = (s) => document.querySelector(s)?.getBoundingClientRect();
    const f = q('[data-slot="career-portrait"]'), t = q(".career-id-text"), l = q('[data-slot="career-languages"]'), n = q("#career-name");
    return { f: [f.width, f.height, f.top, f.bottom], textW: t.width, langTop: l.top, nameTop: n.top, rem: parseFloat(getComputedStyle(document.documentElement).fontSize) };
  });
  const [fw, fh, , fb] = m.f;
  ok(Math.abs(fw - fh) < 1 && fw >= 9 * m.rem - 1 && fw <= 17 * m.rem + 1, `${width}px: the portrait is a square between 9 and 17 rem (${Math.round(fw)}x${Math.round(fh)})`);
  ok(fb <= m.langTop + 0.5, `${width}px: the portrait stays above the languages line (bottom ${Math.round(fb)}, line ${Math.round(m.langTop)})`);
  ok(m.textW >= width * 0.55, `${width}px: the text keeps at least 55 % of the width (${Math.round(m.textW)} px)`);
  ok(Math.abs(m.f[2] - m.nameTop) < 1.5, `${width}px: the top of the portrait meets the top of the name`);
  await ctx.close();
}

// --- 3. Keyboard: the order of the tab stops, with a visible focus ---------------------------------------------------------------------
{
  const { ctx, page } = await open(DESKTOP, "light");
  const stops = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return { tag: el.tagName, text: (el.textContent ?? "").trim().slice(0, 30), href: el.getAttribute("href"), inMain: !!el.closest("main"), ring: cs.outlineStyle !== "none" || cs.boxShadow !== "none" || cs.textDecorationLine !== "none" };
    });
    if (!s) break;
    stops.push(s);
  }
  const mainStops = stops.filter((s) => s.inMain);
  const firstMain = stops.findIndex((s) => s.inMain);
  ok(stops.slice(0, firstMain).some((s) => s.href === "/career"), "the header's Career link is a tab stop before the page's content");
  ok(mainStops.length >= 4 && mainStops.every((s) => s.ring), `${mainStops.length} tab stops in the page, each with a visible focus style`);
  const external = FIXTURE.career.links.map((l) => l.url);
  const seen = mainStops.map((s) => s.href).filter((h) => h?.startsWith("http"));
  ok(JSON.stringify(seen.slice(-external.length)) === JSON.stringify(external), "the links of the footer are the last tab stops, in the document's order");
  await ctx.close();
}

// --- 4. Reduced motion ----------------------------------------------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ ...DESKTOP, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/career`);
  await page.waitForTimeout(400);
  const moving = await page.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => {
    const cs = getComputedStyle(el);
    return (cs.animationName !== "none" && parseFloat(cs.animationDuration) > 0) || cs.transitionDuration.split(",").some((d) => parseFloat(d) > 0.001 && /color|transform|opacity|all/.test(cs.transitionProperty));
  }).map((el) => el.className).slice(0, 5));
  ok(moving.length === 0 || moving.every((c) => /career-(org|place|link)/.test(String(c))), `reduced motion: nothing moves in the page (${moving.join(", ") || "none"})`);
  await ctx.close();
}

// --- 5. Print ----------------------------------------------------------------------------------------------------------------------------
{
  const { ctx, page } = await open(DESKTOP, "dark");
  await page.emulateMedia({ media: "print", colorScheme: "dark" });
  const p = await page.evaluate(() => {
    const vis = (s) => { const el = document.querySelector(s); return !!el && getComputedStyle(el).display !== "none"; };
    const timeline = document.querySelector("#experience");
    return {
      header: vis('[data-slot="site-header"]'),
      skip: vis('[data-slot="skip-links"]'),
      bg: getComputedStyle(document.body).backgroundColor,
      color: getComputedStyle(document.querySelector("main")).color,
      blockDisplay: getComputedStyle(timeline).display,
      linkAfter: getComputedStyle(document.querySelector(".career-link"), "::after").content,
      over: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    };
  });
  ok(!p.header && !p.skip, "print: no header and no skip links");
  ok(p.bg === "rgb(255, 255, 255)" && /^rgb\(0, 0, 0\)|^rgb\(10, 10, 10\)|^rgb\(1?\d, 1?\d, 1?\d\)/.test(p.color), `print: ink on white whatever the scheme (${p.bg}, ${p.color})`);
  ok(p.blockDisplay === "block", "print: one column (the blocks stack)");
  ok(p.linkAfter.includes("http"), "print: the links print their address");
  ok(p.over <= 0, `print: no horizontal overflow (${p.over}px)`);
  const pdf = await page.pdf({ format: "A4", printBackground: false });
  writeFileSync(`${OUT_DIR}/career-print.pdf`, pdf);
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  ok(pages >= 1 && pages <= 3, `print: the PDF is ${pages} page(s) (1 to 3 expected)`);
  await page.screenshot({ path: `${OUT_DIR}/career-print.png`, fullPage: true });
  await ctx.close();
}

// --- 6. Discoverability with a career: header, home hero, search -------------------------------------------------------------------------
{
  const { ctx, page } = await open(DESKTOP, "light", "/");
  await page.waitForSelector('[data-slot="landing-hero"]');
  await page.waitForTimeout(1500); // the palette is mounted by the navigation at hydration
  const hero = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".hero-row")];
    return { hrefs: rows.map((a) => a.getAttribute("href")), labels: rows.map((a) => a.textContent.trim()), rows: document.querySelector('[data-slot="landing-hero"]').getAttribute("data-rows") };
  });
  ok(hero.hrefs.join() === "/software,/articles,/artworks,/poetry,/photography,/career" && hero.labels.at(-1) === "Career" && hero.rows === "6", `the hero has Career as its last row (${hero.hrefs.join(" ")})`);
  await page.evaluate(() => window.dispatchEvent(new Event("site:open-search")));
  await page.waitForSelector("dialog[open] input");
  await page.keyboard.type("career");
  await page.waitForTimeout(500);
  const hits = await page.locator('dialog[open] [role="option"]').allInnerTexts();
  ok(hits.some((h) => /career/i.test(h)), `the search finds the career page (${hits.slice(0, 3).join(" | ").replace(/\n/g, " ")})`);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/career$/, { timeout: 5000 }).catch(() => {});
  ok(new URL(page.url()).pathname === "/career", "Enter on the result opens /career");
  await ctx.close();
}

// --- 7. Without a career: 404, no link anywhere ------------------------------------------------------------------------------------------
if (ABSENT_URL) {
  const { ctx, page, response } = await open(DESKTOP, "light", "/career", ABSENT_URL);
  ok(response?.status() === 404, "without a career: /career is a 404");
  ok((await page.locator('a[href="/career"]').count()) === 0, "without a career: no link to /career in the header of the 404 page");
  await ctx.close();
  const home = await open(DESKTOP, "light", "/", ABSENT_URL);
  ok((await home.page.locator(".hero-row").count()) === 4 && (await home.page.locator('a[href="/career"]').count()) === 0, "without a career: the hero has its four rows and no career link");
  const map = await (await fetch(`${ABSENT_URL}/sitemap.xml`)).text();
  ok(!map.includes("/career"), "without a career: not in the sitemap");
  const idx = await (await fetch(`${ABSENT_URL}/search-index.json`)).json();
  ok(!idx.some((i) => i.type === "career"), "without a career: not in the search index");
  await home.ctx.close();
} else {
  console.log("SKIP  ABSENT_URL is not set: the no-career checks (404, no links) did not run");
}
{
  const map = await (await fetch(`${BASE_URL}/sitemap.xml`)).text();
  ok(map.includes("/career</loc>"), "with a career: /career is in the sitemap");
}

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} FAILED`);
  process.exit(1);
}
console.log("\nall checks passed");
