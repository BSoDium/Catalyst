import { placeholderTiles } from "./view";

/** The container's aspect when it has no size yet (a long strip, or four staggered strips). */
export const defaultAspect = (strips: number) => (strips > 1 ? 0.8 : 3.97);

/**
 * The place-holder as SVG markup: the year's days as faint rounded square pits (darker than the page, with the soft inner shadow and the pale lip of the scene's own, lit from the top right) on the same slab, seen by the same camera as the scene, pulsing (not with `prefers-reduced-motion`). It fills its (positioned) parent, takes the parent's
 * text colour, and is the same string in the browser and on the server, so it can be in a prerendered page (React: `dangerouslySetInnerHTML`, or just use `ActivityGraphView`, which does it).
 */
export function placeholderMarkup({ weeks = 53, strips = 1, aspect, shifts, tallest, dark }: { weeks?: number; strips?: number; aspect?: number; shifts?: readonly number[]; tallest?: number; dark?: boolean }): string {
  const { viewBox, d } = placeholderTiles(weeks, strips, aspect ?? defaultAspect(strips), tallest, shifts);
  // (the scene's pits are lit by the sun from the top right, the floor as light as the page: a soft inner shadow along the top and right edges, as three thin slivers of falling strength (the square minus the square moved toward the bottom left by a little more each time):
  // plain fills and masks, no filter, so it is cheap; the offsets are shares of the picture's width, so they follow the tiles' size)
  const w = Number(viewBox.split(" ")[2]) || 100;
  const big = `<rect x="-1e5" y="-1e5" width="2e5" height="2e5" fill="#fff"/>`;
  const steps = [[0.0005, 0.07], [0.0010, 0.05], [0.0016, 0.035]] as const;
  const masks = steps.map(([o], n) => `<mask id="nag-sh${n}">${big}<use href="#nag-p" fill="#000" transform="translate(-${(w * o).toFixed(3)} ${(w * o).toFixed(3)})"/></mask>`).join("");
  const shadows = steps.map(([, a], n) => `<use href="#nag-p" fill="#000" fill-opacity="${a}" mask="url(#nag-sh${n})"/>`).join("");
  return (
    `<svg data-neon-placeholder aria-hidden="true" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;transition:opacity .4s ease">` +
    `<style>@keyframes nag-pulse{50%{opacity:.5}}.nag-pulse{animation:nag-pulse 2s ease-in-out infinite}.nag-tiles{opacity:0}@media (prefers-color-scheme:dark){.nag-tiles{opacity:1}}@media (prefers-reduced-motion:reduce){.nag-pulse{animation:none}}</style>` +
    `<defs><path id="nag-p" d="${d}"/>${masks}</defs>` +
    // (the dark theme's pits are dark on a dark page: their shading cannot be seen, so the tiles are faint grey squares there; `dark` is the theme when it is known, else the system's says)
    `<g class="nag-pulse"><use class="nag-tiles" href="#nag-p" fill="#fff" fill-opacity="0.05"${dark === undefined ? "" : ` style="opacity:${dark ? 1 : 0}"`}/>${shadows}</g></svg>`
  );
}

/** Puts the place-holder into `container` (browser only) and returns a function that fades it out and removes it. Follows the container's size. */
export function mountPlaceholder(container: HTMLElement, geometry: { weeks?: number; strips?: number; shifts?: readonly number[]; tallest?: number; dark?: boolean }): { fadeOut(): void; remove(): void; setGeometry(g: { shifts?: readonly number[]; tallest?: number }): void; setDark(dark: boolean | undefined): void } {
  let { weeks, strips = 1, shifts, tallest, dark } = geometry;
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  const holder = document.createElement("div");
  holder.style.cssText = "position:absolute;inset:0;pointer-events:none";
  const draw = () => {
    const aspect = container.clientWidth > 0 && container.clientHeight > 0 ? container.clientWidth / container.clientHeight : undefined;
    holder.innerHTML = placeholderMarkup({ weeks, strips, aspect, shifts, tallest, dark });
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
    setDark(d) {
      dark = d;
      if (!gone) draw();
    },
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
