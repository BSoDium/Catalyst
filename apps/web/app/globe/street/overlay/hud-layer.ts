/**
 * Overlay of the street map: the DETECTION BOXES of the places and groups (engine/lod-tree.ts decides which, in screen
 * space; engine/box-scene.ts draws them as pixel art on a canvas of the map's own art cells, the same class and font as the
 * globe's overlay, so nothing changes in kind when the renderers hand over). The pass never sees them; this layer reads the
 * same camera as the map, so it stays aligned during flights because it is updated from the map's own `render` event.
 *
 * Accessibility (the globe's rule): the root is `aria-hidden`, nothing here has a tab stop or a role. The accessible
 * place list (`PlacesNav`) remains the dependable path; this layer is a visual duplicate plus pointer input.
 * The root is `pointer-events: none`; clicks reach it through `hit()`, consulted by the engine on a map click, so a
 * drag that starts on a box still pans and the touch target can be larger than the label.
 */
import type { Rgb } from "../../engine/colors";
import { BoxScene } from "../../engine/box-scene";
import { boxHitDistance, snapBox } from "../../engine/group-square";
import { LOD, type LodCamera, type LodTree } from "../../engine/lod-tree";
import { NodeScreen } from "../../engine/node-screen";
import { labelPriorityFloor } from "../core/label-place";
import { STREET_TUNING } from "../tuning";

export interface HudFrame {
  width: number;
  height: number;
  cellCss: number;
  /** The camera of the detection boxes for this frame (unified zoom registered from the map's, the container's projection space, free area, cell). */
  cam: LodCamera;
}

/** Kept for the engine's option: there is one look now (the detection boxes). */
export type OverlayLook = "hud" | "globe";

export class HudLayer {
  private scene: BoxScene;
  private selectedIdx = -1;
  private focusedIdx = -1;
  private reduced: boolean;
  private lastFrame: HudFrame | null = null;
  private lastMinPriority = 0;
  /** Where the visible nodes are (rectangles in whole cells, container CSS px); filled by `update`. */
  readonly screen: NodeScreen;

  constructor(
    root: HTMLElement,
    private lod: LodTree,
    reducedMotion: boolean,
    _look: OverlayLook = "globe",
  ) {
    this.reduced = reducedMotion;
    this.screen = new NodeScreen(lod.size);
    this.scene = new BoxScene(root, lod);
  }

  /** The theme (palette ramp). Redraws on the next update. */
  setTheme(theme: { ramp: readonly Rgb[] }): void {
    this.scene.setTheme(theme);
    if (this.lastFrame) this.update(this.lastFrame, this.lastMinPriority);
  }

  /** Nothing to measure any more (the label font is baked into the bundle); kept so callers need not know. */
  remeasure(): void {}

  setReducedMotion(on: boolean): void {
    this.reduced = on;
  }

  setSelected(slug: string | null): void {
    this.selectedIdx = this.lod.indexOf(slug);
    this.scene.setSelected(slug);
    if (this.lastFrame) this.update(this.lastFrame, this.lastMinPriority);
  }

  setFocused(slug: string | null): void {
    this.focusedIdx = this.lod.indexOf(slug);
    this.scene.setFocused(slug);
    if (this.lastFrame) this.update(this.lastFrame, this.lastMinPriority);
  }

  /** The node under the pointer (highlight only). */
  setHovered(slug: string | null): void {
    this.scene.setHovered(slug);
    if (this.lastFrame) this.update(this.lastFrame, this.lastMinPriority);
  }

  setCell(_cellCss: number): void {}

  /** Slugs of the drawn rectangles of places (`markers`) and of groups (`groups`), and the labels shown (`labels`): debug and tests. */
  shown(): { markers: string[]; labels: string[]; groups: string[] } {
    const lod = this.lod;
    const markers: string[] = [];
    const groups: string[] = [];
    for (let k = 0; k < lod.count; k++) {
      const i = lod.visible[k]!;
      if (!this.screen.shown[i]) continue;
      (lod.isGroup[i] ? groups : markers).push(lod.slug[i]!);
    }
    return { markers, labels: [...this.scene.shown()], groups };
  }

  /** The centre of a node's drawn rectangle (CSS px in the container), or null when it is not drawn. */
  markerAt(slug: string): { x: number; y: number } | null {
    const i = this.lod.indexOf(slug);
    return i < 0 || !this.screen.shown[i] ? null : { x: this.screen.x[i]!, y: this.screen.y[i]! };
  }

  /** Cells of every rectangle and label drawn in the last frame (checks): the same shape as the globe's. */
  labelCells() {
    return this.scene.snapshot();
  }

  /** Canvas drawing counters (frames drawn, frames skipped because nothing changed). */
  stats() {
    return this.scene.stats();
  }

  /** What the last frame drew per node (alpha, tone, rectangle, members): debug and the check that compares it with the globe's. */
  snapshot(): { slug: string; kind: string; alpha: number; level: number; box: { x0: number; y0: number; x1: number; y1: number }; members: number; total: number; x: number; y: number; shown: boolean }[] {
    const lod = this.lod;
    const out = [];
    for (let k = 0; k < lod.count; k++) {
      const i = lod.visible[k]!;
      out.push({
        slug: lod.slug[i]!,
        kind: lod.kind[i]!,
        alpha: lod.alpha[i]!,
        level: lod.level[i]!,
        box: { x0: this.screen.bx0[i]!, y0: this.screen.by0[i]!, x1: this.screen.bx1[i]!, y1: this.screen.by1[i]! },
        members: lod.members[i]!,
        total: lod.total[i]!,
        x: this.screen.x[i]!,
        y: this.screen.y[i]!,
        shown: !!this.screen.shown[i],
      });
    }
    return out;
  }

  /**
   * The node under a CSS-px point: a label (grown by the label slop of the pointer type) first, else a rectangle's border band
   * (never its interior, so the rectangles inside stay clickable; the smallest rectangle wins).
   */
  hit(x: number, y: number, kind: "mouse" | "touch"): string | null {
    const label = this.scene.hit(x, y, STREET_TUNING.labelSlop[kind]);
    if (label) return label;
    const lod = this.lod;
    let best = -1;
    let bestArea = Infinity;
    for (let k = 0; k < lod.count; k++) {
      const i = lod.visible[k]!;
      if (!this.screen.shown[i] || lod.alpha[i]! < LOD.pickAlphaMin) continue;
      const box = { x0: this.screen.bx0[i]!, y0: this.screen.by0[i]!, x1: this.screen.bx1[i]!, y1: this.screen.by1[i]! };
      if (boxHitDistance(x, y, box, null, kind) > 0) continue;
      const area = (box.x1 - box.x0) * (box.y1 - box.y0);
      if (area < bestArea || (area === bestArea && best >= 0 && lod.priority[i]! > lod.priority[best]!)) {
        bestArea = area;
        best = i;
      }
    }
    return best >= 0 ? lod.slug[best]! : null;
  }

  /** Re-place everything for the current camera. `minPriority` hides the labels of low-priority places (zoom-dependent reveal). */
  update(frame: HudFrame, minPriority: number): void {
    this.lastFrame = frame;
    this.lastMinPriority = minPriority;
    const lod = this.lod;
    lod.update(frame.cam, this.selectedIdx, this.focusedIdx, this.reduced);
    const cell = frame.cellCss;
    const cols = Math.ceil(frame.width / cell);
    const rows = Math.ceil(frame.height / cell);
    const screen = this.screen;
    for (let k = 0; k < lod.count; k++) {
      const i = lod.visible[k]!;
      const r = snapBox(lod.boxX0[i]!, lod.boxY0[i]!, lod.boxX1[i]!, lod.boxY1[i]!, cell);
      screen.bx0[i] = r.c0 * cell;
      screen.by0[i] = r.r0 * cell;
      screen.bx1[i] = r.c1 * cell;
      screen.by1[i] = r.r1 * cell;
      screen.x[i] = (screen.bx0[i]! + screen.bx1[i]!) / 2;
      screen.y[i] = (screen.by0[i]! + screen.by1[i]!) / 2;
      const drawn = (lod.isGroup[i] ? lod.members[i]! > 0 : !!lod.shown[i]) && r.c1 > 0 && r.r1 > 0 && r.c0 < cols && r.r0 < rows;
      screen.shown[i] = drawn ? 1 : 0;
      screen.facing[i] = 1;
    }
    this.scene.update(screen, minPriority, { cols, rows, cell, left: 0, top: 0 });
  }

  /** Priority floor for a zoom (the globe's rule, with the street map's "all labels" zoom). */
  static priorityFloor(zoom: number): number {
    return labelPriorityFloor(zoom, STREET_TUNING.minZoom, STREET_TUNING.allLabelsZoom);
  }

  dispose(): void {
    this.scene.dispose();
  }
}
