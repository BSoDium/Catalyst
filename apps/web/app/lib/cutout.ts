import manifest from "./cutouts.generated.json";

/**
 * Subject cutouts of the photographs (prototype, #510): next to a photograph `photo.<hash>.webp` (or a route's `image.<hash>.webp`) a `photo.<hash>.cutout.webp` with everything but the
 * subject transparent, made by `scripts/cutout/run.py` (Apple's Vision foreground mask by default; a skyline is "everything but the sky", the boat of Quito a hand-drawn polygon refined by GrabCut: `scripts/cutout/config.json`). The poster draws it over the trip's word, so the subject stands in front of the lettering.
 * `cutouts.generated.json` lists the photographs that have one, with the share of the picture the subject covers.
 */
const SUBJECTS = manifest as unknown as Record<string, { coverage: number; cx: number; cy: number; top: number; occlude?: number; force?: boolean; blend?: boolean; placeOnly?: boolean; box: [number, number, number, number] }>;

/** A subject that covers less than this is a speck, more than this is the whole picture: either way there is nothing to put the word behind. */
export const CUTOUT_MIN = 0.05;
export const CUTOUT_MAX = 0.9;

export interface Cutout {
  src: string;
  /** The share of the picture the subject covers (0 to 1). */
  coverage: number;
  /** The subject's centre of mass, as shares of the picture's width and height (y from the top). */
  cx: number;
  cy: number;
  /** Where its top edge is (a share of the picture's height from the top; a tenth of the subject lies above it). */
  top: number;
  /** How much of the word's height this picture's subject hides, when it is not the usual `OCCLUDE` (a share, 0 to 1). */
  occlude?: number;
  /** Used whatever the share it covers (a pole and its flag cover almost nothing of the picture, and are the whole point). */
  force?: boolean;
  /** Dimmed and faded exactly as the photograph is (not whole down to the poster's foot): for a subject that stands on a part of the picture that is faded (a pole on a boat), so it does not stand out of nothing. */
  blend?: boolean;
  /** No cutout is drawn: the picture is only placed by this subject's edge (a skyline), so that the part that matters stays in the poster whatever the card's width. */
  placeOnly?: boolean;
}

/** The raw cutout of a photograph, whatever its coverage (the gallery shows them all). */
export function rawCutoutOf(src: string): Cutout | undefined {
  const s = SUBJECTS[src];
  return s === undefined ? undefined : { src: src.replace(/\.webp$/, ".cutout.webp"), coverage: s.coverage, cx: s.cx, cy: s.cy, top: s.top, ...(s.occlude !== undefined ? { occlude: s.occlude } : {}), ...(s.force ? { force: true } : {}), ...(s.blend ? { blend: true } : {}), ...(s.placeOnly ? { placeOnly: true } : {}) };
}

/** The cutout the poster uses: only one whose subject is neither a speck nor the whole picture. */
/** What a picture is placed by, with or without a cutout drawn: the subject's edge and where across it is. */
export function anchorOf(src: string): Cutout | undefined {
  const c = rawCutoutOf(src);
  return c && (c.placeOnly || c.force || (c.coverage >= CUTOUT_MIN && c.coverage <= CUTOUT_MAX)) ? c : undefined;
}

export function cutoutOf(src: string): Cutout | undefined {
  const c = rawCutoutOf(src);
  return c && !c.placeOnly && (c.force || (c.coverage >= CUTOUT_MIN && c.coverage <= CUTOUT_MAX)) ? c : undefined;
}

/** The share of the word's height the subject hides (the bottom of the letters): the word stays readable, and the subject opens onto it. */
export const OCCLUDE = 0.35;

export interface Placement {
  width: number;
  height: number;
  left: number;
  top: number;
}

/** The most the photograph is enlarged beyond covering the layer to bring the subject's edge to its place. */
const MAX_ZOOM = 1.4;

/**
 * Where to put the photograph so that its subject rises over the word: the subject's top edge comes to `target.y` (px in the layer: the point of the word where the horizon or the skyline is to be) and its centre across as near `target.x`
 * as covering the layer allows. The picture covers the layer (`w` by `run`) at least, and is enlarged just as much as it takes for the edge to reach its height (up to `MAX_ZOOM`). Every value is a continuous function of the
 * layer's size, so a poster that is being resized moves its photograph smoothly (a choice among a few zooms jumped from one to another).
 */
export function subjectPlace(subject: Pick<Cutout, "cx" | "top">, image: { w: number; h: number }, layer: { w: number; run: number }, target: { x: number; y: number }): Placement {
  const base = Math.max(layer.w / image.w, layer.run / image.h);
  const top = Math.min(0.999, Math.max(0.001, subject.top));
  // (the height the picture needs: the edge at `target.y` with the picture's top at or above the layer's, and its bottom at or below the layer's)
  const needed = Math.max(target.y / top, (layer.run - target.y) / (1 - top));
  const zoom = Math.min(MAX_ZOOM, Math.max(1, needed / (image.h * base)));
  const width = image.w * base * zoom;
  const height = image.h * base * zoom;
  return {
    width,
    height,
    left: Math.min(0, Math.max(layer.w - width, target.x - subject.cx * width)),
    top: Math.min(0, Math.max(layer.run - height, target.y - top * height)),
  };
}
