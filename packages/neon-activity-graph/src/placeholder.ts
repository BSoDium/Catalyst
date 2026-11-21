import { placeholderTiles } from "./view";

/** The container's aspect when it has no size yet (a long strip, or four staggered strips). */
export const defaultAspect = (strips: number) => (strips > 1 ? 0.8 : 3.97);

/**
 * The place-holder as SVG markup: the year's days as faint flat squares on the same slab, seen by the same camera as the scene, pulsing (not with `prefers-reduced-motion`). It fills its (positioned) parent, takes the parent's
 * text colour, and is the same string in the browser and on the server, so it can be in a prerendered page (React: `dangerouslySetInnerHTML`, or just use `ActivityGraphView`, which does it).
 */
export function placeholderMarkup({ weeks = 53, strips = 1, aspect }: { weeks?: number; strips?: number; aspect?: number }): string {
  const { viewBox, d } = placeholderTiles(weeks, strips, aspect ?? defaultAspect(strips));
  return (
    `<svg data-neon-placeholder aria-hidden="true" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;transition:opacity .4s ease">` +
    `<style>@keyframes nag-pulse{50%{opacity:.5}}.nag-pulse{animation:nag-pulse 2s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.nag-pulse{animation:none}}</style>` +
    `<g class="nag-pulse"><path d="${d}" fill="currentColor" opacity="0.07"/></g></svg>`
  );
}

/** Puts the place-holder into `container` (browser only) and returns a function that fades it out and removes it. Follows the container's size. */
export function mountPlaceholder(container: HTMLElement, { weeks, strips = 1 }: { weeks?: number; strips?: number }): { fadeOut(): void; remove(): void } {
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  const holder = document.createElement("div");
  holder.style.cssText = "position:absolute;inset:0;pointer-events:none";
  const draw = () => {
    const aspect = container.clientWidth > 0 && container.clientHeight > 0 ? container.clientWidth / container.clientHeight : undefined;
    holder.innerHTML = placeholderMarkup({ weeks, strips, aspect });
  };
  draw();
  container.prepend(holder);
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(draw);
  ro?.observe(container);
  let timer = 0;
  const remove = () => {
    window.clearTimeout(timer);
    ro?.disconnect();
    holder.remove();
  };
  return {
    fadeOut() {
      ro?.disconnect();
      const svg = holder.firstElementChild as SVGElement | null;
      if (svg) svg.style.opacity = "0";
      timer = window.setTimeout(remove, 450);
    },
    remove,
  };
}
