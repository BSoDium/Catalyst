/**
 * The annotation language of the UI system as pure formatters (docs/design-system.md, "Micro-labels"): index numbers, entry
 * codes, coordinates, timestamps and status brackets. Text only; the case and tracking are CSS (`.ds-micro`).
 * Every function is total: a bad input gives a visibly empty placeholder, never a throw or "NaN".
 */
import { ENTRY_KIND_LABEL, type EntryKind } from "./entry-kind";

/** `42` -> `0042`. Whole numbers only (fractions are floored), never negative, never truncated when wider than `width`. */
export function formatIndex(n: number, width = 4): string {
  const whole = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return String(whole).padStart(Math.max(1, Math.floor(width)), "0");
}

/** `("article", 42)` -> `ARTICLE / 0042`. */
export function entryCode(kind: EntryKind, index: number, width = 4): string {
  return `${ENTRY_KIND_LABEL[kind].toUpperCase()} / ${formatIndex(index, width)}`;
}

const EMPTY_COORD = "--.---- / --.----";

/** `(10.7769, 106.7009)` -> `10.7769° N / 106.7009° E`. Out-of-range or non-finite input gives the placeholder. */
export function formatCoordinates(lat: number, lon: number, digits = 4): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return EMPTY_COORD;
  const d = Math.min(8, Math.max(0, Math.floor(digits)));
  const part = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(d)}° ${v < 0 ? neg : pos}`;
  return `${part(lat, "N", "S")} / ${part(lon, "E", "W")}`;
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

/** `published` -> `PUBLISHED`; the brackets are drawn around it by `StatusTag`. Plain text for logs and tests: `[ PUBLISHED ]`. */
export function statusText(status: Status | string): string {
  return status.trim().toUpperCase();
}

export function statusBracket(status: Status | string): string {
  return `[ ${statusText(status)} ]`;
}

/** Joins non-empty parts with the slash separator of the annotation language: `["A", "", "B"]` -> `A / B`. */
export function slashJoin(parts: readonly (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" / ");
}
