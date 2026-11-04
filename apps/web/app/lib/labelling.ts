/**
 * The few formatters of figures and statuses the UI needs (docs/design-system.md, "Type"): coordinates, a date stamp, a status word.
 * Text only; the face is CSS. Every function is total: a bad input gives a visibly empty placeholder, never a throw or "NaN".
 * (Index numbers and entry codes such as `ARTICLE / 0042` are not shown any more: a list is ordered by its dates.)
 */
const EMPTY_COORD = "--.---- / --.----";

/** `(10.7769, 106.7009)` -> `10.7769° N / 106.7009° E`. Out-of-range or non-finite input gives the placeholder. */
export function formatCoordinates(lat: number, lon: number, digits = 4): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return EMPTY_COORD;
  const d = Math.min(8, Math.max(0, Math.floor(digits)));
  const part = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(d)}° ${v < 0 ? neg : pos}`;
  return `${part(lat, "N", "S")} / ${part(lon, "E", "W")}`;
}

/** How many decimals a number is written with (`48.85` -> 2, `2` -> 0, `1e-7` -> 7), capped at 6 (a decimetre); not finite -> 0. */
export function decimalsOf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const text = String(value);
  const exp = /e-(\d+)$/i.exec(text);
  const mantissa = text.replace(/e.*$/i, "").split(".")[1]?.length ?? 0;
  return Math.min(6, exp ? mantissa + Number(exp[1]) : mantissa);
}

/**
 * A place's coordinates at the precision they are stored with, never more: `(48.85, 2.35)` -> `48.85° N, 2.35° E`, `(48.8566, 2.3522)` ->
 * `48.8566° N, 2.3522° E`. Each value keeps its own number of decimals (a stored `48.85` is not `48.8500`: that would claim a metre
 * of precision it does not have). Out-of-range or non-finite input gives the placeholder.
 */
export function formatPlaceCoordinates(lat: number, lon: number): string {
  const parts = placeCoordinateParts(lat, lon);
  return parts ? `${parts[0].text}, ${parts[1].text}` : EMPTY_COORD;
}

/** One coordinate cut for typesetting: `52.23° N` is `{ whole: "52", fraction: ".23", hemisphere: "N" }`, `text` the same written out. */
export interface CoordinatePart {
  whole: string;
  fraction: string;
  hemisphere: string;
  text: string;
}

/** The two coordinates of a place as `formatPlaceCoordinates` writes them (the same decimals), in parts the panel can set in different weights; null when out of range or not finite. */
export function placeCoordinateParts(lat: number, lon: number): [CoordinatePart, CoordinatePart] | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const part = (v: number, pos: string, neg: string): CoordinatePart => {
    const [whole = "0", fraction = ""] = Math.abs(v).toFixed(decimalsOf(v)).split(".");
    const hemisphere = v < 0 ? neg : pos;
    return { whole, fraction: fraction ? `.${fraction}` : "", hemisphere, text: `${whole}${fraction ? `.${fraction}` : ""}° ${hemisphere}` };
  };
  return [part(lat, "N", "S"), part(lon, "E", "W")];
}

/** An ISO date or `Date` -> `2026.10.08` (UTC, so the server and the browser agree). Invalid input gives `----.--.--`. */
export function formatStamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "----.--.--";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}`;
}

export const STATUSES = ["published", "draft", "live", "archived", "pending", "error"] as const;
export type Status = (typeof STATUSES)[number];

/** `PUBLISHED` or ` draft ` -> `Published` / `Draft`: the status as a plain word (first letter up, the rest down). */
export function statusLabel(status: Status | string): string {
  const word = status.trim().toLowerCase();
  return word.charAt(0).toUpperCase() + word.slice(1);
}
