import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_URL, THEME_COLORS, captionText, isIndexableHost, requestHost, resolveSiteUrl, siteCaption } from "./site";

describe("siteCaption: four rows in view, never five", () => {
  const counts = { project: 33, article: 2, artwork: 16, poem: 9, photograph: 4 };
  it("names the five sections in two rows, the widest as wide as the counts' row of the four-section caption was (24 letters)", () => {
    const text = captionText(siteCaption());
    expect(text.sets[1]).toEqual(["Software, articles, art,", "poetry & photography."]);
    expect(Math.max(...text.sets[1]!.map((r) => r.length))).toBeLessThanOrEqual(24);
  });
  it("counts them in two rows too: the total and how many sections hold something", () => {
    expect(captionText(siteCaption(counts)).sets[2]).toEqual(["64 entries,", "in 5 sections."]);
    expect(captionText(siteCaption({ ...counts, article: 0, artwork: 0, poem: 0, photograph: 0, project: 1 })).sets[2]).toEqual(["1 entry,", "in 1 section."]);
  });
  it("leaves the counts out when there is nothing yet, and every set is two rows", () => {
    expect(captionText(siteCaption({ project: 0, article: 0, artwork: 0, poem: 0, photograph: 0 })).sets).toHaveLength(2);
    for (const set of siteCaption(counts).sets) expect(set).toHaveLength(2);
  });
  it("keeps the call to action in the two rows that stay", () => {
    expect(captionText(siteCaption()).fixed).toEqual(["Drag to explore.", "Pick a place."]);
  });
});

describe("resolveSiteUrl", () => {
  it("defaults to the temporary main domain", () => {
    expect(DEFAULT_SITE_URL).toBe("https://v2.bsodium.fr");
    expect(resolveSiteUrl(undefined)).toBe(DEFAULT_SITE_URL);
    expect(resolveSiteUrl("")).toBe(DEFAULT_SITE_URL);
    expect(resolveSiteUrl("   ")).toBe(DEFAULT_SITE_URL);
  });
  it("keeps only the origin of a valid value (no trailing slash, path, query or credentials)", () => {
    expect(resolveSiteUrl("https://example.org/")).toBe("https://example.org");
    expect(resolveSiteUrl(" https://example.org/some/path?x=1#h ")).toBe("https://example.org");
    expect(resolveSiteUrl("https://user:pw@example.org:8443")).toBe("https://example.org:8443");
  });
  it("accepts http only for localhost (to test a production build)", () => {
    expect(resolveSiteUrl("http://localhost:5440")).toBe("http://localhost:5440");
    expect(resolveSiteUrl("http://example.org", () => {})).toBe(DEFAULT_SITE_URL);
  });
  it("warns once per bad value and falls back to the default", () => {
    const warnings: string[] = [];
    expect(resolveSiteUrl("not a url", (m) => warnings.push(m))).toBe(DEFAULT_SITE_URL);
    expect(resolveSiteUrl("ftp://example.org", (m) => warnings.push(m))).toBe(DEFAULT_SITE_URL);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/CATALYST_SITE_URL/);
  });
});

describe("isIndexableHost", () => {
  const siteUrl = "https://v2.bsodium.fr";
  it("is true only on the site's own host", () => {
    expect(isIndexableHost({ siteUrl, host: "v2.bsodium.fr" })).toBe(true);
    expect(isIndexableHost({ siteUrl, host: "V2.Bsodium.FR", vercelEnv: "production" })).toBe(true);
    expect(isIndexableHost({ siteUrl, host: "catalyst-abc.vercel.app" })).toBe(false);
    expect(isIndexableHost({ siteUrl, host: "localhost:5440" })).toBe(false);
    expect(isIndexableHost({ siteUrl, host: "v2.bsodium.fr.evil.test" })).toBe(false);
    expect(isIndexableHost({ siteUrl, host: null })).toBe(false);
  });
  it("is false for a preview or development deployment even on the right host", () => {
    expect(isIndexableHost({ siteUrl, host: "v2.bsodium.fr", vercelEnv: "preview" })).toBe(false);
    expect(isIndexableHost({ siteUrl, host: "v2.bsodium.fr", vercelEnv: "development" })).toBe(false);
  });
  it("compares the port too (a local production run on CATALYST_SITE_URL)", () => {
    expect(isIndexableHost({ siteUrl: "http://localhost:5440", host: "localhost:5440" })).toBe(true);
    expect(isIndexableHost({ siteUrl: "http://localhost:5440", host: "localhost:5441" })).toBe(false);
  });
});

describe("requestHost", () => {
  const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
  it("prefers the first forwarded host, then the host header", () => {
    expect(requestHost(headers({ "x-forwarded-host": "v2.bsodium.fr, internal", host: "x" }))).toBe("v2.bsodium.fr");
    expect(requestHost(headers({ host: "localhost:1" }))).toBe("localhost:1");
    expect(requestHost(headers({}))).toBeNull();
  });
});

describe("theme colours", () => {
  const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
  it("equal the page colours of the two schemes in app.css", () => {
    const light = /:root\s*\{[^}]*?--background:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    const dark = /prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{[^}]*?--background:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    expect(light?.toLowerCase()).toBe(THEME_COLORS.light);
    expect(dark?.toLowerCase()).toBe(THEME_COLORS.dark);
  });
});
