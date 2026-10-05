/**
 * DOM overlay for place labels. One `<span>` per place, positioned with `transform` by `placeLabels`.
 *
 * Accessibility: the overlay is a visual duplicate of the place list (the accessible path), so the root is
 * `aria-hidden` (set by the component) and the labels are NOT focusable, avoiding extra tab stops and
 * duplicate announcements. They are also `pointer-events: none`; clicking a label goes through `hit()`, which
 * the canvas pointer handler consults, so that dragging over a label still rotates the globe and the touch hit
 * area can be enlarged without extra DOM.
 */
import type { ScreenPoint } from "./geo";
import { placeLabels, type LabelInput, type Placement } from "./labels";

export interface LabelItem {
  id: string;
  text: string;
  lon: number;
  lat: number;
  priority: number;
}

export interface Projector {
  project(lon: number, lat: number): ScreenPoint;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BASE_STYLE: Partial<CSSStyleDeclaration> = {
  position: "absolute",
  left: "0",
  top: "0",
  visibility: "hidden",
  opacity: "0",
  padding: "2px 5px",
  font: "12px/1.2 var(--font-mono)",
  letterSpacing: "0.01em",
  whiteSpace: "nowrap",
  background: "color-mix(in srgb, var(--background) 82%, transparent)",
  color: "var(--foreground)",
  pointerEvents: "none",
  userSelect: "none",
  willChange: "transform",
};

export class LabelLayer {
  private els = new Map<string, HTMLSpanElement>();
  private sizes = new Map<string, { w: number; h: number }>();
  private boxes = new Map<string, Box>();
  private lastTransform = new Map<string, string>();
  private previous = new Map<string, Placement>();
  private selectedId: string | null = null;
  private focusedId: string | null = null;
  private priorities = new Map<string, number>();

  constructor(
    private root: HTMLElement,
    private items: readonly LabelItem[],
    reducedMotion: boolean,
  ) {
    Object.assign(root.style, { position: "absolute", inset: "0", overflow: "hidden", pointerEvents: "none" });
    const frag = document.createDocumentFragment();
    for (const item of items) {
      const el = document.createElement("span");
      Object.assign(el.style, BASE_STYLE);
      el.textContent = item.text;
      this.els.set(item.id, el);
      this.priorities.set(item.id, item.priority);
      frag.append(el);
    }
    root.append(frag);
    this.setReducedMotion(reducedMotion);
    this.remeasure();
  }

  /** Re-measure label boxes (call after web fonts load). Does not change visibility. */
  remeasure() {
    for (const [id, el] of this.els) this.sizes.set(id, { w: el.offsetWidth, h: el.offsetHeight });
  }

  setReducedMotion(on: boolean) {
    const transition = on ? "none" : "opacity var(--duration-fast) linear";
    for (const el of this.els.values()) el.style.transition = transition;
  }

  setSelected(id: string | null) {
    this.selectedId = id;
    this.restyle();
  }

  setFocused(id: string | null) {
    this.focusedId = id;
    this.restyle();
  }

  private restyle() {
    for (const [id, el] of this.els) {
      const selected = id === this.selectedId;
      el.style.background = selected ? "var(--foreground)" : BASE_STYLE.background!;
      el.style.color = selected ? "var(--background)" : "var(--foreground)";
      el.style.boxShadow = id === this.focusedId && !selected ? "inset 0 0 0 1px var(--foreground)" : "none";
    }
  }

  /** Ids of the labels currently shown. */
  shown(): ReadonlySet<string> {
    return new Set(this.boxes.keys());
  }

  /**
   * The shown label under a CSS-px point, grown by `slop` px on every side (larger for touch).
   * The nearest label centre wins when boxes overlap.
   */
  hit(x: number, y: number, slop: number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const [id, b] of this.boxes) {
      if (x < b.x - slop || x > b.x + b.w + slop || y < b.y - slop || y > b.y + b.h + slop) continue;
      const d = Math.hypot(x - (b.x + b.w / 2), y - (b.y + b.h / 2));
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  /** Re-place every label. `minPriority` hides low-priority labels (zoom-dependent reveal). */
  update(projector: Projector, size: { width: number; height: number }, minPriority: number) {
    const inputs: LabelInput[] = this.items.map((it) => {
      const p = projector.project(it.lon, it.lat);
      const s = this.sizes.get(it.id) ?? { w: 60, h: 20 };
      const forced = it.id === this.selectedId || it.id === this.focusedId;
      return {
        id: it.id,
        x: p.x,
        y: p.y,
        width: s.w,
        height: s.h,
        priority: it.priority,
        visible: p.visible,
        facing: p.facing,
        forced,
      };
    });
    // Hidden-by-priority places still act as marker obstacles, so only the label is suppressed.
    const placed = placeLabels(inputs, {
      width: size.width,
      height: size.height,
      markerRadius: 6,
      gap: 9,
      previous: this.previous,
    }).filter((l) => l.id === this.selectedId || l.id === this.focusedId || (this.priorities.get(l.id) ?? 0) >= minPriority);

    const nextPlacements = new Map<string, Placement>();
    const nextBoxes = new Map<string, Box>();
    for (const l of placed) {
      const el = this.els.get(l.id)!;
      const s = this.sizes.get(l.id) ?? { w: 60, h: 20 };
      const t = `translate(${Math.round(l.x)}px, ${Math.round(l.y)}px)`;
      if (this.lastTransform.get(l.id) !== t) {
        el.style.transform = t;
        this.lastTransform.set(l.id, t);
      }
      if (!this.boxes.has(l.id)) {
        el.style.visibility = "visible";
        el.style.opacity = "1";
      }
      nextPlacements.set(l.id, l.placement);
      nextBoxes.set(l.id, { x: Math.round(l.x), y: Math.round(l.y), w: s.w, h: s.h });
    }
    for (const id of this.boxes.keys()) {
      if (nextBoxes.has(id)) continue;
      const el = this.els.get(id);
      if (el) {
        el.style.visibility = "hidden";
        el.style.opacity = "0";
      }
    }
    this.previous = nextPlacements;
    this.boxes = nextBoxes;
  }

  dispose() {
    for (const el of this.els.values()) el.remove();
    this.els.clear();
    this.boxes.clear();
  }
}
