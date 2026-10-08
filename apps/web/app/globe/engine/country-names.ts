/**
 * Country names for place labels (pure; `Intl.DisplayNames` is part of the platform, no table to ship or keep up to date).
 *
 * A hovered, focused or selected label says which country its place is in: "Bogotá, Colombia" (the label at rest is the name alone). The
 * name is English, whatever the page language, like the place names. An unknown or malformed code gives no name: the
 * label silently stays the place's name.
 */
let names: Intl.DisplayNames | null | undefined;
const cache = new Map<string, string | null>();

export function countryName(code: string | undefined): string | null {
  if (!code || !/^[A-Z]{2}$/.test(code) || code === "ZZ") return null;
  const hit = cache.get(code);
  if (hit !== undefined) return hit;
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
    } catch {
      names = null;
    }
  }
  let out: string | null = null;
  try {
    const n = names?.of(code);
    out = n && n !== code && !/^unknown/i.test(n) ? n : null;
  } catch {
    out = null;
  }
  cache.set(code, out);
  return out;
}

/**
 * A place's name without a trailing ", <its own country>" ("London, United Kingdom" with code GB gives "London"). Only the country of the
 * place itself is removed, only at the end, only when the whole tail equals its English name: "Kingston, Jamaica" with code GB stays, and so
 * does "Georgia, Atlanta". The labels say the name alone and add the country themselves when hovered or selected (engine/box-scene.ts), so a
 * source that already writes the country into the name (a trip step called "London, United Kingdom") must not say it twice. The stored
 * content is never changed: this is the web app's projection mapping (lib/projection.ts).
 */
export function stripCountry(name: string, code: string | undefined): string {
  const country = countryName(code);
  if (!country) return name;
  const tail = `, ${country}`;
  const trimmed = name.trimEnd();
  if (trimmed.length > tail.length && trimmed.toLowerCase().endsWith(tail.toLowerCase())) {
    const head = trimmed.slice(0, trimmed.length - tail.length).trimEnd();
    if (head) return head;
  }
  return name;
}
