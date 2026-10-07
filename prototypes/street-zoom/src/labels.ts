/**
 * HTML labels over the pixel pass: boxed mono text, square marker snapped to the art grid, 1 px leader line.
 * The pass never sees text; labels read the same projection as the map (`map.project`), so they stay aligned during
 * flights because they are updated from the map's own `render` event.
 */
import type { Map as MLMap } from "maplibre-gl";
import { placeLabels, snapToCell, type Candidate } from "./core/labelPlace";

export interface LabelSource {
  id: string;
  name: string;
  lon: number;
  lat: number;
  priority: number;
  pinned?: boolean;
  selected?: boolean;
}

interface Item {
  src: LabelSource;
  box: HTMLElement;
  marker: HTMLElement;
  line: SVGLineElement;
  w: number;
  h: number;
}

export class HudLabels {
  private items = new Map<string, Item>();
  private svg: SVGSVGElement;
  private cellCss = 3;
  private onRender = () => this.update();

  constructor(private map: MLMap, private root: HTMLElement) {
    this.svg = root.querySelector("svg")!;
    map.on("render", this.onRender);
  }

  setCell(cellCss: number): void {
    this.cellCss = cellCss;
  }

  set(sources: LabelSource[]): void {
    const keep = new Set(sources.map((s) => s.id));
    for (const [id, it] of this.items) {
      if (!keep.has(id)) {
        it.box.remove();
        it.marker.remove();
        it.line.remove();
        this.items.delete(id);
      }
    }
    for (const s of sources) {
      let it = this.items.get(s.id);
      if (!it) {
        const box = document.createElement("div");
        box.className = "hud-label" + (s.selected || s.pinned ? "" : " minor");
        box.textContent = s.name;
        const marker = document.createElement("div");
        marker.className = "hud-marker" + (s.selected ? " selected" : "");
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        this.root.appendChild(marker);
        this.root.appendChild(box);
        this.svg.appendChild(line);
        it = { src: s, box, marker, line, w: 0, h: 0 };
        this.items.set(s.id, it);
        const measure = () => {
          const r = box.getBoundingClientRect();
          it!.w = r.width;
          it!.h = r.height;
        };
        measure();
        void document.fonts?.ready.then(measure);
      }
      it.src = s;
      it.marker.className = "hud-marker" + (s.selected ? " selected" : "");
      const size = s.selected ? this.cellCss * 3 : this.cellCss * 2;
      it.marker.style.width = it.marker.style.height = `${size}px`;
    }
    this.update();
  }

  update(): void {
    const rect = this.map.getCanvas().getBoundingClientRect();
    const cands: Candidate[] = [];
    const pos = new Map<string, { x: number; y: number }>();
    for (const it of this.items.values()) {
      const s = it.src;
      const occluded = farSide(this.map.getCenter(), s.lon, s.lat);
      const p = this.map.project([s.lon, s.lat]);
      if (occluded || p.x < -20 || p.y < -20 || p.x > rect.width + 20 || p.y > rect.height + 20) {
        it.box.style.visibility = it.marker.style.visibility = "hidden";
        it.line.style.visibility = "hidden";
        continue;
      }
      const x = snapToCell(p.x, this.cellCss);
      const y = snapToCell(p.y, this.cellCss);
      pos.set(s.id, { x, y });
      cands.push({ id: s.id, x, y, w: it.w || 80, h: it.h || 16, priority: s.priority, pinned: s.pinned || s.selected });
    }
    const placed = new Map(placeLabels(cands, { w: rect.width, h: rect.height }).map((p) => [p.id, p]));
    for (const it of this.items.values()) {
      const at = pos.get(it.src.id);
      if (!at) continue;
      const size = parseFloat(it.marker.style.width) || this.cellCss * 2;
      it.marker.style.visibility = "visible";
      it.marker.style.transform = `translate(${Math.round(at.x - size / 2)}px, ${Math.round(at.y - size / 2)}px)`;
      const pl = placed.get(it.src.id);
      if (!pl) {
        it.box.style.visibility = "hidden";
        it.line.style.visibility = "hidden";
        continue;
      }
      it.box.style.visibility = "visible";
      it.box.style.transform = `translate(${Math.round(pl.left)}px, ${Math.round(pl.top)}px)`;
      // leader: from the marker to the nearest box corner
      const cx = pl.left > at.x ? pl.left : pl.left + it.w;
      const cy = pl.top < at.y ? pl.top + it.h : pl.top;
      it.line.setAttribute("x1", String(Math.round(at.x) + 0.5));
      it.line.setAttribute("y1", String(Math.round(at.y) + 0.5));
      it.line.setAttribute("x2", String(Math.round(cx) + 0.5));
      it.line.setAttribute("y2", String(Math.round(cy) + 0.5));
      it.line.style.visibility = "visible";
    }
  }

  dispose(): void {
    this.map.off("render", this.onRender);
    for (const it of this.items.values()) {
      it.box.remove();
      it.marker.remove();
      it.line.remove();
    }
    this.items.clear();
  }
}

/** Globe far-side test: more than ~84 degrees of arc from the view centre is at or behind the limb. */
export function farSide(center: { lng: number; lat: number }, lon: number, lat: number): boolean {
  const r = Math.PI / 180;
  const cosArc = Math.sin(center.lat * r) * Math.sin(lat * r) + Math.cos(center.lat * r) * Math.cos(lat * r) * Math.cos((lon - center.lng) * r);
  return cosArc < 0.1;
}
