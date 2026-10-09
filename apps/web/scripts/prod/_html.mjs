// Tiny HTML reading helpers for the production check (no dependency: the markup React writes is regular enough for this).

export const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Every `<meta>` and `<link>` of the document as an attribute map (`{ tag, name, content, ... }`). */
export function headTags(html) {
  const out = [];
  for (const m of html.matchAll(/<(meta|link)\b([^>]*?)\/?>/g)) {
    const attrs = { tag: m[1] };
    for (const a of m[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? "" : decode(a[2]);
    out.push(attrs);
  }
  return out;
}

export const metaContent = (tags, key, value) => tags.find((t) => t.tag === "meta" && t[key] === value)?.content;
export const linkHref = (tags, rel) => tags.find((t) => t.tag === "link" && t.rel === rel)?.href;
export const title = (html) => decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "");

/** The parsed JSON-LD objects of the document; throws on invalid JSON. */
export function jsonLd(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/\\u003c/gi, "<")));
}

/** `script-src` etc. of a CSP header as { directive: [tokens] }. */
export function parseCsp(header) {
  const out = {};
  for (const part of header.split(";")) {
    const [name, ...tokens] = part.trim().split(/\s+/);
    if (name) out[name] = tokens;
  }
  return out;
}

/** Width and height of a PNG (IHDR), or null. */
export function pngSize(buf) {
  if (buf.length < 24 || buf.toString("latin1", 1, 4) !== "PNG") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
