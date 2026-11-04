/**
 * How a leg is drawn, by travel mode. One table for both renderers, in ART PIXELS (cells): the globe's buffer pixel and the
 * street map's art cell are the same unit, so a pattern reads the same at the hand-over.
 *
 *   road     solid, one cell
 *   rail     solid, one cell (as a road: its picture, the badge on the leg, tells them apart)
 *   ferry    dotted 1.5 on / 2.5 off
 *   flight   dotted 1.5 on / 3.5 off, and lifted above the surface (an arc) on the globe
 *   walk     fine dots 1.5 on / 1.5 off
 *   unknown  the dashed arc of the curated routes (the original look: 4 on / 3 off)
 *
 * A "dot" is 1.5 cells, not 1: docs/pixel-line-rules.md (3.12 c) measured that a dash shorter than 1.42 line widths breaks at
 * some angles and offsets under the pixel pass. The globe draws the same lengths so both sides keep the one pattern.
 */
export const LEG_MODES = ["road", "rail", "ferry", "flight", "walk", "unknown"] as const;
export type LegMode = (typeof LEG_MODES)[number];

export interface ModeStyle {
  /** Index in `LEG_MODES`, the value written to the GPU buffers. */
  id: number;
  /** Length of the whole pattern, cells. 0: solid. */
  period: number;
  /** Cells inked in each period. */
  on: number;
}

export const MODE_STYLE: Record<LegMode, ModeStyle> = {
  road: { id: 0, period: 0, on: 0 },
  rail: { id: 1, period: 0, on: 0 },
  ferry: { id: 2, period: 4, on: 1.5 },
  flight: { id: 3, period: 5, on: 1.5 },
  walk: { id: 4, period: 3, on: 1.5 },
  unknown: { id: 5, period: 7, on: 4 },
};

/**
 * The patterns written CELL BY CELL on the street map (paths/trail-dots.ts): whole cells along the path, so a dot is exactly one art pixel at
 * every angle and zoom. Same periods as `MODE_STYLE` (the globe draws those in its own buffer); an `on` of 1 is a dot.
 */
export const CELL_PATTERN: Record<LegMode, { period: number; on: number } | null> = {
  road: null,
  rail: null,
  ferry: { period: 4, on: 1 },
  flight: { period: 5, on: 1 },
  walk: { period: 3, on: 1 },
  unknown: { period: 7, on: 4 },
};

/** MapLibre `line-dasharray` (in line widths = cells for a 1-cell line) of a mode, or undefined when it is solid. */
export function dashArray(mode: LegMode): [number, number] | undefined {
  const s = MODE_STYLE[mode];
  return s.period === 0 ? undefined : [s.on, s.period - s.on];
}

export function isLegMode(v: unknown): v is LegMode {
  return typeof v === "string" && (LEG_MODES as readonly string[]).includes(v);
}
