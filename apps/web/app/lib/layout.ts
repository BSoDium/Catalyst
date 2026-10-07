/** Share of the viewport width the detail panel takes on desktop (`md:w-1/2` in detail-panel.tsx). */
const PANEL_FRACTION = 0.5;

/**
 * CSS px of the globe's box covered by the detail panel: half the viewport while the panel is open on desktop,
 * else 0 (the mobile slide-over unmounts the globe instead). Whole pixels, so the globe's centre shift is stable.
 */
export function panelInset(viewportWidth: number, open: boolean, isMobile: boolean): number {
  if (!open || isMobile || !Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0;
  return Math.round(viewportWidth * PANEL_FRACTION);
}
