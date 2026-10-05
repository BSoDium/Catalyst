/**
 * Pure maths for the right-hand inset (`GlobeProps.insetRight`): UI (the detail panel) covers the right strip of
 * the globe's box, so the globe is centred on the free area to its left instead of on the box.
 *
 * Everything is in CSS px of the container unless it says "Buf" (drawing-buffer pixels, one art pixel each).
 * The projection centre is shifted by a WHOLE number of buffer pixels so markers, labels and picking (which all
 * snap to the art pixel grid) agree with what the GPU draws.
 */
import { clamp } from "./geo";

/** The strip may never cover more than this fraction of the box (the free area keeps a usable width). */
const MAX_INSET_FRACTION = 0.85;

/** Inset limited to what makes sense for a box of `width` px. */
export function clampInset(inset: number, width: number): number {
  return clamp(Number.isFinite(inset) ? inset : 0, 0, width * MAX_INSET_FRACTION);
}

/** Width of the free area (left of the covered strip). */
export function freeWidth(width: number, inset: number): number {
  return width - clampInset(inset, width);
}

/** How far the projection centre moves left of the box centre, in whole buffer pixels (half the inset). */
export function insetShiftBuf(inset: number, pixel: number): number {
  return Math.round(inset / 2 / pixel);
}

/** Extra width beyond the free area that is still drawn, so the map seems to continue under the panel. */
export function renderMargin(width: number): number {
  return clamp(width * 0.1, 96, 240);
}

export interface FadeZone {
  /** Fully opaque up to here (container x, CSS px). */
  start: number;
  /** Fully transparent from here on; nothing is drawn beyond it. */
  end: number;
}

/**
 * Where the right edge of the map dissolves. It is anchored on the panel's left edge: it starts a little before
 * it and ends one margin beyond it. The zone grows with the inset (it is a point at inset 0), so the edge is
 * continuous while the panel slides in or out.
 */
export function fadeZone(width: number, inset: number): FadeZone {
  const i = clampInset(inset, width);
  const edge = width - i;
  const margin = renderMargin(width);
  const k = clamp(i / (2 * margin), 0, 1);
  return { start: edge - 0.4 * margin * k, end: edge + margin * k };
}

/** `mask-image` value that dissolves the right edge, shifted by `offset` px (the canvas is offset in its box). */
export function fadeMask(width: number, inset: number, offset = 0): string | null {
  if (clampInset(inset, width) <= 0) return null;
  const z = fadeZone(width, inset);
  const at = (x: number) => `${(x - offset).toFixed(1)}px`;
  const mid = (z.start + z.end) / 2;
  // Three stops with an eased middle: a plain two-stop ramp shows a visible kink where it starts.
  return `linear-gradient(to right, #000 ${at(z.start)}, rgb(0 0 0 / 0.55) ${at(mid)}, rgb(0 0 0 / 0.15) ${at(
    z.start + (z.end - z.start) * 0.78,
  )}, transparent ${at(z.end)})`;
}
