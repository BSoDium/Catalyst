// The page function of `seal-csp.mts`: one prerendered page in, the same page with its Content-Security-Policy `<meta>` out (unit tested).
import { createHash } from "node:crypto";
import { buildCsp } from "../../app/lib/security-headers.ts";

/** The inline scripts the browser runs: `<script>` without `src`, and not a data block (`application/ld+json`). */
const SCRIPT = /<script((?:\s[^>]*)?)>([\s\S]*?)<\/script>/g;

export function sealPage(html: string, connectOrigins: readonly string[]): string {
  const hashes = new Set<string>();
  for (const [, attrs = "", body = ""] of html.matchAll(SCRIPT)) {
    if (/\ssrc\s*=/.test(attrs) || /type\s*=\s*["']?application\/ld\+json/i.test(attrs) || body === "") continue;
    hashes.add(`sha256-${createHash("sha256").update(body, "utf8").digest("base64")}`);
  }
  const csp = buildCsp({ scriptHashes: [...hashes], connectOrigins, upgradeInsecure: false });
  const unnonced = html.replace(/\snonce="[^"]*"/g, "");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}"/>`;
  // (early in <head>, but after the charset declaration, which must be within the first 1024 bytes: the policy holds for what comes after it)
  const charset = /<meta charSet="[^"]*"\s*\/?>/i;
  if (charset.test(unnonced)) return unnonced.replace(charset, (m) => `${m}${meta}`);
  return /<head[^>]*>/.test(unnonced) ? unnonced.replace(/<head([^>]*)>/, (m) => `${m}${meta}`) : unnonced;
}
