import type { HoverInfo } from "./types";

/** SVG path data for the `outline` points of a hover (`"x,y x,y ..."`, CSS pixels of the container). */
export function outlinePath(outline: string): string {
  const pts = outline.trim().split(/\s+/).filter(Boolean);
  return pts.length ? `M${pts.join("L").replaceAll(",", " ")}Z` : "";
}

/** "Thu 19 Nov 2026" for an ISO date, read in UTC (the date has no time of day). */
export function formatDay(date: string, locale?: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Where a card hangs on a day: centred on the top of its column, above it (below it when there is no room above), kept `margin` px inside the box horizontally. Returns the card's top-left corner (CSS pixels of the box).
 */
export function cardPosition(info: Pick<HoverInfo, "x" | "y">, box: { width: number; height: number }, card: { width: number; height: number }, gap = 14, margin = 8): { x: number; y: number; below: boolean } {
  const half = card.width / 2;
  const x = box.width > card.width + 2 * margin ? Math.min(Math.max(info.x, half + margin), box.width - half - margin) : box.width / 2;
  const below = info.y - card.height - gap < 0;
  return { x: x - half, y: below ? info.y + gap : info.y - card.height - gap, below };
}

/** A number as the card shows it: whole numbers plainly, others with one decimal. */
export function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
