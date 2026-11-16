import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCsp } from "../../app/lib/security-headers";
import { sealPage } from "./seal-page.mts";

const hash = (s: string) => `sha256-${createHash("sha256").update(s, "utf8").digest("base64")}`;
const page = `<!DOCTYPE html><html><head><meta charSet="utf-8"/><title>t</title><script src="/theme-boot.js"></script><script type="application/ld+json">{"a":1}</script><script nonce="N1">window.a=1</script><script nonce="N1" type="module" async="">import("/x.js")</script></head><body><script nonce="N1" id="_R_">window.b=2</script></body></html>`;

describe("sealPage: a prerendered page gets its own policy", () => {
  const out = sealPage(page, ["https://tiles.example"]);
  const content = /content="([^"]*)"/.exec(out)![1]!;
  it("names the hash of every inline script (not the src one, not the JSON-LD block), and no nonce", () => {
    for (const body of ["window.a=1", 'import("/x.js")', "window.b=2"]) expect(content).toContain(`'${hash(body)}'`);
    expect(content).not.toContain(hash('{"a":1}'));
    expect(content.match(/'sha256-/g)).toHaveLength(3);
    expect(out).not.toContain("nonce=");
  });
  it("is the server's policy otherwise, put right after the charset declaration (which must come first)", () => {
    expect(content).toBe(buildCsp({ scriptHashes: [hash("window.a=1"), hash('import("/x.js")'), hash("window.b=2")], connectOrigins: ["https://tiles.example"], upgradeInsecure: false }));
    expect(out.indexOf("charSet")).toBeLessThan(out.indexOf("Content-Security-Policy"));
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<script"));
  });
});

describe("buildCsp for a page that is a static file", () => {
  it("has no frame-ancestors or upgrade-insecure-requests (a <meta> ignores them), and the nonce form is unchanged", () => {
    const meta = buildCsp({ scriptHashes: ["sha256-x"], connectOrigins: [], upgradeInsecure: true });
    expect(meta).not.toContain("frame-ancestors");
    expect(meta).not.toContain("upgrade-insecure");
    expect(buildCsp({ nonce: "abc", connectOrigins: [], upgradeInsecure: true })).toContain("script-src 'self' 'nonce-abc'");
  });
});
