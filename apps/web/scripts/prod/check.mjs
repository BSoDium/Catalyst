// Production readiness check (docs/web-architecture.md, "Production readiness"). Serves the PRODUCTION build (`pnpm build` first)
// the way a deployment runs it (NODE_ENV=production, `react-router-serve`) and asserts, over HTTP and in a real browser:
//   - security headers and the nonce-based CSP on pages, data responses and errors; cache headers; content types;
//   - head tags (title template, description, canonical, Open Graph, Twitter card, JSON-LD) on /, a list, an entry and a place;
//   - sitemap.xml (every URL answers 200), robots.txt (closed on a foreign host, open on the site's own host), manifest and icons;
//   - 404 for unknown slugs and addresses, a non-404 error page (405), no stack traces;
//   - in Chrome: ZERO CSP violations and no console errors on the globe, a place, an entry, a list, the 404 page and the street map
//     (real OpenFreeMap tiles, and the local PMTiles fallback with its host in connect-src); CLS; the skip link; reading and navigating
//     with JavaScript off; the navigation-pending line and reduced motion.
// It uses the DEMO content (made-up placeholders, CATALYST_CONTENT=demo: an explicit opt-in) so entries and places exist whatever the
// real projection holds; nothing in it is specific to the demo's slugs. It needs network access for the OpenFreeMap tiles.
//
//   node scripts/prod/check.mjs [--base URL --site https://v2.bsodium.fr] [--no-browser] [--no-fallback]
//
// With --base it checks a running server (a preview deployment, say) instead of spawning one: the checks that need two servers
// (robots.txt on the site's own host, the local tile fallback) are skipped. Exit code 1 on any failed assertion.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { launch, MOBILE, DESKTOP } from "../perf/lib.mjs";
import { ensureTiles } from "../street/_lib.mjs";
import { headTags, jsonLd, linkHref, metaContent, parseCsp, pngSize, title } from "./_html.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const webDir = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_SITE = "https://v2.bsodium.fr";

const failures = [];
const ok = (cond, message) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${message}`);
  if (!cond) failures.push(message);
  return cond;
};
const info = (message) => console.log(`INFO  ${message}`);
const section = (name) => console.log(`\n== ${name}`);

// ---- servers ----------------------------------------------------------------------------------------------------------------------
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

const children = [];
/** `react-router-serve` on a port, the way a deployment runs it. Content is the demo's (explicit opt-in); the rest of the configuration is cleared so the defaults are what is tested. */
async function startServerAt(port, env) {
  if (!existsSync(`${webDir}build/server/index.js`)) throw new Error("no production build: run `pnpm --filter @catalyst/web build` first");
  const child = spawn(process.execPath, ["node_modules/@react-router/serve/bin.js", "./build/server/index.js"], {
    cwd: webDir,
    env: { ...process.env, PORT: String(port), NODE_ENV: "production", CATALYST_CONTENT: "demo", CATALYST_TILES_PRIMARY_URL: "", CATALYST_TILES_FALLBACK_URL: "", CATALYST_SITE_URL: "", CATALYST_CSP_CONNECT_EXTRA: "", ...env },
    stdio: "ignore",
  });
  children.push(child);
  const base = `http://localhost:${port}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(base + "/robots.txt")).ok) return base;
    } catch {}
    if (i > 100) throw new Error("the server did not start");
    await new Promise((r) => setTimeout(r, 200));
  }
}
const startServer = async (env) => ({ base: await startServerAt(await freePort(), env) });
process.on("exit", () => children.forEach((c) => c.kill()));

const external = opt("base");
const SITE = (opt("site") ?? DEFAULT_SITE).replace(/\/$/, "");
const main = external ? { base: external.replace(/\/$/, "") } : await startServer({});
const BASE = main.base;
const get = (path, init) => fetch(BASE + path, { redirect: "manual", ...init });
const text = async (path, init) => {
  const res = await get(path, init);
  return { res, body: await res.text() };
};

// ---- the headers every response of ours carries ------------------------------------------------------------------------------------
const STATIC = {
  "x-content-type-options": /^nosniff$/,
  "referrer-policy": /^strict-origin-when-cross-origin$/,
  "x-frame-options": /^DENY$/,
  "cross-origin-opener-policy": /^same-origin$/,
  "permissions-policy": /camera=\(\).*geolocation=\(\).*microphone=\(\).*payment=\(\).*usb=\(\)/,
};
function staticHeaders(res, label) {
  for (const [name, re] of Object.entries(STATIC)) ok(re.test(res.headers.get(name) ?? ""), `${label}: ${name} (${res.headers.get(name) ?? "missing"})`.slice(0, 120));
}

function checkCsp(res, html, label) {
  const header = res.headers.get("content-security-policy") ?? "";
  const csp = parseCsp(header);
  const nonce = /'nonce-([^']+)'/.exec(csp["script-src"]?.join(" ") ?? "")?.[1];
  ok(Boolean(nonce), `${label}: CSP has a script nonce`);
  ok(csp["default-src"]?.join() === "'none'", `${label}: default-src 'none'`);
  ok(csp["script-src"]?.includes("'self'") && !csp["script-src"].some((t) => /unsafe-|^\*$|^https?:|^data:/.test(t)), `${label}: script-src is self + nonce only`);
  ok(!header.includes("unsafe-eval"), `${label}: no unsafe-eval anywhere`);
  ok(csp["style-src"]?.join() === "'self'", `${label}: style-src 'self' (no inline <style>)`);
  ok(csp["worker-src"]?.includes("blob:") && csp["worker-src"].includes("'self'"), `${label}: worker-src self blob:`);
  ok(csp["img-src"]?.includes("data:") && csp["img-src"].includes("blob:"), `${label}: img-src self data: blob:`);
  ok(csp["connect-src"]?.includes("'self'") && csp["connect-src"].some((t) => t.startsWith("http")), `${label}: connect-src self + tile hosts (${csp["connect-src"]?.slice(1).join(" ")})`);
  ok(csp["object-src"]?.join() === "'none'" && csp["base-uri"]?.join() === "'self'" && csp["form-action"]?.join() === "'self'" && csp["frame-ancestors"]?.join() === "'none'", `${label}: object-src none, base-uri/form-action self, frame-ancestors none`);
  if (nonce && html) {
    const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]).filter((a) => !/application\/ld\+json/.test(a));
    ok(scripts.length > 0 && scripts.every((a) => a.includes(`nonce="${nonce}"`)), `${label}: all ${scripts.length} executable <script> tags carry the response's nonce`);
  }
  return csp;
}

const page = async (path, label, { status = 200, method = "GET" } = {}) => {
  const { res, body } = await text(path, { method });
  ok(res.status === status, `${label}: status ${status} (got ${res.status})`);
  ok(/^text\/html/.test(res.headers.get("content-type") ?? ""), `${label}: content-type text/html (${res.headers.get("content-type")})`);
  ok(res.headers.get("cache-control") === "private, no-cache", `${label}: cache-control private, no-cache (${res.headers.get("cache-control")})`);
  staticHeaders(res, label);
  checkCsp(res, body, label);
  return { res, body };
};

// ---- 1. site map: what exists ---------------------------------------------------------------------------------------------------
section("sitemap.xml");
const sm = await text("/sitemap.xml");
ok(sm.res.status === 200, "sitemap.xml: 200");
ok(/^application\/xml/.test(sm.res.headers.get("content-type") ?? ""), `sitemap.xml: content-type application/xml (${sm.res.headers.get("content-type")})`);
ok(/s-maxage=\d+/.test(sm.res.headers.get("cache-control") ?? ""), `sitemap.xml: cache-control (${sm.res.headers.get("cache-control")})`);
staticHeaders(sm.res, "sitemap.xml");
const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const lastmods = [...sm.body.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
ok(sm.body.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && sm.body.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'), "sitemap.xml: XML declaration and sitemap namespace");
ok(locs.every((l) => l.startsWith(SITE + "/")), `sitemap.xml: ${locs.length} URLs, all absolute on ${SITE}`);
ok(new Set(locs).size === locs.length, "sitemap.xml: no duplicate URL");
ok(lastmods.every((d) => /^\d{4}(-\d{2}(-\d{2})?)?$/.test(d)), `sitemap.xml: ${lastmods.length} lastmod values are W3C dates`);
const paths = locs.map((l) => l.slice(SITE.length));
for (const p of ["/", "/projects", "/articles", "/artworks", "/poems"]) ok(paths.includes(p), `sitemap.xml lists ${p}`);
const entryPaths = paths.filter((p) => /^\/(articles|projects|artworks|poems)\/./.test(p));
const placePaths = paths.filter((p) => p.startsWith("/locations/"));
ok(entryPaths.length > 0 && placePaths.length > 0, `sitemap.xml lists ${entryPaths.length} entries and ${placePaths.length} places`);
{
  // Every URL of the sitemap must answer 200 (four at a time).
  const bad = [];
  const queue = [...paths];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
        const r = await get(p);
        await r.arrayBuffer();
        if (r.status !== 200) bad.push(`${p} ${r.status}`);
      }
    }),
  );
  ok(bad.length === 0, `sitemap.xml: every URL answers 200${bad.length ? ` (${bad.slice(0, 5).join(", ")})` : ""}`);
}
const kindOf = (p) => p.split("/")[1];
const articlePath = entryPaths.find((p) => kindOf(p) === "articles") ?? entryPaths[0];
const placePath = placePaths[0];

// ---- 2. documents ---------------------------------------------------------------------------------------------------------------
section("documents: headers and head tags");
const TYPES = { articles: "Article", projects: ["CreativeWork", "SoftwareSourceCode"], artworks: "CreativeWork", poems: "CreativeWork" };
async function document(path, label, expect) {
  const { res, body } = await page(path, label);
  const tags = headTags(body);
  const t = title(body);
  ok(/<html lang="en"/.test(body), `${label}: <html lang="en">`);
  ok(expect.home ? /^Catalyst · /.test(t) : /^.+ · Catalyst$/.test(t), `${label}: title "${t}"`);
  const description = metaContent(tags, "name", "description");
  ok(Boolean(description) && description.length <= 320, `${label}: meta description`);
  const canonical = linkHref(tags, "canonical");
  ok(canonical === SITE + (path === "/" ? "/" : path), `${label}: canonical ${canonical}`);
  ok(metaContent(tags, "property", "og:url") === canonical, `${label}: og:url equals the canonical`);
  ok(metaContent(tags, "property", "og:title") === t, `${label}: og:title equals the title`);
  ok(metaContent(tags, "property", "og:description") === description, `${label}: og:description`);
  ok(metaContent(tags, "property", "og:type") === (expect.article ? "article" : "website"), `${label}: og:type ${metaContent(tags, "property", "og:type")}`);
  const image = metaContent(tags, "property", "og:image");
  ok(Boolean(image) && image.startsWith(SITE + "/") && /\.(png|jpe?g|webp|gif)$/i.test(image), `${label}: og:image is an absolute raster URL (${image})`);
  ok(metaContent(tags, "property", "og:image:alt")?.length > 0, `${label}: og:image:alt`);
  ok(metaContent(tags, "name", "twitter:card") === "summary_large_image" && metaContent(tags, "name", "twitter:image") === image, `${label}: twitter card and image`);
  ok(metaContent(tags, "name", "twitter:title") === t && metaContent(tags, "name", "twitter:description") === description, `${label}: twitter title and description`);
  const themes = tags.filter((x) => x.name === "theme-color");
  ok(themes.length === 2 && themes.every((x) => /^#[0-9a-f]{6}$/.test(x.content) && /prefers-color-scheme/.test(x.media)), `${label}: theme-color for both schemes`);
  ok(metaContent(tags, "name", "color-scheme") === "light dark", `${label}: color-scheme`);
  ok(Boolean(linkHref(tags, "manifest")) && Boolean(linkHref(tags, "apple-touch-icon")) && tags.some((x) => x.rel === "icon" && x.type === "image/svg+xml"), `${label}: manifest, apple-touch-icon and SVG icon links`);
  ok(!tags.some((x) => x.name === "robots" && /noindex/.test(x.content)), `${label}: indexable (no robots noindex)`);
  let ld = [];
  try {
    ld = jsonLd(body);
  } catch (e) {
    ok(false, `${label}: JSON-LD parses (${e.message})`);
  }
  if (expect.ld) {
    const types = [].concat(expect.ld);
    ok(ld.length === 1 && ld[0]["@context"] === "https://schema.org" && types.includes(ld[0]["@type"]), `${label}: JSON-LD ${ld[0]?.["@type"]} parses (${types.join("|")})`);
    ok(ld[0]?.url === canonical || ld[0]?.url === canonical + "/" || canonical.startsWith(ld[0]?.url ?? "?"), `${label}: JSON-LD url matches the page`);
    ok(Object.values(ld[0] ?? {}).every((v) => v !== null && v !== undefined && v !== ""), `${label}: JSON-LD has no empty value`);
  } else ok(ld.length === 0, `${label}: no JSON-LD`);
  return { body, tags };
}
await document("/", "/", { home: true, ld: "WebSite" });
await document("/articles", "/articles", {});
if (articlePath) {
  const e = await document(articlePath, articlePath, { article: kindOf(articlePath) === "articles", ld: TYPES[kindOf(articlePath)] });
  ok(/article:published_time/.test(e.body) === (kindOf(articlePath) === "articles" && /datePublished/.test(e.body)), `${articlePath}: article:published_time follows the authored date`);
}
for (const k of ["projects", "artworks", "poems"]) {
  const p = entryPaths.find((x) => kindOf(x) === k);
  if (p) await document(p, p, { ld: TYPES[k] });
}
if (placePath) await document(placePath, placePath, {});

section("data responses (client navigations)");
{
  const { res } = await text("/articles.data");
  ok(res.status === 200, "/articles.data: 200");
  staticHeaders(res, "/articles.data");
  ok(/public/.test(res.headers.get("cache-control") ?? "") && /s-maxage=60/.test(res.headers.get("cache-control") ?? "") && /stale-while-revalidate/.test(res.headers.get("cache-control") ?? ""), `/articles.data: cache-control (${res.headers.get("cache-control")})`);
}

// ---- 3. errors -------------------------------------------------------------------------------------------------------------------
section("errors");
for (const path of ["/articles/this-entry-does-not-exist", "/locations/this-place-does-not-exist", "/no-such-page", `/projects/${articlePath?.split("/")[2] ?? "x"}-wrong-kind`]) {
  const { body } = await page(path, `404 ${path}`, { status: 404 });
  ok(/Page not found|Place not found|not found/i.test(body), `404 ${path}: says not found`);
  ok(/name="robots" content="noindex"/.test(body), `404 ${path}: noindex`);
  ok(!/node_modules|\.tsx?:\d+|at \w+ \(/.test(body), `404 ${path}: no stack trace in the page`);
}
{
  // A request no route accepts: POST on a page with no action is a 405 error response, drawn by the root boundary (not the 404 page).
  const { res, body } = await text("/articles", { method: "POST", body: "x=1", headers: { "content-type": "application/x-www-form-urlencoded" } });
  ok(res.status === 405, `405 POST /articles: status (got ${res.status})`);
  ok(/ERR \/ 405/.test(body) && !/Page not found/.test(body), "405: the error page, with its code");
  ok(!/node_modules|\.tsx?:\d+|at \w+ \(/.test(body), "405: no stack trace in the page");
  ok(Boolean(res.headers.get("content-security-policy")), "405: CSP");
}
{
  const { res } = await text("/media/nope/missing.png");
  ok(res.status === 404, `missing media: 404 (got ${res.status})`);
}

// ---- 4. robots, manifest, icons ---------------------------------------------------------------------------------------------------
section("robots.txt, manifest, icons");
{
  const { res, body } = await text("/robots.txt");
  ok(res.status === 200 && /^text\/plain/.test(res.headers.get("content-type") ?? ""), `robots.txt: 200 text/plain (${res.headers.get("content-type")})`);
  staticHeaders(res, "robots.txt");
  const onSiteHost = new URL(BASE).host === new URL(SITE).host;
  if (onSiteHost) {
    ok(/^User-agent: \*\nAllow: \/\n/m.test(body) && body.includes(`Sitemap: ${SITE}/sitemap.xml`), "robots.txt (site host): allows all and links the sitemap");
    ok(!res.headers.get("x-robots-tag"), "site host: no X-Robots-Tag noindex");
  } else {
    ok(/^User-agent: \*\nDisallow: \/$/m.test(body) && !/Allow:/.test(body), "robots.txt (foreign host): disallows everything");
    ok(/noindex/.test((await get("/")).headers.get("x-robots-tag") ?? ""), "foreign host: X-Robots-Tag noindex on pages");
  }
}
{
  const m = await text("/manifest.webmanifest");
  ok(m.res.status === 200 && /json/.test(m.res.headers.get("content-type") ?? ""), `manifest: 200 (${m.res.headers.get("content-type")})`);
  const j = JSON.parse(m.body);
  ok(j.name && j.short_name && j.display === "standalone" && j.start_url && /^#[0-9a-f]{6}$/i.test(j.theme_color) && /^#[0-9a-f]{6}$/i.test(j.background_color), "manifest: name, short_name, display standalone, start_url, colours");
  const sizes = j.icons.map((i) => i.sizes);
  ok(sizes.includes("192x192") && sizes.includes("512x512") && j.icons.every((i) => i.type === "image/png"), `manifest: PNG icons ${sizes.join(", ")}`);
  for (const icon of j.icons) {
    const r = await get(icon.src);
    const buf = Buffer.from(await r.arrayBuffer());
    const size = pngSize(buf);
    ok(r.status === 200 && r.headers.get("content-type") === "image/png" && size && `${size.width}x${size.height}` === icon.sizes, `manifest icon ${icon.src}: 200 image/png ${size?.width}x${size?.height}`);
  }
}
for (const [path, type, dims, maxKb] of [
  ["/favicon.svg", /^image\/svg\+xml/, null, 4],
  ["/favicon.ico", /^image\/(x-icon|vnd\.microsoft\.icon)/, null, 8],
  ["/apple-touch-icon.png", /^image\/png$/, "180x180", 16],
  ["/og-default.png", /^image\/png$/, "1200x630", 60],
]) {
  const r = await get(path);
  const buf = Buffer.from(await r.arrayBuffer());
  const size = pngSize(buf);
  ok(r.status === 200 && type.test(r.headers.get("content-type") ?? ""), `${path}: 200 ${r.headers.get("content-type")}`);
  ok(!dims || (size && `${size.width}x${size.height}` === dims), `${path}: ${dims ?? "any size"}${size ? ` (is ${size.width}x${size.height})` : ""}`);
  ok(buf.length <= maxKb * 1024, `${path}: ${(buf.length / 1024).toFixed(1)} kB (max ${maxKb})`);
}

// ---- 5. assets: caching -----------------------------------------------------------------------------------------------------------
section("assets");
{
  const { body } = await text("/");
  const asset = /\/assets\/[\w.-]+\.js/.exec(body)?.[0];
  const css = /\/assets\/[\w.-]+\.css/.exec(body)?.[0];
  for (const a of [asset, css]) {
    if (!a) continue;
    const r = await get(a);
    await r.arrayBuffer();
    ok(r.status === 200 && /immutable/.test(r.headers.get("cache-control") ?? ""), `${a}: 200, immutable (${r.headers.get("cache-control")})`);
    ok(r.headers.get("x-content-type-options") === "nosniff" || external === undefined, `${a}: nosniff (local server serves it without; Vercel adds it from vercel.json)`);
  }
  const mediaPath = /\/media\/[\w./-]+\.(?:svg|png|jpe?g|webp)/.exec((await text(articlePath ?? "/")).body)?.[0];
  if (mediaPath) {
    const r = await get(mediaPath);
    await r.arrayBuffer();
    ok(r.status === 200 && Boolean(r.headers.get("cache-control")), `${mediaPath}: 200 with a cache-control (${r.headers.get("cache-control")})`);
  }
}

// ---- 6. sizes -------------------------------------------------------------------------------------------------------------------
if (!external) {
  section("JavaScript sizes (gzip), per page: what the HTML preloads");
  const gz = (file) => gzipSync(readFileSync(`${webDir}build/client${file}`)).length;
  for (const [label, path] of [["/", "/"], ["list", "/articles"], ["entry", articlePath], ["place", placePath]]) {
    if (!path) continue;
    const { body } = await text(path);
    const files = [...new Set([...body.matchAll(/(?:href|src)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]))];
    const total = files.reduce((n, f) => n + gz(f), 0);
    info(`${label.padEnd(6)} ${path.padEnd(28)} ${(total / 1024).toFixed(0).padStart(4)} kB gzip in ${files.length} files (critical path, before the globe chunk)`);
  }
  const all = readdirSync(`${webDir}build/client/assets`).filter((f) => f.endsWith(".js") && !/^(?:server-build|maplibre-gl-worker)/.test(f));
  const sized = all.map((f) => [f, gz(`/assets/${f}`)]).sort((a, b) => b[1] - a[1]);
  info(`all client JS ${(sized.reduce((n, [, s]) => n + s, 0) / 1024).toFixed(0)} kB gzip; largest: ${sized.slice(0, 5).map(([f, s]) => `${f.replace(/-[\w-]{8}\.js$/, "")} ${(s / 1024).toFixed(0)}`).join(", ")} kB`);
}

// ---- 7. robots on the site's own host (a second server whose CATALYST_SITE_URL is itself) -----------------------------------------
if (!external) {
  section("robots.txt on the site's own host");
  const port = await freePort();
  const own = await startServerAt(port, { CATALYST_SITE_URL: `http://localhost:${port}` });
  const r = await fetch(`${own}/robots.txt`);
  const body = await r.text();
  ok(/^User-agent: \*\nAllow: \/\n/m.test(body) && body.includes(`Sitemap: http://localhost:${port}/sitemap.xml`), "own host: allow all, Sitemap line on CATALYST_SITE_URL");
  const home = await fetch(`${own}/`);
  ok(!home.headers.get("x-robots-tag"), "own host: no X-Robots-Tag");
  const html = await home.text();
  ok(headTags(html).find((t) => t.rel === "canonical")?.href === `http://localhost:${port}/`, "own host: canonical follows CATALYST_SITE_URL");
  const smOwn = await (await fetch(`${own}/sitemap.xml`)).text();
  ok(smOwn.includes(`<loc>http://localhost:${port}/</loc>`), "own host: sitemap URLs follow CATALYST_SITE_URL");
}
// ---- 8. the browser ------------------------------------------------------------------------------------------------------------------
if (!flag("no-browser")) {
  const browser = await launch();
  const results = { cls: {} };

  /** A page with the violation and layout-shift probes installed before any app code. */
  async function open(base, path, { profile = DESKTOP, scheme = "dark", reducedMotion = "no-preference", debug = false, streetOpts = null, javaScriptEnabled = true } = {}) {
    const ctx = await browser.newContext({ ...profile, colorScheme: scheme, reducedMotion, javaScriptEnabled });
    const pg = await ctx.newPage();
    const logs = [];
    pg.on("console", (m) => {
      if ((m.type() === "error" || m.type() === "warning") && !/^Failed to load resource/.test(m.text())) logs.push(`${m.type()}: ${m.text()}`);
    });
    pg.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
    pg.on("response", (r) => {
      if (r.status() >= 400 && r.url() !== base + path) logs.push(`http ${r.status()}: ${r.url()}`);
    });
    await pg.addInitScript(
      ([dbg, street]) => {
        window.__csp = [];
        document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI} (${e.sourceFile}:${e.lineNumber})`));
        window.__cls = 0;
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
          }).observe({ type: "layout-shift", buffered: true });
        } catch {}
        if (dbg) sessionStorage.setItem("globe-debug", "1");
        if (street) sessionStorage.setItem("street-opts", JSON.stringify(street));
      },
      [debug, streetOpts],
    );
    const response = await pg.goto(base + path);
    return { ctx, pg, logs, response };
  }
  const globeReady = (pg) => pg.waitForSelector('[data-globe="three"][data-state="ready"]', { timeout: 30000 });
  const verdict = async (label, { pg, logs, ctx }, { settleMs = 1500 } = {}) => {
    await pg.waitForTimeout(settleMs);
    const csp = await pg.evaluate(() => window.__csp);
    ok(csp.length === 0, `${label}: zero CSP violations${csp.length ? ` (${csp.slice(0, 3).join(" | ")})` : ""}`);
    ok(logs.length === 0, `${label}: no console error or warning${logs.length ? ` (${logs.slice(0, 3).join(" | ")})` : ""}`);
    const cls = await pg.evaluate(() => window.__cls);
    results.cls[label] = +cls.toFixed(4);
    ok(cls < 0.1, `${label}: CLS ${cls.toFixed(4)} (< 0.1)`);
    await ctx.close();
  };

  section("browser: CSP violations, console, CLS (pages and the street map)");
  const shellPaths = [["globe /", "/"], ...(placePath ? [[`place ${placePath}`, placePath]] : []), ...(articlePath ? [[`entry ${articlePath}`, articlePath]] : [])];
  for (const [label, path] of shellPaths) {
    const t = await open(BASE, path);
    await globeReady(t.pg);
    await verdict(label, t);
  }
  for (const [label, path] of [["list /articles", "/articles"], ["404 page", "/no-such-page"]]) {
    const t = await open(BASE, path);
    await verdict(label, t);
  }
  {
    const t = await open(BASE, articlePath ?? "/", { profile: MOBILE, scheme: "light" });
    await globeReady(t.pg).catch(() => {});
    await verdict("mobile entry (light)", t);
  }

  /** Zoom into the street map on real OpenFreeMap tiles (or the local fallback) and demand a clean console. */
  async function streetPass(base, label, streetOpts, { fallback }) {
    const t = await open(base, "/", { debug: true, streetOpts });
    await t.pg.waitForFunction(() => window.__handoverDebug && document.querySelector('[data-globe="three"][data-state="ready"]'), null, { timeout: 30000 });
    const lonlat = fallback ? { lon: 106.7, lat: 10.8 } : { lon: 2.35, lat: 48.86 };
    await t.pg.evaluate((v) => window.__handoverDebug.globe.setView({ ...v, zoom: 6.5 }), lonlat);
    let street = "none";
    try {
      await t.pg.waitForFunction(
        () => {
          const d = window.__handoverDebug;
          const tile = d?.tile();
          return d?.streetState() === "ready" && (tile?.state === "primary" || tile?.state === "fallback") && d.street()?.debug().map().areTilesLoaded();
        },
        null,
        { timeout: 45000 },
      );
      street = await t.pg.evaluate(() => `${window.__handoverDebug.streetState()} / ${window.__handoverDebug.tile()?.state}`);
    } catch {}
    ok(street.startsWith("ready"), `${label}: the street map is ready with tiles (${street})`);
    const workers = await t.pg.evaluate(() => performance.getEntriesByType("resource").filter((r) => /worker/.test(r.name)).map((r) => r.name.replace(/^.*\//, "")));
    info(`${label}: worker script(s) fetched: ${workers.join(", ") || "(none seen)"}`);
    await verdict(label, t, { settleMs: 800 });
  }
  await streetPass(BASE, "street zoom (OpenFreeMap)", { forceSource: "primary" }, { fallback: false });

  if (!external && !flag("no-fallback")) {
    try {
      const tiles = await ensureTiles();
      const port = await freePort();
      // Run time NODE_ENV=development: a production runtime refuses a plain-http fallback (the build itself is the production one).
      const base = await startServerAt(port, { NODE_ENV: "development", CATALYST_TILES_FALLBACK_URL: tiles.url });
      const { res } = { res: await fetch(base + "/") };
      const csp = parseCsp(res.headers.get("content-security-policy") ?? "");
      ok(csp["connect-src"]?.includes(new URL(tiles.url).origin), `fallback host ${new URL(tiles.url).origin} is in connect-src`);
      await streetPass(base, "street zoom (local PMTiles fallback)", { forceSource: "fallback" }, { fallback: true });
      await tiles.stop();
    } catch (e) {
      info(`fallback pass skipped: ${e.message}`);
    }
  }

  section("browser: skip link, navigation without JavaScript, pending line, reduced motion");
  for (const path of ["/articles", articlePath].filter(Boolean)) {
    const t = await open(BASE, path);
    await t.pg.waitForTimeout(600);
    await t.pg.keyboard.press("Tab");
    const first = await t.pg.evaluate(() => document.activeElement?.textContent);
    await t.pg.keyboard.press("Enter");
    const landed = await t.pg.evaluate(() => ({ hash: location.hash, id: document.activeElement?.id, visible: !!document.querySelector("#main")?.getClientRects().length }));
    ok(first === "Skip to content" && landed.hash === "#main" && landed.id === "main", `skip link on ${path}: first tab stop "${first}", Enter moves focus to #main (${landed.hash}, ${landed.id})`);
    await t.ctx.close();
  }
  if (articlePath) {
    const t = await open(BASE, articlePath, { javaScriptEnabled: false });
    const state = await t.pg.evaluate(() => {
      const panel = document.querySelector("[data-panel]");
      const r = panel?.getBoundingClientRect();
      return {
        h1: panel?.querySelector("h1")?.innerText ?? null,
        panelVisible: !!r && r.width > 300 && r.left < window.innerWidth - 300,
        shown: panel?.innerText.length ?? 0,
        total: panel?.textContent.length ?? 0,
        noscript: document.body.innerText.includes("The globe needs JavaScript") || !!document.querySelector("noscript"),
      };
    });
    ok(Boolean(state.h1) && state.panelVisible, `no JS: the entry renders its title ("${state.h1}") in a visible panel`);
    ok(state.total > 0 && state.shown / state.total > 0.9, `no JS: the entry's text is readable (${state.shown} of ${state.total} characters visible)`);
    ok(state.noscript, "no JS: the noscript note is in the page");
    await t.pg.getByRole("link", { name: "Articles", exact: true }).first().click();
    await t.pg.waitForURL("**/articles");
    ok((await t.pg.locator("h1").first().innerText()) === "Articles", "no JS: the navigation links work (Articles list loads)");
    const list = await t.pg.locator("main a[href^='/articles/']").first().getAttribute("href");
    ok(Boolean(list), "no JS: the list links to its entries");
    await t.ctx.close();
  }
  {
    // The pending line: slow the data request down, click a link, see the line, see it go.
    const t = await open(BASE, "/articles");
    await t.pg.waitForTimeout(500);
    await t.pg.route("**/*.data*", async (route) => {
      await new Promise((r) => setTimeout(r, 900));
      await route.continue();
    });
    await t.pg.getByRole("link", { name: "Poems", exact: true }).first().click();
    const shown = await t.pg.waitForSelector(".nav-progress[data-active]", { timeout: 3000 }).then(() => true, () => false);
    ok(shown, "pending navigation: the top progress line appears after a short delay");
    await t.pg.waitForURL("**/poems");
    await t.pg.waitForFunction(() => !document.querySelector(".nav-progress[data-active]"), null, { timeout: 5000 });
    ok(true, "pending navigation: the line is gone once the page has loaded");
    const anim = await t.pg.evaluate(() => getComputedStyle(document.querySelector(".nav-progress"), "::after").animationName);
    ok(anim === "nav-progress-sweep", `motion on: the line sweeps (${anim})`);
    await t.ctx.close();
    const r = await open(BASE, "/articles", { reducedMotion: "reduce" });
    const still = await r.pg.evaluate(() => getComputedStyle(document.querySelector(".nav-progress"), "::after").animationName);
    ok(still === "none", `reduced motion: the line does not animate (${still})`);
    await r.ctx.close();
  }

  await browser.close();
  section("CLS");
  info(JSON.stringify(results.cls));
}

children.forEach((c) => c.kill());
console.log(`\n${failures.length === 0 ? "ALL PASSED" : `${failures.length} FAILED`}`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
