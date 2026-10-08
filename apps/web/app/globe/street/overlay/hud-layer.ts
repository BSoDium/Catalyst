/**
 * Overlay of the street map: the DETECTION BOXES of the places and groups (engine/lod-tree.ts decides which, in screen
 * space; engine/box-scene.ts draws the boxes as pixel art on a canvas of the map's own art cells and their labels as HTML text,
 * the same class, labels and label plan as the globe's overlay, so nothing changes in kind when the renderers hand over). The pass never sees them; this layer reads the
 * same camera as the map, so it stays aligned during flights because it is updated from the map's own `render` event.
 *
 * Accessibility (the globe's rule): the root is `aria-hidden`, nothing here has a tab stop or a role. The accessible
 * place list (`PlacesNav`) remains the dependable path; this layer is a visual duplicate plus pointer input.
 * The root is `pointer-events: none`; clicks reach it through `hit()`, consulted by the engine on a map click, so a
 * drag that starts on a box still pans and the touch target can be larger than the label.
 */
import type { Rgb } from "../../engine/colors";
import { BoxScene } from "../../engine/box-scene";
import { snapBox } from "../../engine/group-square";
import { type LodCamera, type LodTree } from "../../engine/lod-tree";
import { NodeScreen } from "../../engine/node-screen";

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
    this.scene.setReducedMotion(reducedMotion);
  }

  /** The theme (palette ramp). Redraws on the next update. */
  setTheme(theme: { ramp: readonly Rgb[] }): void {
    this.scene.setTheme(theme);
    if (this.lastFrame) this.update(this.lastFrame);
  }

  /** Nothing to measure any more (the labels are measured once per string, with the page's own font); kept so callers need not know. */
  remeasure(): void {}

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    this.scene.setReducedMotion(on);
  }

  setSelected(slug: string | null): void {
    this.selectedIdx = this.lod.indexOf(slug);
    this.scene.setSelected(slug);
    if (this.lastFrame) this.update(this.lastFrame);
  }

  setFocused(slug: string | null): void {
    this.focusedIdx = this.lod.indexOf(slug);
    this.scene.setFocused(slug);
    if (this.lastFrame) this.update(this.lastFrame);
  }

  /** The node under the pointer (highlight only). */
  setHovered(slug: string | null): void {
    this.scene.setHovered(slug);
    if (this.lastFrame) this.update(this.lastFrame);
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

  /** Cells of every rectangle and the CSS px of every label drawn in the last frame (checks): the same shape as the globe's. */
  labelCells() {
    return this.scene.snapshot();
  }

  /** The label elements as they are in the DOM (checks). */
  labelsDom() {
    return this.scene.labelsDom();
  }

  /** Canvas and label drawing counters (frames drawn, frames skipped because nothing changed; element writes, re-plans). */
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
   * The node under a CSS-px point: the convex hull of a box and its label plus slop, the same rule as the globe's
   * (engine/hit-area.ts; the innermost target containing the point, else the nearest).
   */
  hit(x: number, y: number, kind: "mouse" | "touch"): string | null {
    return this.scene.hit(x, y, kind);
  }

  /** Some timed transition of the boxes (engine/fade.ts) or a label's glide to its place (engine/label-track.ts) has not reached its end: the host must keep drawing frames. */
  get animating(): boolean {
    return this.lod.animating || this.scene.animating;
  }

  /** What to call to get a frame when a plan run by the labels' own timer on a map at rest started a glide. */
  setWake(fn: (() => void) | null): void {
    this.scene.setWake(fn);
  }

  /** Re-place everything for the current camera. */
  update(frame: HudFrame): void {
    this.lastFrame = frame;
    const lod = this.lod;
    lod.update(frame.cam, this.selectedIdx, this.focusedIdx, this.reduced);
    lod.advance(performance.now());
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
    this.scene.update(screen, { cols, rows, cell, left: 0, top: 0 });
  }

  dispose(): void {
    this.scene.dispose();
  }
}
