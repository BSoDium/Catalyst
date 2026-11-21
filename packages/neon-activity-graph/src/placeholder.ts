import { placeholderTiles } from "./view";

/** The container's aspect when it has no size yet (a long strip, or four staggered strips). */
export const defaultAspect = (strips: number) => (strips > 1 ? 0.8 : 3.97);

/**
 * The place-holder as SVG markup: the year's days as faint rounded square pits (darker than the page, with the soft inner shadow and the pale lip of the scene's own, lit from the top right) on the same slab, seen by the same camera as the scene, pulsing (not with `prefers-reduced-motion`). It fills its (positioned) parent, takes the parent's
 * text colour, and is the same string in the browser and on the server, so it can be in a prerendered page (React: `dangerouslySetInnerHTML`, or just use `ActivityGraphView`, which does it).
 */
export function placeholderMarkup({ weeks = 53, strips = 1, aspect, shifts, tallest }: { weeks?: number; strips?: number; aspect?: number; shifts?: readonly number[]; tallest?: number }): string {
  const { viewBox, d } = placeholderTiles(weeks, strips, aspect ?? defaultAspect(strips), tallest, shifts);
  // (the scene's pits are lit by the sun from the top right: a soft inner shadow on the side that faces it, and a pale lip on the opposite, left edge; the offsets are shares of the picture's width, so they follow the tiles' size)
  const w = Number(viewBox.split(" ")[2]) || 100;
  const off = (w * 0.0016).toFixed(3);
  const blur = (w * 0.0012).toFixed(3);
  const filter =
    `<filter id="nag-pit" x="-2%" y="-2%" width="104%" height="104%" color-interpolation-filters="sRGB">` +
    `<feOffset in="SourceAlpha" dx="-${off}" dy="${off}" result="shift"/><feGaussianBlur in="shift" stdDeviation="${blur}" result="soft"/>` +
    `<feComposite in="SourceAlpha" in2="soft" operator="out" result="edge"/><feFlood flood-color="#000" flood-opacity="0.6"/><feComposite in2="edge" operator="in" result="inner"/>` +
    `<feOffset in="SourceAlpha" dx="-${off}" dy="0" result="left"/><feGaussianBlur in="left" stdDeviation="${blur}" result="lsoft"/>` +
    `<feComposite in="lsoft" in2="SourceAlpha" operator="out" result="lipEdge"/><feFlood class="nag-lip" flood-color="#fff"/><feComposite in2="lipEdge" operator="in" result="lip"/>` +
    `<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="inner"/><feMergeNode in="lip"/></feMerge></filter>`;
  return (
    `<svg data-neon-placeholder aria-hidden="true" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;transition:opacity .4s ease">` +
    `<style>@keyframes nag-pulse{50%{opacity:.5}}.nag-pulse{animation:nag-pulse 2s ease-in-out infinite}.nag-lip{flood-opacity:1}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .nag-lip{flood-opacity:.1}}:root[data-theme="dark"] .nag-lip{flood-opacity:.1}@media (prefers-reduced-motion:reduce){.nag-pulse{animation:none}}</style>` +
    `<defs>${filter}</defs>` +
    `<g class="nag-pulse"><path d="${d}" fill="#000" fill-opacity="0.2" filter="url(#nag-pit)"/></g></svg>`
  );
}

/** Puts the place-holder into `container` (browser only) and returns a function that fades it out and removes it. Follows the container's size. */
export function mountPlaceholder(container: HTMLElement, geometry: { weeks?: number; strips?: number; shifts?: readonly number[]; tallest?: number }): { fadeOut(): void; remove(): void; setGeometry(g: { shifts?: readonly number[]; tallest?: number }): void } {
  let { weeks, strips = 1, shifts, tallest } = geometry;
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  const holder = document.createElement("div");
  holder.style.cssText = "position:absolute;inset:0;pointer-events:none";
  const draw = () => {
    const aspect = container.clientWidth > 0 && container.clientHeight > 0 ? container.clientWidth / container.clientHeight : undefined;
    holder.innerHTML = placeholderMarkup({ weeks, strips, aspect, shifts, tallest });
  };
  draw();
  container.prepend(holder);
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(draw);
  ro?.observe(container);
  let timer = 0;
  let gone = false;
  const remove = () => {
    gone = true;
    window.clearTimeout(timer);
    ro?.disconnect();
    holder.remove();
  };
  return {
    setGeometry(g) {
      shifts = g.shifts;
      tallest = g.tallest;
      if (!gone) draw();
    },
    fadeOut() {
      gone = true;
      ro?.disconnect();
      const svg = holder.firstElementChild as SVGElement | null;
      if (svg) svg.style.opacity = "0";
      timer = window.setTimeout(remove, 450);
    },
    remove,
  };
}
