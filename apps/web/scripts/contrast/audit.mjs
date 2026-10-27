// Contrast audit in a browser (docs/design-tokens.md, "Contrast audit"). Loads every kind of route (the home page, the places panel, the four
// lists, an entry of each kind in the panel and full screen (the article's figures, their captions and credits, the links to a figure, and a figure open larger in its dialog), a short note, an archived project, a mature artwork, a poem in French, the
// 404 page, the search palette with and without a query, the credits dialog, the styleguide) in BOTH colour schemes at 1440 x 900 and
// 390 x 844, and for every piece of text compares its colour with what is REALLY drawn behind it:
//
//   1. every element that owns a text node is scrolled into view and its glyph boxes are measured (colour with the alpha and the
//      opacity of its ancestors applied, size, weight);
//   2. the page is drawn again with every text colour made transparent (`.__audit-hide`), the box is screenshot, and every distinct
//      pixel under it is a possible background: the contrast is the WORST of them, so a scrim, a plate, a gradient, the globe's lines or
//      a hover fill are all in the number (a flat background is one pixel colour);
//   3. every link, button and control (two of each look: the same classes and variant) is put in its hover, keyboard-focus and (buttons)
//      pressed states and measured again, with its focus ring checked at 3:1 against what is around it (or, where there is no ring, a
//      change of colour, fill or underline against the resting state).
//
// Required: 4.5:1 for text under 24 px (or 18.66 px bold), 3:1 above (WCAG 2 AA); 3:1 for a focus ring. Skipped, and counted: text that is
// not displayed (visually hidden, clipped, covered by something else, behind a modal) and disabled controls (WCAG exempts them; they are
// measured and listed as information). Needs a Chrome binary and a running server with the DEMO content (entries of every kind):
//
//   CHROME_PATH=/path/to/chrome BASE_URL=http://localhost:5463 OUT_DIR=/tmp/contrast node scripts/contrast/audit.mjs [--page name,name] [--scheme light|dark] [--vp d|m]
//
// With `pnpm dev:demo` or a server started with CATALYST_CONTENT=demo; the styleguide route (`/dev/design`) needs a development server
// (or a build made with CATALYST_DEV_ROUTES=1) and is skipped on a 404. Exit code 1 on any failure; the full table is OUT_DIR/contrast-audit.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE_URL, OUT_DIR, launch } from "../globe/_lib.mjs";

mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const opt = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const onlyPages = opt("page")?.split(",");
const onlySchemes = opt("scheme") ? [opt("scheme")] : ["light", "dark"];
const VIEWPORTS = {
  d: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  m: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1",
  },
};
const onlyViewports = opt("vp") ? [opt("vp")] : ["d", "m"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitGlobe = (page) => page.waitForSelector('[data-globe][data-state="ready"]', { timeout: 20000 }).catch(() => {});

/** Open the quick search with the palette's own event; `query` types into it. Only the dialog is audited then (the page behind is inert). */
const searchPalette = (query) => async (page) => {
  await sleep(1500);
  await page.evaluate(() => window.dispatchEvent(new Event("site:open-search")));
  await page.waitForSelector("dialog[open] input", { timeout: 5000 });
  if (query) await page.keyboard.type(query);
  await sleep(700);
  return "dialog[open]";
};
/** An article's figure opened larger (the lightbox, a modal dialog): only the dialog is audited then, the page behind is inert. */
const figureLightbox = async (page) => {
  await sleep(1500);
  await page.click(".entry-fig-zoom");
  await page.waitForSelector("dialog[open] img", { timeout: 5000 });
  await sleep(600);
  return "dialog[open]";
};
const creditsDialog = async (page) => {
  await waitGlobe(page);
  await sleep(1500);
  // the card's "See more" button
  await page.click('[data-attribution="card"] button:visible');
  await page.waitForSelector("dialog[open]", { timeout: 5000 });
  await sleep(700);
  return "dialog[open]";
};
/** The error page: a data request that answers 500 during a client navigation shows the root error boundary. */
const errorPage = async (page) => {
  await sleep(1500);
  await page.route(/\.data(\?|$)/, (route) => route.fulfill({ status: 500, contentType: "text/plain", body: "boom" }));
  await page.evaluate(() => {
    const a = [...document.querySelectorAll("a[href='/articles']")].find((n) => n.getClientRects().length);
    a?.click();
  });
  await sleep(1500);
};

const PAGES = [
  { name: "home", path: "/", after: async (p) => { await waitGlobe(p); await sleep(2500); } },
  { name: "home-search", path: "/", after: searchPalette("") },
  { name: "home-search-query", path: "/", after: searchPalette("tra") },
  { name: "home-search-none", path: "/", after: searchPalette("zzzzqq") },
  { name: "home-credits", path: "/", after: creditsDialog },
  { name: "place", path: "/locations/paris", after: async (p) => { await waitGlobe(p); await sleep(2000); } },
  { name: "list-software", path: "/software" },
  { name: "list-software-filter", path: "/software?tag=typescript" },
  { name: "list-articles", path: "/articles" },
  { name: "list-artworks", path: "/artworks" },
  { name: "list-poetry", path: "/poetry" },
  // The career page (the demo content has a career document, with a portrait); the header carries its link too.
  { name: "career", path: "/career" },
  { name: "home-search-career", path: "/", after: searchPalette("career") },
  { name: "article-full", path: "/articles/demo-article?view=full" },
  { name: "article-panel", path: "/articles/demo-article", after: async (p) => { await waitGlobe(p); await sleep(2000); } },
  { name: "article-lightbox", path: "/articles/demo-article?view=full", after: figureLightbox },
  { name: "note-full", path: "/articles/rain-at-the-citadel-gate?view=full" },
  { name: "software-full", path: "/software/demo-project?view=full" },
  { name: "software-panel", path: "/software/demo-project", after: async (p) => { await waitGlobe(p); await sleep(2000); } },
  { name: "software-archived", path: "/software/weather-ledger?view=full" },
  { name: "artwork-full", path: "/artworks/demo-artwork?view=full" },
  { name: "artwork-panel", path: "/artworks/demo-artwork", after: async (p) => { await waitGlobe(p); await sleep(2000); } },
  { name: "artwork-mature", path: "/artworks/figure-study-two?view=full" },
  { name: "poem-full", path: "/poetry/demo-poem?view=full" },
  { name: "poem-panel", path: "/poetry/demo-poem", after: async (p) => { await waitGlobe(p); await sleep(2000); } },
  { name: "poem-fr", path: "/poetry/quai-de-nuit?view=full" },
  { name: "404", path: "/does-not-exist" },
  { name: "404-entry", path: "/articles/does-not-exist" },
  { name: "error-500", path: "/", after: errorPage },
  { name: "dev-design", path: "/dev/design", optional: true },
];

/** In the page: everything the audit needs, installed once per document. */
const INSTALL = () => {
  if (window.__audit) return;
  const g = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  g.canvas.width = g.canvas.height = 1;
  const style = document.createElement("style");
  style.textContent = `*, *::before, *::after { transition: none !important; animation-play-state: paused !important; }
    .__audit-hide, .__audit-hide *, .__audit-hide *::before, .__audit-hide *::after {
    color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important;
    text-decoration-color: transparent !important; caret-color: transparent !important; outline-color: transparent !important;
    -webkit-text-stroke-color: transparent !important; }
    .__audit-hide ::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; }`;
  document.head.append(style);
  /** Any CSS colour as [r, g, b, a] (0-255, a 0-1): drawn on a 1 px canvas, so `color(srgb ...)`, `oklch()` and named colours all work. */
  const rgba = (css) => {
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = "#000";
    g.fillStyle = css;
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], Math.round((d[3] / 255) * 1000) / 1000];
  };
  const hiddenReason = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === "none") return "display-none";
      if (cs.visibility === "hidden" || cs.visibility === "collapse") return "visibility-hidden";
      if (Number(cs.opacity) === 0) return "opacity-0";
      if (n.hasAttribute("inert")) return "inert";
      // visually hidden (`sr-only`: a 1 px box that clips its content): read by assistive technology only
      if (cs.overflow !== "visible" || cs.clip !== "auto" || cs.clipPath !== "none") {
        const r = n.getBoundingClientRect();
        if (r.width <= 1.5 && r.height <= 1.5) return "visually-hidden";
      }
    }
    return null;
  };
  const opacityOf = (el) => {
    let o = 1;
    for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  /** The union of the glyph boxes of an element's own text nodes, in viewport px. */
  const textRect = (el) => {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const q of range.getClientRects()) {
        if (q.width < 0.5 || q.height < 0.5) continue;
        l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
      }
    }
    return r > l && b > t ? { l, t, r, b } : null;
  };
  window.__audit = { rgba, hiddenReason, opacityOf, textRect };
};

/**
 * Pure contrast math, run in a helper page next to the pixels. `hidden` is the clip with every text colour made transparent (the
 * backgrounds), `visible` the same clip as drawn. Where both are given, only the pixels the glyphs changed are compared (a thin 300-weight
 * heading has far more empty box than ink, and a globe line passing through the empty part is not behind a letter); a box where the text
 * left (almost) no mark is compared whole. `rects` are regions of the image to test against `fg`.
 */
const DECODE = async ({ hidden, visible, fg, rects }) => {
  const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const load = async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const g = cv.getContext("2d", { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    return { g, w: bmp.width, h: bmp.height };
  };
  const H = await load(hidden);
  const V = visible ? await load(visible) : null;
  const out = [];
  for (const rect of rects) {
    const w = Math.max(1, rect.w), h = Math.max(1, rect.h);
    const d = H.g.getImageData(rect.x, rect.y, w, h).data;
    const v = V ? V.g.getImageData(rect.x, rect.y, w, h).data : null;
    const pick = [];
    if (v) for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - v[i]) + Math.abs(d[i + 1] - v[i + 1]) + Math.abs(d[i + 2] - v[i + 2]) > 6) pick.push(i);
    const idx = pick.length >= 3 ? pick : null;
    const seen = new Set();
    let worst = Infinity, worstBg = null, best = 0;
    const test = (i) => {
      const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      if (seen.has(key)) return;
      seen.add(key);
      const bg = [d[i], d[i + 1], d[i + 2]];
      const a = fg[3];
      const c = a < 1 ? [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)] : fg;
      const r = ratio(c, bg);
      if (r < worst) { worst = r; worstBg = bg; }
      if (r > best) best = r;
    };
    if (idx) for (const i of idx) test(i);
    else for (let i = 0; i < d.length; i += 4) test(i);
    out.push({ worst, worstBg, best, distinct: seen.size, ink: idx ? idx.length : 0 });
  }
  return out;
};

const failures = [];
const rows = [];
const skipped = {};
const hex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

const browser = await launch();
const helperCtx = await browser.newContext();
const helper = await helperCtx.newPage();
await helper.goto("about:blank");

async function ratioOf(hidden, visible, fg, rects) {
  return helper.evaluate(DECODE, { hidden: hidden.toString("base64"), visible: visible ? visible.toString("base64") : null, fg, rects });
}

/** Measure one element that owns text: returns a row (or a skip reason). `ctx` is the page's context line. */
async function measure(page, id, ctx, state) {
  const sel = `[data-audit="${id}"]`;
  // Scroll it to the middle, then let what animates in on scroll (`whileInView` fades, 120 ms colour transitions) settle.
  const there = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    return true;
  }, sel);
  let info = { skip: "gone" };
  let lastOpacity = -1;
  for (let attempt = 0; there && attempt < 16; attempt++) {
    await sleep(attempt === 0 ? 25 : 150);
    info = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const reason = window.__audit.hiddenReason(el);
      if (reason) return { skip: reason };
      const o = window.__audit.opacityOf(el);
      const field = el.matches("input, textarea");
      const icon = el instanceof SVGSVGElement;
      let q = field || icon ? null : window.__audit.textRect(el);
      if (icon) {
        const b = el.getBoundingClientRect();
        q = { l: b.left, t: b.top, r: b.right, b: b.bottom };
      }
      if (field) {
        const b = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        q = { l: b.left + parseFloat(s.paddingLeft), t: b.top + parseFloat(s.paddingTop), r: b.right - parseFloat(s.paddingRight), b: b.bottom - parseFloat(s.paddingBottom) };
      }
      if (!q) return { skip: "no-box" };
      const w = innerWidth, h = innerHeight;
      const l = Math.max(0, q.l), t = Math.max(0, q.t), r = Math.min(w, q.r), b = Math.min(h, q.b);
      if (r - l < 1 || b - t < 1) return { skip: "offscreen" };
      if (r - l <= 2 && b - t <= 2) return { skip: "clipped" };
      // Covered by something that is not part of it (another panel, a dialog): the point under its middle must be it or inside it.
      const top = document.elementFromPoint((l + r) / 2, (t + b) / 2);
      if (top && !el.contains(top) && !top.contains(el)) return { skip: "occluded" };
      const cs = getComputedStyle(el);
      const fill = field ? getComputedStyle(el, "::placeholder").color : cs.webkitTextFillColor && cs.webkitTextFillColor !== "rgba(0, 0, 0, 0)" ? cs.webkitTextFillColor : cs.color;
      let fg = window.__audit.rgba(fill);
      fg = [fg[0], fg[1], fg[2], Math.round(fg[3] * o * 1000) / 1000];
      const size = icon ? 24 : parseFloat(cs.fontSize);
      const weight = Number(cs.fontWeight) || 400;
      const tag = icon ? "icon" : el.tagName.toLowerCase();
      const cls = (el.getAttribute("class")?.baseVal ?? el.getAttribute("class") ?? "").split(/\s+/).slice(0, 4).join(" ");
      const text = (icon ? `icon of ${el.closest("a, button, [role='button']")?.getAttribute("aria-label") ?? el.closest("a, button, [role='button']")?.textContent.trim() ?? "?"}` : field ? `placeholder: ${el.getAttribute("placeholder")}` : el.textContent.replace(/\s+/g, " ").trim()).slice(0, 48);
      return { l, t, r, b, fg, o, size, weight, tag, cls, text, large: size >= 24 || (size >= 18.66 && weight >= 700), disabled: el.matches(":disabled, [aria-disabled='true']") || !!el.closest("[aria-disabled='true'], fieldset:disabled") };
    }, sel);
    // still fading in (or a transition running): look again until the opacity holds still (text that is meant to be translucent is measured as it is)
    if (info.skip === "opacity-0") continue;
    if (info.o !== undefined && info.o < 0.999 && Math.abs(info.o - lastOpacity) > 0.001) {
      lastOpacity = info.o;
      continue;
    }
    break;
  }
  if (info.o !== undefined && info.o < 0.05) info = { skip: "fading" };
  if (info.skip) {
    skipped[info.skip] = (skipped[info.skip] ?? 0) + 1;
    return null;
  }
  const x = Math.floor(info.l), y = Math.floor(info.t);
  const clip = { x, y, width: Math.max(1, Math.ceil(info.r) - x), height: Math.max(1, Math.ceil(info.b) - y) };
  const visible = await page.screenshot({ clip, type: "png", animations: "allow", caret: "hide" });
  await page.evaluate(() => document.documentElement.classList.add("__audit-hide"));
  const hidden = await page.screenshot({ clip, type: "png", animations: "allow", caret: "hide" });
  await page.evaluate(() => document.documentElement.classList.remove("__audit-hide"));
  const [res] = await ratioOf(hidden, visible, info.fg, [{ x: 0, y: 0, w: clip.width, h: clip.height }]);
  const required = info.large ? 3 : 4.5;
  const row = {
    ...ctx,
    state,
    tag: info.tag,
    cls: info.cls,
    text: info.text,
    size: Math.round(info.size * 10) / 10,
    weight: info.weight,
    fg: hex(info.fg) + (info.fg[3] < 1 ? `@${info.fg[3]}` : ""),
    bg: hex(res.worstBg),
    ratio: Math.round(res.worst * 100) / 100,
    required,
    large: info.large,
    disabled: info.disabled,
    pass: res.worst >= required - 0.005,
  };
  return row;
}

/** Tag the elements of a page that own text (and the empty fields that show a placeholder) inside `root`; returns their ids. */
async function tagTexts(page, rootSel) {
  return page.evaluate((rootSel) => {
    const root = (rootSel && document.querySelector(rootSel)) || document.body;
    const ids = [];
    const seen = new Set();
    const add = (el) => {
      if (seen.has(el)) return;
      seen.add(el);
      const id = `t${seen.size}`;
      el.setAttribute("data-audit", id);
      ids.push(id);
    };
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!n.nodeValue.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest("script, style, noscript, title, head, template")) continue;
      add(el);
    }
    for (const input of root.querySelectorAll("input[placeholder], textarea[placeholder]")) if (!input.value) add(input);
    // an icon that is the whole of its control (a close button, the search trigger, a heading anchor) is the control's only label: 3:1
    for (const svg of root.querySelectorAll("svg.ui-icon")) {
      const host = svg.closest("a, button, [role='button']");
      if (!host) continue;
      const hasText = [host, ...host.querySelectorAll("*")].some((n) => !n.closest(".sr-only") && [...n.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim()));
      if (!hasText) add(svg);
    }
    return ids;
  }, rootSel);
}

const SIGNATURE = (el) => {
  const frame = el.closest("[data-scheme], .ds-frame[data-variant]");
  return [
    el.tagName,
    el.getAttribute("class") ?? "",
    el.getAttribute("data-slot") ?? "",
    el.getAttribute("data-variant") ?? "",
    el.getAttribute("data-pressed") ?? "",
    el.getAttribute("aria-current") ?? "",
    el.getAttribute("role") ?? "",
    frame?.getAttribute("data-scheme") ?? frame?.getAttribute("data-variant") ?? "",
    el.parentElement?.getAttribute("class")?.split(/\s+/)[0] ?? "",
  ].join("|");
};

/** Interactive elements to put in their states: up to two of each look. */
async function tagInteractive(page, rootSel, perLook = 2) {
  return page.evaluate(
    ({ rootSel, perLook, sig }) => {
      const signature = new Function(`return (${sig})`)();
      const root = (rootSel && document.querySelector(rootSel)) || document.body;
      const sel = "a[href], button, [role='button'], [role='option'], [role='tab'], summary, input:not([type='hidden']), select, textarea";
      const counts = new Map();
      const out = [];
      for (const el of root.querySelectorAll(sel)) {
        if (el.closest("[inert]") || el.closest("[hidden]")) continue;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        // a visually hidden skip link is still a control: it is shown on focus (its look is measured in the focus state)
        const key = signature(el);
        const c = counts.get(key) ?? 0;
        if (c >= perLook) continue;
        counts.set(key, c + 1);
        const id = `x${out.length}`;
        el.setAttribute("data-audit-x", id);
        const label = el.getAttribute("aria-label") || el.textContent.replace(/\s+/g, " ").trim().slice(0, 36) || el.getAttribute("href") || "";
        out.push({ id, desc: `${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ? "[" + el.getAttribute("data-slot") + "]" : ""} "${label}" ${(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 3).join(".")}`, tag: el.tagName.toLowerCase(), disabled: el.matches(":disabled, [aria-disabled='true']"), box: r.width * r.height > 0 });
      }
      return out;
    },
    { rootSel, perLook, sig: SIGNATURE.toString() },
  );
}

/** What differs between two looks of a control: the focus indicator must change something when there is no outline (the control, its
 *  children, or the box that holds it: the palette's field is shown by a rule under its row). */
const LOOK = (el) => {
  const one = (n) => {
    const cs = getComputedStyle(n);
    return [cs.color, cs.backgroundColor, cs.textDecorationLine, cs.textDecorationColor, cs.textDecorationThickness, cs.boxShadow, cs.borderTopColor, cs.borderBottomColor, cs.fontWeight, cs.opacity];
  };
  const kids = [...el.querySelectorAll("*")].slice(0, 6).map((k) => one(k).join(","));
  return [...one(el), ...(el.parentElement ? one(el.parentElement) : []), ...kids].join("|");
};

async function auditPage(ctx, page, def, scheme, vp, cdp) {
  const label = { page: def.name, scheme, vp };
  await page.goto(BASE_URL + def.path, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await sleep(1200);
  let rootSel = null;
  if (def.after) rootSel = (await def.after(page)) ?? null;
  await page.evaluate(INSTALL);
  const pageRows = [];

  // 1. every text, at rest
  const ids = await tagTexts(page, rootSel);
  for (const id of ids) {
    const row = await measure(page, id, label, "rest");
    if (row) pageRows.push(row);
  }

  // 2. every control, in its states
  const controls = await tagInteractive(page, rootSel);
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const c of controls) {
    const sel = `[data-audit-x="${c.id}"]`;
    const prepared = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height, rest: null };
    }, sel);
    const kids = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const out = [];
      let own = [el, ...el.querySelectorAll("*")].filter((n) => !n.closest(".sr-only") && [...n.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim()));
      if (!own.length) own = [...el.querySelectorAll("svg.ui-icon")];
      own.slice(0, 6).forEach((n, i) => {
        n.setAttribute("data-audit", `${el.getAttribute("data-audit-x")}-${i}`);
        out.push(`${el.getAttribute("data-audit-x")}-${i}`);
      });
      return out;
    }, sel);
    const look = (s) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return (${LOOK.toString()})(el); })()`);
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    const restLookStr = await look(sel);
    const ctxRow = { ...label };
    const stateRows = [];
    const measureKids = async (state) => {
      for (const k of kids) {
        const r = await measure(page, k, ctxRow, state);
        if (r) stateRows.push(r);
      }
    };
    if (c.disabled) {
      await measureKids("disabled");
    } else {
      // hover: a real pointer, so every ancestor is hovered too (`.ds-card:hover [data-slot=entry-card-title] a`)
      if (prepared.w > 0 && prepared.h > 0) {
        const hit = await page.evaluate(({ cx, cy, sel }) => {
          const top = document.elementFromPoint(cx, cy);
          const el = document.querySelector(sel);
          return !!top && (el.contains(top) || top.contains(el));
        }, { ...prepared, sel });
        if (hit) {
          await page.mouse.move(prepared.cx, prepared.cy);
          await sleep(60);
          await measureKids("hover");
          await page.mouse.move(0, 0);
          await sleep(30);
        }
      }
      // keyboard focus: forced `:focus` and `:focus-visible` on the element
      const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: sel });
      if (nodeId) {
        await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["focus", "focus-visible"] });
        await sleep(60);
        await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: "center", behavior: "instant" }), sel);
        await measureKids("focus");
        const ring = await page.evaluate((sel) => {
          // the ring of the control, or of the nearest ancestor that draws one (`.ds-card:has(:focus-visible)`)
          for (let n = document.querySelector(sel), depth = 0; n && depth < 8; n = n.parentElement, depth++) {
            const cs = getComputedStyle(n);
            if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 && window.__audit.rgba(cs.outlineColor)[3] > 0) {
              const r = n.getBoundingClientRect();
              return { color: window.__audit.rgba(cs.outlineColor), width: parseFloat(cs.outlineWidth), offset: parseFloat(cs.outlineOffset) || 0, l: r.left, t: r.top, r: r.right, b: r.bottom, own: depth === 0 };
            }
          }
          return null;
        }, sel);
        const focusLook = await look(sel);
        if (ring) {
          // what is behind the ring: its top and bottom bands (the ring spans [offset, offset + width] from the border edge, outwards positive,
          // inwards for a negative offset), drawn with the ring itself made transparent
          await page.evaluate(() => document.documentElement.classList.add("__audit-hide"));
          const reach = Math.max(0, ring.offset + ring.width);
          const pad = Math.ceil(reach) + 2;
          const clip = { x: Math.max(0, Math.floor(ring.l - pad)), y: Math.max(0, Math.floor(ring.t - pad)), width: 0, height: 0 };
          clip.width = Math.min(1440, Math.ceil(ring.r + pad) - clip.x);
          clip.height = Math.min(900, Math.ceil(ring.b + pad) - clip.y);
          if (clip.width > 0 && clip.height > 0) {
            const png = await page.screenshot({ clip, type: "png" });
            const bw = Math.max(1, Math.round(ring.width));
            const out = Math.round(ring.offset + ring.width); // distance of the ring's outer edge from the border edge
            const x0 = Math.max(0, Math.floor(ring.l) - Math.max(0, out) - clip.x);
            const wBox = Math.ceil(ring.r) - Math.floor(ring.l) + 2 * Math.max(0, out);
            const top = Math.floor(ring.t) - clip.y - out;
            const bottom = Math.ceil(ring.b) - clip.y + out - bw;
            const bands = [
              { x: x0, y: top, w: wBox, h: bw },
              { x: x0, y: bottom, w: wBox, h: bw },
            ]
              // a band that is off the screen (a control against the top edge) is not drawn: skipped, not clamped onto other pixels
              .filter((r) => r.y >= 0 && r.y + r.h <= clip.height)
              .map((r) => ({ x: Math.max(0, r.x), y: r.y, w: Math.min(r.w, clip.width - Math.max(0, r.x)), h: r.h }))
              .filter((r) => r.w > 0);
            if (bands.length) {
              const res = await ratioOf(png, null, ring.color, bands);
              const worst = Math.min(...res.map((x) => x.worst));
              stateRows.push({ ...ctxRow, state: "focus-ring", tag: c.tag, cls: "", text: `${c.desc} (ring ${ring.width}px, offset ${ring.offset}px)`, size: 0, weight: 0, fg: hex(ring.color), bg: hex(res.sort((a, b) => a.worst - b.worst)[0].worstBg), ratio: Math.round(worst * 100) / 100, required: 3, large: true, disabled: false, pass: worst >= 2.995 });
            }
          }
          await page.evaluate(() => document.documentElement.classList.remove("__audit-hide"));
        } else if (focusLook === restLookStr && c.box) {
          if (process.env.DBG) console.log("NORING", await page.evaluate((sel) => { const el = document.querySelector(sel); const cs = getComputedStyle(el); return [el.outerHTML.slice(0, 120), cs.outline, cs.outlineColor, el.matches(":focus-visible")]; }, sel));
          stateRows.push({ ...ctxRow, state: "focus-indicator", tag: c.tag, cls: "", text: `${c.desc} (no ring and no change of look)`, size: 0, weight: 0, fg: "-", bg: "-", ratio: 0, required: 1, large: true, disabled: false, pass: false });
        }
        await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
      }
      // pressed: buttons only
      if (c.tag === "button" || (await page.evaluate((sel) => document.querySelector(sel).matches(".ds-button"), sel))) {
        const { root: r2 } = await cdp.send("DOM.getDocument", { depth: 0 });
        const { nodeId: n2 } = await cdp.send("DOM.querySelector", { nodeId: r2.nodeId, selector: sel });
        if (n2) {
          await cdp.send("CSS.forcePseudoState", { nodeId: n2, forcedPseudoClasses: ["hover", "active"] });
          await sleep(60);
          await measureKids("active");
          await cdp.send("CSS.forcePseudoState", { nodeId: n2, forcedPseudoClasses: [] });
        }
      }
    }
    pageRows.push(...stateRows);
  }
  return pageRows;
}

let pageCount = 0;
/** One colour scheme at one viewport: every page in turn. The four combinations run side by side (separate contexts). */
async function runCombo(scheme, vk) {
  const ctx = await browser.newContext({ ...VIEWPORTS[vk], colorScheme: scheme, reducedMotion: "reduce" });
  for (const def of PAGES) {
    if (onlyPages && !onlyPages.includes(def.name)) continue;
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    page.on("pageerror", (e) => console.log(`  pageerror ${def.name}: ${e.message.split("\n")[0]}`));
    try {
      const probe = await ctx.request.get(BASE_URL + def.path.split("?")[0]).catch(() => null);
      if (def.optional && probe && probe.status() === 404) {
        console.log(`SKIP  ${def.name} (${scheme} ${vk}): not served by this server`);
        continue;
      }
      const t0 = Date.now();
      const got = await auditPage(ctx, page, def, scheme, vk, cdp);
      rows.push(...got);
      const bad = got.filter((r) => !r.pass && !r.disabled);
      pageCount++;
      const worst = got.filter((r) => r.state !== "focus-indicator" && !r.disabled).reduce((m, r) => Math.min(m, r.ratio / r.required), Infinity);
      console.log(`${bad.length ? "FAIL" : "PASS"}  ${def.name.padEnd(22)} ${scheme.padEnd(5)} ${vk}  ${String(got.length).padStart(4)} measures  worst ${(worst * 4.5).toFixed(2)} (as text)  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      for (const r of bad) {
        failures.push(r);
        console.log(`        ${def.name} ${scheme} ${vk} ${r.state.padEnd(9)} ${r.ratio.toFixed(2)} < ${r.required}  ${r.fg} on ${r.bg}  <${r.tag}${r.cls ? " " + r.cls : ""}> "${r.text}" (${r.size}px/${r.weight})`);
      }
    } catch (e) {
      failures.push({ page: def.name, scheme, vp: vk, state: "error", text: String(e.message).split("\n")[0], pass: false });
      console.log(`FAIL  ${def.name} ${scheme} ${vk}: ${String(e.message).split("\n")[0]}`);
    } finally {
      await page.close();
    }
  }
  await ctx.close();
}
await Promise.all(onlySchemes.flatMap((scheme) => onlyViewports.map((vk) => runCombo(scheme, vk))));
await browser.close();

// ---- summary
const measured = rows.filter((r) => r.state !== "focus-indicator");
const byKind = (f) => measured.filter(f);
const minOf = (list) => list.reduce((m, r) => (r.ratio / r.required < m.ratio / m.required ? r : m), list[0] ?? { ratio: Infinity, required: 1 });
const text = byKind((r) => r.state !== "focus-ring" && !r.disabled);
const small = text.filter((r) => !r.large);
const large = text.filter((r) => r.large);
const rings = measured.filter((r) => r.state === "focus-ring");
const lowest = (list) => (list.length ? list.reduce((m, r) => (r.ratio < m.ratio ? r : m)) : null);
console.log(`\n${pageCount} page loads, ${rows.length} measures, skipped: ${JSON.stringify(skipped)}`);
const line = (name, list) => {
  const w = lowest(list);
  console.log(`  ${name.padEnd(28)} ${String(list.length).padStart(5)} measures, lowest ${w ? `${w.ratio.toFixed(2)}:1 (${w.page} ${w.scheme} ${w.vp} ${w.state}, ${w.fg} on ${w.bg}, "${w.text}")` : "-"}`);
};
line("text under 24 px (4.5:1)", small);
line("large text (3:1)", large);
line("focus rings (3:1)", rings);
for (const state of ["rest", "hover", "focus", "active"]) line(`  text, ${state}`, text.filter((r) => r.state === state));
const disabled = measured.filter((r) => r.disabled);
if (disabled.length) console.log(`  disabled controls (exempt): ${disabled.length} measures, lowest ${lowest(disabled).ratio.toFixed(2)}:1`);

writeFileSync(`${OUT_DIR}/contrast-audit.json`, JSON.stringify({ base: BASE_URL, pages: pageCount, skipped, failures, rows }, null, 1));
console.log(`\n${failures.length ? `FAIL  ${failures.length} measure(s) under AA` : "PASS  every measured text and ring is AA"}  (table: ${OUT_DIR}/contrast-audit.json)`);
process.exit(failures.length ? 1 : 0);
