// Entry views in a browser (docs/web-architecture.md, "Entries in the shell"): the four kinds open in the shell's side panel and in
// the full-screen container (`?view=full`), the globe stays mounted while the container toggles, Escape and the toggle behave, the
// place panel lists its entries and opens one in the same panel, headings are in order, nothing overflows at 390 px, no console errors.
// Uses the DEMO content (made-up placeholders): run against `pnpm dev:demo` or a demo build, never against real content.
//
//   CHROME_PATH=/path/to/chrome BASE_URL=http://localhost:5370 OUT_DIR=/some/dir node scripts/entries/check.mjs
//
// Exit code 1 on any failed assertion. Screenshots (dark and light, desktop and 390 px) go to OUT_DIR.
import { readFileSync } from "node:fs";
import { BASE_URL, OUT_DIR, DESKTOP, MOBILE, launch } from "../globe/_lib.mjs";

// The four legacy slugs are the first entry of their kind in the demo fixture; the whole fixture is also read, so that every entry (long
// title, long verse line, wide code, many tags, no cover) goes through the layout checks below.
const FIXTURE = JSON.parse(readFileSync(new URL("../../../../packages/published/fixtures/demo.json", import.meta.url), "utf8"));
const COLLECTIONS = [["article", "articles"], ["project", "projects"], ["artwork", "artworks"], ["poem", "poems"]];
const ALL_ENTRIES = COLLECTIONS.flatMap(([kind, key]) => FIXTURE[key].map((e, i) => ({ kind, key, slug: e.slug, title: e.title, path: `/${key}/${e.slug}`, code: `${kind.toUpperCase()} / ${String(i + 1).padStart(4, "0")}` })));
const ENTRIES = ["demo-article", "demo-poem", "demo-project", "demo-artwork"].map((slug) => ALL_ENTRIES.find((e) => e.slug === slug));

const failures = [];
const ok = (cond, message) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${message}`);
  if (!cond) failures.push(message);
};

const browser = await launch();

async function newPage(contextOptions, colorScheme = "dark") {
  const ctx = await browser.newContext({ ...contextOptions, colorScheme });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => {
    if (m.type() === "error") logs.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  return { ctx, page, logs };
}

const waitPanel = (page) => page.waitForSelector("[data-panel]", { state: "visible", timeout: 15000 });
const waitGlobeMounted = (page) => page.waitForSelector("[data-globe]", { state: "attached", timeout: 20000 });
const panelState = (page) =>
  page.evaluate(() => {
    const p = document.querySelector("[data-panel]");
    const r = p?.getBoundingClientRect();
    return p ? { layout: p.getAttribute("data-layout"), role: p.getAttribute("role"), width: Math.round(r.width), left: Math.round(r.left), url: location.pathname + location.search } : null;
  });
const headingLevels = (page) =>
  page.evaluate(() => [...document.querySelectorAll("[data-panel] h1, [data-panel] h2, [data-panel] h3, [data-panel] h4, main h1, main h2, main h3, main h4")].filter((h) => h.getClientRects().length > 0 && !h.closest("[inert]")).map((h) => +h.tagName[1]));
const outline = (levels) => levels[0] === 1 && levels.filter((l) => l === 1).length === 1 && levels.every((l, i) => i === 0 || l - levels[i - 1] <= 1);
const overflow = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);

// --- 1. Desktop: each kind, panel and full screen -----------------------------------------------------------------------------------
for (const entry of ENTRIES) {
  const { ctx, page, logs } = await newPage(DESKTOP);
  const response = await page.goto(`${BASE_URL}${entry.path}`);
  ok(response?.status() === 200, `${entry.path}: 200`);
  await waitPanel(page);
  await waitGlobeMounted(page);
  await page.waitForTimeout(800);
  const t = `${entry.kind}`;

  const text = await page.locator("[data-panel] h1").innerText();
  ok(text === entry.title, `${t}: the panel's h1 is the title`);
  ok((await page.locator("[data-slot=entry-code]").innerText()).toUpperCase() === entry.code, `${t}: index code ${entry.code}`);
  const p0 = await panelState(page);
  ok(p0.layout === "panel" && p0.role === "complementary" && Math.abs(p0.left - 720) <= 2, `${t}: the panel is the right half, a complementary landmark`);
  ok(outline(await headingLevels(page)), `${t}: one h1, headings never skip a level (${(await headingLevels(page)).join("")})`);
  ok((await page.locator("main#main").count()) === 1 && (await page.locator("[data-panel] h1").evaluate((h) => document.activeElement === h).catch(() => false)) === false, `${t}: direct load keeps focus off the heading (no focus steal) and #main is the globe's main`);

  // the globe keeps its identity across the toggle
  await page.evaluate(() => {
    const g = document.querySelector("[data-globe]");
    g.__marker = "same-node";
    window.__canvasCount = document.querySelectorAll("canvas").length;
  });
  const toggle = page.getByRole("button", { name: "Full screen" });
  ok((await toggle.getAttribute("aria-pressed")) === "false", `${t}: the expand toggle is a pressed-state button, off`);
  await toggle.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-panel]")?.getAttribute("data-layout") === "full");
  await page.waitForTimeout(500);
  const p1 = await panelState(page);
  ok(p1.url.endsWith("?view=full"), `${t}: URL gets ?view=full (${p1.url})`);
  ok(p1.width >= 1438 && p1.role === "main", `${t}: full screen covers the viewport and is the main landmark (${p1.width}px)`);
  const kept = await page.evaluate(() => ({ same: document.querySelector("[data-globe]")?.__marker === "same-node", canvases: document.querySelectorAll("canvas").length === window.__canvasCount }));
  ok(kept.same && kept.canvases, `${t}: the globe node and its canvases are the same after expanding (not remounted)`);
  ok((await page.evaluate(() => document.activeElement?.getAttribute("aria-pressed"))) === "true", `${t}: focus stays on the toggle, now pressed`);
  ok((await page.evaluate(() => document.querySelectorAll("main#main, #main").length)) === 1, `${t}: exactly one #main in full screen`);
  ok(outline(await headingLevels(page)), `${t}: full screen: one h1, no skipped level`);
  ok((await page.evaluate(() => document.querySelector("main[inert]") !== null)), `${t}: the globe's main is inert behind the full view`);
  await page.screenshot({ path: `${OUT_DIR}/${t}-full-dark.png` });

  // skip link lands on the full view
  await page.keyboard.press("Tab");
  await page.focus("a[href='#main']");
  await page.keyboard.press("Enter");
  ok((await page.evaluate(() => document.activeElement?.id)) === "main" && (await page.evaluate(() => document.activeElement?.getAttribute("data-panel"))) !== null, `${t}: "Skip to content" focuses the full view`);

  // reload keeps the mode
  await page.reload();
  await waitPanel(page);
  ok((await panelState(page)).layout === "full", `${t}: reload keeps full screen`);
  const ssr = await page.request.get(`${BASE_URL}${entry.path}?view=full`).then((r) => r.text());
  ok(/data-layout="full"/.test(ssr) && ssr.includes(`>${entry.title}<`), `${t}: the server renders the full view (SSR)`);

  // back to the panel with the toggle; the URL loses the parameter
  await waitGlobeMounted(page);
  await page.getByRole("button", { name: "Full screen" }).click();
  await page.waitForFunction(() => document.querySelector("[data-panel]")?.getAttribute("data-layout") === "panel");
  await page.waitForTimeout(500);
  const p2 = await panelState(page);
  ok(!p2.url.includes("view=") && Math.abs(p2.left - 720) <= 2, `${t}: collapsing returns to the half panel and drops ?view (${p2.url})`);
  // Back goes to full again (the toggle is a history entry), then forward
  await page.goBack();
  await page.waitForFunction(() => document.querySelector("[data-panel]")?.getAttribute("data-layout") === "full");
  ok(true, `${t}: browser Back from the panel returns to full screen`);
  await page.goForward();
  await page.waitForFunction(() => document.querySelector("[data-panel]")?.getAttribute("data-layout") === "panel");

  // Escape closes
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => location.pathname === "/");
  await page.waitForFunction(() => !document.querySelector("[data-panel]"));
  ok(true, `${t}: Escape closes the panel and returns to /`);
  ok((await page.evaluate(() => document.querySelectorAll("h1").length)) === 1, `${t}: closed: the globe page has its own single h1`);
  ok(logs.length === 0, `${t}: no console errors${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}

// --- 2. The place panel lists its entries; one opens in the same panel with a way back ---------------------------------------------------
{
  const { ctx, page, logs } = await newPage(DESKTOP);
  await page.goto(`${BASE_URL}/locations/lisbon`);
  await waitPanel(page);
  await waitGlobeMounted(page);
  await page.waitForTimeout(800);
  ok((await page.locator("[data-panel] h1").innerText()) === "Lisbon", "place: panel h1 is the place");
  ok(outline(await headingLevels(page)), `place: headings in order (${(await headingLevels(page)).join("")})`);
  const groups = await page.locator("[data-slot=place-entries] h3").allInnerTexts();
  ok(groups.length === 2 && /articles/i.test(groups[0]) && /projects/i.test(groups[1]), `place: entries grouped by kind (${groups.join(" | ").replace(/\n/g, " ")})`);
  await page.screenshot({ path: `${OUT_DIR}/place-dark.png` });
  await page.evaluate(() => {
    document.querySelector("[data-panel]").__marker = "same-panel";
    document.querySelector("[data-globe]").__marker = "same-globe";
  });
  await page.getByRole("link", { name: "Eleven hours of Atlantic coast, by bus" }).click();
  await page.waitForURL("**/articles/morocco-coast-bus");
  await page.waitForSelector("[data-slot=entry-view]");
  const same = await page.evaluate(() => ({ panel: document.querySelector("[data-panel]")?.__marker === "same-panel", globe: document.querySelector("[data-globe]")?.__marker === "same-globe", focus: document.activeElement?.id }));
  ok(same.panel && same.globe, "place: the entry opens in the SAME panel element, the globe stays mounted");
  ok(same.focus === "panel-heading", "place: focus moves to the entry's heading after the click");
  const back = page.getByRole("link", { name: /Back to .*Lisbon/ });
  ok((await back.count()) === 1, "entry opened from a place has a way back to it");
  await back.click();
  await page.waitForURL("**/locations/lisbon");
  await page.waitForSelector("[data-slot=place-view]");
  ok((await page.locator("[data-panel] h1").innerText()) === "Lisbon", "back path returns to the place panel");
  // entry -> place by its places list
  await page.getByRole("link", { name: "Collide, a label collision engine for maps" }).click();
  await page.waitForURL("**/projects/label-collision-engine");
  await page.locator('[data-slot=entry-view] section a[href="/locations/lisbon"]').click();
  await page.waitForURL("**/locations/lisbon");
  await page.waitForSelector("[data-slot=place-view]");
  ok(true, "entry: its place links to /locations/:slug");
  ok(logs.length === 0, `place: no console errors${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}

// --- 3. Unknown slugs are real 404s through the not-found page ----------------------------------------------------------------------------
for (const path of ["/articles/nope", "/projects/demo-poem", "/poems/Demo-Poem"]) {
  const { ctx, page } = await newPage(DESKTOP);
  const r = await page.goto(`${BASE_URL}${path}`);
  ok(r?.status() === 404, `${path}: 404`);
  ok(/Page not found/.test(await page.locator("h1").first().innerText()), `${path}: the not-found page`);
  await ctx.close();
}

// --- 4. Lists ----------------------------------------------------------------------------------------------------------------------------
for (const [kind, key] of COLLECTIONS) {
  const path = `/${key}`;
  const { ctx, page, logs } = await newPage(DESKTOP);
  await page.goto(`${BASE_URL}${path}`);
  const slugs = FIXTURE[key].map((e) => e.slug);
  const found = await Promise.all(slugs.map((slug) => page.locator(`#${slug}`).count()));
  ok(found.every((n) => n === 1), `${path}: one card per demo ${kind} (${slugs.length}), each anchored by its slug`);
  ok(outline(await headingLevels(page)), `${path}: one h1, cards at level 2`);
  const slug = slugs[0];
  const href = await page.locator(`#${slug} a`).first().getAttribute("href");
  ok(href === `${path}/${slug}`, `${path}: the card links to ${href}`);
  const covers = await page.evaluate(() => [...document.querySelectorAll("main img")].filter((i) => i.getClientRects().length).map((i) => i.complete && i.naturalWidth > 0));
  ok(covers.every(Boolean), `${path}: every authored cover in the list loaded (${covers.length} images)`);
  const wide = await overflow(page);
  ok(wide <= 0, `${path}: no horizontal overflow on desktop (${wide})`);
  await page.screenshot({ path: `${OUT_DIR}/list-${key}-desktop-dark.png`, fullPage: true });
  await page.locator(`#${slug} a`).first().click();
  await page.waitForURL(`**${path}/${slug}`);
  await waitPanel(page);
  ok(true, `${path}: the card opens the entry in the panel`);
  ok(logs.length === 0, `${path}: no console errors${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}
if (process.env.BASE_URL_EMPTY) {
  const { ctx, page } = await newPage(DESKTOP);
  await page.goto(`${process.env.BASE_URL_EMPTY}/articles`);
  ok(/Nothing here yet/.test(await page.locator("main").innerText()), "empty collection: the StatePanel says nothing here yet");
  await page.screenshot({ path: `${OUT_DIR}/list-empty-dark.png` });
  await ctx.close();
}

// --- 5. 390 px: no horizontal overflow, slide-over, no expand toggle ----------------------------------------------------------------------
for (const scheme of ["dark", "light"]) {
  for (const path of [...ALL_ENTRIES.map((e) => e.path), "/locations/lisbon", "/locations/cusco", "/locations/zagreb", "/articles", "/poems", "/projects", "/artworks"]) {
    const { ctx, page, logs } = await newPage(MOBILE, scheme);
    await page.goto(`${BASE_URL}${path}`);
    await page.waitForTimeout(700);
    const o = await overflow(page);
    ok(o <= 0, `390px ${scheme} ${path}: no horizontal overflow (${o})`);
    if (/\/(articles|projects|artworks|poems|locations)\/./.test(path)) {
      await page.waitForSelector("[role=dialog]");
      ok((await page.getByRole("button", { name: "Full screen" }).count()) === 0 || !(await page.getByRole("button", { name: "Full screen" }).isVisible()), `390px ${path}: no expand toggle (the slide-over is full screen)`);
      ok(await page.evaluate(() => document.activeElement?.id === "panel-heading"), `390px ${path}: focus moves to the heading`);
      if (/^\/(articles|projects|artworks|poems)\//.test(path) || path.startsWith("/locations/")) await page.screenshot({ path: `${OUT_DIR}/${path.slice(1).replace(/\//g, "-")}-${scheme}-390.png` });
    } else if (path === "/poems" || path === "/articles" || path === "/projects" || path === "/artworks") await page.screenshot({ path: `${OUT_DIR}/list${path.replace("/", "-")}-${scheme}-390.png` });
    // 44 px targets
    const small = await page.evaluate(() => [...document.querySelectorAll("a, button")].filter((e) => e.getClientRects().length && !e.closest("[inert]") && !e.classList.contains("sr-only")).map((e) => ({ t: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 24), h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width })).filter((r) => r.h < 43.5 && r.w < 43.5 && r.t));
    ok(small.length === 0, `390px ${scheme} ${path}: targets are 44 px (${small.map((s) => `${s.t}:${Math.round(s.w)}x${Math.round(s.h)}`).join(", ")})`);
    ok(logs.length === 0, `390px ${scheme} ${path}: no console errors${logs.length ? ` (${logs.join(" | ")})` : ""}`);
    await ctx.close();
  }
}

// --- 6. Desktop screenshots in both schemes, and reduced motion ---------------------------------------------------------------------------
for (const scheme of ["dark", "light"]) {
  for (const [name, path] of [["article", "/articles/demo-article"], ["poem", "/poems/demo-poem"], ["project", "/projects/demo-project"], ["artwork", "/artworks/demo-artwork"], ["article-full", "/articles/demo-article?view=full"], ["poem-full", "/poems/demo-poem?view=full"], ["list-articles", "/articles"]]) {
    const { ctx, page } = await newPage(DESKTOP, scheme);
    await page.goto(`${BASE_URL}${path}`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT_DIR}/${name}-${scheme}.png` });
    await ctx.close();
  }
}
{
  const ctx = await browser.newContext({ ...DESKTOP, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/articles/demo-article`);
  await waitPanel(page);
  await page.getByRole("button", { name: "Full screen" }).click();
  await page.waitForTimeout(60);
  const w = await page.evaluate(() => Math.round(document.querySelector("[data-panel]").getBoundingClientRect().width));
  ok(w >= 1438, `reduced motion: the container switches at once (${w}px after 60 ms)`);
  await ctx.close();
}

// --- 7. Every demo entry, in the panel and in full screen: its title, nothing wider than its container, every image loaded ------------------------------
// (what the richer content can break: a very long title, long verse lines, wide code, many tags, a cover or no cover, many images).
for (const entry of ALL_ENTRIES) {
  for (const layout of ["panel", "full"]) {
    const { ctx, page, logs } = await newPage(DESKTOP);
    await page.goto(`${BASE_URL}${entry.path}${layout === "full" ? "?view=full" : ""}`);
    await waitPanel(page);
    await page.waitForTimeout(500);
    // let every lazy image load before measuring
    await page.evaluate(async () => {
      const panel = document.querySelector("[data-panel]");
      for (const img of panel.querySelectorAll("img")) img.loading = "eager";
      for (let y = 0; y < panel.scrollHeight; y += 600) { panel.scrollTo?.(0, y); window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
      await Promise.all([...panel.querySelectorAll("img")].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
      panel.scrollTo?.(0, 0);
      window.scrollTo(0, 0);
    });
    const t = `${entry.path}${layout === "full" ? " (full)" : ""}`;
    ok((await page.locator("[data-panel] h1").innerText()) === entry.title, `${t}: the h1 is the title`);
    ok(outline(await headingLevels(page)), `${t}: one h1, no skipped heading level`);
    const m = await page.evaluate(() => {
      const panel = document.querySelector("[data-panel]");
      const box = panel.getBoundingClientRect();
      const wide = [...panel.querySelectorAll("*")]
        .filter((e) => !e.closest("pre") && e.getClientRects().length && e.getBoundingClientRect().right > box.right + 1)
        .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)}`);
      const images = [...panel.querySelectorAll("img")].map((i) => i.complete && i.naturalWidth > 0);
      const pre = [...panel.querySelectorAll("pre")].map((p) => ({ scrolls: p.scrollWidth > p.clientWidth, focusable: p.tabIndex >= 0 }));
      return { wide: wide.slice(0, 4), images, pre, overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth };
    });
    ok(m.wide.length === 0 && m.overflow <= 0, `${t}: nothing wider than the panel (${m.wide.join(", ") || "ok"}, page overflow ${m.overflow})`);
    ok(m.images.every(Boolean), `${t}: every image loaded (${m.images.length})`);
    ok(m.pre.every((p) => !p.scrolls || p.focusable), `${t}: a code block that scrolls is focusable (${m.pre.length} blocks)`);
    ok(logs.length === 0, `${t}: no console errors${logs.length ? ` (${logs.join(" | ")})` : ""}`);
    if (layout === "full" || ["demo-poem", "vietnam-by-rail", "timetable-diff", "altiplano-sediment", "citadel-rain", "cuesta-arriba", "quai-de-nuit", "rain-at-the-citadel-gate"].includes(entry.slug)) {
      await page.screenshot({ path: `${OUT_DIR}/entry-${entry.slug}-${layout}.png`, fullPage: false });
    }
    await ctx.close();
  }
}

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
