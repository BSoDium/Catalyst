import { cardPosition, formatDay, formatValue, outlinePath } from "./overlay-math";
import type { HoverInfo } from "./types";

export interface OverlayOptions {
  /** Draw the outline of the day's blocks (default true). */
  outline?: boolean;
  /** The day card: `true` for the default one, `false` for none, or a function that returns its content (text or a node). */
  card?: boolean | ((info: HoverInfo) => string | Node);
  /** Locale of the default card's date. */
  locale?: string;
}

export interface HoverOverlay {
  update(info: HoverInfo | null): void;
  destroy(): void;
}

/**
 * The day under the pointer: an outline round its blocks (an SVG path over the picture) and a card hung on its column, both inside `container`, styled through CSS variables (set them on the container or above it):
 * `--nag-outline` (stroke, default the text colour), `--nag-outline-fill`, `--nag-card-bg`, `--nag-card-fg`, `--nag-card-muted`, `--nag-top` and `--nag-bottom` (the two layers' colours in the card), `--nag-card-radius`.
 * `labels` names the two layers in the default card. Days behind one another (the pointer is on several) show "2 of 3, click for next".
 */
export function createHoverOverlay(container: HTMLElement, options: OverlayOptions = {}, labels: () => { top?: { label?: string; unit?: string }; bottom?: { label?: string; unit?: string } } = () => ({})): HoverOverlay {
  const { outline = true, card = true, locale } = options;
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  const root = document.createElement("div");
  root.className = "nag-overlay";
  root.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2";
  root.innerHTML = `<style>
.nag-overlay{--nag-top-default:#0a8f2c;--nag-bottom-default:#1a6fe0}
@media (prefers-color-scheme:dark){.nag-overlay{--nag-top-default:#3ddc6a;--nag-bottom-default:#5aa9ff}}
.nag-outline{fill:var(--nag-outline-fill,color-mix(in srgb,currentColor 7%,transparent));stroke:var(--nag-outline,currentColor);stroke-width:1.5;stroke-linejoin:round}
.nag-card{position:absolute;left:0;top:0;padding:10px 14px;min-width:9.5em;border-radius:var(--nag-card-radius,12px);color:var(--nag-card-fg,inherit);font:13px/1.35 system-ui,sans-serif;white-space:nowrap;background:var(--nag-card-bg,color-mix(in srgb,Canvas 70%,transparent));-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 11%,transparent),0 14px 44px -12px rgb(0 0 0/.38),0 2px 10px -4px rgb(0 0 0/.22);transition:opacity .16s,transform .3s cubic-bezier(.2,.7,.2,1)}
.nag-card .nag-day{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--nag-card-muted,color-mix(in srgb,currentColor 60%,transparent))}
.nag-card .nag-figs{display:flex;gap:22px;margin-top:8px}
.nag-card .nag-v{font-size:26px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
.nag-card .nag-l{margin-top:4px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--nag-card-muted,color-mix(in srgb,currentColor 60%,transparent))}
.nag-card .nag-top{color:var(--nag-top,var(--nag-top-default))}.nag-card .nag-bottom{color:var(--nag-bottom,var(--nag-bottom-default))}
.nag-card .nag-behind{margin-top:10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--nag-card-muted,color-mix(in srgb,currentColor 60%,transparent))}
@media (prefers-reduced-motion:reduce){.nag-card{transition:opacity .16s}}
</style>`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:visible;opacity:0;transition:opacity .12s";
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("class", "nag-outline");
  svg.append(path);
  if (outline) root.append(svg);
  const cardEl = document.createElement("div");
  cardEl.className = "nag-card";
  cardEl.style.opacity = "0";
  if (card) root.append(cardEl);
  const live = document.createElement("p");
  live.setAttribute("aria-live", "polite");
  live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;margin:0";
  root.append(live);
  container.append(root);

  const fill = (info: HoverInfo) => {
    if (typeof card === "function") {
      const c = card(info);
      return void (typeof c === "string" ? (cardEl.textContent = c) : cardEl.replaceChildren(c));
    }
    const l = labels();
    const fig = (cls: string, v: number, name: string | undefined, unit: string | undefined) => `<div class="${cls}"><div class="nag-v">${formatValue(v)}${unit && unit.length <= 2 ? `<span style="font-size:13px;font-weight:400"> ${unit}</span>` : ""}</div><div class="nag-l">${name ?? ""}</div></div>`;
    const esc = (s: string | undefined) => (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    cardEl.innerHTML = `<div class="nag-day">${esc(formatDay(info.date, locale))}</div><div class="nag-figs">${fig("nag-top", info.top, esc(l.top?.label), l.top?.unit)}${fig("nag-bottom", info.bottom, esc(l.bottom?.label), l.bottom?.unit)}</div>${info.behind && info.behind.count > 1 ? `<div class="nag-behind">${info.behind.index + 1} of ${info.behind.count} · click for next</div>` : ""}`;
  };
  let seen = false;
  return {
    update(info) {
      if (!info) {
        svg.style.opacity = "0";
        cardEl.style.opacity = "0";
        live.textContent = "";
        return;
      }
      path.setAttribute("d", outlinePath(info.outline));
      svg.style.opacity = "1";
      if (card) {
        fill(info);
        const p = cardPosition(info, { width: container.clientWidth, height: container.clientHeight }, { width: cardEl.offsetWidth, height: cardEl.offsetHeight });
        // (the card appears in place when it comes from nothing, and glides from one day to the next)
        if (!seen) cardEl.style.transition = "opacity .16s";
        cardEl.style.transform = `translate(${p.x}px, ${p.y}px)`;
        cardEl.style.opacity = "1";
        if (!seen) requestAnimationFrame(() => (cardEl.style.transition = ""));
        seen = true;
      }
      live.textContent = `${formatDay(info.date, locale)}: ${formatValue(info.top)} and ${formatValue(info.bottom)}`;
    },
    destroy() {
      root.remove();
    },
  };
}
