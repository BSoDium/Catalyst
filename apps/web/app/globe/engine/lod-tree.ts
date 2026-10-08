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
 *     visible places, clamped to the same minimum, `padCells` of room around it. A rectangle bigger than `LOD.sizeFadeTo` times the smaller free side is hidden
 *     (shown again below `sizeFadeFrom`): you are inside it, it is just an outline.
 *   - THE FILL. A rectangle drawn at the minimum size (larger than its true box) has its interior MASKED in the page colour
 *     (so the small area reads as outlined and empty, like an erased marker dot); as its true side goes from `fillFadeFrom`
 *     to `fillFadeTo` times the minimum the mask is switched off (a hysteresis band, `fillHyst`), leaving the hollow outline you can
 *     see through. `fillAlpha` is its OPACITY per node (0 = hollow), already multiplied by the node's alpha.
 *   - THE CUT. Every place that passes the visibility rule (front hemisphere, clear of the limb: engine/visibility.ts) counts.
 *     Top down from the roots, a group OPENS (is replaced by its children) when its children, each as the rectangle and the
 *     label it would be drawn with, do not collide: the nearest two are `LOD.sepPx` or more apart (a signed gap: negative when
 *     they overlap); it CLOSES again at `LOD.sepClosedPx` or less, and in between it keeps the state it has (a hysteresis band, so a
 *     camera jittering around the threshold cannot flap). A group with one visible place is that place's rectangle. A group box
 *     bigger than `boxMaxFrom` of the screen opens whatever the spacing, and every group is open from street scale
 *     (`forceOpenZoom`: places at the same spot cannot be told apart).
 *   - So a place alone, and a group whose members are spread out, are never boxed together: a lone place is its own rectangle
 *     at every zoom, a country with two distant places shows two rectangles, ten places 50 km apart are one rectangle (the
 *     group, with a chip "10 entries") until you zoom in, and continents and subregions are only drawn on crowded views.
 *
 *   - THE PEEK. After the cut (so it never feeds back into the open and close decisions above) the most important PLACES under a group that
 *     stays CLOSED may be drawn too, as small boxes with their label next to the group's box (`peekPass`, `LOD.peek`): a country of six
 *     cities is not a closed box with nothing in it for two zoom levels. The group stays ONE box with the total in its chip. Greedy by
 *     importance (`labelPriority`, then the true size of the place, then the slug: a camera independent order), a candidate is accepted
 *     when its host is big enough, it keeps a clear gap from every other drawn box and label (with a way to write its own label), the host
 *     has room for it, and the screen is under its box budget. Accepted peeks keep their place with a hysteresis (accept at the enter gap,
 *     keep down to the leave gap), so a camera that jitters cannot flap them. A peek is a normal node otherwise: wanted, the same timed
 *     transition, picked like any box; when its group opens it simply stays.
 *
 * BINARY STATE, TIMED TRANSITIONS (docs/web-architecture.md, "Binary visibility"). The cut decides only a TARGET per node: drawn or
 * not, with the hysteresis above (the same for the box that is "bigger than the screen", `sizeFadeFrom` .. `sizeFadeTo`, and for the
 * interior mask, `fillHyst`). The opacity of a node is its own `FadeArray` value (engine/fade.ts), run towards the target by TIME over
 * `FADE_MS` whatever the camera does, so at rest every node is fully drawn or not drawn at all, never half way, and the group that
 * closes and the places that come in swap over the same 200 ms (their opacities sum to 1 on the way). A node's opacity never depends on
 * its parent's: a place whose ancestors are all open (none is drawn) is drawn at full opacity, London under an open Europe included.
 * The one thing that is not timed is geometry: a place that goes over the globe's limb, and a group left without a visible place,
 * vanish at once (a fading box there would be drawn at a mirrored position behind the globe).
 *
 *   alpha(node) = ease(progress(node)),  progress runs 0 -> 1 (target drawn) or 1 -> 0 (target hidden) at 1 / FADE_MS per ms
 *
 * The alpha is the opacity the rectangle, its mask and its label are drawn with (engine/pixel-labels.ts: a real alpha blend per art
 * cell, never a shade of grey; for the HTML label, its CSS opacity: engine/label-dom.ts). Reduced motion: the same targets, and the transition is an instant switch.
 *
 * The camera is the unified one (`zu`, street/core/registration.ts), projected here with the globe model (the street map
 * is registered to it under a pixel), so both renderers get the same decision. Cost per camera change: one projection of
 * every place (typed arrays, no allocation) plus a traversal that only descends into open groups; cached until the camera
 * (or the forced nodes) change.
 */
import { DEFAULT_VIEW_RADIUS_KM, EARTH_RADIUS_KM, bboxExtentsKm, type Bbox } from "./framing";
import { lonLatToVec3, viewBasis, projectUnit, zoomToRadiusPx, focalPx, type ScreenPoint } from "./geo";
import { countryName } from "./country-names";
import { FadeArray, clockStep, easeFade } from "./fade";
import { LABEL_TYPE, chipText, labelText } from "./label-text";
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
  /** The mask of a box at the minimum size: its TRUE side as a multiple of the minimum goes from `fillFadeFrom` (masked) to `fillFadeTo` (hollow); the switch has the hysteresis `fillHyst`. */
  fillFadeFrom: 1,
  fillFadeTo: 1.6,
  /** The mask is switched off once `1 - smoothstep(side ratio)` falls to `off` and back on once it rises to `on`; in between it keeps its state. */
  fillHyst: { off: 0.3, on: 0.7 },
  /** A group's rectangle has this many cells of room around the union of its places' rectangles (so a child's outline never coincides with it). */
  padCells: 2,
  /**
   * Two sibling rectangles (each with the label it carries) whose signed gap is below this, in CSS px, "collide": the group
   * above them stays one rectangle. A group CLOSES at a gap of `sepClosedPx` or less and OPENS at `sepPx` or more; in between it
   * keeps its state (hysteresis). Raise `sepPx` to cluster more, lower it to show more rectangles.
   */
  sepPx: 30,
  sepClosedPx: 10,
  /** A group's rectangle wider (or taller) than `boxMaxTo` of the smaller free side opens whatever the spacing; it may close again below `boxMaxFrom`. */
  boxMaxFrom: 0.45,
  boxMaxTo: 0.6,
  /** A rectangle bigger than `sizeFadeTo` times the smaller free side is hidden (you are inside it); it comes back below `sizeFadeFrom`. */
  sizeFadeFrom: 1.6,
  sizeFadeTo: 2.2,
  /** Every group is open from this unified zoom (street scale: places at the same spot cannot be told apart); closed again below `forceOpenZoom - forceOpenSpan`. */
  forceOpenZoom: 13,
  forceOpenSpan: 0.5,
  /** A node with alpha below this is not drawn at all (the last frames of a fade). */
  alphaMin: 0.06,
  /** A place with neither a bounding box nor a view radius gets this radius (km; framing.ts `DEFAULT_VIEW_RADIUS_KM`). */
  defaultPlaceRadiusKm: DEFAULT_VIEW_RADIUS_KM,
  /** A node can be picked once it is at least this opaque (a ghost mid-fade is not a target). */
  pickAlphaMin: 0.3,
  /** Label priority: selected and focused first, then places before groups. */
  placePriorityBonus: 30,
  /**
   * The PEEK pass: places drawn inside a closed group (docs/web-architecture.md, "Peeks: progressive disclosure of a closed group").
   * Every number is in CSS px of the host's space unless said otherwise.
   */
  peek: {
    /** Kinds of group that may show peeks. Continents do not: the world view stays calm. */
    hostKinds: ["subregion", "region", "country", "area"] as readonly GroupKind[],
    /** The host's rectangle (its larger side) must be at least `enter` for a new peek, and keeps the peeks it has down to `leave`. */
    hostMinPx: { enter: 90, leave: 80 },
    /** At most this many peeks per host. */
    perHost: 3,
    /** Clear gap from every other drawn box and label (the larger of the gaps along x and y): to be accepted / to be kept. */
    gapPx: { enter: 8, leave: 3 },
    /** A peek's box is at most this part of its host's larger side: accepted / kept (a peek is a SMALL box). */
    maxHostFrac: { enter: 0.4, leave: 0.5 },
    /** Boxes on the screen (a 1440 x 900 free area; scaled by the free area, within `budgetMin`..`budgetMax`): a new peek needs fewer than `budget`, a kept one fewer than `budget + budgetKeep`. */
    budget: 30,
    budgetKeep: 4,
    budgetRefArea: 1440 * 900,
    budgetMin: 8,
    budgetMax: 60,
    /** A peek dropped by the label planner (no room for its label) is not tried again until the camera zoomed by `banZoom` or its place moved by `banPx`. */
    banZoom: 0.2,
    banPx: 48,
    /** A peek's label ranks this far below everything else (and below its host's): it takes only the room that is left, it never displaces another label. */
    labelScoreDrop: 100,
  },
} as const;

/**
 * Placement order of a label (engine/label-plan.ts: higher first) from its `own` score: a PEEK's label ranks below its host's and after every
 * other label (it only takes the room that is left; the planner never gives another label's place to an optional box). `host` is the
 * host's score for a peek, null for every other node.
 */
export function labelScoreOf(own: number, host: number | null): number {
  return host === null ? own : Math.min(own, host - 1) - LOD.peek.labelScoreDrop;
}

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
  /** Width of the free map area, centred on `centreX` (the area the detail panel leaves): the screen of the peek pass. */
  freeWidth: number;
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
  cam.freeWidth = Math.max(1, freeWidthPx);
  cam.cell = cell;
}

export const newLodCamera = (): LodCamera => ({ lon: 0, lat: 0, zoom: 0, width: 1, height: 1, centreX: 0.5, refPx: 1, freeWidth: 1, cell: 3 });

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
  /** What a node's label says: the name, and the chip of a group ("12 entries"; null for a place). */
  readonly text: string[];
  readonly chip: (string | null)[];
  /** The English name of a place's country (from `countryCode`), null for a group or when the code is missing or unknown: a hovered or selected label says it ("Name, Country"). */
  readonly country: (string | null)[];
  /** CSS px across and high of every node's label as it is written at rest (name and chip; engine/label-text.ts): part of the node for the cut. */
  readonly labelW: Float32Array;
  readonly labelH: Float32Array;
  private readonly childStart: Int32Array;
  private readonly childList: Int32Array;
  private readonly roots: Int32Array;
  private readonly places: Int32Array;
  private readonly groups: Int32Array;
  private readonly bySlug = new Map<string, number>();

  // ---- the result of the last `update` / `advance` (valid until the next one) ----------------------------------------------
  /** Number of nodes drawn (alpha at least `LOD.alphaMin`). */
  count = 0;
  /** Their indices, parents before children. */
  readonly visible: Int32Array;
  /** Alpha per node index (only meaningful for visible ones): the node's own timed opacity, never its parent's. */
  readonly alpha: Float32Array;
  /** Alpha as a palette step per node index (1 .. the ink level): a debugging summary, drawing uses `alpha`. */
  readonly level: Uint8Array;
  /** Opacity of the interior mask per node index (0 = hollow .. 1), node alpha included. */
  readonly fillAlpha: Float32Array;
  /**
   * The timed on/off values (engine/fade.ts), one per node, shared by every host of the tree (the globe's and the street map's
   * overlay), so the picture does not restart at the handover: the node itself (`life`, set by the cut) and its interior mask
   * (`mask`, set by the cut). A label is always on with its node (engine/label-plan.ts), so it has no transition of its own.
   */
  readonly life: FadeArray;
  readonly mask: FadeArray;
  /** Side in CSS px of a node's TRUE box (a place: its extent without the minimum; a group: the union of its places' drawn boxes, without the padding). */
  readonly side: Float64Array;
  /** Visible places below a group (a group's rectangle wraps only these). */
  readonly members: Int32Array;
  /**
   * The PEEKS of the last evaluation: the host group (index) of a place the peek pass drew inside a closed group, -1 for every other node.
   * A peek is wanted like any node; this says WHY it is drawn under a drawn group (`isPeek`).
   */
  readonly peekHost: Int32Array;
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
  /** Persistent decisions (the hysteresis memory): a group is open, a node's box is hidden for being bigger than the screen, an interior mask is on. */
  private readonly open: Uint8Array;
  private readonly decided: Uint8Array;
  private readonly bigHidden: Uint8Array;
  private readonly fillOn: Uint8Array;
  /** What the last evaluation wants drawn, and the mask each of those wants. */
  private readonly want: Uint8Array;
  private readonly wantFill: Uint8Array;
  /** Node indices by depth, parents first: the order of `visible`. */
  private readonly byDepth: Int32Array;
  private readonly stack: Int32Array;
  private readonly sx0: Float64Array;
  private readonly sy0: Float64Array;
  private readonly sx1: Float64Array;
  private readonly sy1: Float64Array;
  private readonly order: Int32Array;
  // ---- the peek pass: static order, the memory between evaluations, and scratch ----
  /** Places by importance, camera independent: `priority` descending, then the true size in km descending, then the slug. */
  private readonly peekOrder: Int32Array;
  /** Group kinds that may host peeks. */
  private readonly hostKind: Uint8Array;
  /** A place was a peek in the last evaluation (the incumbent, kept with the leave thresholds), also while it is wanted for another reason. */
  private readonly peekMem: Uint8Array;
  /** Per group in the current pass: 0 not a host, 1 may take new peeks, 2 only keeps the ones it has (between the host size thresholds). */
  private readonly hostState: Uint8Array;
  private readonly hostCount: Uint8Array;
  /** Which of the six plate positions a peek's label took (-1: none): an incumbent tries it first, so a position does not flip between two that are both free. */
  private readonly peekCand: Int8Array;
  /** A dropped peek's ban: the zoom and the place's position when the label planner refused it (NaN: none). */
  private readonly banZoom: Float64Array;
  private readonly banX: Float64Array;
  private readonly banY: Float64Array;
  /** Obstacles of the pass: rectangles (4 numbers each), the node they belong to and 0 for its box, 1 for its label's plate, 2 for the reserved box of an incumbent. */
  private obs: Float64Array;
  private obsOwner: Int32Array;
  private obsKind: Uint8Array;
  private nObs = 0;
  /** The zoom of the last evaluation (the ban's reference). */
  private lastZoom = 0;
  private key = new Float64Array(10);
  private keyValid = false;
  private lastForced0 = -2;
  private lastForced1 = -2;
  private lastReduced = false;
  private lastNow = 0;
  private rebuild = true;
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
    // Label text: the name alone; the country is only said by a hovered, focused or selected label (the same for every place, whether or not it is
    // the only one of its country).
    this.text = list.map((x) => x.name);
    this.chip = list.map((_, i) => (this.isGroup[i] ? chipText(this.total[i]!) : null));
    this.country = list.map((x) => (x.kind === "place" ? countryName(x.countryCode) : null));
    this.labelW = new Float32Array(n);
    this.labelH = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = labelText(this.text[i]!, this.chip[i]!);
      this.labelW[i] = t.w;
      this.labelH[i] = t.h;
    }

    this.visible = new Int32Array(n);
    this.alpha = new Float32Array(n);
    this.level = new Uint8Array(n);
    this.fillAlpha = new Float32Array(n);
    this.life = new FadeArray(n);
    this.mask = new FadeArray(n);
    this.side = new Float64Array(n);
    this.fillOn = new Uint8Array(n);
    this.want = new Uint8Array(n);
    this.wantFill = new Uint8Array(n);
    this.decided = new Uint8Array(n);
    this.bigHidden = new Uint8Array(n);
    this.byDepth = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => this.depth[a]! - this.depth[b]! || a - b);
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
    this.stack = new Int32Array(n + 1);
    let widest = 1;
    for (let g = 0; g < n; g++) widest = Math.max(widest, counts[g + 1]! - counts[g]!);
    this.sx0 = new Float64Array(widest);
    this.sy0 = new Float64Array(widest);
    this.sx1 = new Float64Array(widest);
    this.sy1 = new Float64Array(widest);
    this.order = new Int32Array(widest);

    this.peekHost = new Int32Array(n).fill(-1);
    this.hostKind = Uint8Array.from(list, (x) => (x.kind !== "place" && LOD.peek.hostKinds.includes(x.kind as GroupKind) ? 1 : 0));
    this.peekMem = new Uint8Array(n);
    this.peekCand = new Int8Array(n).fill(-1);
    this.hostState = new Uint8Array(n);
    this.hostCount = new Uint8Array(n);
    this.banZoom = new Float64Array(n).fill(NaN);
    this.banX = new Float64Array(n);
    this.banY = new Float64Array(n);
    this.obs = new Float64Array(12 * n + 8);
    this.obsOwner = new Int32Array(3 * n + 2);
    this.obsKind = new Uint8Array(3 * n + 2);
    // true size of a place in km, camera independent: a bounding box's larger side, else the square of its view radius
    const sizeKm = (i: number) => (this.halfXKm[i]! > 0 ? 2 * Math.max(this.halfXKm[i]!, this.halfYKm[i]!) : (2 * this.radiusKm[i]!) / LOD.halfSideDivisor);
    this.peekOrder = Int32Array.from(this.places).sort((a, b) => {
      const pa = this.priority[a]!;
      const pb = this.priority[b]!;
      if (pa !== pb) return pb - pa;
      const sa = sizeKm(a);
      const sb = sizeKm(b);
      if (sa !== sb) return sb - sa;
      return this.slug[a]! < this.slug[b]! ? -1 : this.slug[a]! > this.slug[b]! ? 1 : 0;
    });
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
   * Decide the cut for a camera: what each node WANTS (drawn or not) and the geometry of every rectangle (`members`, the
   * `box*` arrays, `side`). `forced0` and `forced1` (node indices or -1: the selected and the focused place) are always wanted.
   * Cached while the camera and the forced nodes are the same. It sets targets only; the opacities are `advance`'s.
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
      k[8] === cam.freeWidth &&
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
    k[8] = cam.freeWidth;
    this.keyValid = true;
    this.lastForced0 = forced0;
    this.lastForced1 = forced1;
    this.lastReduced = reduced;
    this.evaluations++;
    this.evaluate(cam, forced0, forced1);
    this.retarget();
    this.rebuild = true;
    return this.count;
  }

  /** True while some transition (a node, a mask) has not reached its target: the host's frame loop must keep going. */
  get animating(): boolean {
    return this.life.moving || this.mask.moving;
  }

  /**
   * Move every transition forward to the clock reading `now` (ms, any origin) and refresh the drawn list, `alpha` and `fillAlpha`.
   * Call it once per frame after `update`. Returns `animating`. A reduced-motion camera switches at once.
   */
  advance(now: number): boolean {
    const dt = clockStep(this.lastNow, now);
    this.lastNow = now;
    const instant = this.lastReduced;
    const moved = this.animating;
    if (moved) {
      this.life.step(dt, instant);
      this.mask.step(dt, instant);
    }
    if (moved || this.rebuild) this.build();
    return this.animating;
  }

  /** Run every transition to its end now (tests and the checks' resting frame; the next `advance` redraws). */
  settle(): void {
    this.life.settle();
    this.mask.settle();
    this.build();
  }

  /**
   * Whether some ancestor group of node `i` is drawn: the cut wants its box and it has places in view. A group on its way out
   * (it opened) does not count, so the places that replace it are not treated as its subordinates while it fades.
   */
  hasDrawnAncestor(i: number): boolean {
    for (let a = this.parent[i]!; a >= 0; a = this.parent[a]!) if (this.members[a]! > 0 && this.life.target[a] === 1) return true;
    return false;
  }

  /** Node `i` is a peek in the last evaluation: a place the peek pass wants drawn inside a closed group. It has a drawn ancestor by design. */
  isPeek(i: number): boolean {
    return this.peekHost[i]! >= 0;
  }

  /**
   * The label planner could not place the label of peek `i` without overlapping another (engine/box-scene.ts): the peek is dropped at
   * once (never drawn over others) and not tried again until the camera has moved enough for the answer to change (`LOD.peek.banZoom`,
   * `banPx`). Does nothing for a node that is not a peek.
   */
  dropPeek(i: number): void {
    if (this.peekHost[i]! < 0) return;
    this.peekHost[i] = -1;
    this.peekMem[i] = 0;
    this.want[i] = 0;
    this.banZoom[i] = this.lastZoom;
    this.banX[i] = this.px[i]!;
    this.banY[i] = this.py[i]!;
    this.life.snap(i, false);
    this.mask.snap(i, false);
    this.keyValid = false;
    this.build(); // the drawn list now: the next frame of the other overlay must not see it
  }

  /** Alpha of every drawn node at rest for a camera, for tests and checks (allocates; not for frames). */
  alphas(cam: LodCamera, reduced = false): Map<string, number> {
    this.keyValid = false;
    this.update(cam, -1, -1, reduced);
    this.settle();
    const out = new Map<string, number>();
    for (let j = 0; j < this.count; j++) out.set(this.slug[this.visible[j]!]!, this.alpha[this.visible[j]!]!);
    return out;
  }

  /** Hand the cut's wants to the transitions, and snap what must not fade (geometry: a limb crossing, a group left empty). */
  private retarget() {
    for (let i = 0; i < this.size; i++) {
      const on = this.want[i] === 1;
      const geometry = this.isGroup[i] ? this.members[i]! > 0 : this.shown[i] === 1;
      if (!geometry) {
        // Nothing to draw it from: a fade would show it where the globe's far side is, mirrored. It goes at once.
        this.life.snap(i, false);
        this.mask.snap(i, false);
        continue;
      }
      if (on && this.life.target[i] === 0 && this.life.p[i] === 0) {
        // Just appeared: its interior begins in its state, so only the node itself fades in.
        this.mask.snap(i, this.wantFill[i] === 1);
      } else if (on) this.mask.set(i, this.wantFill[i] === 1);
      this.life.set(i, on);
    }
  }

  /** The drawn list (parents first), the opacities and the mask opacities from the transitions' state. */
  private build() {
    this.rebuild = false;
    let count = 0;
    for (const i of this.byDepth) {
      const p = this.life.p[i]!;
      if (p === 0) continue;
      const a = easeFade(p);
      if (a < LOD.alphaMin) continue;
      this.alpha[i] = a;
      this.level[i] = Math.max(1, Math.min(this.inkTop, Math.round(a * this.inkTop)));
      this.fillAlpha[i] = a * this.mask.value(i);
      this.visible[count++] = i;
    }
    this.count = count;
  }

  private evaluate(cam: LodCamera, forced0: number, forced1: number) {
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

    // 2. top down: which nodes the cut wants drawn. A group opens when its children do not collide (or its rectangle is too big),
    // closes when they are well apart again, and keeps its state in between.
    const stack = this.stack;
    const want = this.want;
    want.fill(0);
    let sp = 0;
    let visited = 0;
    for (let r = this.roots.length - 1; r >= 0; r--) stack[sp++] = this.roots[r]!;
    const ref = cam.refPx;
    const sepPx = LOD.sepPx;
    const sepMid = (sepPx + LOD.sepClosedPx) / 2;
    while (sp > 0) {
      const i = stack[--sp]!;
      visited++;
      const w = x1[i]! - x0[i]!;
      const h = y1[i]! - y0[i]!;
      const frac = Math.max(w, h) / ref;
      // a rectangle bigger than the screen is an outline you are inside: hidden (with a hysteresis band)
      const hidden = this.bigHidden[i]! ? frac > LOD.sizeFadeFrom : frac >= LOD.sizeFadeTo;
      this.bigHidden[i] = hidden ? 1 : 0;
      if (!this.isGroup[i]) {
        if (this.shown[i] && !hidden) this.mark(i, cam);
        continue;
      }
      const n = members[i]!;
      if (n === 0) continue;
      let open = true;
      if (n > 1) {
        const gap = this.nearestGap(i);
        const deep = cam.zoom >= LOD.forceOpenZoom;
        // strongly open (children well apart, rectangle too big, street scale) / strongly closed; in between the state is kept
        if (gap >= sepPx || frac >= LOD.boxMaxTo || deep) this.open[i] = 1;
        else if (gap <= LOD.sepClosedPx && frac <= LOD.boxMaxFrom && cam.zoom < LOD.forceOpenZoom - LOD.forceOpenSpan) this.open[i] = 0;
        else if (!this.decided[i]) this.open[i] = gap >= sepMid || frac >= (LOD.boxMaxFrom + LOD.boxMaxTo) / 2 || cam.zoom >= LOD.forceOpenZoom - LOD.forceOpenSpan / 2 ? 1 : 0;
        this.decided[i] = 1;
        open = this.open[i] === 1;
      } else this.open[i] = 1; // a group of one visible place is that place's rectangle
      if (open) {
        const from = this.childStart[i]!;
        for (let j = this.childStart[i + 1]! - 1; j >= from; j--) stack[sp++] = this.childList[j]!;
      } else if (!hidden) this.mark(i, cam);
    }
    // The selected, the focused place and the stops of the shown routes are always wanted.
    const extra = this.extra;
    for (let n = 0; n < 2 + extra.length; n++) {
      const i = n === 0 ? forced0 : n === 1 ? forced1 : extra[n - 2]!;
      if (i < 0 || i >= this.size || this.isGroup[i]) continue;
      this.mark(i, cam);
    }
    this.lastZoom = cam.zoom;
    this.peekPass(cam);
    this.visited = visited;
  }

  /**
   * The PEEK pass (see the header): after the cut, the most important places under the groups that stayed CLOSED are wanted too.
   *
   * Two sweeps over the places in importance order (`peekOrder`, independent of the camera and of the input order): first the places that
   * were peeks in the last evaluation (the incumbents, judged with the LEAVE thresholds), then the others (the ENTER thresholds), so a peek
   * is only given up when it fails the lenient test and only taken when it passes the strict one: a hysteresis in every number (host size,
   * gap, share of the host, budget). The obstacles are the boxes and the label plates (at their first candidate, above the box's top-left
   * corner) of every node the cut wants, then of every peek accepted so far. Cost: O(places) for the sweeps (an ancestor walk and
   * cheap tests each), the geometry only for a place that passed them all, against the boxes on screen.
   */
  private peekPass(cam: LodCamera) {
    const P = LOD.peek;
    const n = this.size;
    const want = this.want;
    const peekHost = this.peekHost;
    peekHost.fill(-1);
    const hs = this.hostState;
    hs.fill(0);
    let hosts = 0;
    for (const g of this.groups) {
      if (!want[g] || !this.hostKind[g]) continue;
      const side = Math.max(this.boxX1[g]! - this.boxX0[g]!, this.boxY1[g]! - this.boxY0[g]!);
      const st = side >= P.hostMinPx.enter ? 1 : side >= P.hostMinPx.leave ? 2 : 0;
      hs[g] = st;
      if (st) hosts++;
    }
    if (!hosts) {
      for (const p of this.places) if (!want[p]) this.peekMem[p] = 0;
      return;
    }
    this.hostCount.fill(0);
    const x0 = this.boxX0;
    const y0 = this.boxY0;
    const x1 = this.boxX1;
    const y1 = this.boxY1;
    // the screen: the free area (centred on the projection centre), and the boxes on it
    const vx0 = cam.centreX - cam.freeWidth / 2;
    const vx1 = vx0 + cam.freeWidth;
    const vy0 = 0;
    const vy1 = cam.height;
    const budget = Math.max(P.budgetMin, Math.min(P.budgetMax, Math.round((P.budget * cam.freeWidth * cam.height) / P.budgetRefArea)));
    let boxes = 0;
    this.nObs = 0;
    for (let i = 0; i < n; i++) {
      if (!want[i]) continue;
      if (x1[i]! > vx0 && x0[i]! < vx1 && y1[i]! > vy0 && y0[i]! < vy1) boxes++;
      if (x1[i]! < vx0 - 400 || x0[i]! > vx1 + 400 || y1[i]! < vy0 - 400 || y0[i]! > vy1 + 400) continue; // (an obstacle is only worth keeping near the screen)
      this.addObstacle(i, 0, x0[i]!, y0[i]!, x1[i]!, y1[i]!);
      const tx = x0[i]! - LABEL_TYPE.padX;
      this.addObstacle(i, 1, tx, y0[i]! - this.labelH[i]! - LABEL_TYPE.boxGap, tx + this.labelW[i]!, y0[i]! - LABEL_TYPE.boxGap);
    }
    // The boxes of the incumbents are reserved while the incumbents are judged (obstacles of kind 2, for the PLATES only): a more important peek
    // does not put its label over a less important one it is about to keep, which would drop it for nothing and bring it back a step later.
    for (const p of this.places) {
      if (!want[p] && this.peekMem[p] === 1 && this.shown[p] === 1) this.addObstacle(p, 2, x0[p]!, y0[p]!, x1[p]!, y1[p]!);
    }
    const plate = { x: 0, y: 0 };
    for (let pass = 0; pass < 2; pass++) {
      const keep = pass === 0;
      const gap = keep ? P.gapPx.leave : P.gapPx.enter;
      const frac = keep ? P.maxHostFrac.leave : P.maxHostFrac.enter;
      const room = keep ? budget + P.budgetKeep : budget;
      for (const p of this.peekOrder) {
        if (want[p] || keep !== (this.peekMem[p] === 1)) continue; // wanted for another reason (kept in memory), or not of this sweep
        // the host: the one drawn group above it, if it can host
        let h = -1;
        for (let a = this.parent[p]!; a >= 0; a = this.parent[a]!) {
          if (want[a]) {
            h = hs[a] === 0 || (!keep && hs[a] !== 1) ? -1 : a;
            break;
          }
        }
        const ok = h >= 0 && this.shown[p] === 1 && this.hostCount[h]! < P.perHost && boxes < room && !this.peekBanned(p, cam);
        // its box small beside the host, clear of everything, with a label that fits on the screen
        let fits = false;
        if (ok) {
          const bx0 = x0[p]!;
          const by0 = y0[p]!;
          const bx1 = x1[p]!;
          const by1 = y1[p]!;
          const on = bx1 > vx0 && bx0 < vx1 && by1 > vy0 && by0 < vy1;
          const hostSide = Math.max(x1[h]! - x0[h]!, y1[h]! - y0[h]!);
          if (Math.max(bx1 - bx0, by1 - by0) <= frac * hostSide && this.peekClear(bx0, by0, bx1, by1, gap, h, p, false)) {
            // the label must fit on the screen (the planner's positions are all on it): with the gap to spare to be taken, exactly to be kept, so a
            // box on the edge of the screen does not flap; a box wholly off it has no position and is not a peek
            const m = keep ? 0 : gap;
            fits = this.peekPlate(p, vx0 + m, vy0 + m, vx1 - m, vy1 - m, gap, h, keep, plate);
            if (fits) {
              peekHost[p] = h;
              this.hostCount[h]!++;
              this.mark(p, cam);
              this.addObstacle(p, 0, bx0, by0, bx1, by1);
              this.addObstacle(p, 1, plate.x, plate.y, plate.x + this.labelW[p]!, plate.y + this.labelH[p]!);
              if (on) boxes++;
            }
          }
        }
        this.peekMem[p] = fits ? 1 : 0;
      }
    }
  }

  private addObstacle(owner: number, kind: number, x0: number, y0: number, x1: number, y1: number) {
    const k = this.nObs++;
    const o = this.obs;
    o[4 * k] = x0;
    o[4 * k + 1] = y0;
    o[4 * k + 2] = x1;
    o[4 * k + 3] = y1;
    this.obsOwner[k] = owner;
    this.obsKind[k] = kind;
  }

  /**
   * The rectangle keeps `gap` px from every obstacle (the larger of the gaps along x and y), except the box of its `host`. The reserved boxes of the
   * incumbents other than `own` count only when `reserved` (a plate while the incumbents are judged).
   */
  private peekClear(ax0: number, ay0: number, ax1: number, ay1: number, gap: number, host: number, own: number, reserved: boolean): boolean {
    const o = this.obs;
    for (let k = 0; k < this.nObs; k++) {
      const kind = this.obsKind[k];
      if (kind === 0 && this.obsOwner[k] === host) continue;
      if (kind === 2 && (!reserved || this.obsOwner[k] === own)) continue;
      const dx = Math.max(o[4 * k]! - ax1, ax0 - o[4 * k + 2]!);
      const dy = Math.max(o[4 * k + 1]! - ay1, ay0 - o[4 * k + 3]!);
      if ((dx > dy ? dx : dy) < gap) return false;
    }
    return true;
  }

  /**
   * The first of the positions of place `p`'s label (the planner's own: above and below the box on each side, then right and left, with the
   * same room to the box) that is inside `[bx0, bx1] x [by0, by1]` and clear of every obstacle by `gap`; false when there is none.
   */
  private peekPlate(p: number, bx0: number, by0: number, bx1: number, by1: number, gap: number, host: number, keep: boolean, out: { x: number; y: number }): boolean {
    const w = this.labelW[p]!;
    const h = this.labelH[p]!;
    const r0 = this.boxX0[p]!;
    const t0 = this.boxY0[p]!;
    const r1 = this.boxX1[p]!;
    const t1 = this.boxY1[p]!;
    const g = LABEL_TYPE.boxGap;
    const bleed = LABEL_TYPE.padX;
    const mine = keep ? this.peekCand[p]! : -1;
    for (let t = 0; t < 7; t++) {
      // the position it had first (while kept), then the six in the planner's order
      const c = t === 0 ? mine : t - 1;
      if (c < 0 || (t > 0 && c === mine)) continue;
      const x = c === 0 || c === 2 ? r0 - bleed : c === 1 || c === 3 ? r1 - w + bleed : c === 4 ? r1 + g : r0 - w - g;
      const y = c < 2 ? t0 - h - g : c < 4 ? t1 + g : t0;
      if (x < bx0 || y < by0 || x + w > bx1 || y + h > by1) continue;
      if (!this.peekClear(x, y, x + w, y + h, gap, host, p, keep)) continue;
      out.x = x;
      out.y = y;
      this.peekCand[p] = c;
      return true;
    }
    return false;
  }

  /** The label planner refused peek `p` and the camera has not moved enough since for the answer to change. */
  private peekBanned(p: number, cam: LodCamera): boolean {
    const z = this.banZoom[p]!;
    if (Number.isNaN(z)) return false;
    if (Math.abs(cam.zoom - z) > LOD.peek.banZoom || Math.hypot(this.px[p]! - this.banX[p]!, this.py[p]! - this.banY[p]!) > LOD.peek.banPx) {
      this.banZoom[p] = NaN;
      return false;
    }
    return true;
  }

  /** Node `i` is wanted drawn, with the interior mask the switch (with its hysteresis) says. */
  private mark(i: number, cam: LodCamera) {
    this.want[i] = 1;
    const minSide = LOD.minBoxCells * cam.cell;
    const f = 1 - smooth((this.side[i]! / minSide - LOD.fillFadeFrom) / (LOD.fillFadeTo - LOD.fillFadeFrom));
    const on = this.fillOn[i]! ? f > LOD.fillHyst.off : f > LOD.fillHyst.on;
    this.fillOn[i] = on ? 1 : 0;
    this.wantFill[i] = this.fillOn[i]!;
  }

  /**
   * The signed gap, in CSS px, of the nearest two children of group `g`, each as the rectangle it would be drawn with and
   * the tab it carries (the tab hangs on the top-left corner and can be wider than the rectangle): the larger of the gaps
   * along x and y, so negative when they overlap on both axes (by how much), 0 when they touch. Infinity when fewer than two
   * children have a visible place. A sweep over the rectangles sorted by left edge: O(m log m) for m children.
   */
  private nearestGap(g: number): number {
    const from = this.childStart[g]!;
    const to = this.childStart[g + 1]!;
    const members = this.members;
    const cap = LOD.sepPx * 4; // beyond a few times the threshold the exact value does not matter
    let m = 0;
    for (let j = from; j < to; j++) {
      const c = this.childList[j]!;
      if (this.isGroup[c] ? members[c]! === 0 : !this.shown[c]) continue;
      // the label's plate sits just above the rectangle's top edge, flush with its left edge
      const bx0 = this.boxX0[c]!;
      this.sx0[m] = bx0 - LABEL_TYPE.padX;
      this.sy0[m] = this.boxY0[c]! - this.labelH[c]! - LABEL_TYPE.boxGap;
      this.sx1[m] = Math.max(this.boxX1[c]!, bx0 - LABEL_TYPE.padX + this.labelW[c]!);
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
