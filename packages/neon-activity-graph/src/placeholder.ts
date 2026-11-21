import { placeholderTiles } from "./view";

/** The container's aspect when it has no size yet (a long strip, or four staggered strips). */
export const defaultAspect = (strips: number) => (strips > 1 ? 0.8 : 3.97);

/**
 * The place-holder as SVG markup: the year's days as faint rounded square pits (darker than the page, with the soft inner shadow and the pale lip of the scene's own, lit from the top right) on the same slab, seen by the same camera as the scene, pulsing (not with `prefers-reduced-motion`). It fills its (positioned) parent, takes the parent's
 * text colour, and is the same string in the browser and on the server, so it can be in a prerendered page (React: `dangerouslySetInnerHTML`, or just use `ActivityGraphView`, which does it).
 */
export function placeholderMarkup({ weeks = 53, strips = 1, aspect, shifts, tallest }: { weeks?: number; strips?: number; aspect?: number; shifts?: readonly number[]; tallest?: number }): string {
  const { viewBox, d } = placeholderTiles(weeks, strips, aspect ?? defaultAspect(strips), tallest, shifts);
  // (the scene's pits are lit by the sun from the top right, the floor as light as the page: a thin inner shadow along the top and right edges (the square minus the square moved toward the bottom left) and a thin pale lip outside the left and lower edges (the square
  // moved toward the left, minus the square): plain fills and masks, no filter, so it is cheap; the offsets are shares of the picture's width, so they follow the tiles' size)
  const w = Number(viewBox.split(" ")[2]) || 100;
  const k = (w * 0.0009).toFixed(3);
  const kl = (w * 0.0007).toFixed(3);
  const big = `<rect x="-1e5" y="-1e5" width="2e5" height="2e5" fill="#fff"/>`;
  return (
    `<svg data-neon-placeholder aria-hidden="true" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;transition:opacity .4s ease">` +
    `<style>@keyframes nag-pulse{50%{opacity:.5}}.nag-pulse{animation:nag-pulse 2s ease-in-out infinite}.nag-lip{fill-opacity:.7}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .nag-lip{fill-opacity:.1}}:root[data-theme="dark"] .nag-lip{fill-opacity:.1}@media (prefers-reduced-motion:reduce){.nag-pulse{animation:none}}</style>` +
    `<defs><path id="nag-p" d="${d}"/>` +
    `<mask id="nag-sh">${big}<use href="#nag-p" fill="#000" transform="translate(-${k} ${k})"/></mask>` +
    `<mask id="nag-out">${big}<use href="#nag-p" fill="#000"/></mask></defs>` +
    `<g class="nag-pulse">` +
    `<g mask="url(#nag-out)"><use href="#nag-p" class="nag-lip" fill="#fff" transform="translate(-${kl} ${(Number(kl) * 0.5).toFixed(3)})"/></g>` +
    `<use href="#nag-p" fill="#000" fill-opacity="0.16" mask="url(#nag-sh)"/>` +
    `</g></svg>`
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
