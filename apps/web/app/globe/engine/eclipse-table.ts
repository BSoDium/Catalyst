/**
 * The real eclipses (#633): NASA's catalogues of 2025 to 2045, baked into `eclipses.json` (apps/web/scripts/moon/bake-eclipses.py, public/media/eclipses.NOTICE.txt). Pure: the caller gives the time.
 * The HUD says which is next; the session's orbit is lined up with the sun only around a real eclipse (`eclipseNear`), not by a coin flip.
 */
import table from "./eclipses.json";

export type LunarKind = "N" | "P" | "T";
export type SolarKind = "P" | "A" | "T" | "H";
export interface RealEclipse<K extends string> {
  /** Epoch milliseconds (UTC) of the greatest eclipse. */
  ms: number;
  kind: K;
  magnitude: number;
}

const make = <K extends string>(rows: readonly (readonly [number, string, number])[]): RealEclipse<K>[] => rows.map(([t, kind, magnitude]) => ({ ms: t * 1000, kind: kind as K, magnitude }));

export const LUNAR_ECLIPSES = make<LunarKind>(table.lunar as [number, string, number][]);
export const SOLAR_ECLIPSES = make<SolarKind>(table.solar as [number, string, number][]);
/** The years the table covers, first and last. */
export const ECLIPSE_YEARS = table.range as [number, number];

export const LUNAR_NAMES: Record<LunarKind, string> = { N: "PENUMBRAL", P: "PARTIAL", T: "TOTAL" };
export const SOLAR_NAMES: Record<SolarKind, string> = { P: "PARTIAL", A: "ANNULAR", T: "TOTAL", H: "HYBRID" };

/** The first eclipse of `list` at or after `ms`, or null past the table's end. */
export function nextOf<K extends string>(list: readonly RealEclipse<K>[], ms: number): RealEclipse<K> | null {
  return list.find((e) => e.ms >= ms) ?? null;
}

/** Whether `ms` is within `days` of a real eclipse, lunar or solar (before or after). */
export function eclipseNear(ms: number, days: number): boolean {
  const span = days * 86_400_000;
  return [...LUNAR_ECLIPSES, ...SOLAR_ECLIPSES].some((e) => Math.abs(e.ms - ms) <= span);
}

/** The HUD's two lines: `REAL NEXT LUNAR ECLIPSE 2026-08-28 PARTIAL`; past the table's end, "BEYOND TABLE". */
export function eclipseLines(ms: number): string[] {
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const l = nextOf(LUNAR_ECLIPSES, ms);
  const s = nextOf(SOLAR_ECLIPSES, ms);
  return [`REAL NEXT LUNAR ECLIPSE ${l ? `${day(l.ms)} ${LUNAR_NAMES[l.kind]}` : `BEYOND ${ECLIPSE_YEARS[1]}`}`, `REAL NEXT SOLAR ECLIPSE ${s ? `${day(s.ms)} ${SOLAR_NAMES[s.kind]}` : `BEYOND ${ECLIPSE_YEARS[1]}`}`];
}
