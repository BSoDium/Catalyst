import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DATA_CACHE_CONTROL,
  HTML_CACHE_CONTROL,
  MEDIA_CSP,
  STATIC_SECURITY_HEADERS,
  applyDataHeaders,
  isCacheableData,
  applyDocumentHeaders,
  buildCsp,
  createNonce,
  originOf,
  parseOrigins,
} from "./security-headers";

const directives = (csp: string) => Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));
const input = { nonce: "abc123", connectOrigins: ["https://tiles.openfreemap.org"], upgradeInsecure: true };

describe("buildCsp", () => {
  const csp = directives(buildCsp(input));
  it("denies everything by default and lists what the app loads", () => {
    expect(csp["default-src"]).toEqual(["'none'"]);
    expect(csp["script-src"]).toEqual(["'self'", "'nonce-abc123'"]);
    expect(csp["style-src"]).toEqual(["'self'"]);
    expect(csp["style-src-attr"]).toEqual(["'unsafe-inline'"]);
    expect(csp["img-src"]).toEqual(["'self'", "data:", "blob:"]);
    expect(csp["font-src"]).toEqual(["'self'"]);
    expect(csp["worker-src"]).toEqual(["'self'", "blob:"]);
    expect(csp["manifest-src"]).toEqual(["'self'"]);
  });
  it("has no unsafe-inline for scripts or style elements, no unsafe-eval, no wildcard", () => {
    const all = buildCsp(input);
    expect(all).not.toContain("unsafe-eval");
    expect(all).not.toMatch(/(?:^|; )(?:script-src|style-src|default-src) [^;]*unsafe-inline/);
    expect(all).not.toMatch(/ \* |\*;|\*$/);
  });
  it("locks down plugins, base URI, forms and framing", () => {
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
  });
  it("lets the page connect to itself and to the tile hosts, once each", () => {
    expect(csp["connect-src"]).toEqual(["'self'", "https://tiles.openfreemap.org"]);
    const two = directives(buildCsp({ ...input, connectOrigins: ["https://a.test", "https://a.test", "https://b.test:8443"] }));
    expect(two["connect-src"]).toEqual(["'self'", "https://a.test", "https://b.test:8443"]);
  });
  it("upgrades insecure requests only when asked (the page itself came over https)", () => {
    expect(buildCsp(input)).toContain("upgrade-insecure-requests");
    expect(buildCsp({ ...input, upgradeInsecure: false })).not.toContain("upgrade-insecure-requests");
  });
});

describe("createNonce", () => {
  it("is 128 random bits in base64 and differs every time", () => {
    const a = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(a);
  });
});

describe("origins", () => {
  it("reduces a URL to its origin and refuses anything that is not http(s)", () => {
    expect(originOf("https://tiles.openfreemap.org/planet")).toBe("https://tiles.openfreemap.org");
    expect(originOf("http://127.0.0.1:5240/places.pmtiles")).toBe("http://127.0.0.1:5240");
    expect(originOf("javascript:alert(1)")).toBeNull();
    expect(originOf("not a url")).toBeNull();
    expect(originOf(null)).toBeNull();
  });
  it("reads CATALYST_CSP_CONNECT_EXTRA: spaces or commas, valid origins only, no way to smuggle a directive in", () => {
    expect(parseOrigins("https://a.test, https://b.test/path https://c.test")).toEqual(["https://a.test", "https://b.test", "https://c.test"]);
    expect(parseOrigins("https://a.test; script-src *")).toEqual([]);
    expect(originOf("https://a.test;")).toBeNull();
    expect(originOf("https://a,b.test")).toBeNull();
    expect(originOf("http://[::1]:5240/x")).toBe("http://[::1]:5240");
    expect(parseOrigins("'unsafe-inline' *")).toEqual([]);
    expect(parseOrigins(undefined)).toEqual([]);
  });
});

describe("applyDocumentHeaders", () => {
  const base = { ...input, indexable: true, dev: false };
  it("sets the static security headers, the CSP and a private cache policy in production", () => {
    const h = new Headers();
    applyDocumentHeaders(h, base);
    for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) expect(h.get(name)).toBe(value);
    expect(h.get("content-security-policy")).toBe(buildCsp(input));
    expect(h.get("cache-control")).toBe(HTML_CACHE_CONTROL);
    expect(HTML_CACHE_CONTROL).toBe("private, no-cache");
    expect(h.get("x-robots-tag")).toBeNull();
  });
  it("adds X-Robots-Tag noindex off the production host", () => {
    const h = new Headers();
    applyDocumentHeaders(h, { ...base, indexable: false });
    expect(h.get("x-robots-tag")).toBe("noindex, nofollow");
  });
  it("sets no CSP and no cache policy on the Vite dev server (its inline preamble and HMR socket are not ours)", () => {
    const h = new Headers();
    applyDocumentHeaders(h, { ...base, dev: true });
    expect(h.get("content-security-policy")).toBeNull();
    expect(h.get("cache-control")).toBeNull();
    expect(h.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("applyDataHeaders", () => {
  it("shares data responses for a minute at the CDN and keeps a cache policy a route already set", () => {
    const h = new Headers();
    applyDataHeaders(h, { cache: true });
    expect(h.get("cache-control")).toBe(DATA_CACHE_CONTROL);
    expect(DATA_CACHE_CONTROL).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=300");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    const own = new Headers({ "Cache-Control": "no-store" });
    applyDataHeaders(own, { cache: true });
    expect(own.get("cache-control")).toBe("no-store");
    const off = new Headers();
    applyDataHeaders(off, { cache: false });
    expect(off.get("cache-control")).toBeNull();
    expect(off.get("x-frame-options")).toBe("DENY");
  });
  it("shares only answers and not-founds, never on the dev server", () => {
    expect(isCacheableData(200, false)).toBe(true);
    expect(isCacheableData(404, false)).toBe(true);
    for (const status of [202, 204, 302, 400, 405, 500, 503]) expect(isCacheableData(status, false)).toBe(false);
    expect(isCacheableData(200, true)).toBe(false);
  });
});

describe("the static headers", () => {
  it("deny what the app does not use and framing", () => {
    expect(STATIC_SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(STATIC_SECURITY_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) expect(STATIC_SECURITY_HEADERS["Permissions-Policy"]).toContain(`${feature}=()`);
  });
  it("are mirrored exactly in vercel.json (what Vercel serves without our code: assets, media, icons, resource routes)", () => {
    const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
    const all = config.headers.find((h) => h.source === "/(.*)");
    expect(all).toBeDefined();
    const byKey = Object.fromEntries(all!.headers.map((h) => [h.key, h.value]));
    for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) expect(byKey[name]).toBe(value);
    expect(byKey["Strict-Transport-Security"]).toMatch(/^max-age=\d{8,}/);
    // The CSP of documents carries a per-response nonce, so it can only come from the server, never from this static file.
    expect(byKey["Content-Security-Policy"]).toBeUndefined();
  });
  it("pin the caching of hashed assets, media and the icons in vercel.json", () => {
    const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
    const cache = (source: string) => config.headers.find((h) => h.source === source)?.headers.find((h) => h.key === "Cache-Control")?.value;
    expect(cache("/assets/(.*)")).toBe("public, max-age=31536000, immutable");
    expect(cache("/media/(.*)")).toMatch(/^public, max-age=\d+, stale-while-revalidate=\d+$/);
    expect(cache("/media/(.*)")).not.toMatch(/immutable/);
    const media = config.headers.find((h) => h.source === "/media/(.*)")?.headers.find((h) => h.key === "Content-Security-Policy")?.value;
    expect(media).toBe(MEDIA_CSP);
  });
});
