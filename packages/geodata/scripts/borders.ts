/**
 * Which Natural Earth boundary lines the globe draws, and a country-pair label for each line (for reports only).
 *
 * Rule: the globe shows solid, de-facto land borders and nothing else, the same rule the street map applies to OpenStreetMap
 * (admin_level 2, not disputed, not maritime). Natural Earth classifies every boundary-line feature (`FEATURECLA`), so the rule
 * is a class allowlist, plus a short list of per-feature exceptions (`OVERRIDES`) that were checked against the street map's
 * tiles with `apps/web/scripts/geo/border-osm.mjs`.
 */

/** `FEATURECLA` values the globe draws. */
export const KEEP_CLASSES: readonly string[] = ["International boundary (verify)"];

/**
 * Every other class of Natural Earth 5.1.2's boundary_lines_land files (50m: 21 disputed, 7 line of control, 5 indefinite, 2 indeterminant; 110m adds a claim boundary) and why it is left out:
 *  - "Disputed (please verify)": a frontier claimed by more than one state (Crimea, Kashmir / Aksai Chin, West Bank, Golan, Arunachal, ...);
 *  - "Line of control (please verify)": a ceasefire or control line that is not a recognised border (Kashmir LoC, the Moroccan wall, the Korean DMZ, Cyprus buffer zone, Golan);
 *  - "Indefinite (please verify)": no agreed alignment (Somalia / Ethiopia, Patagonian ice field, Kashmir north, Morocco / Algeria);
 *  - "Indeterminant frontier": Kashmir / Siachen glacier area;
 *  - "Claim boundary": a claim line (one feature in the 110m file, none in the 50m one);
 *  - "Overlay limit": a limit of an overlay region (none in either land-lines file, listed for completeness).
 */
export const DROP_CLASSES: readonly string[] = [
  "Disputed (please verify)",
  "Line of control (please verify)",
  "Indefinite (please verify)",
  "Indeterminant frontier",
  "Claim boundary",
  "Overlay limit",
];

export interface NeFeature {
  /** `FEATURECLA`. */
  cls: string;
  /** `NE_ID`. */
  id: number;
  /** `BRK_A3` (Natural Earth's break-away code, informational). */
  brk: string | null;
  lines: number[][][];
}

/**
 * The exceptions to the class rule, measured against the street map's OpenStreetMap tiles by `apps/web/scripts/geo/border-osm.mjs
 * --emit` and committed in `osm-evidence.json` (the generator needs no access to OSM). Feature numbers index the features of the
 * pinned Natural Earth file (`sources.json`); each entry carries the `NE_ID` as a guard against a different file.
 *  - `keep`: the class rule drops it but OSM draws it as a plain land border (Ethiopia / Somalia, the Korean DMZ, Algeria / Morocco, ...);
 *  - `drop`: the class rule keeps it but OSM has no land border there (the Haro Strait, the Johor Strait, Hong Kong and Macao, which OSM carries as region borders);
 *  - `cuts`: stretches of a kept feature that OSM carries only as a disputed or a maritime line (the 22 N Hala'ib line, the Bhutan / Arunachal stretch, ...).
 * `--strict-classes` ignores the file and applies the class rule alone.
 */
export interface Evidence {
  keep: { feature: number; id: number; pair: string; why: string }[];
  drop: { feature: number; id: number; pair: string; why: string }[];
  cuts: { feature: number; id: number; pair: string; osm: string; km: number; from: [number, number]; to: [number, number]; why: string }[];
}

export function decide(f: NeFeature, index: number, ev: Evidence | null): { keep: boolean; reason: string } {
  const hit = <T extends { feature: number; id: number }>(list: T[]): T | undefined => {
    const e = list.find((x) => x.feature === index);
    if (e && e.id !== f.id) throw new Error(`osm-evidence.json feature #${index} has NE_ID ${e.id}, the source has ${f.id}: not the pinned file`);
    return e;
  };
  const forced = ev && hit(ev.keep);
  if (forced) return { keep: true, reason: `OSM evidence: ${forced.why}` };
  const dropped = ev && hit(ev.drop);
  if (dropped) return { keep: false, reason: `OSM evidence: ${dropped.why}` };
  if (KEEP_CLASSES.includes(f.cls)) return { keep: true, reason: "class allowlist" };
  return { keep: false, reason: `class "${f.cls}"` };
}

interface NeCountry {
  name: string;
  rings: number[][][];
}

/** Country outlines of ne_50m_admin_0_countries (GeoJSON), as rings with a name. */
export function readCountries(geojson: unknown): NeCountry[] {
  const fc = geojson as { features: { properties: { NAME: string }; geometry: { type: string; coordinates: any } }[] };
  return fc.features.map((f) => {
    const polys: number[][][][] = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    return { name: f.properties.NAME, rings: polys.flat() };
  });
}

/**
 * "A / B" for the two countries whose outlines run along the line (within `tolKm` of most sample points); "A" or "?" for a line
 * that only follows one outline (a strait line, a claim over water). Samples every ~20 km plus both ends.
 */
export function labelPair(lines: number[][][], countries: NeCountry[], tolKm = 6): string {
  const segs: { c: number; a: number[]; b: number[] }[] = [];
  const grid = new Map<string, number[]>();
  const cell = 1;
  countries.forEach((c, ci) =>
    c.rings.forEach((ring) => {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!;
        const b = ring[i]!;
        if (Math.abs(b[0]! - a[0]!) > 180) continue;
        const id = segs.push({ c: ci, a, b }) - 1;
        for (let x = Math.floor(Math.min(a[0]!, b[0]!) / cell); x <= Math.floor(Math.max(a[0]!, b[0]!) / cell); x++)
          for (let y = Math.floor(Math.min(a[1]!, b[1]!) / cell); y <= Math.floor(Math.max(a[1]!, b[1]!) / cell); y++) {
            const k = `${x},${y}`;
            (grid.get(k) ?? grid.set(k, []).get(k)!).push(id);
          }
      }
    }),
  );
  const samples: number[][] = [];
  for (const l of lines) {
    let acc = 0;
    samples.push(l[0]!);
    for (let i = 1; i < l.length; i++) {
      acc += Math.hypot((l[i]![0]! - l[i - 1]![0]!) * Math.cos((l[i]![1]! * Math.PI) / 180), l[i]![1]! - l[i - 1]![1]!) * 111;
      if (acc >= 20) {
        samples.push(l[i]!);
        acc = 0;
      }
    }
    samples.push(l[l.length - 1]!);
  }
  const hits = new Map<number, number>();
  for (const p of samples) {
    const c = Math.cos((p[1]! * Math.PI) / 180);
    const gx = Math.floor(p[0]! / cell);
    const gy = Math.floor(p[1]! / cell);
    const best = new Map<number, number>();
    const span = Math.min(6, Math.ceil(1 / Math.max(0.2, c)));
    for (let dx = -span; dx <= span; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const id of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          const { c: ci, a, b } = segs[id]!;
          const px = p[0]! * c * 111.32;
          const py = p[1]! * 110.57;
          const ax = a[0]! * c * 111.32;
          const ay = a[1]! * 110.57;
          const ddx = b[0]! * c * 111.32 - ax;
          const ddy = b[1]! * 110.57 - ay;
          const L = ddx * ddx + ddy * ddy;
          const t = L ? Math.max(0, Math.min(1, ((px - ax) * ddx + (py - ay) * ddy) / L)) : 0;
          const d = Math.hypot(px - ax - t * ddx, py - ay - t * ddy);
          if (d < (best.get(ci) ?? Infinity)) best.set(ci, d);
        }
    for (const [ci, d] of best) if (d <= tolKm) hits.set(ci, (hits.get(ci) ?? 0) + 1);
  }
  const top = [...hits].sort((x, y) => y[1] - x[1]).filter(([, n]) => n >= samples.length * 0.35);
  const names = top.slice(0, 2).map(([ci]) => countries[ci]!.name).sort();
  return names.length ? names.join(" / ") : "?";
}

/** Frontiers the committed reference (`src/frontier-reference.json`, see `--fixture`) requires to be COMPLETE in the dataset. */
export const PRESENT_PAIRS: readonly string[] = [
  "Canada / United States of America",
  "Mexico / United States of America",
  "Kazakhstan / Russia",
  "Argentina / Chile",
  "China / Mongolia",
  "China / Russia",
  "Mongolia / Russia",
  "Bolivia / Brazil",
  "Angola / Dem. Rep. Congo",
  "Bangladesh / India",
  "Dem. Rep. Congo / Zambia",
  "Norway / Sweden",
  "Mali / Mauritania",
  "France / Spain",
  "Germany / Poland",
  "Botswana / South Africa",
  // kept on OSM evidence although Natural Earth classes them as disputed / indefinite / line of control
  "Algeria / Morocco",
  "Ethiopia / Somalia",
  "North Korea / South Korea",
  "Israel / Palestine",
];

/** `n` points along the lines every `stepKm`, as a flat [lon, lat, ...] array rounded to 1/100 degree; `margin` km are skipped at both ends of each line. */
export function samplePoints(lines: number[][][], stepKm: number, margin = 0): number[] {
  const out: number[] = [];
  const put = (p: number[]) => out.push(Math.round(p[0]! * 100) / 100, Math.round(p[1]! * 100) / 100);
  for (const l of lines) {
    const cum = [0];
    for (let i = 1; i < l.length; i++) cum.push(cum[i - 1]! + Math.hypot((l[i]![0]! - l[i - 1]![0]!) * Math.cos((l[i]![1]! * Math.PI) / 180) * 111.32, (l[i]![1]! - l[i - 1]![1]!) * 110.57));
    const total = cum[cum.length - 1]!;
    if (total < 2) continue; // a sliver left by a cut: the encoder drops it
    const at = (d: number) => {
      let i = 1;
      while (i < cum.length - 1 && cum[i]! < d) i++;
      const t = cum[i]! > cum[i - 1]! ? (d - cum[i - 1]!) / (cum[i]! - cum[i - 1]!) : 0;
      return [l[i - 1]![0]! + t * (l[i]![0]! - l[i - 1]![0]!), l[i - 1]![1]! + t * (l[i]![1]! - l[i - 1]![1]!)];
    };
    if (total <= 2 * margin) put(at(total / 2));
    else for (let d = margin; d <= total - margin + 1e-9; d += stepKm) put(at(d));
    if (margin === 0) put(l[l.length - 1]!);
  }
  return out;
}
