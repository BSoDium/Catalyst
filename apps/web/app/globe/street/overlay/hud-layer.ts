/**
 * HTML overlay for places: boxed mono labels with a 1 px leader line and square markers snapped to the art grid, in
 * the HUD style of the spike. The pass never sees text; this layer reads the same projection as the map, so it stays
 * aligned during flights because it is updated from the map's own `render` event.
 *
 * Accessibility (the globe's rule): the root is `aria-hidden`, nothing here has a tab stop or a role. The accessible
 * place list (`PlacesNav`) remains the dependable path; this layer is a visual duplicate plus pointer input.
 * The root is `pointer-events: none`; clicks reach it through `hit()`, consulted by the engine on a map click, so a
 * drag that starts on a label still pans and the touch target can be larger than the label.
 *
 * Markers are drawn WHOLE or not at all (core/marker-visibility.ts); labels are placed by priority around them
 * (core/label-place.ts); selected and focused places are always shown.
 */
import { labelPriorityFloor, placeLabels, snapToCell, type Candidate, type Placed, type Side } from "../core/label-place";
import { markerDrawn, type MarkerViewport } from "../core/marker-visibility";
import type { MapView } from "../core/registration";
import { STREET_TUNING } from "../tuning";

export interface HudPlace {
  slug: string;
  name: string;
  lat: number;
  lon: number;
  labelPriority: number;
}

export interface HudFrame {
  view: MapView;
  width: number;
  height: number;
  centreX: number;
  cellCss: number;
  /** Projects lon/lat to CSS px in the container (the map's own projection, padding included). */
  project(lon: number, lat: number): { x: number; y: number };
}

interface Item {
  place: HudPlace;
  marker: HTMLDivElement;
  box: HTMLDivElement;
  line: SVGLineElement;
  w: number;
  h: number;
  /** Snapped marker centre when drawn. */
  at: { x: number; y: number } | null;
  size: number;
  labelBox: { x: number; y: number; w: number; h: number } | null;
  transform: string;
  markerTransform: string;
}

const BOX_STYLE: Partial<CSSStyleDeclaration> = {
  position: "absolute",
  left: "0",
  top: "0",
  visibility: "hidden",
  opacity: "0",
  whiteSpace: "nowrap",
  margin: "0",
  padding: "1px 5px 2px",
  font: "11px/1.25 var(--font-mono, ui-monospace, Menlo, monospace)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  background: "var(--background)",
  color: "var(--foreground)",
  border: "1px solid var(--foreground)",
  pointerEvents: "none",
  userSelect: "none",
  willChange: "transform",
};

export class HudLayer {
  private items = new Map<string, Item>();
  private svg: SVGSVGElement;
  private previous = new Map<string, Side>();
  private selectedId: string | null = null;
  private focusedId: string | null = null;
  private cellCss = 3;
  private reduced: boolean;
  private lastFrame: HudFrame | null = null;
  private lastMinPriority = 0;

  constructor(
    private root: HTMLElement,
    places: readonly HudPlace[],
    reducedMotion: boolean,
  ) {
    this.reduced = reducedMotion;
    Object.assign(root.style, { position: "absolute", inset: "0", overflow: "hidden", pointerEvents: "none" } satisfies Partial<CSSStyleDeclaration>);
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("width", "100%");
    this.svg.setAttribute("height", "100%");
    Object.assign(this.svg.style, { position: "absolute", inset: "0", overflow: "visible", pointerEvents: "none" } satisfies Partial<CSSStyleDeclaration>);
    root.appendChild(this.svg);
    for (const place of places) {
      const marker = document.createElement("div");
      Object.assign(marker.style, {
        position: "absolute",
        left: "0",
        top: "0",
        visibility: "hidden",
        pointerEvents: "none",
        willChange: "transform",
        boxSizing: "border-box",
      } satisfies Partial<CSSStyleDeclaration>);
      const box = document.createElement("div");
      Object.assign(box.style, BOX_STYLE);
      box.textContent = place.name;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("stroke", "var(--foreground)");
      line.setAttribute("stroke-width", "1");
      line.setAttribute("shape-rendering", "crispEdges");
      line.style.visibility = "hidden";
      root.appendChild(marker);
      root.appendChild(box);
      this.svg.appendChild(line);
      this.items.set(place.slug, { place, marker, box, line, w: 80, h: 18, at: null, size: STREET_TUNING.markerCells.normal, labelBox: null, transform: "", markerTransform: "" });
    }
    this.setReducedMotion(reducedMotion);
    this.remeasure();
    this.restyle();
  }

  /** Measure label boxes (call at start and after web fonts load). */
  remeasure(): void {
    for (const it of this.items.values()) {
      it.w = it.box.offsetWidth || it.w;
      it.h = it.box.offsetHeight || it.h;
    }
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    const transition = on ? "none" : "opacity var(--duration-fast, 120ms) linear";
    for (const it of this.items.values()) it.box.style.transition = transition;
  }

  setSelected(slug: string | null): void {
    this.selectedId = slug;
    this.restyle();
  }

  setFocused(slug: string | null): void {
    this.focusedId = slug;
    this.restyle();
  }

  setCell(cellCss: number): void {
    if (cellCss === this.cellCss) return;
    this.cellCss = cellCss;
    this.restyle();
  }

  private sizeOf(slug: string): number {
    const m = STREET_TUNING.markerCells;
    return slug === this.selectedId ? m.selected : slug === this.focusedId ? m.focused : m.normal;
  }

  private restyle(): void {
    const c = this.cellCss;
    for (const [slug, it] of this.items) {
      const selected = slug === this.selectedId;
      const focused = slug === this.focusedId && !selected;
      it.size = this.sizeOf(slug);
      const px = it.size * c;
      const ring = selected || focused;
      Object.assign(it.marker.style, {
        width: `${px}px`,
        height: `${px}px`,
        background: ring ? "linear-gradient(var(--foreground), var(--foreground)) center / " + 3 * c + "px " + 3 * c + "px no-repeat" : "var(--foreground)",
        border: ring ? `${c}px solid var(--foreground)` : "0",
      } satisfies Partial<CSSStyleDeclaration>);
      const strong = selected || focused;
      Object.assign(it.box.style, {
        background: selected ? "var(--foreground)" : "var(--background)",
        color: selected ? "var(--background)" : strong ? "var(--foreground)" : "var(--muted-foreground, var(--foreground))",
        border: strong ? "1px solid var(--foreground)" : "1px dotted var(--border-strong, var(--foreground))",
        textTransform: strong ? "uppercase" : "none",
        letterSpacing: strong ? "0.06em" : "0.02em",
      } satisfies Partial<CSSStyleDeclaration>);
      it.box.setAttribute("data-state", selected ? "selected" : focused ? "focused" : "");
    }
    this.remeasure();
    // sizes changed: re-place on the next frame
    if (this.lastFrame) this.update(this.lastFrame, this.lastMinPriority);
  }

  /** Slugs of the shown markers and labels (debug and tests). */
  shown(): { markers: string[]; labels: string[] } {
    const markers: string[] = [];
    const labels: string[] = [];
    for (const [slug, it] of this.items) {
      if (it.at) markers.push(slug);
      if (it.labelBox) labels.push(slug);
    }
    return { markers, labels };
  }

  /** Snapped marker centre of a place if it is drawn (CSS px in the container). */
  markerAt(slug: string): { x: number; y: number } | null {
    return this.items.get(slug)?.at ?? null;
  }

  /**
   * The place under a CSS-px point. Markers win within the pick radius of the pointer type; labels are grown by the
   * label slop. The nearest wins when several are in reach.
   */
  hit(x: number, y: number, kind: "mouse" | "touch"): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    const R = STREET_TUNING.pickRadius[kind];
    const slop = STREET_TUNING.labelSlop[kind];
    for (const [slug, it] of this.items) {
      if (it.at) {
        const d = Math.hypot(x - it.at.x, y - it.at.y);
        if (d <= R && d < bestD) {
          bestD = d;
          best = slug;
        }
      }
      const b = it.labelBox;
      if (b && x >= b.x - slop && x <= b.x + b.w + slop && y >= b.y - slop && y <= b.y + b.h + slop) {
        const d = Math.hypot(x - (b.x + b.w / 2), y - (b.y + b.h / 2));
        if (d < bestD) {
          bestD = d;
          best = slug;
        }
      }
    }
    return best;
  }

  /** Re-place everything for the current camera. `minPriority` hides low-priority labels (zoom-dependent reveal). */
  update(frame: HudFrame, minPriority: number): void {
    this.lastFrame = frame;
    this.lastMinPriority = minPriority;
    const vp: MarkerViewport = { width: frame.width, height: frame.height, centreX: frame.centreX };
    const cands: Candidate[] = [];
    for (const [slug, it] of this.items) {
      const p = frame.project(it.place.lon, it.place.lat);
      const snapped = { x: snapToCell(p.x, frame.cellCss), y: snapToCell(p.y, frame.cellCss) };
      it.size = this.sizeOf(slug);
      const forced = slug === this.selectedId || slug === this.focusedId;
      const drawn = Number.isFinite(p.x) && markerDrawn(it.place, snapped, it.size, frame.view, vp, frame.cellCss);
      it.at = drawn ? snapped : null;
      if (drawn && (forced || it.place.labelPriority >= minPriority)) {
        cands.push({ id: slug, x: snapped.x, y: snapped.y, w: it.w, h: it.h, priority: it.place.labelPriority, forced });
      }
    }
    // Markers that are drawn but whose label is suppressed by priority still count as obstacles.
    const labelled = new Set(cands.map((c) => c.id));
    const obstacles: { id: string; x: number; y: number }[] = [];
    for (const [slug, it] of this.items) if (it.at && !labelled.has(slug)) obstacles.push({ id: slug, x: it.at.x, y: it.at.y });
    const placed = placeLabels(cands, { w: frame.width, h: frame.height }, {
      previous: this.previous,
      markerHalf: (STREET_TUNING.markerCells.normal * frame.cellCss) / 2 + 2,
      gap: Math.round(22 / frame.cellCss) * frame.cellCss,
      obstacles,
    });
    this.apply(frame, placed);
  }

  private apply(frame: HudFrame, placed: Placed[]): void {
    const byId = new Map(placed.map((p) => [p.id, p]));
    const nextPrev = new Map<string, Side>();
    for (const [slug, it] of this.items) {
      const at = it.at;
      if (!at) {
        it.marker.style.visibility = "hidden";
        this.hideLabel(it);
        continue;
      }
      const half = (it.size * frame.cellCss) / 2;
      const mt = `translate(${at.x - half}px, ${at.y - half}px)`;
      if (mt !== it.markerTransform) {
        it.marker.style.transform = mt;
        it.markerTransform = mt;
      }
      it.marker.style.visibility = "visible";
      const pl = byId.get(slug);
      if (!pl) {
        this.hideLabel(it);
        continue;
      }
      nextPrev.set(slug, pl.side);
      const left = Math.round(pl.left);
      const top = Math.round(pl.top);
      const t = `translate(${left}px, ${top}px)`;
      if (t !== it.transform) {
        it.box.style.transform = t;
        it.transform = t;
      }
      if (!it.labelBox) {
        it.box.style.visibility = "visible";
        it.box.style.opacity = "1";
      }
      it.labelBox = { x: left, y: top, w: it.w, h: it.h };
      // leader: from the marker centre to the nearest corner of the box
      const cx = left > at.x ? left : left + it.w;
      const cy = top < at.y ? top + it.h : top;
      it.line.setAttribute("x1", String(Math.round(at.x) + 0.5));
      it.line.setAttribute("y1", String(Math.round(at.y) + 0.5));
      it.line.setAttribute("x2", String(Math.round(cx) + 0.5));
      it.line.setAttribute("y2", String(Math.round(cy) + 0.5));
      it.line.style.visibility = "visible";
    }
    this.previous = nextPrev;
  }

  private hideLabel(it: Item): void {
    if (it.labelBox) {
      it.box.style.visibility = "hidden";
      it.box.style.opacity = "0";
      it.labelBox = null;
    }
    it.line.style.visibility = "hidden";
  }

  /** Priority floor for a zoom (the globe's rule, with the street map's "all labels" zoom). */
  static priorityFloor(zoom: number): number {
    return labelPriorityFloor(zoom, STREET_TUNING.minZoom, STREET_TUNING.allLabelsZoom);
  }

  dispose(): void {
    for (const it of this.items.values()) {
      it.marker.remove();
      it.box.remove();
      it.line.remove();
    }
    this.items.clear();
    this.svg.remove();
  }
}
