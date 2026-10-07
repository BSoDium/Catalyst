/**
 * Country names for place labels (pure; `Intl.DisplayNames` is part of the platform, no table to ship or keep up to date).
 *
 * A place that is the only one of its country in the whole projection says which country it is: "Bogotá, Colombia". The
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
 * The label text of every place: its name, plus ", <Country>" when it is the ONLY place of its country (`countryCode`)
 * among `places` (the whole projection, not what is in view). `places` and the result are parallel arrays.
 */
export function placeLabelTexts(places: readonly { name: string; countryCode?: string | undefined }[]): string[] {
  const perCountry = new Map<string, number>();
  for (const p of places) if (p.countryCode) perCountry.set(p.countryCode, (perCountry.get(p.countryCode) ?? 0) + 1);
  return places.map((p) => {
    if (!p.countryCode || perCountry.get(p.countryCode) !== 1) return p.name;
    const c = countryName(p.countryCode);
    return c ? `${p.name}, ${c}` : p.name;
  });
}
