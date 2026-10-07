/**
 * Detection boxes of the marker hierarchy (pure, renderer independent, unit tested).
 *
 * EVERYTHING on the map is a rectangle, like an object detector's output: a place is the bounding box of its extent, a group
 * is the bounding box of the places below it, and the published hierarchy (continent > subregion | region > country > area >
 * place) is the tree from which a CUT is chosen, in SCREEN SPACE, at every camera change: which rectangles are drawn.
 *
 *   - BOX GEOMETRY. A place's rectangle is axis aligned in screen space. When the place has a BOUNDING BOX (`bbox`, the true
 *     extent of the city or area it sits in, independent of where the recorded point lies) the rectangle is that box: centred
 *     on the box's centre, with the box's own width and height in km at the local scale of the camera. Without one it is a
 *     square around the point with a half side of `viewRadiusKm / 1.25` km (so the box of a place the camera is framed on
 *     fits the free area with the existing 25 % margin). Either way it is at least `LOD.minBoxCells` art cells across (per
 *     axis), so a far away place is a small rectangle, never a dot. A group's rectangle is the union of the TRUE boxes of its
 *     visible places, clamped to the same minimum, `padCells` of room around it. A rectangle bigger than `LOD.sizeFadeFrom` of the smaller free side fades out (gone at `sizeFadeTo`): you are
 *     inside it, it is just an outline.
 *   - THE FILL. A rectangle drawn at the minimum size (larger than its true box) has its interior MASKED in the page colour
 *     (so the small area reads as outlined and empty, like an erased marker dot); as its true side goes from `fillFadeFrom`
 *     to `fillFadeTo` times the minimum the mask fades out, leaving the hollow outline you can see through. `fillAlpha` is
 *     its OPACITY per node (0 = hollow), already multiplied by the node's alpha.
 *   - THE CUT. Every place that passes the visibility rule (front hemisphere, clear of the limb: engine/visibility.ts) counts.
 *     Top down from the roots, a group OPENS (is replaced by its children) when its children, each as the rectangle and the
 *     label it would be drawn with, do not collide: the nearest two are `LOD.sepPx` or more apart (a signed gap: negative when
 *     they overlap); the group is closed at a gap of `sepClosedPx` or less and open from `sepPx`, and the cross-fade between
 *     is the hysteresis (a camera jittering around the threshold cannot flap, it only moves the tone). A group with
 *     one visible place is that place's rectangle. A group box bigger than `boxMaxFrom` of the screen opens whatever the
 *     spacing, and every group is open from street scale (`forceOpenZoom`: places at the same spot cannot be told apart).
 *   - So a place alone, and a group whose members are spread out, are never boxed together: a lone place is its own rectangle
 *     at every zoom, a country with two distant places shows two rectangles, ten places 50 km apart are one rectangle (the
 *     group, with a chip "10 entries") until you zoom in, and continents and subregions are only drawn on crowded views.
 *
 *   c(g)      = openness, 0 (the group's rectangle) to 1 (its children), a smoothstep of rho (or of the box size)
 *   e(root) = 1,  e(child) = e(parent) * c(parent),  alpha(g) = e(g) * (1 - c(g)) * fade(g),  alpha(place) = e(place) * fade
 *
 * so along any root-to-leaf branch the alphas of the rectangles on it ALWAYS sum to 1 (a partition of unity; `fade` is the
 * "you are inside it" fade of a place's own huge box, which has no children to hand over to): the children come in, inside
 * the group's rectangle, exactly as fast as it goes out; nothing pops and no place is ever missing. Alpha is a continuous
 * function of the camera and IS the opacity the rectangle, its mask and its label are drawn with (engine/pixel-labels.ts:
 * a real alpha blend per art cell, never a shade of grey); reduced motion switches at once (`reducedBand` hysteresis).
 *
 * The camera is the unified one (`zu`, street/core/registration.ts), projected here with the globe model (the street map
 * is registered to it under a pixel), so both renderers get the same decision. Cost per camera change: one projection of
 * every place (typed arrays, no allocation) plus a traversal that only descends into open groups; cached until the camera
 * (or the forced nodes) change.
 */
import { DEFAULT_VIEW_RADIUS_KM, EARTH_RADIUS_KM, bboxExtentsKm, type Bbox } from "./framing";
import { lonLatToVec3, viewBasis, projectUnit, zoomToRadiusPx, focalPx, type ScreenPoint } from "./geo";
import { placeLabelTexts } from "./country-names";
import { chipText, labelLayout } from "./pixel-labels";
import { TUNING } from "./tuning";
import { markerShown } from "./visibility";

export type GroupKind = "continent" | "subregion" | "region" | "country" | "area";
export type NodeKind = "place" | GroupKind;

/** THE tuning table of the detection boxes and their cut (docs/web-architecture.md, "Detection boxes"). */
export const LOD = {
  /** The half side of a place's box is its view radius over this: the framed place's box then fits the free area with the framing's 25 % margin. */
  halfSideDivisor: 1.25,
  /** A box is at least this many art cells across (9 cells = 22 CSS px at 2.5 px): far away places are small rectangles, not dots. */
  minBoxCells: 9,
  /** The fill of a box at the minimum size fades while its TRUE side goes from this to `fillFadeTo` times the minimum (hollow from there). */
  fillFadeFrom: 1,
  fillFadeTo: 1.6,
  /** A group's rectangle has this many cells of room around the union of its places' rectangles (so a child's outline never coincides with it). */
  padCells: 2,
  /**
   * Two sibling rectangles (each with the label it carries) whose signed gap is below this, in CSS px, "collide": the group
   * above them stays one rectangle. `sepClosedPx` or less = closed, `sepPx` or more = open, a smoothstep between: the
   * cross-fade, about 0.4 zoom levels for a pair. Raise `sepPx` to cluster more, lower it to show more rectangles.
   */
  sepPx: 30,
  sepClosedPx: 10,
  /** A group's rectangle wider (or taller) than this fraction of the smaller free side starts to open whatever the spacing (fully open at `boxMaxTo`). */
  boxMaxFrom: 0.45,
  boxMaxTo: 0.6,
  /** A rectangle bigger than this multiple of the smaller free side fades out (gone at `sizeFadeTo`): you are inside it. */
  sizeFadeFrom: 1.6,
  sizeFadeTo: 2.2,
  /** Every group is open from this unified zoom (street scale: places at the same spot cannot be told apart); closed below `forceOpenZoom - forceOpenSpan`. */
  forceOpenZoom: 13,
  forceOpenSpan: 0.5,
  /** A node with alpha below this is not drawn at all. */
  alphaMin: 0.06,
  /** Reduced motion: a group opens at a gap of `mid + band` and closes below `mid - band`, `mid` being half way between `sepClosedPx` and `sepPx` (CSS px). */
  reducedBand: 3,
  /** A place with neither a bounding box nor a view radius gets this radius (km; framing.ts `DEFAULT_VIEW_RADIUS_KM`). */
  defaultPlaceRadiusKm: DEFAULT_VIEW_RADIUS_KM,
  /** A node can be picked once it is at least this opaque (a ghost mid-fade is not a target). */
  pickAlphaMin: 0.3,
  /** Labels are not drawn below this alpha (the node's own minimum: a label fades in and out with its rectangle, it does not pop in at a threshold). */
  labelAlphaMin: 0.06,
  /** Label priority: selected and focused first, then places before groups. */
  placePriorityBonus: 30,
} as const;

const smooth = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

/** What the tree needs from a node (`GlobePlace` and `GlobeGroup` both fit through `buildLodNodes`). */
export interface LodNodeInput {
  slug: string;
  name: string;
  kind: NodeKind;
  /** Slug of the enclosing group. */
  parent?: string | undefined;
  /** ISO 3166-1 alpha-2 code of a place's country (a place that is alone in its country says it: engine/country-names.ts). */
  countryCode?: string | undefined;
  lat: number;
  lon: number;
  radiusKm: number;
  priority: number;
  /** A place's bounding box `[west, south, east, north]` (degrees): its rectangle when valid (framing.ts `bboxExtentsKm`), else `radiusKm` around the point. */
  bbox?: Bbox | undefined;
}

/**
 * Camera of one evaluation; the caller keeps one object and mutates it (no allocation per frame). All lengths are CSS px in
 * the host's projection space (the globe's canvas, or the street map's container): the tree projects with the globe model
 * into that space, so `width`, `height` and `centreX` must be the ones the host's own projection uses.
 */
export interface LodCamera {
  lon: number;
  lat: number;
  /** Unified (internal) zoom, NOT capped at the globe's maximum. */
  zoom: number;
  /** Size of the projection space; the focal length of the camera model comes from `height`. */
  width: number;
  height: number;
  /** x of the projection centre (the view centre; shifted left by the detail panel's inset). */
  centreX: number;
  /** Smaller side of the free map area (free width, height): the unit of the size rules. */
  refPx: number;
  /** CSS px per art pixel. */
  cell: number;
}

/** The camera of an evaluation. */
export function setLodCamera(
  cam: LodCamera,
  view: { lon: number; lat: number; zoom: number },
  space: { width: number; height: number; centreX: number },
  freeWidthPx: number,
  cell: number,
) {
  cam.lon = view.lon;
  cam.lat = view.lat;
  cam.zoom = view.zoom;
  cam.width = space.width;
  cam.height = space.height;
  cam.centreX = space.centreX;
  cam.refPx = Math.max(1, Math.min(freeWidthPx, space.height));
  cam.cell = cell;
}

export const newLodCamera = (): LodCamera => ({ lon: 0, lat: 0, zoom: 0, width: 1, height: 1, centreX: 0.5, refPx: 1, cell: 3 });

/**
 * Half side in CSS px of the box of a place of `radiusKm` at a node whose cosine to the view centre is `pc`: the local scale
 * of the camera model (exact at the view centre, foreshortened towards the limb and clamped there, so a node at or beyond it
 * gets a finite size). Pure.
 */
export function placeHalfPx(radiusKm: number, zoom: number, height: number, pc: number): number {
  return (radiusKm / LOD.halfSideDivisor) * placePxPerKm(zoom, height, pc);
}

/** CSS px per km at a node whose cosine to the view centre is `pc` (the local scale of the camera model, clamped at the limb). */
export function placePxPerKm(zoom: number, height: number, pc: number): number {
  const f = focalPx(height);
  const d = 1 + f / zoomToRadiusPx(zoom);
  const limb = 1 / d;
  return (zoomToRadiusPx(zoom) / EARTH_RADIUS_KM) * ((d - 1) / (d - (pc > limb ? pc : limb)));
}

export class LodTree {
  readonly size: number;
  readonly slug: string[];
  readonly name: string[];
  readonly kind: NodeKind[];
  readonly isGroup: Uint8Array;
  readonly lat: Float64Array;
  readonly lon: Float64Array;
  readonly radiusKm: Float64Array;
  readonly priority: Float32Array;
  /** Half width and half height in km of a place's bounding box (0 for a node without a valid one: its box is the radius around the point). */
  readonly halfXKm: Float64Array;
  readonly halfYKm: Float64Array;
  /** Unit vector of every node (`lonLatToVec3`): of a place's bounding-box centre when it has one (its rectangle is centred there), else of its point. */
  readonly vec: Float64Array;
  /** Index of the parent group, -1 for a root. */
  readonly parent: Int32Array;
  readonly depth: Uint8Array;
  /** Places below each group (0 for a place): the count on a group's chip. */
  readonly total: Int32Array;
  /** What a node's label says: the name (a place alone in its country: and the country), and the chip of a group ("12 entries"; null for a place). */
  readonly text: string[];
  readonly chip: (string | null)[];
  /** Cells across and high of every node's label plate (name and chip), whole cells. */
  readonly labelW: Int16Array;
  readonly labelH: Int16Array;
  private readonly childStart: Int32Array;
  private readonly childList: Int32Array;
  private readonly roots: Int32Array;
  private readonly places: Int32Array;
  private readonly groups: Int32Array;
  private readonly bySlug = new Map<string, number>();

  // ---- the result of the last `update` (valid until the next one) -------------------------------------------------------
  /** Number of nodes drawn (alpha at least `LOD.alphaMin`, or forced). */
  count = 0;
  /** Their indices, in traversal order (parents before children). */
  readonly visible: Int32Array;
  /** Alpha per node index (only meaningful for visible ones). */
  readonly alpha: Float32Array;
  /** Alpha as a palette step per node index (1 .. the ink level): a debugging summary, drawing uses `alpha`. */
  readonly level: Uint8Array;
  /** Opacity of the interior mask per node index (0 = hollow .. 1), node alpha included. */
  readonly fillAlpha: Float32Array;
  /** Side in CSS px of a node's TRUE box (a place: its extent without the minimum; a group: the union of its places' drawn boxes, without the padding). */
  readonly side: Float64Array;
  /** Visible places below a group (a group's rectangle wraps only these). */
  readonly members: Int32Array;
  /** Rectangle of a drawn node (host projection space, CSS px, unsnapped). */
  readonly boxX0: Float64Array;
  readonly boxY0: Float64Array;
  readonly boxX1: Float64Array;
  readonly boxY1: Float64Array;
  /** The true boxes of the places (no minimum) and their unions per group, before clamping. */
  private readonly trueX0: Float64Array;
  private readonly trueY0: Float64Array;
  private readonly trueX1: Float64Array;
  private readonly trueY1: Float64Array;
  /** Projected centre of every place in this evaluation (unsnapped) and whether it passes the visibility rule. */
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly shown: Uint8Array;
  /** Nodes visited by the last evaluation (the roots and the children of every open group). */
  visited = 0;
  /** Places that passed the visibility rule in the last evaluation. */
  projected = 0;
  /** Evaluations done / cache hits since creation. */
  evaluations = 0;
  cacheHits = 0;

  private inkTop = 11;
  private readonly open: Uint8Array;
  /** Reduced motion: whether a node's fill is on (switches with a hysteresis band instead of fading). */
  private readonly fillOn: Uint8Array;
  private readonly seen: Uint32Array;
  private epoch = 0;
  private readonly stack: Int32Array;
  private readonly stackE: Float32Array;
  private readonly sx0: Float64Array;
  private readonly sy0: Float64Array;
  private readonly sx1: Float64Array;
  private readonly sy1: Float64Array;
  private readonly order: Int32Array;
  private key = new Float64Array(10);
  private keyValid = false;
  private lastForced0 = -2;
  private lastForced1 = -2;
  private lastReduced = false;
  /** More places that are always drawn (the stops of the selected place's routes); set by `setExtraForced`. */
  private extra: number[] = [];
  private scratch: ScreenPoint = { x: 0, y: 0, visible: false, facing: 0 };

  constructor(nodes: readonly LodNodeInput[]) {
    // Duplicate slugs: the first wins (the schema forbids them; this keeps the tree well formed whatever the input).
    const list: LodNodeInput[] = [];
    for (const n of nodes) {
      if (this.bySlug.has(n.slug)) continue;
      this.bySlug.set(n.slug, list.length);
      list.push(n);
    }
    const n = (this.size = list.length);
    this.slug = list.map((x) => x.slug);
    this.name = list.map((x) => x.name);
    this.kind = list.map((x) => x.kind);
    this.isGroup = Uint8Array.from(list, (x) => (x.kind === "place" ? 0 : 1));
    this.lat = Float64Array.from(list, (x) => x.lat);
    this.lon = Float64Array.from(list, (x) => x.lon);
    this.radiusKm = Float64Array.from(list, (x) => (Number.isFinite(x.radiusKm) && x.radiusKm > 0 ? x.radiusKm : LOD.defaultPlaceRadiusKm));
    this.priority = Float32Array.from(list, (x) => x.priority);
    this.halfXKm = new Float64Array(n);
    this.halfYKm = new Float64Array(n);
    this.vec = new Float64Array(n * 3);
    list.forEach((x, i) => {
      let lon = x.lon;
      let lat = x.lat;
      const ext = x.kind === "place" && x.bbox ? bboxExtentsKm(x.bbox) : null;
      if (ext) {
        this.halfXKm[i] = ext.halfXKm;
        this.halfYKm[i] = ext.halfYKm;
        lon = ext.lon;
        lat = ext.lat;
      }
      this.vec.set(lonLatToVec3(lon, lat), i * 3);
    });

    // Parents. Only a group can be a parent; an unknown parent makes a root; a cycle is cut where it closes.
    this.parent = new Int32Array(n).fill(-1);
    list.forEach((x, i) => {
      const p = x.parent === undefined ? undefined : this.bySlug.get(x.parent);
      if (p !== undefined && p !== i && this.isGroup[p]) this.parent[i] = p;
    });
    for (let i = 0; i < n; i++) {
      let cur = i;
      for (let steps = 0; this.parent[cur]! >= 0; steps++) {
        if (steps > n) {
          this.parent[cur] = -1; // cycle: this edge becomes a root
          break;
        }
        cur = this.parent[cur]!;
      }
    }
    this.depth = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let dpt = 0;
      for (let cur = this.parent[i]!; cur >= 0; cur = this.parent[cur]!) dpt++;
      this.depth[i] = Math.min(255, dpt);
    }
    // Children in CSR form, in input order.
    const counts = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) if (this.parent[i]! >= 0) counts[this.parent[i]! + 1]!++;
    for (let i = 0; i < n; i++) counts[i + 1]! += counts[i]!;
    this.childStart = counts;
    this.childList = new Int32Array(Math.max(1, counts[n]!));
    const fill = counts.slice(0, n);
    for (let i = 0; i < n; i++) if (this.parent[i]! >= 0) this.childList[fill[this.parent[i]!]!++] = i;
    const roots: number[] = [];
    for (let i = 0; i < n; i++) if (this.parent[i]! < 0) roots.push(i);
    this.roots = Int32Array.from(roots);
    this.places = Int32Array.from({ length: n }, (_, i) => i).filter((i) => !this.isGroup[i]);
    this.groups = Int32Array.from({ length: n }, (_, i) => i).filter((i) => this.isGroup[i]);
    this.total = new Int32Array(n);
    for (const p of this.places) for (let a = this.parent[p]!; a >= 0; a = this.parent[a]!) this.total[a]!++;
    // Label text: a place alone in its country (counted over every place of the tree) names it.
    const placeTexts = placeLabelTexts(list.map((x) => (x.kind === "place" ? x : { name: "" })));
    this.text = list.map((x, i) => (x.kind === "place" ? placeTexts[i]! : x.name));
    this.chip = list.map((_, i) => (this.isGroup[i] ? chipText(this.total[i]!) : null));
    this.labelW = new Int16Array(n);
    this.labelH = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const t = labelLayout(this.text[i]!, this.chip[i]!);
      this.labelW[i] = t.w;
      this.labelH[i] = t.h;
    }

    this.visible = new Int32Array(n);
    this.alpha = new Float32Array(n);
    this.level = new Uint8Array(n);
    this.fillAlpha = new Float32Array(n);
    this.side = new Float64Array(n);
    this.fillOn = new Uint8Array(n);
    this.members = new Int32Array(n);
    this.boxX0 = new Float64Array(n);
    this.boxY0 = new Float64Array(n);
    this.boxX1 = new Float64Array(n);
    this.boxY1 = new Float64Array(n);
    this.trueX0 = new Float64Array(n);
    this.trueY0 = new Float64Array(n);
    this.trueX1 = new Float64Array(n);
    this.trueY1 = new Float64Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.shown = new Uint8Array(n);
    this.open = new Uint8Array(n);
    this.seen = new Uint32Array(n);
    this.stack = new Int32Array(n + 1);
    this.stackE = new Float32Array(n + 1);
    let widest = 1;
    for (let g = 0; g < n; g++) widest = Math.max(widest, counts[g + 1]! - counts[g]!);
    this.sx0 = new Float64Array(widest);
    this.sy0 = new Float64Array(widest);
    this.sx1 = new Float64Array(widest);
    this.sy1 = new Float64Array(widest);
    this.order = new Int32Array(widest);
  }

  indexOf(slug: string | null | undefined): number {
    return slug == null ? -1 : (this.bySlug.get(slug) ?? -1);
  }

  /** Number of groups. */
  get groupCount(): number {
    return this.groups.length;
  }

  childrenOf(i: number): Int32Array {
    return this.childList.subarray(this.childStart[i]!, this.childStart[i + 1]!);
  }

  /** Places drawn whatever the zoom, besides the selected and the focused one (the stops of the shown routes); invalidates the cache. */
  setExtraForced(indices: readonly number[]) {
    this.extra = indices.filter((i) => i >= 0 && i < this.size && !this.isGroup[i]);
    this.keyValid = false;
  }

  /** The ink level: rectangles and text are drawn in it, at the node's alpha. */
  get ink(): number {
    return this.inkTop;
  }

  /** The theme's ramp length (sets the ink level the `level` summary counts in); invalidates the cache. */
  setTones(levels: number) {
    this.inkTop = levels - 1;
    this.keyValid = false;
  }

  /**
   * Evaluate the camera: fills `count`, `visible`, `alpha`, `level`, `members` and the rectangles. `forced0` and `forced1`
   * (node indices or -1: the selected and the focused place) are always drawn at full alpha. Cached while nothing changed.
   */
  update(cam: LodCamera, forced0: number, forced1: number, reduced: boolean): number {
    const k = this.key;
    if (
      this.keyValid &&
      k[0] === cam.lon &&
      k[1] === cam.lat &&
      k[2] === cam.zoom &&
      k[3] === cam.height &&
      k[4] === cam.refPx &&
      k[5] === cam.width &&
      k[6] === cam.centreX &&
      k[7] === cam.cell &&
      forced0 === this.lastForced0 &&
      forced1 === this.lastForced1 &&
      reduced === this.lastReduced
    ) {
      this.cacheHits++;
      return this.count;
    }
    k[0] = cam.lon;
    k[1] = cam.lat;
    k[2] = cam.zoom;
    k[3] = cam.height;
    k[4] = cam.refPx;
    k[5] = cam.width;
    k[6] = cam.centreX;
    k[7] = cam.cell;
    this.keyValid = true;
    this.lastForced0 = forced0;
    this.lastForced1 = forced1;
    this.lastReduced = reduced;
    this.evaluations++;
    this.evaluate(cam, forced0, forced1, reduced);
    return this.count;
  }

  /** Alpha of every drawn node for a camera, for tests and checks (allocates; not for frames). */
  alphas(cam: LodCamera, reduced = false): Map<string, number> {
    this.keyValid = false;
    this.update(cam, -1, -1, reduced);
    const out = new Map<string, number>();
    for (let j = 0; j < this.count; j++) out.set(this.slug[this.visible[j]!]!, this.alpha[this.visible[j]!]!);
    return out;
  }

  private evaluate(cam: LodCamera, forced0: number, forced1: number, reduced: boolean) {
    const cell = cam.cell;
    const minHalf = (LOD.minBoxCells * cell) / 2;
    const pad = LOD.padCells * cell;
    const basis = viewBasis({ lon: cam.lon, lat: cam.lat, zoom: cam.zoom }, cam.height);
    const c = basis.c;
    const clearance = TUNING.markerLimbClearance * cell;
    const vec = this.vec;
    const out = this.scratch;
    const members = this.members;
    const x0 = this.boxX0;
    const y0 = this.boxY0;
    const x1 = this.boxX1;
    const y1 = this.boxY1;

    // 1. project every place and give it its rectangle; a group's rectangle is the union of the TRUE boxes of its visible places
    // (then clamped to the minimum like any rectangle, and padded)
    const tx0 = this.trueX0;
    const ty0 = this.trueY0;
    const tx1 = this.trueX1;
    const ty1 = this.trueY1;
    for (const g of this.groups) {
      members[g] = 0;
      tx0[g] = ty0[g] = Infinity;
      tx1[g] = ty1[g] = -Infinity;
    }
    let projected = 0;
    for (const p of this.places) {
      const p3 = p * 3;
      projectUnit(vec[p3]!, vec[p3 + 1]!, vec[p3 + 2]!, basis, cam.height, 1, cam.centreX, out);
      const shown = markerShown(out, basis, cam.centreX, cam.height / 2, clearance);
      this.shown[p] = shown ? 1 : 0;
      this.px[p] = out.x;
      this.py[p] = out.y;
      const pc = vec[p3]! * c[0] + vec[p3 + 1]! * c[1] + vec[p3 + 2]! * c[2];
      // true half extents: the bounding box's own, else a square of the view radius around the point
      const pxPerKm = placePxPerKm(cam.zoom, cam.height, pc);
      const hxKm = this.halfXKm[p]!;
      const trueX = hxKm > 0 ? hxKm * pxPerKm : (this.radiusKm[p]! / LOD.halfSideDivisor) * pxPerKm;
      const trueY = hxKm > 0 ? this.halfYKm[p]! * pxPerKm : trueX;
      this.side[p] = 2 * (trueX > trueY ? trueX : trueY);
      tx0[p] = out.x - trueX;
      tx1[p] = out.x + trueX;
      ty0[p] = out.y - trueY;
      ty1[p] = out.y + trueY;
      // the drawn rectangle is clamped to the minimum per axis
      const hx = trueX < minHalf ? minHalf : trueX;
      const hy = trueY < minHalf ? minHalf : trueY;
      x0[p] = out.x - hx;
      x1[p] = out.x + hx;
      y0[p] = out.y - hy;
      y1[p] = out.y + hy;
      if (!shown) continue;
      projected++;
      for (let a = this.parent[p]!; a >= 0; a = this.parent[a]!) {
        members[a]!++;
        if (tx0[p]! < tx0[a]!) tx0[a] = tx0[p]!;
        if (tx1[p]! > tx1[a]!) tx1[a] = tx1[p]!;
        if (ty0[p]! < ty0[a]!) ty0[a] = ty0[p]!;
        if (ty1[p]! > ty1[a]!) ty1[a] = ty1[p]!;
      }
    }
    this.projected = projected;
    for (const g of this.groups) {
      if (members[g]! === 0) continue;
      const w = tx1[g]! - tx0[g]!;
      const h = ty1[g]! - ty0[g]!;
      this.side[g] = w > h ? w : h;
      // clamped to the minimum per axis, about the centre of the union, with padCells of room around
      const hx = (w < 2 * minHalf ? minHalf : w / 2) + pad;
      const hy = (h < 2 * minHalf ? minHalf : h / 2) + pad;
      const cx = (tx0[g]! + tx1[g]!) / 2;
      const cy = (ty0[g]! + ty1[g]!) / 2;
      x0[g] = cx - hx;
      x1[g] = cx + hx;
      y0[g] = cy - hy;
      y1[g] = cy + hy;
    }

    // 2. top down: a group opens when its children do not collide (or when its rectangle would be too big)
    const stack = this.stack;
    const stackE = this.stackE;
    const epoch = ++this.epoch;
    let sp = 0;
    let count = 0;
    let visited = 0;
    for (let r = this.roots.length - 1; r >= 0; r--) {
      stack[sp] = this.roots[r]!;
      stackE[sp++] = 1;
    }
    const ref = cam.refPx;
    const sepPx = LOD.sepPx;
    while (sp > 0) {
      sp--;
      const i = stack[sp]!;
      const e = stackE[sp]!;
      visited++;
      const w = x1[i]! - x0[i]!;
      const h = y1[i]! - y0[i]!;
      const frac = Math.max(w, h) / ref;
      // a rectangle bigger than the screen is an outline you are inside: it fades out
      let inside = 1 - smooth((frac - LOD.sizeFadeFrom) / (LOD.sizeFadeTo - LOD.sizeFadeFrom));
      if (reduced) inside = inside >= 0.5 ? 1 : 0; // no fade under reduced motion: it is simply there or not
      if (!this.isGroup[i]) {
        const a = e * inside;
        if (this.shown[i] && a >= LOD.alphaMin) this.emit(i, a, count++, epoch, cam, reduced);
        continue;
      }
      const n = members[i]!;
      if (n === 0) continue;
      // openness
      let c = 1;
      if (n > 1) {
        const gap = this.nearestGap(i, cam);
        if (reduced) {
          let st = this.open[i]!;
          if (st === 0 && (gap >= (sepPx + LOD.sepClosedPx) / 2 + LOD.reducedBand || frac >= LOD.boxMaxTo || cam.zoom >= LOD.forceOpenZoom)) st = 1;
          else if (st === 1 && gap < (sepPx + LOD.sepClosedPx) / 2 - LOD.reducedBand && frac < LOD.boxMaxFrom && cam.zoom < LOD.forceOpenZoom) st = 0;
          this.open[i] = st;
          c = st;
        } else {
          const bySpacing = gap === Infinity ? 1 : smooth((gap - LOD.sepClosedPx) / (sepPx - LOD.sepClosedPx));
          const bySize = smooth((frac - LOD.boxMaxFrom) / (LOD.boxMaxTo - LOD.boxMaxFrom));
          const byZoom = smooth((cam.zoom - (LOD.forceOpenZoom - LOD.forceOpenSpan)) / LOD.forceOpenSpan);
          c = Math.max(bySpacing, bySize, byZoom);
          this.open[i] = c > 0.5 ? 1 : 0; // keeps the reduced-motion switch coherent when the preference flips
        }
      } else this.open[i] = 1;
      const a = e * (1 - c);
      // a group of one visible place is that place's rectangle (c = 1); its own rectangle is drawn only when it is shut
      if (a * inside >= LOD.alphaMin) this.emit(i, a * inside, count++, epoch, cam, reduced);
      const ec = e * c;
      if (ec >= LOD.alphaMin) {
        const from = this.childStart[i]!;
        const to = this.childStart[i + 1]!;
        for (let j = to - 1; j >= from; j--) {
          stack[sp] = this.childList[j]!;
          stackE[sp++] = ec;
        }
      }
    }
    // The selected, the focused place and the stops of the shown routes are always drawn.
    const extra = this.extra;
    for (let n = 0; n < 2 + extra.length; n++) {
      const i = n === 0 ? forced0 : n === 1 ? forced1 : extra[n - 2]!;
      if (i < 0 || i >= this.size || this.isGroup[i]) continue;
      if (this.seen[i] === epoch) {
        this.alpha[i] = 1;
        this.level[i] = this.inkTop;
        this.fillAlpha[i] = this.fillFor(i, 1, cam, reduced);
      } else {
        this.emit(i, 1, count++, epoch, cam, reduced);
      }
    }
    this.count = count;
    this.visited = visited;
  }

  /**
   * The signed gap, in CSS px, of the nearest two children of group `g`, each as the rectangle it would be drawn with and
   * the tab it carries (the tab hangs on the top-left corner and can be wider than the rectangle): the larger of the gaps
   * along x and y, so negative when they overlap on both axes (by how much), 0 when they touch. Infinity when fewer than two
   * children have a visible place. A sweep over the rectangles sorted by left edge: O(m log m) for m children.
   */
  private nearestGap(g: number, cam: LodCamera): number {
    const from = this.childStart[g]!;
    const to = this.childStart[g + 1]!;
    const members = this.members;
    const cell = cam.cell;
    const cap = LOD.sepPx * 4; // beyond a few times the threshold the exact value does not matter
    let m = 0;
    for (let j = from; j < to; j++) {
      const c = this.childList[j]!;
      if (this.isGroup[c] ? members[c]! === 0 : !this.shown[c]) continue;
      // the label's plate sits just above the rectangle's top edge, one cell left of its left edge
      const bx0 = this.boxX0[c]!;
      this.sx0[m] = bx0 - cell;
      this.sy0[m] = this.boxY0[c]! - this.labelH[c]! * cell;
      this.sx1[m] = Math.max(this.boxX1[c]!, bx0 + (this.labelW[c]! - 1) * cell);
      this.sy1[m] = this.boxY1[c]!;
      this.order[m] = m;
      m++;
    }
    if (m < 2) return Infinity;
    const order = this.order.subarray(0, m);
    const sx0 = this.sx0;
    order.sort((a, b) => sx0[a]! - sx0[b]!);
    let best = cap;
    for (let a = 0; a < m; a++) {
      const ia = order[a]!;
      const right = this.sx1[ia]!;
      for (let b = a + 1; b < m; b++) {
        const ib = order[b]!;
        const dx = sx0[ib]! - right;
        if (dx >= best) break; // every later rectangle starts further right
        const dy = Math.max(this.sy0[ib]! - this.sy1[ia]!, this.sy0[ia]! - this.sy1[ib]!);
        const gap = dx > dy ? dx : dy;
        if (gap < best) best = gap;
      }
    }
    return best;
  }

  /** Record node `i` as drawn with opacity `a`, and its interior mask (from the node's true size). */
  private emit(i: number, a: number, slot: number, epoch: number, cam: LodCamera, reduced: boolean) {
    this.seen[i] = epoch;
    this.level[i] = Math.max(1, Math.min(this.inkTop, Math.round(a * this.inkTop)));
    this.fillAlpha[i] = this.fillFor(i, a, cam, reduced);
    this.alpha[i] = a;
    this.visible[slot] = i;
  }

  /**
   * The opacity of the interior mask of a rectangle: the page colour at the node's alpha while the rectangle is CLAMPED to the
   * minimum size (drawn larger than its true box), fading to hollow as its true side goes from `fillFadeFrom` to `fillFadeTo`
   * times the minimum. Reduced motion: on or off, with a hysteresis band.
   */
  private fillFor(i: number, a: number, cam: LodCamera, reduced: boolean): number {
    const minSide = LOD.minBoxCells * cam.cell;
    const f = 1 - smooth((this.side[i]! / minSide - LOD.fillFadeFrom) / (LOD.fillFadeTo - LOD.fillFadeFrom));
    if (reduced) {
      const on = this.fillOn[i]! ? f > 0.3 : f > 0.7;
      this.fillOn[i] = on ? 1 : 0;
      return on ? a : 0;
    }
    return f * a;
  }
}

/** Nodes of a tree from the seam's places and groups (`GlobeGroup`, `GlobePlace`). */
export function buildLodNodes(
  places: readonly { slug: string; name: string; lat: number; lon: number; labelPriority: number; viewRadiusKm?: number | undefined; bbox?: Bbox | undefined; groupSlug?: string | undefined; countryCode?: string | undefined }[],
  groups: readonly { slug: string; name: string; kind: GroupKind; parent?: string | undefined; lat: number; lon: number; viewRadiusKm: number; labelPriority: number }[],
): LodNodeInput[] {
  return [
    ...groups.map((g) => ({ slug: g.slug, name: g.name, kind: g.kind, parent: g.parent, lat: g.lat, lon: g.lon, radiusKm: g.viewRadiusKm, priority: g.labelPriority })),
    ...places.map((p) => ({
      slug: p.slug,
      name: p.name,
      kind: "place" as const,
      parent: p.groupSlug,
      lat: p.lat,
      lon: p.lon,
      radiusKm: p.viewRadiusKm ?? LOD.defaultPlaceRadiusKm,
      priority: p.labelPriority,
      countryCode: p.countryCode,
      bbox: p.bbox,
    })),
  ];
}
