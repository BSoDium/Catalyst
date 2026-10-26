/**
 * The moon's picture on the page (docs/landing.md, "The moon"): a small 2D canvas, one pixel per art cell, scaled up crisp, laid in the globe's stage UNDER the ring of type (so the
 * ring's letters are over a moon that is behind the planet's plane, as they should be) and above the globe's own canvas. The shading is engine/moon.ts `moonSprite` (a lit sphere,
 * the Earth's picture treatment); this file only paints it and places it.
 *
 * Why a sprite and not a mesh in the globe's scene (the first version of the 3D moon was one): everything in the globe's canvas is on the art grid, so anything that moves
 * across it moves a whole art pixel at a time, and a slow thing moves in visible steps. The sprite is a RIGID pixel-art picture (its stipple is the moon's own, it never swims
 * across it) that is moved by a CSS transform in whole DEVICE pixels, so it glides. It is still a body in the globe's space: the position, size, light and phase come from the
 * same camera and orbit, and the planet hides it by its silhouette, cell by cell on the globe's own grid, so the limb it goes behind is the stepped one the planet is drawn with.
 */
import { CELL, MOON, type MoonMap } from "./moon";
import type { GlobeTheme } from "./colors";
import { surfaceTones } from "./surface";

const rgb = (c: readonly [number, number, number]) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;

/** The Moon's picture, decoded once into a grey array (the red channel of a grey PNG), or null when it cannot be had (the moon is then its lit outline alone). */
export async function loadMoonMap(doc: Document, url: string): Promise<MoonMap | null> {
  try {
    const img = doc.createElement("img");
    img.src = url;
    await img.decode();
    const canvas = doc.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !canvas.width || !canvas.height) return null;
    ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const data = new Uint8Array(canvas.width * canvas.height);
    for (let k = 0; k < data.length; k++) data[k] = rgba[k * 4]!;
    return { width: canvas.width, height: canvas.height, data };
  } catch {
    return null;
  }
}

export class MoonSprite {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private colours: (string | null)[] = [];
  private theme: GlobeTheme | null = null;
  private cells = 0;
  private shown = false;
  private left = NaN;
  private top = NaN;

  /** `host` is the globe's stage; the sprite is appended to it (the caller makes the ring after it, so the ring is over it). */
  constructor(host: HTMLElement) {
    const canvas = (this.canvas = host.ownerDocument.createElement("canvas"));
    canvas.setAttribute("aria-hidden", "true");
    canvas.dataset.moonSprite = "";
    Object.assign(canvas.style, {
      position: "absolute",
      left: "0",
      top: "0",
      pointerEvents: "none",
      imageRendering: "pixelated",
      display: "none",
      willChange: "transform",
    } satisfies Partial<CSSStyleDeclaration>);
    this.ctx = canvas.getContext("2d");
    host.append(canvas);
  }

  /** The tones, in this theme: the Earth's (a step from the page's colour towards its ink, boosted), the rim the coastlines' colour softened toward the page's, the body the page's. */
  setTheme(t: GlobeTheme): void {
    this.theme = t;
    const mix = (to: readonly [number, number, number], k: number) => rgb([0, 1, 2].map((i) => t.background[i]! + (to[i]! - t.background[i]!) * Math.min(1, k)) as [number, number, number]);
    const steps = surfaceTones(t.scheme);
    const c: (string | null)[] = [];
    c[CELL.none] = null;
    c[CELL.outline] = mix(t.coast, MOON.outlineMix);
    c[CELL.tone0] = mix(t.ink, steps[0]! * MOON.toneBoost);
    c[CELL.tone1] = mix(t.ink, steps[1]! * MOON.toneBoost);
    c[CELL.tone2] = mix(t.ink, steps[2]! * MOON.toneBoost);
    c[CELL.body] = rgb(t.background);
    this.colours = c;
  }

  /**
   * Paint the sprite (`codes`, `cells` x `cells`) and put its centre at (`x`, `y`) in the stage's CSS px. `cell` is the art cell in CSS px and `dpr` the device's ratio: the sprite is
   * `cells * cell` CSS px (a whole number of device pixels, as the art pixel is) and its corner is rounded to a whole device pixel, so it is crisp at every place and moves
   * by one device pixel at a time. `front`: in front of the plane of the planet's centre, so over the ring (otherwise under it).
   */
  draw(codes: Uint8Array, cells: number, x: number, y: number, cell: number, dpr: number, front: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.theme) return;
    const canvas = this.canvas;
    if (cells !== this.cells) {
      this.cells = cells;
      canvas.width = canvas.height = cells;
      canvas.style.width = canvas.style.height = `${cells * cell}px`;
    }
    ctx.clearRect(0, 0, cells, cells);
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const colour = this.colours[codes[j * cells + i]!];
        if (!colour) continue;
        ctx.fillStyle = colour;
        ctx.fillRect(i, j, 1, 1);
      }
    }
    const half = (cells * cell) / 2;
    const left = Math.round((x - half) * dpr) / dpr;
    const top = Math.round((y - half) * dpr) / dpr;
    if (left !== this.left || top !== this.top) {
      this.left = left;
      this.top = top;
      canvas.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    }
    canvas.style.zIndex = front ? "1" : "";
    if (!this.shown) {
      this.shown = true;
      canvas.style.display = "";
    }
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.canvas.style.display = "none";
  }

  /** Where the sprite is now, in the stage's CSS px (checks). */
  state() {
    return { shown: this.shown, cells: this.cells, left: this.left, top: this.top };
  }

  dispose(): void {
    this.canvas.remove();
  }
}
