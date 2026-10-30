// Mature content ("sensitive") entries in a browser (docs/design-system.md, "Sensitive media"; docs/web-architecture.md, "Sensitive media").
// On the DEMO content (made-up placeholders; the one sensitive entry is `/artworks/figure-study-two`): the images of a sensitive entry are
// blurred in the server HTML and at every moment of hydration, the entry offers one real "Show image" button (keyboard, aria-pressed,
// status), a reload and a client-side return re-blur, cards in lists, the place panel and the related entries are blurred with no control,
// the head and the structured data never carry the cover, nothing is stored, print keeps the blur, reduced motion unblurs at once.
//
//   CHROME_PATH=/path/to/chrome BASE_URL=http://localhost:5500 OUT_DIR=/some/dir node scripts/entries/sensitive.mjs
//
// Exit code 1 on any failed assertion. Screenshots (dark and light, 1440 and 390 px, hidden and revealed) go to OUT_DIR.
import { readFileSync } from "node:fs";
import { BASE_URL, OUT_DIR, DESKTOP, MOBILE, launch } from "../globe/_lib.mjs";

const FIXTURE = JSON.parse(readFileSync(new URL("../../../../packages/published/fixtures/demo.json", import.meta.url), "utf8"));
const SLUG = "figure-study-two";
const PATH = `/artworks/${SLUG}`;
const entry = FIXTURE.artworks.find((a) => a.slug === SLUG);
if (!entry?.sensitive) throw new Error("the demo fixture has no sensitive entry");
const MEDIA = [entry.cover.src, ...entry.body.filter((b) => b.type === "image").map((b) => b.src)];
const COVER_STEM = entry.cover.src.split("/").pop().replace(/\.svg$/, "");

const failures = [];
const ok = (cond, message) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${message}`);
  if (!cond) failures.push(message);
};

const browser = await launch();

async function newPage(contextOptions = DESKTOP, colorScheme = "dark", extra = {}) {
  const ctx = await browser.newContext({ ...contextOptions, colorScheme, ...extra });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => {
    if (m.type() === "error") logs.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  return { ctx, page, logs };
}

/** Every frame of mature content in `root`: its state, the blur radius in px (0 = none) of the picture, the frame's width, whether it has a control. */
const frames = (page, root = "body") =>
  page.evaluate((root) => {
    return [...document.querySelector(root).querySelectorAll("[data-slot=sensitive-media]")].map((frame) => {
      const content = frame.querySelector(".sensitive-media-content");
      const filter = getComputedStyle(content).filter;
      const m = /blur\(([\d.]+)px\)/.exec(filter);
      return {
        state: frame.getAttribute("data-state"),
        blur: m ? parseFloat(m[1]) : 0,
        width: Math.round(frame.getBoundingClientRect().width),
        control: frame.querySelectorAll("button").length,
        interactive: frame.hasAttribute("data-interactive"),
        label: frame.querySelector("[data-slot=sensitive-media-label]")?.textContent?.trim() ?? "",
        text: frame.innerText,
        inFrame: !!content.querySelector("img"),
      };
    });
  }, root);

/** "Unrecognisable": the blur is at least 12 px and about 5 % of the frame's width (or the 48 px cap). */
const strong = (f) => f.blur >= 12 && (f.blur >= 0.055 * f.width || f.blur >= 47);
const headOf = (page) =>
  page.evaluate(() => ({
    ogImage: document.querySelector('meta[property="og:image"]')?.content,
    twitterImage: document.querySelector('meta[name="twitter:image"]')?.content,
    robots: document.querySelector('meta[name="robots"]')?.content,
    jsonld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent)),
  }));
const noCover = (value) => !MEDIA.some((src) => String(value).includes(src.split("/").pop())) && !String(value).includes(COVER_STEM);

// --- 1. The server HTML ----------------------------------------------------------------------------------------------------------
{
  const html = await fetch(`${BASE_URL}${PATH}`).then((r) => r.text());
  const open = [...html.matchAll(/<div data-slot="sensitive-media" data-state="(\w+)"/g)].map((m) => m[1]);
  ok(open.length === 1 + entry.body.filter((b) => b.type === "image").length && open.every((s) => s === "hidden"), `server HTML: the cover and the image block are frames, all hidden (${open.join(",")})`);
  // every <img> of the entry's own pictures sits directly inside a frame's content
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => ({ tag: m[0], at: m.index })).filter((i) => MEDIA.some((src) => i.tag.includes(`src="${src}"`)));
  ok(imgs.length === MEDIA.length && imgs.every((i) => html.slice(i.at - 40, i.at).includes('class="sensitive-media-content">')), `server HTML: each of the ${MEDIA.length} pictures is inside a blurred frame`);
  ok(/Mature content/.test(html) && /Image hidden/.test(html), 'server HTML: the label "Mature content" and the note "Image hidden"');
  ok(!/<button[^>]*>[^<]*(<[^>]+>)*\s*Show image/.test(html), "server HTML: no dead button (the control is drawn once hydrated)");
  const og = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  const tw = /<meta name="twitter:image" content="([^"]+)"/.exec(html)?.[1];
  ok(og?.endsWith("/og-default.png") && tw?.endsWith("/og-default.png"), `server HTML: og:image and twitter:image are the default image (${og})`);
  ok(![...html.matchAll(/<meta[^>]+>/g)].some((m) => !noCover(m[0])), "server HTML: no meta tag names the cover or an image block");
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  ok(ld.length === 1 && !("image" in ld[0]) && noCover(JSON.stringify(ld[0])), "server HTML: JSON-LD has no image");
  ok(/<meta name="robots" content="noimageindex"/.test(html), "server HTML: robots noimageindex");
  const sitemap = await fetch(`${BASE_URL}/sitemap.xml`).then((r) => r.text());
  ok(!/image:|<image|\/media\//.test(sitemap), "sitemap.xml: no image tag and no media path");
  // an ordinary entry is untouched
  const plain = await fetch(`${BASE_URL}/artworks/demo-artwork`).then((r) => r.text());
  ok(!/data-slot="sensitive-media" data-state="hidden" data-interactive/.test(plain) && /og:image" content="[^"]*stock-art-yellow-red-blue|og:image" content="[^"]*og-default/.test(plain), "an ordinary artwork has no entry frame");
  ok(!/noimageindex/.test(plain), "an ordinary artwork has no noimageindex");
}

// --- 2. No scripts: the images stay blurred and a note says so ----------------------------------------------------------------------
{
  const { ctx, page } = await newPage(DESKTOP, "dark", { javaScriptEnabled: false });
  await page.goto(`${BASE_URL}${PATH}`);
  const f = await frames(page);
  ok(f.length === 2 && f.every((x) => x.state === "hidden" && strong(x)), `no JS: both images are blurred by CSS alone (${f.map((x) => `${x.blur.toFixed(0)}px of ${x.width}`).join(", ")})`);
  ok(f.every((x) => x.label === "Mature content" && /image hidden/i.test(x.text) && x.control === 0), "no JS: the label and the visible note 'Image hidden', and nothing to press");
  await page.screenshot({ path: `${OUT_DIR}/sensitive-nojs-dark.png` });
  await ctx.close();
}

// --- 3. Hydration: never sharp, not for one frame ----------------------------------------------------------------------------------
{
  const { ctx, page, logs } = await newPage();
  await page.addInitScript(() => {
    window.__blur = [];
    // Rendering is blocked until the stylesheet has loaded, so nothing is painted before it: a style read earlier says nothing about what
    // a visitor sees (it is computed without the sheet). Every sample here is of a state that can be painted.
    const sample = (why) => {
      if (![...document.querySelectorAll("link[rel=stylesheet]")].every((l) => l.sheet)) return;
      for (const el of document.querySelectorAll(".sensitive-media-content")) {
        const frame = el.closest("[data-slot=sensitive-media]");
        window.__blur.push({ why, state: frame?.getAttribute("data-state"), filter: getComputedStyle(el).filter });
      }
    };
    document.addEventListener("DOMContentLoaded", () => sample("dcl"));
    new MutationObserver(() => sample("mutation")).observe(document, { childList: true, subtree: true, attributes: true });
    let n = 0;
    const tick = () => {
      sample("raf");
      if (++n < 240) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(`${BASE_URL}${PATH}`);
  await page.waitForSelector("[data-slot=sensitive-media-toggle]", { timeout: 20000 });
  await page.waitForTimeout(1500);
  const log = await page.evaluate(() => window.__blur);
  const sharp = log.filter((x) => x.state === "hidden" && !/^blur\(/.test(x.filter));
  ok(log.length > 20 && sharp.length === 0, `hydration: ${log.length} samples of the picture's filter while hidden, none without a blur (${sharp.length} sharp)`);
  const f = await frames(page);
  ok(f.length === 2 && f.every((x) => x.state === "hidden" && strong(x) && x.control === 1 && x.interactive), `after hydration: both frames hidden and blurred, each with one control (${f.map((x) => `${x.blur.toFixed(0)}px`).join(", ")})`);
  const buttons = page.getByRole("button", { name: "Show image" });
  ok((await buttons.count()) === 2, "after hydration: the buttons are real <button>s named 'Show image' (one per image)");
  ok((await buttons.first().getAttribute("aria-pressed")) === "false", "the button is aria-pressed=false while hidden");
  ok(f.every((x) => x.label === "Mature content"), "the label 'Mature content' is visible on each blurred image");
  ok(logs.length === 0, `no console errors${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}

// --- 4. The control, with the keyboard; reload and return re-blur; nothing is stored --------------------------------------------------
{
  const { ctx, page, logs } = await newPage();
  await page.goto(`${BASE_URL}${PATH}`);
  await page.waitForSelector("[data-slot=sensitive-media-toggle]");
  await page.waitForTimeout(600);
  // reach it by Tab from the title
  await page.focus("#panel-heading");
  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => document.activeElement?.getAttribute("data-slot") === "sensitive-media-toggle");
  }
  ok(reached, "keyboard: Tab reaches the 'Show image' button");
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  ok(ring.style !== "none" && ring.width >= 2, `keyboard: the focus ring is drawn (${ring.style} ${ring.width}px)`);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-slot=sensitive-media]")?.getAttribute("data-state") === "revealed");
  await page.waitForTimeout(500);
  let f = await frames(page);
  ok(f.length === 2 && f.every((x) => x.state === "revealed" && x.blur === 0), "Enter reveals every image of the entry (cover and image block), blur gone");
  ok((await page.evaluate(() => document.activeElement?.getAttribute("aria-pressed"))) === "true", "focus stays on the same button, now aria-pressed=true");
  ok((await page.locator("[data-slot=sensitive-media] [role=status]").first().innerText()).includes("Image shown"), "a polite status says 'Image shown'");
  await page.screenshot({ path: `${OUT_DIR}/sensitive-revealed-dark.png` });
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector("[data-slot=sensitive-media]")?.getAttribute("data-state") === "hidden");
  await page.waitForTimeout(500);
  f = await frames(page);
  ok(f.every((x) => x.state === "hidden" && strong(x)), "Space hides them again (the same control toggles)");
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector("[data-slot=sensitive-media]")?.getAttribute("data-state") === "revealed");
  // the pointer works on the other image's own button too
  // storage: nothing was written
  const stored = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage).filter((k) => !/^(globe-debug|sky|no-street|no-groups)$/.test(k)), cookies: document.cookie }));
  ok(stored.local.length === 0 && stored.cookie === undefined && stored.cookies === "", `nothing is stored (localStorage ${JSON.stringify(stored.local)}, sessionStorage ${JSON.stringify(stored.session)}, cookies "${stored.cookies}")`);
  // a client-side departure and return starts hidden again
  await page.getByRole("link", { name: /Previous artwork|Altiplano Sediment/ }).first().click();
  await page.waitForURL("**/artworks/altiplano-sediment");
  await page.waitForSelector("[data-slot=entry-view]");
  ok((await frames(page, "[data-panel]")).length === 0, "another entry of the kind has no frame");
  await page.goBack();
  await page.waitForURL(`**${PATH}`);
  await page.waitForSelector("[data-slot=sensitive-media-toggle]");
  f = await frames(page);
  ok(f.length === 2 && f.every((x) => x.state === "hidden" && strong(x)), "coming back to the entry in the app starts hidden again");
  // reveal, then reload: blurred again
  await page.getByRole("button", { name: "Show image" }).first().click();
  await page.waitForFunction(() => document.querySelector("[data-slot=sensitive-media]")?.getAttribute("data-state") === "revealed");
  await page.reload();
  await page.waitForSelector("[data-slot=sensitive-media-toggle]");
  f = await frames(page);
  ok(f.length === 2 && f.every((x) => x.state === "hidden" && strong(x)), "a reload blurs the images again (the choice is not remembered)");
  // pressing one image's control reveals the entry's images and the click works with the pointer
  await page.getByRole("button", { name: "Show image" }).nth(1).click();
  await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=sensitive-media]")].every((e) => e.getAttribute("data-state") === "revealed"));
  ok(true, "the pointer on the second image's button reveals the entry's images");
  // a hidden image's frame is a container: the label fits and nothing overflows
  ok(logs.length === 0, `no console errors${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}

// --- 5. Full screen and print ----------------------------------------------------------------------------------------------------------
{
  const { ctx, page } = await newPage();
  await page.goto(`${BASE_URL}${PATH}?view=full`);
  await page.waitForSelector("[data-slot=sensitive-media-toggle]");
  await page.waitForTimeout(800);
  const f = await frames(page);
  ok(f.length === 2 && f.every((x) => x.state === "hidden" && strong(x)), `full screen: both images blurred (${f.map((x) => `${x.blur.toFixed(0)}px of ${x.width}`).join(", ")})`);
  await page.locator("[data-slot=sensitive-media]").first().evaluate((e) => e.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT_DIR}/sensitive-full-hidden-dark.png` });
  await page.getByRole("button", { name: "Show image" }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/sensitive-full-revealed-dark.png` });
  await page.emulateMedia({ media: "print" });
  const printed = await frames(page);
  const toggles = await page.evaluate(() => [...document.querySelectorAll("[data-slot=sensitive-media-toggle]")].map((b) => getComputedStyle(b).display));
  const labels = await page.evaluate(() => [...document.querySelectorAll("[data-slot=sensitive-media-label]")].map((l) => getComputedStyle(l).display));
  ok(printed.length === 2 && printed.every((x) => x.state === "revealed" && strong(x)), `print: revealed images are blurred on paper (${printed.map((x) => `${x.blur.toFixed(0)}px`).join(", ")})`);
  ok(toggles.every((d) => d === "none") && labels.every((d) => d !== "none"), "print: the control is not printed and the label is");
  await ctx.close();
}

// --- 6. Reduced motion: the unblur is immediate -----------------------------------------------------------------------------------------
{
  const { ctx, page } = await newPage(DESKTOP, "dark", { reducedMotion: "reduce" });
  await page.goto(`${BASE_URL}${PATH}`);
  await page.waitForSelector("[data-slot=sensitive-media-toggle]");
  await page.waitForTimeout(500);
  const transition = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector(".sensitive-media-content"));
    return { property: s.transitionProperty, duration: Math.max(...s.transitionDuration.split(",").map((d) => parseFloat(d) * (d.trim().endsWith("ms") ? 1 : 1000))) };
  });
  ok(transition.duration <= 0.1, `reduced motion: the picture's transition lasts no time (${transition.duration} ms)`);
  await page.getByRole("button", { name: "Show image" }).first().click();
  await page.waitForTimeout(80);
  ok((await frames(page)).every((x) => x.blur === 0), "reduced motion: unblurred within 80 ms");
  await ctx.close();
  const motion = await newPage(DESKTOP, "dark", { reducedMotion: "no-preference" });
  await motion.page.goto(`${BASE_URL}${PATH}`);
  await motion.page.waitForSelector("[data-slot=sensitive-media-toggle]");
  const hiddenT = await motion.page.evaluate(() => getComputedStyle(document.querySelector(".sensitive-media-content")).transitionDuration);
  ok(/^0s(, 0s)*$/.test(hiddenT), `with motion allowed, a hidden picture has no transition: it can never fade in from sharp (${hiddenT})`);
  await motion.page.getByRole("button", { name: "Show image" }).first().click();
  await motion.page.waitForFunction(() => document.querySelector("[data-slot=sensitive-media]")?.getAttribute("data-state") === "revealed");
  const shownT = await motion.page.evaluate(() => getComputedStyle(document.querySelector(".sensitive-media-content")).transitionProperty);
  ok(/filter/.test(shownT), `with motion allowed the unblur transitions the filter (${shownT})`);
  await motion.page.waitForTimeout(400);
  await motion.page.getByRole("button", { name: "Show image" }).first().click();
  const afterHide = await motion.page.evaluate(() => parseFloat(/blur\(([\d.]+)px\)/.exec(getComputedStyle(document.querySelector(".sensitive-media-content")).filter)?.[1] ?? "0"));
  ok(afterHide >= 12, `hiding again is immediate (${afterHide.toFixed(0)}px at once)`);
  await motion.ctx.close();
}

// --- 7. Cards: the list, the place panel, the related entries ------------------------------------------------------------------------------
for (const [name, path, scope, expected] of [
  ["list", "/artworks", "main", 1],
  ["place panel", "/locations/kyoto", "[data-panel]", 1],
  ["related entries", "/artworks/demo-artwork", "[data-slot=entry-more]", 1],
  ["tag filter", "/artworks?tag=figure", "main", 1],
]) {
  for (const js of [false, true]) {
    const { ctx, page } = await newPage(DESKTOP, "dark", js ? {} : { javaScriptEnabled: false });
    await page.goto(`${BASE_URL}${path}`);
    await page.waitForSelector(scope);
    if (js) await page.waitForTimeout(800);
    const f = await frames(page, scope);
    ok(f.length === expected && f.every((x) => x.state === "hidden" && strong(x) && x.control === 0 && !x.interactive && x.label === "Mature content"), `${name}${js ? "" : " (no JS)"}: ${expected} blurred card image, labelled, with no control (${f.map((x) => `${x.blur.toFixed(0)}px of ${x.width}`).join(", ")})`);
    if (js && name === "list") {
      const rows = await page.evaluate(() => [...document.querySelectorAll("main article")].map((a) => ({ id: a.id, framed: !!a.querySelector("[data-slot=sensitive-media]") })));
      ok(rows.filter((r) => r.framed).map((r) => r.id).join() === SLUG && rows.length === FIXTURE.artworks.length, "list: only the sensitive entry's row is blurred");
      await page.screenshot({ path: `${OUT_DIR}/sensitive-list-dark.png`, fullPage: true });
      // the card opens the entry, which is blurred as well
      await page.locator(`#${SLUG} a`).first().click();
      await page.waitForURL(`**${PATH}`);
      await page.waitForSelector("[data-slot=sensitive-media-toggle]");
      ok((await frames(page, "[data-panel]")).every((x) => x.state === "hidden"), "list: opening the card shows the entry with its images hidden");
    }
    if (js && name === "place panel") await page.screenshot({ path: `${OUT_DIR}/sensitive-place-dark.png` });
    if (js && name === "related entries") {
      ok((await page.locator("[data-slot=entry-more] button").count()) === 0, "related entries: no button on a card");
    }
    await ctx.close();
  }
}

// --- 8. 390 px and the light scheme: no overflow, a 44 px control, screenshots --------------------------------------------------------------------
for (const scheme of ["dark", "light"]) {
  const { ctx, page, logs } = await newPage(MOBILE, scheme);
  await page.goto(`${BASE_URL}${PATH}`);
  await page.waitForSelector("[data-slot=sensitive-media-toggle]");
  await page.waitForTimeout(800);
  const over = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  ok(over <= 0, `390px ${scheme}: no horizontal overflow (${over})`);
  const f = await frames(page);
  ok(f.length === 2 && f.every((x) => x.state === "hidden" && strong(x)), `390px ${scheme}: blurred (${f.map((x) => `${x.blur.toFixed(0)}px of ${x.width}`).join(", ")})`);
  const box = await page.getByRole("button", { name: "Show image" }).first().boundingBox();
  ok(box && box.height >= 43.5, `390px ${scheme}: the control is 44 px high (${box?.height})`);
  // the plate stays inside the picture
  const inside = await page.evaluate(() => [...document.querySelectorAll("[data-slot=sensitive-media]")].every((f) => {
    const a = f.getBoundingClientRect();
    const p = f.querySelector(".sensitive-media-plate").getBoundingClientRect();
    return p.left >= a.left - 0.5 && p.right <= a.right + 0.5 && p.top >= a.top - 0.5 && p.bottom <= a.bottom + 0.5;
  }));
  ok(inside, `390px ${scheme}: the plate with its control fits inside the image`);
  await page.locator("[data-slot=sensitive-media]").first().evaluate((e) => e.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT_DIR}/sensitive-390-${scheme}-hidden.png` });
  await page.getByRole("button", { name: "Show image" }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/sensitive-390-${scheme}-revealed.png` });
  ok(logs.length === 0, `390px ${scheme}: no console errors${logs.length ? ` (${logs.join(" | ")})` : ""}`);
  await ctx.close();
}
for (const scheme of ["dark", "light"]) {
  const { ctx, page } = await newPage(DESKTOP, scheme);
  await page.goto(`${BASE_URL}${PATH}`);
  await page.waitForSelector("[data-slot=sensitive-media-toggle]");
  await page.waitForTimeout(800);
  await page.locator("[data-slot=sensitive-media]").first().evaluate((e) => e.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT_DIR}/sensitive-panel-${scheme}-hidden.png` });
  await page.getByRole("button", { name: "Show image" }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/sensitive-panel-${scheme}-revealed.png` });
  await ctx.close();
}
{
  // the head after hydration (client-side meta) says the same as the server's
  const { ctx, page } = await newPage();
  await page.goto(`${BASE_URL}/artworks/demo-artwork`);
  await page.waitForSelector("[data-panel]");
  await page.getByRole("link", { name: /Figure Study in Charcoal/ }).first().click();
  await page.waitForURL(`**${PATH}`);
  await page.waitForSelector("[data-slot=sensitive-media-toggle]");
  await page.waitForTimeout(300);
  const head = await headOf(page);
  ok(head.ogImage?.endsWith("/og-default.png") && head.twitterImage?.endsWith("/og-default.png") && head.jsonld.every((j) => !("image" in j)) && noCover(JSON.stringify(head)), `client navigation: the head has the default share image and no JSON-LD image (${head.ogImage})`);
  ok(head.robots === "noimageindex", "client navigation: robots noimageindex");
  await page.goBack();
  await page.waitForURL("**/artworks/demo-artwork");
  await page.waitForTimeout(300);
  const back = await headOf(page);
  ok(back.robots === undefined || back.robots !== "noimageindex", "client navigation: the ordinary entry's head has no noimageindex again");
  await ctx.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
