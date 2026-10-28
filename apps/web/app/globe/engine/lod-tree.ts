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
 *     Top down from the roots, a group is either ONE rectangle (closed) or REPLACED by some of its children (open), never both: no node is
 *     ever drawn together with a drawn ancestor. A group OPENS EARLY, as soon as at least `LOD.open.quota` (2; all of them when it has
 *     fewer) of its MOST IMPORTANT children (`labelPriority`, then the true size, then the slug; a child group is as important as the
 *     most important place below it) can be drawn, each as the rectangle and the label it would be drawn with, KEEPING ROOM: `gapPx.enter`
 *     (24 px, relaxed with the zoom: `clearanceAt`) from every other drawn rectangle and label plate (both lines of the label) and from each
 *     other, within the screen's box budget. When it opens, ONLY the children that keep the room are drawn (the others stay hidden, still counted
 *     by the group's total, and come in as the zoom lets them in: crowded children are not shown, the most important ones are kept); a child
 *     group is judged the same way once it is drawn, so the screen shows a mix of regions, countries and places that do not crowd each other,
 *     the coarsest grouping that has such nodes (a crowded group stays ONE rectangle with its count). It closes again, with an easier test
 *     (`gapPx.leave`, 12 px, the budget plus `budgetKeep`), when fewer than the quota still keep that room: a hysteresis, so a camera jittering
 *     around a threshold cannot flap. A group box bigger than `boxMaxTo` of the screen opens whatever the spacing, with its most important
 *     child that keeps the room (or, failing that, its first child whatever the room) and the others as they keep it (it may close again below
 *     `boxMaxFrom`), every group is open from street scale (`forceOpenZoom`: places at the same spot cannot be told apart) and no room is asked
 *     from `crowdOffZoom` (a cluster of places whose boxes overlap is drawn as it is). A group with one visible child is that child's
 *     rectangle. The decisions are taken group by group in a camera independent order (importance, then depth, then slug: a parent before
 *     its children), each against what the groups before it left drawn, so the result never depends on the order of the input and a group's
 *     choice never depends on a group decided after it.
 *   - So a place alone, and a group whose members are spread out, are never boxed together: a lone place is its own rectangle
 *     at every zoom, a country with two distant places shows two rectangles, ten places 50 km apart are one rectangle (the
 *     group, whose second line says "10 places") until its two most important ones fit, and continents and subregions are only drawn on
 *     crowded views.
 *
 * BINARY STATE, TIMED TRANSITIONS (docs/web-architecture.md, "Binary visibility"). The cut decides only a TARGET per node: drawn or
 * not, with the hysteresis above (the same for the box that is "bigger than the screen", `sizeFadeFrom` .. `sizeFadeTo`, and for the
 * interior mask, `fillHyst`). The opacity of a node is its own `FadeArray` value (engine/fade.ts), run towards the target by TIME over
 * `FADE_MS` whatever the camera does, so at rest every node is fully drawn or not drawn at all, never half way. A group that opens and the
 * children it opens into are retargeted in the SAME `update` (one clock, one duration, one ease, a smoothstep of a linear progress): the group
 * goes 1 -> 0 exactly as its children go 0 -> 1, the sum of the group's opacity and any one child's is 1 on the way (never both at full
 * opacity), and a reversal keeps the pair in step. A node's opacity never depends on its parent's: a place whose ancestors are all open
 * (none is drawn) is drawn at full opacity, London under an open Europe included.
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
import { groupSub, nodeEntryCounts, placeSub, subText, type EntryRef, type LabelSub } from "./label-sub";
import { LABEL_TYPE, labelText } from "./label-text";
import { holdBleedOnScreen, SPOT } from "./pixel-labels";
import { TUNING } from "./tuning";
import { markerShown } from "./visibility";

export type GroupKind = "continent" | "subregion" | "region" | "country" | "area";
export type NodeKind = "place" | GroupKind;

/** THE tuning table of the detection boxes and their cut (docs/web-architecture.md, "Detection boxes"). */
export const LOD = {
  /** The half side of a place's box is its view radius over this: the framed place's box then fits the free area with the framing's 25 % margin. */
  halfSideDivisor: 1.25,
  /**
   * The room a box reserves for the CUT: at least this many art cells across (9 cells = 22 CSS px at 2.5 px): far away places are small
   * rectangles, not dots, and the cut (which boxes and labels fit, which groups open) keeps its room from this footprint. It is not what is
   * drawn: the rectangle that is drawn, labelled and picked is `drawX0..drawY1`, whose floor is `floorCells`.
   */
  minBoxCells: 9,
  /**
   * The smallest a box is DRAWN (2026-10-13, owner: "the min height and width could be smaller", it was `minBoxCells`): 5 cells = 12.5 CSS px at
   * 2.5 px, 10 px on a phone. A box at this size is a closed rectangle with its interior masked, and it opens into corner arms and dashes as its
   * true size grows (engine/pixel-labels.ts `boxOpenness`: from `floorCells` to twice it). The drawn rectangle is concentric with, and inside,
   * the footprint, so the cut's decisions (which are made on footprints) do not depend on it. Its pointer target is at least `HIT.minBoxPx`.
   */
  floorCells: 5,
  /** The mask of a box at the minimum size: its TRUE side as a multiple of the minimum goes from `fillFadeFrom` (masked) to `fillFadeTo` (hollow); the switch has the hysteresis `fillHyst`. */
  fillFadeFrom: 1,
  fillFadeTo: 1.6,
  /** The mask is switched off once `1 - smoothstep(side ratio)` falls to `off` and back on once it rises to `on`; in between it keeps its state. */
  fillHyst: { off: 0.3, on: 0.7 },
  /** A group's rectangle has this many cells of room around the union of its places' rectangles (so a child's outline never coincides with it). */
  padCells: 2,
  /** A group's rectangle wider (or taller) than `boxMaxTo` of the smaller free side opens whatever the spacing, with all its children; it may close again below `boxMaxFrom`. */
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
  /** A node can be picked once it is at least this opaque (a ghost mid-fade is not a target) ... */
  pickAlphaMin: 0.3,
  /** ... except a node on its way OUT (the cut no longer wants it): it is a target only while it is still at least this opaque, so a fading group never steals a click from the children that replace it. */
  pickFadingMin: 0.5,
  /** Label priority: selected and focused first, then places before groups. */
  placePriorityBonus: 30,
  /**
   * EARLY OPENING of a closed group (docs/web-architecture.md, "Opening a group into its most important children"). Every length is in CSS px of
   * the host's space.
   */
  open: {
    /** A group opens when at least this many of its most important children fit (all of them when it has fewer). */
    quota: 2,
    /** Clear gap from every other drawn box and label (the larger of the gaps along x and y): a child is taken at `enter`, kept down to `leave`. */
    gapPx: { enter: 24, leave: 12 },
    /**
     * The room a label's PLATE (both lines) keeps from every other box and plate is this fraction of `gapPx` (a plate is padded:
     * 16 px of a box's 24). At the full 24 px the groups of the complaint opened 0.65 (Western Europe) and 1.15 (Central Europe, its second node)
     * of a level later than before in the browser, at 2/3 they are within 0.3.
     */
    plateGapRatio: 2 / 3,
    /** The clearance relaxes with the zoom, from `gapPx` below `relaxZoom.from` to this at `relaxZoom.to` and above (close up the places are individually small and what crowds is a cluster whose boxes overlap: nothing is kept out of the screen for ever). */
    gapRelaxedPx: { enter: 8, leave: 3 },
    relaxZoom: { from: 6.5, to: 9 },
    /** From this zoom no clearance is asked at all (the budget still holds): a cluster of places whose boxes overlap is drawn as it is. */
    crowdOffZoom: 10,
    /** Boxes on the screen (a 1440 x 900 free area; scaled by the free area, within `budgetMin`..`budgetMax`): a new child needs fewer than `budget`, a kept one fewer than `budget + budgetKeep`. */
    budget: 30,
    budgetKeep: 4,
    budgetRefArea: 1440 * 900,
    budgetMin: 8,
    budgetMax: 60,
    /**
     * A group that was open (also through one unit) merges back into its box only on a zoom-out, this many levels below the zoom it opened at, and
     * when the box keeps the room of a newcomer (`LodTree.stayThrough`). (An incumbent BOX on a zoom-in or a pan is kept without the leave test, the
     * gaps only grow, as long as nothing touches it: `touchPx`; on a zoom-out it is judged by the leave test at every step.)
     */
    stickyZoom: 0.4,
    /** At most this many children of a group (the most important ones) are tried per evaluation: a safety for flat groups of thousands of places. */
    maxTried: 64,
    /** An incumbent kept without the leave test (a zoom-in, a pan) must still be at least this far from every other box and label. */
    touchPx: 3,
    /** A group that does not fit as a box and cannot open into two children (an area, a country, or any group that is an extra) is replaced by the first of this many of its most important children that fits (a minor place does not stand in for it). */
    throughTop: 3,
    /** A group is judged only while its box is within this many px of the free area (further out nothing of it is seen: it stays closed, and one that pans in is judged before it is seen). */
    judgeMarginPx: 160,
  },
} as const;

const smooth = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

/**
 * The clearance (px) a child has to keep from every other box and label at a unified zoom: taken at `enter`, kept down to `leave`
 * (`LOD.open.gapPx`), relaxed from `relaxZoom.from` to `relaxZoom.to` to `gapRelaxedPx`, and not asked at all from `crowdOffZoom`. Pure.
 */
export function clearanceAt(zoom: number): { enter: number; leave: number } {
  const O = LOD.open;
  if (zoom >= O.crowdOffZoom) return { enter: -1e9, leave: -1e9 };
  const r = smooth((zoom - O.relaxZoom.from) / (O.relaxZoom.to - O.relaxZoom.from));
  return { enter: O.gapPx.enter + (O.gapRelaxedPx.enter - O.gapPx.enter) * r, leave: O.gapPx.leave + (O.gapRelaxedPx.leave - O.gapPx.leave) * r };
}

/** What the tree needs from a node (`GlobePlace` and `GlobeGroup` both fit through `buildLodNodes`). */
export interface LodNodeInput {
  slug: string;
  name: string;
  kind: NodeKind;
  /** Slug of the enclosing group. */
  parent?: string | undefined;
  /** ISO 3166-1 alpha-2 code of a place's country (its label's second line says it: engine/country-names.ts). */
  countryCode?: string | undefined;
  /** The entries (articles, artworks, software...) linked to a place: its label's second line counts them by kind, a group's counts the distinct ones below it (engine/label-sub.ts). */
  entries?: readonly EntryRef[] | undefined;
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
  /** y of the projection centre (the middle of the height, shifted up while the landing hero covers the bottom: `GlobeProps.coverBottom`). */
  centreY: number;
  /** Smaller side of the free map area (free width, height): the unit of the size rules. */
  refPx: number;
  /** Width of the free map area, centred on `centreX` (the area the detail panel leaves): the screen of the early opening (`LOD.open`). */
  freeWidth: number;
  /** CSS px per art pixel. */
  cell: number;
}

/** The camera of an evaluation. */
export function setLodCamera(
  cam: LodCamera,
  view: { lon: number; lat: number; zoom: number },
  space: { width: number; height: number; centreX: number; centreY?: number },
  freeWidthPx: number,
  cell: number,
) {
  cam.lon = view.lon;
  cam.lat = view.lat;
  cam.zoom = view.zoom;
  cam.width = space.width;
  cam.height = space.height;
  cam.centreX = space.centreX;
  cam.centreY = space.centreY ?? space.height / 2;
  cam.refPx = Math.max(1, Math.min(freeWidthPx, space.height));
  cam.freeWidth = Math.max(1, freeWidthPx);
  cam.cell = cell;
}

export const newLodCamera = (): LodCamera => ({ lon: 0, lat: 0, zoom: 0, width: 1, height: 1, centreX: 0.5, centreY: 0.5, refPx: 1, freeWidth: 1, cell: 3 });

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
  /** Places below each group (0 for a place): the "<N> places" of a group's second line. */
  readonly total: Int32Array;
  /** What a node's label says: the name, and the parts of its second line (engine/label-sub.ts): a place's country (the English name of its `countryCode`, when known) and entries by kind, a group's "<N> places" and the entries below it; null when there is none. */
  readonly text: string[];
  readonly sub: (LabelSub | null)[];
  /** CSS px across and high of every node's label as it is written whole (name and second line; engine/label-text.ts): part of the node for the cut. */
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
  /**
   * How present the overlay (boxes and labels) is as a WHOLE, one timed value: the same primitive, duration and ease as every node's own
   * opacity, started by the same call (`setSuppressed`), so whatever should leave while the overlay arrives (the flat ring of type) can follow
   * it exactly. 1 = the overlay is wanted, 0 = suppressed.
   */
  private readonly overlay: FadeArray;
  /** Side in CSS px of a node's TRUE box (a place: its extent without the minimum; a group: the union of its places' drawn boxes, without the padding). */
  readonly side: Float64Array;
  /** Visible places below a group (a group's rectangle wraps only these). */
  readonly members: Int32Array;
  /** Rectangle of a drawn node (host projection space, CSS px, unsnapped). */
  /** Rectangle of a drawn node (host projection space, CSS px, unsnapped). */
  readonly boxX0: Float64Array;
  readonly boxY0: Float64Array;
  readonly boxX1: Float64Array;
  readonly boxY1: Float64Array;
  /**
   * The rectangle that is DRAWN (and labelled and picked), the same space and the same centre as `box*`: its floor is `LOD.floorCells` where the
   * footprint's is `LOD.minBoxCells`, so it is the footprint or inside it. `box*` is the room the cut keeps.
   */
  readonly drawX0: Float64Array;
  readonly drawY0: Float64Array;
  readonly drawX1: Float64Array;
  readonly drawY1: Float64Array;
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
  /**
   * Persistent decisions (the hysteresis memory): a group is open (replaced by its children), the size trigger of a group is on, the children of an
   * early-opened group that were drawn, a node's box is hidden for being bigger than the screen, an interior mask is on.
   */
  private readonly open: Uint8Array;
  private readonly sizeOpen: Uint8Array;
  private readonly decided: Uint8Array;
  private readonly admitted: Uint8Array;
  /** Node was drawn as a BOX in the last cut (in the plan, not open): only such an incumbent keeps its box without a geometry test (`fits`); an open group's box was never drawn. */
  private readonly boxedPrev: Uint8Array;
  /** The zoom a node was taken at (the start of its tenure as a child of an open group); meaningful while `admitted`. */
  private readonly admitZoom: Float64Array;
  /** The zoom a group was last opened at (the start of its being open, not of its being in the plan); meaningful while `open`. `openPrev` is `open` of the evaluation before. */
  private readonly openZoom: Float64Array;
  private readonly openPrev: Uint8Array;
  /** The zoom of the last cut, and whether this one zooms OUT from it (a group open through its places goes back to its box only on a zoom-out). */
  private prevZoom = NaN;
  private zoomingOut = false;
  private readonly bigHidden: Uint8Array;
  private readonly fillOn: Uint8Array;
  /** What the last evaluation wants drawn, and the mask each of those wants. */
  private readonly want: Uint8Array;
  private readonly wantFill: Uint8Array;
  /** Node indices by depth, parents first: the order of `visible`. */
  private readonly byDepth: Int32Array;
  // ---- the cut: the scratch of one evaluation ----
  /** The camera of the evaluation. */
  private cam: LodCamera = newLodCamera();
  /**
   * The PLAN of the evaluation: the nodes of the frontier, in the order they were decided: a root, or a node below a group that opens. A group
   * is `open` (replaced by its children) or one more box. Trials add to it and roll back by truncating it.
   */
  private readonly planNode: Int32Array;
  /** Per plan entry: -1 for a box, else the group is open and this many of its visible children (most important first) have been decided; the rest are the extras of `fillExtras`. */
  private readonly planKids: Int32Array;
  private nPlan = 0;
  /** Where each node is in the plan (checked by `slotOf`: a trial that rolls back leaves stale entries). */
  private readonly planIndex: Int32Array;
  /** The groups above a forced place (the selected, the focused, the stops of the shown routes): they open, whatever the room, so that no group is drawn together with a place below it. */
  private readonly mustOpen: Uint8Array;
  /** The cut is in its GROW sweep (newcomers, ENTER thresholds), else in KEEP (the incumbents, LEAVE thresholds). */
  private growing = false;
  /** The nodes of the plan, by index (rebuilt at the end of the cut). */
  private readonly planned: Uint8Array;
  /** The visible children of the groups being judged (a stack: most important first). */
  private readonly kidStack: Int32Array;
  private kidTop = 0;
  /** Scratch of `growBoxes` and `fillExtras`: the candidates. */
  private readonly extraList: Int32Array;
  /** Position of every node in the importance order (0 = the most important): camera independent. */
  private readonly rank: Int32Array;
  /** Which of the six plate positions a child's label took (-1: none): an incumbent tries it first, so a position does not flip between two that are both free. */
  private readonly plateCand: Int8Array;
  /** The position the last cut RESERVED for a drawn box's label (`plateSlot`), -1 when it was not tested (a box drawn whatever the room). */
  private readonly slotNow: Int8Array;
  /** Obstacles of the judgement: rectangles (4 numbers each), the node they belong to and 0 for its box, 1 for its label's plate, 2 for the reserved box of an incumbent. */
  private obs: Float64Array;
  private obsOwner: Int32Array;
  private obsKind: Uint8Array;
  private nObs = 0;
  /** A node whose obstacles no longer count (a group that opened: its children replace it). */
  private readonly gone: Uint8Array;
  /** Boxes on the screen so far in this evaluation (live nodes whose rectangle touches the free area), the nodes counted in it, and the box budget of the screen. */
  private boxes = 0;
  private readonly inBoxes: Uint8Array;
  private budget = 0;
  /** The clearance of the evaluation (`LOD.open.gapPx`, relaxed with the zoom). */
  private gapEnter = 0;
  private gapLeave = 0;
  /** The free area of the evaluation (x range; y is 0 .. height) and the plate `fits` found. */
  private vx0 = 0;
  private vx1 = 0;
  private vy1 = 0;
  private plateX = 0;
  private plateY = 0;
  private key = new Float64Array(10);
  /** The overlay is hidden as a whole (`setSuppressed`): every node's target is OFF, so boxes and labels fade out by their own timed opacity and are no click targets. */
  private suppressed = false;
  private keyValid = false;
  private lastForced0 = -2;
  private lastForced1 = -2;
  private lastReduced = false;
  private lastNow = 0;
  private rebuild = true;
  /** More places that are always drawn (the stops of the selected place's routes); set by `setExtraForced`. */
  private extra: number[] = [];
  private scratch: ScreenPoint = { x: 0, y: 0, visible: false, facing: 0 };

  /** Whether groups open early (`LOD.open`). Off, a group opens only by the size rule: what the map did before (measurements and tests compare the two). */
  private readonly early: boolean;

  constructor(nodes: readonly LodNodeInput[], options: { early?: boolean } = {}) {
    this.early = options.early !== false;
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
    // Children in CSR form (put in importance order at the end of the constructor).
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
    // Label text: the name, and a second line that is always there when it has something to say: a place's country (the same for every place) and
    // entries, a group's number of places and entries (engine/label-sub.ts).
    this.text = list.map((x) => x.name);
    const entries = nodeEntryCounts(this.parent, list.map((x) => x.entries));
    this.sub = list.map((x, i) => (this.isGroup[i] ? groupSub(this.total[i]!, entries[i]) : placeSub(countryName(x.countryCode), entries[i])));
    this.labelW = new Float32Array(n);
    this.labelH = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = labelText(this.text[i]!, subText(this.sub[i]!));
      this.labelW[i] = t.w;
      this.labelH[i] = t.h;
    }

    this.visible = new Int32Array(n);
    this.alpha = new Float32Array(n);
    this.level = new Uint8Array(n);
    this.fillAlpha = new Float32Array(n);
    this.life = new FadeArray(n);
    this.mask = new FadeArray(n);
    this.overlay = new FadeArray(1);
    this.overlay.snap(0, true);
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
    this.drawX0 = new Float64Array(n);
    this.drawY0 = new Float64Array(n);
    this.drawX1 = new Float64Array(n);
    this.drawY1 = new Float64Array(n);
    this.trueX0 = new Float64Array(n);
    this.trueY0 = new Float64Array(n);
    this.trueX1 = new Float64Array(n);
    this.trueY1 = new Float64Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.shown = new Uint8Array(n);
    this.open = new Uint8Array(n);
    this.sizeOpen = new Uint8Array(n);
    this.admitted = new Uint8Array(n);
    this.boxedPrev = new Uint8Array(n);
    this.admitZoom = new Float64Array(n);
    this.openZoom = new Float64Array(n);
    this.openPrev = new Uint8Array(n);
    this.gone = new Uint8Array(n);
    this.planNode = new Int32Array(n + 8);
    this.planKids = new Int32Array(n + 8);
    this.planned = new Uint8Array(n);
    this.planIndex = new Int32Array(n).fill(-1);
    this.mustOpen = new Uint8Array(n);
    this.kidStack = new Int32Array(n + 8);
    this.extraList = new Int32Array(n + 8);
    this.inBoxes = new Uint8Array(n);
    this.plateCand = new Int8Array(n).fill(-1);
    this.slotNow = new Int8Array(n).fill(-1);
    this.obs = new Float64Array(4 * (4 * n + 16));
    this.obsOwner = new Int32Array(4 * n + 16);
    this.obsKind = new Uint8Array(4 * n + 16);

    // Importance, camera independent: a place's `labelPriority`, a group's is the best below it. Ties: the larger true size (km), then the slug.
    // The children, and the roots, are kept most important first: the order the cut judges them in.
    const sizeKm = (i: number) => (this.halfXKm[i]! > 0 ? 2 * Math.max(this.halfXKm[i]!, this.halfYKm[i]!) : (2 * this.radiusKm[i]!) / LOD.halfSideDivisor);
    const imp = new Float64Array(n).fill(-Infinity);
    for (const p of this.places) for (let a = p; a >= 0; a = this.parent[a]!) imp[a] = Math.max(imp[a]!, this.priority[p]!);
    const bySlug = (a: number, b: number) => (this.slug[a]! < this.slug[b]! ? -1 : this.slug[a]! > this.slug[b]! ? 1 : 0);
    const moreImportant = (a: number, b: number) => imp[b]! - imp[a]! || sizeKm(b) - sizeKm(a) || bySlug(a, b);
    for (let g = 0; g < n; g++) {
      const sorted = this.childList.slice(this.childStart[g]!, this.childStart[g + 1]!).sort(moreImportant);
      this.childList.set(sorted, this.childStart[g]!);
    }
    this.roots.sort(moreImportant);
    this.rank = new Int32Array(n);
    Int32Array.from({ length: n }, (_, i) => i)
      .sort(moreImportant)
      .forEach((node, r) => (this.rank[node] = r));
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
      k[9] === cam.centreY &&
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
    k[9] = cam.centreY;
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

  /**
   * Hide every box and label (the home screen's caption replaces them: `GlobeProps.showcase`) or bring them back: the targets of all nodes
   * go OFF (or back to what the cut wants) and each runs to it by its own timed opacity (engine/fade.ts), so the overlay cross-fades with
   * whatever replaces it and a node that is mostly gone takes no click (`pickAlpha`). The cut itself is untouched: nothing is re-planned.
   */
  setSuppressed(on: boolean, snap = false): void {
    if (on === this.suppressed) return;
    this.suppressed = on;
    this.keyValid = false;
    // (`snap`: the page's first state: the overlay begins out, nothing fades in the first frame)
    if (snap) this.overlay.snap(0, !on);
    else this.overlay.set(0, !on);
  }

  /**
   * Hide every box and label IN THIS FRAME: suppressed, with the overlay and every node's own opacity snapped to out (`setSuppressed` alone lets each node fade by its own timer). For a
   * view that changes under them at once (an interlude begun from the explore view: the page's camera goes home, and the boxes and labels would hang in the wrong places while they went).
   */
  suppressNow(): void {
    this.setSuppressed(true, true);
    for (let i = 0; i < this.size; i++) this.life.snap(i, false);
    this.keyValid = false;
    this.rebuild = true;
  }

  /** The overlay's presence as a whole, 0..1 (`overlay`): eased like a node's opacity, run by the same clock. */
  get overlayAlpha(): number {
    return this.overlay.value(0);
  }

  get isSuppressed(): boolean {
    return this.suppressed;
  }

  /** True while some transition (a node, a mask) has not reached its target: the host's frame loop must keep going. */
  get animating(): boolean {
    return this.life.moving || this.mask.moving || this.overlay.moving;
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
      this.overlay.step(dt, instant);
    }
    if (moved || this.rebuild) this.build();
    return this.animating;
  }

  /** Run every transition to its end now (tests and the checks' resting frame; the next `advance` redraws). */
  settle(): void {
    this.life.settle();
    this.mask.settle();
    this.overlay.settle();
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

  /**
   * Group `i` was open (replaced by its children, or by those of them that fit) in the last evaluation. False for a place, for a group that is
   * drawn as a box, and for one whose own ancestors are closed.
   */
  isOpen(i: number): boolean {
    return this.open[i] === 1;
  }

  /**
   * The position of node `i`'s label the last cut RESERVED when it took the box, clear of every other box and label by the cut's gap: 0 above the
   * box's left edge, 1 above its right edge, 2 below the left edge, 3 below the right edge, 4 right of the box, 5 left of it; -1 for a node whose
   * box was drawn whatever the room. The label planner takes it first (`PlanItem.pref`), so the labels it places keep the room the cut checked.
   */
  plateSlot(i: number): number {
    return this.slotNow[i]!;
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
      const on = this.want[i] === 1 && !this.suppressed;
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
    const floorHalf = (LOD.floorCells * cell) / 2;
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
    const dx0 = this.drawX0;
    const dy0 = this.drawY0;
    const dx1 = this.drawX1;
    const dy1 = this.drawY1;

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
      projectUnit(vec[p3]!, vec[p3 + 1]!, vec[p3 + 2]!, basis, cam.height, 1, cam.centreX, out, cam.centreY);
      const shown = markerShown(out, basis, cam.centreX, cam.centreY, clearance);
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
      // ... and the rectangle that is drawn has the lower floor, about the same centre
      const fx = trueX < floorHalf ? floorHalf : trueX;
      const fy = trueY < floorHalf ? floorHalf : trueY;
      dx0[p] = out.x - fx;
      dx1[p] = out.x + fx;
      dy0[p] = out.y - fy;
      dy1[p] = out.y + fy;
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
      const fx = (w < 2 * floorHalf ? floorHalf : w / 2) + pad;
      const fy = (h < 2 * floorHalf ? floorHalf : h / 2) + pad;
      dx0[g] = cx - fx;
      dx1[g] = cx + fx;
      dy0[g] = cy - fy;
      dy1[g] = cy + fy;
    }

    // 2. top down: which nodes the cut wants drawn (`cut`), then the selected, the focused place and the stops of the shown routes, which are
    // always wanted.
    this.want.fill(0);
    this.mustOpen.fill(0);
    const extra = this.extra;
    for (let n = 0; n < 2 + extra.length; n++) {
      const i = n === 0 ? forced0 : n === 1 ? forced1 : extra[n - 2]!;
      if (i < 0 || i >= this.size || this.isGroup[i] || !this.shown[i]) continue;
      for (let a = this.parent[i]!; a >= 0; a = this.parent[a]!) this.mustOpen[a] = 1;
    }
    this.cut(cam);
    for (let n = 0; n < 2 + extra.length; n++) {
      const i = n === 0 ? forced0 : n === 1 ? forced1 : extra[n - 2]!;
      if (i < 0 || i >= this.size || this.isGroup[i]) continue;
      this.mark(i, cam);
    }
    this.visited = this.nPlan;
  }

  /**
   * The CUT (see the header), depth first in importance order, in two sweeps so that what is already drawn is never displaced by what is new:
   *   1. KEEP. The roots' rectangles are laid down as obstacles (every root is a box until it is decided), then every group that was OPEN in the last
   *      evaluation is `resolve`d again with the LEAVE thresholds, and the extras that were drawn are kept (`fillExtras`). A group that is not open
   *      stays a box.
   *   2. GROW. The groups that are boxes try to open with the ENTER thresholds (`growBoxes`, most important first, the groups that just opened
   *      tried in the next round), then the other children are added (`fillExtras`).
   * So a camera that moves a little never trades an incumbent for a newcomer, and an incumbent is only lost when its own surroundings no longer
   * leave it the room.
   *
   * `resolve(g)` decides ONE group: it opens (its plan entries follow its own) or it stays a box:
   *   - a group with ONE visible child is that child's rectangle (open, no test);
   *   - a group whose rectangle is `boxMaxTo` of the screen, or any group from street scale, is open with ALL its children (`sizeOpen`, its own
   *     hysteresis down to `boxMaxFrom`);
   *   - otherwise `LOD.open`: its first `quota` children, most important first, are tried one by one (`tryKid`: a child group is itself resolved
   *     first, so it opens into ITS top children when they fit, else it is a box if the box fits). The group opens when they were all taken (a
   *     group never opens leaving out the most important of its children for lesser ones); else it stays one rectangle and the trial leaves no
   *     trace (obstacles, plan, budget are rolled back).
   * Everything a trial leaves on the screen is an obstacle for the children tried after it. Cost: the trials of the groups whose rectangle is big
   * enough to hold two boxes and near the screen, each child against the obstacles near the screen; nothing for a group the size rule opens.
   */
  private cut(cam: LodCamera) {
    const O = LOD.open;
    this.cam = cam;
    this.zoomingOut = cam.zoom < this.prevZoom;
    this.prevZoom = cam.zoom;
    this.gone.fill(0);
    this.slotNow.fill(-1);
    this.inBoxes.fill(0);
    this.planIndex.fill(-1);
    this.nPlan = 0;
    this.nObs = 0;
    this.boxes = 0;
    this.kidTop = 0;
    const room = clearanceAt(cam.zoom);
    this.gapEnter = room.enter;
    this.gapLeave = room.leave;
    this.vx0 = cam.centreX - cam.freeWidth / 2;
    this.vx1 = this.vx0 + cam.freeWidth;
    this.vy1 = cam.height;
    this.budget = Math.max(O.budgetMin, Math.min(O.budgetMax, Math.round((O.budget * cam.freeWidth * cam.height) / O.budgetRefArea)));
    for (const r of this.roots) {
      if (this.isGroup[r] ? this.members[r]! > 0 : this.shown[r] === 1) this.lay(r);
    }
    this.growing = false;
    for (const r of this.roots) {
      if (this.isGroup[r] ? this.members[r]! === 0 : this.shown[r] === 0) continue;
      if (!this.isGroup[r] || !this.resolve(r)) this.planBox(r);
    }
    this.fillExtras();
    this.growing = true;
    this.growBoxes();
    this.fillExtras();
    // the memory: what the plan drew is what the next evaluation's trials call incumbents
    this.openPrev.set(this.open);
    this.open.fill(0);
    const wasPlanned = this.planned;
    wasPlanned.fill(0);
    for (let k = 0; k < this.nPlan; k++) if (!this.admitted[this.planNode[k]!]) this.admitZoom[this.planNode[k]!] = cam.zoom; // (a new tenure)
    this.admitted.fill(0);
    this.boxedPrev.fill(0);
    for (let k = 0; k < this.nPlan; k++) {
      const i = this.planNode[k]!;
      wasPlanned[i] = 1;
      this.admitted[i] = 1;
      if (this.planKids[k]! < 0) this.boxedPrev[i] = 1;
      if (this.planKids[k]! >= 0) {
        this.open[i] = 1;
        if (!this.openPrev[i]) this.openZoom[i] = cam.zoom; // (a new opening)
      }
      // what is drawn: a place that is shown, a group that stayed closed
      else if (!this.bigHidden[i] && (this.isGroup[i] ? this.members[i]! > 0 : this.shown[i] === 1)) this.mark(i, cam);
    }
    // the size rule's memory of a group the cut did not reach (an ancestor is closed) starts again from "closed" when it is reached
    for (const g of this.groups) {
      if (wasPlanned[g]) continue;
      this.sizeOpen[g] = 0;
      this.decided[g] = 0;
    }
  }

  /** The plan entry of node `i`, or -1 when it is not in the plan (entries rolled back by a trial leave a stale index: it is checked). */
  private slotOf(i: number): number {
    const k = this.planIndex[i]!;
    return k >= 0 && k < this.nPlan && this.planNode[k] === i ? k : -1;
  }

  /**
   * GROW, first half: the groups that are boxes try to open, most important first. A group that opens puts its children in the plan (the groups
   * among them are boxes for the next round). Rounds until none opens.
   */
  private growBoxes() {
    for (let round = 0; round < 8; round++) {
      const list = this.extraList;
      let n = 0;
      for (let k = 0; k < this.nPlan; k++) {
        const g = this.planNode[k]!;
        if (this.planKids[k]! < 0 && this.isGroup[g] && this.members[g]! > 0) list[n++] = g;
      }
      if (n === 0) return;
      const groups = list.subarray(0, n);
      groups.sort((a, b) => this.rank[a]! - this.rank[b]!);
      let opened = false;
      for (let t = 0; t < n; t++) if (this.resolve(groups[t]!)) opened = true;
      if (!opened) return;
    }
  }

  /**
   * The EXTRAS: the open groups' other children (everything after the first `quota`), which do not decide whether a group opens. Taken after
   * every group is decided, so the most important children of all the groups come first and a less important one never takes the place of a more
   * important one in the group next to it. All the candidates are ordered by importance (`rank`). In KEEP the extras that were drawn last time are
   * kept (LEAVE thresholds); in GROW the others are tried (ENTER ones). A child group among them is resolved like any other (it may open into
   * its own most important children, whose extras are the next round's).
   */
  private fillExtras() {
    const O = LOD.open;
    for (let round = 0; round < 8; round++) {
      const cand = this.extraList;
      let n = 0;
      for (let k = 0; k < this.nPlan; k++) {
        const g = this.planNode[k]!;
        const done = this.planKids[k]!;
        if (done < 0) continue;
        let t = 0;
        for (let j = this.childStart[g]!, to = this.childStart[g + 1]!; j < to && t < O.maxTried; j++) {
          const c = this.childList[j]!;
          if (this.isGroup[c] ? this.members[c]! === 0 : this.shown[c] === 0) continue;
          if (t++ >= done && (this.growing ? this.slotOf(c) < 0 : this.admitted[c] === 1 && this.slotOf(c) < 0)) cand[n++] = c;
        }
      }
      if (n === 0) return;
      const list = cand.subarray(0, n);
      list.sort((a, b) => this.rank[a]! - this.rank[b]!);
      const start = this.nObs;
      if (!this.growing) for (let t = 0; t < n; t++) this.addObstacle(list[t]!, 2, this.boxX0[list[t]!]!, this.boxY0[list[t]!]!, this.boxX1[list[t]!]!, this.boxY1[list[t]!]!);
      const before = this.nPlan;
      for (let t = 0; t < n; t++) {
        this.tryKid(list[t]!, true);
        // its reservation is over once it is decided (taken, its real rectangles stand; not taken, it must not keep a better neighbour out)
        if (!this.growing) this.obsKind[start + t] = 3;
      }
      for (let k = start; k < this.nObs; k++) if (this.obsKind[k] === 2) this.obsKind[k] = 3; // (the reservations are over)
      if (this.nPlan === before) return;
    }
  }

  /** Node `i` as a box with the label it would carry: its rectangle and its plate at the first position are obstacles, and it counts for the budget (a root, or a child that has to be drawn). */
  private lay(i: number) {
    const x0 = this.boxX0[i]!;
    const y0 = this.boxY0[i]!;
    const x1 = this.boxX1[i]!;
    const y1 = this.boxY1[i]!;
    const frac = Math.max(x1 - x0, y1 - y0) / this.cam.refPx;
    const hidden = this.bigHidden[i]! ? frac > LOD.sizeFadeFrom : frac >= LOD.sizeFadeTo;
    this.bigHidden[i] = hidden ? 1 : 0; // (a rectangle bigger than the screen is an outline you are inside: hidden, with a hysteresis band)
    if (hidden) return;
    this.countBox(i);
    if (x1 < this.vx0 - 400 || x0 > this.vx1 + 400 || y1 < -400 || y0 > this.vy1 + 400) return; // (an obstacle is only worth keeping near the screen)
    this.addObstacle(i, 0, x0, y0, x1, y1);
    const tx = x0 - LABEL_TYPE.bleed;
    this.addObstacle(i, 1, tx, y0 - this.labelH[i]! - LABEL_TYPE.boxGap, tx + this.labelW[i]!, y0 - LABEL_TYPE.boxGap);
  }

  /** Node `i` stays a box: it joins the plan. */
  private planBox(i: number) {
    this.planIndex[i] = this.nPlan;
    this.planNode[this.nPlan] = i;
    this.planKids[this.nPlan++] = -1;
  }

  /** Node `i` is a box on the screen if its rectangle touches the free area: counted once for the budget. */
  private countBox(i: number) {
    if (this.boxX1[i]! > this.vx0 && this.boxX0[i]! < this.vx1 && this.boxY1[i]! > 0 && this.boxY0[i]! < this.vy1) {
      this.boxes++;
      this.inBoxes[i] = 1;
    }
  }

  /**
   * Child `c` of a group that opens for good must be drawn, in whatever form: opened into its own children, else (when it was open through its
   * most important unit, `tryKid`) still open through it, so a group that opens by the size rule does not take back a node that was drawn, else
   * as a box.
   */
  private present(c: number) {
    if (this.isGroup[c] && (this.resolve(c) || (this.stayThrough(c) && this.resolve(c, true)))) return;
    this.planBox(c);
    this.lay(c);
  }

  /**
   * Decide group `g` (reached with at least one visible place; in GROW it may be a box already): true when it is OPEN, with the plan entries of
   * what replaces it; false when it stays a box, with nothing added (the caller draws its box or leaves it out).
   */
  private resolve(g: number, through = false): boolean {
    const O = LOD.open;
    const cam = this.cam;
    // the visible children, most important first (the children are stored in that order)
    const base = this.kidTop;
    let nk = 0;
    for (let j = this.childStart[g]!, to = this.childStart[g + 1]!; j < to; j++) {
      const c = this.childList[j]!;
      if (this.isGroup[c] ? this.members[c]! > 0 : this.shown[c] === 1) this.kidStack[base + nk++] = c;
    }
    if (nk === 0) return false;
    this.kidTop = base + nk;
    const frac = Math.max(this.boxX1[g]! - this.boxX0[g]!, this.boxY1[g]! - this.boxY0[g]!) / cam.refPx;
    // the size rule: strongly open (rectangle too big, street scale) / strongly closed; in between the state is kept
    if (frac >= LOD.boxMaxTo || cam.zoom >= LOD.forceOpenZoom) this.sizeOpen[g] = 1;
    else if (frac <= LOD.boxMaxFrom && cam.zoom < LOD.forceOpenZoom - LOD.forceOpenSpan) this.sizeOpen[g] = 0;
    else if (!this.decided[g]) this.sizeOpen[g] = frac >= (LOD.boxMaxFrom + LOD.boxMaxTo) / 2 || cam.zoom >= LOD.forceOpenZoom - LOD.forceOpenSpan / 2 ? 1 : 0;
    this.decided[g] = 1;
    const k0 = this.slotOf(g);
    if (nk === 1 || this.sizeOpen[g]) {
      // a group with one visible child is that child's rectangle; a rectangle too big or street scale opens whatever the spacing: all its children.
      // The incumbents are decided first, so the children are presented in that order.
      this.gone[g] = 1;
      this.boxes -= this.inBoxes[g]!;
      this.inBoxes[g] = 0;
      // The group's own rectangle is gone, so something of it must be there. At street scale, or with one visible child, all its children are drawn
      // whatever the room. Otherwise the first of its most important children that keeps the clearance is (as a box, or opened into its own), and when
      // none does, the most important one is drawn all the same: the others are EXTRAS, drawn as they keep the room (`fillExtras`).
      const all = nk === 1 || cam.zoom >= LOD.forceOpenZoom - LOD.forceOpenSpan;
      if (k0 >= 0) this.planKids[k0] = all ? nk : 0;
      else {
        this.planIndex[g] = this.nPlan;
        this.planNode[this.nPlan] = g;
        this.planKids[this.nPlan++] = all ? nk : 0;
      }
      if (all) {
        // (the incumbents are decided first, so the children are presented in that order)
        for (let pass = 0; pass < 2; pass++) {
          for (let t = 0; t < nk; t++) {
            const c = this.kidStack[base + t]!;
            if ((this.admitted[c] === 1) === (pass === 0) && this.slotOf(c) < 0) this.present(c);
          }
        }
      } else {
        const top = Math.min(nk, O.throughTop);
        let chosen = -1;
        for (let t = 0; t < top && chosen < 0; t++) {
          const c = this.kidStack[base + t]!;
          if (!this.growing && this.admitted[c] !== 1) continue; // (a child that was not drawn is a newcomer: GROW's)
          if (this.slotOf(c) >= 0 || this.tryKid(c, true)) chosen = t;
        }
        if (chosen < 0) {
          const c = this.kidStack[base]!;
          if (this.slotOf(c) < 0) this.present(c);
          chosen = 0;
        }
        const entry = this.slotOf(g);
        if (chosen === 0) this.planKids[entry] = 1;
      }
      this.kidTop = base;
      return true;
    }
    // the early opening: judged while its rectangle is near the screen and can hold two boxes, else it stays closed (nothing of it is seen)
    const m = O.judgeMarginPx;
    const w = this.boxX1[g]! - this.boxX0[g]!;
    const h = this.boxY1[g]! - this.boxY0[g]!;
    const holds = Math.max(w, h) >= 2 * LOD.minBoxCells * cam.cell + O.gapPx.leave;
    const near = this.boxX1[g]! > this.vx0 - m && this.boxX0[g]! < this.vx1 + m && this.boxY1[g]! > -m && this.boxY0[g]! < this.vy1 + m;
    // a group opened THROUGH (its own box did not fit, `tryKid`) is replaced by ONE unit, the most important of its first `throughTop` children
    // that fits, so its box needs no room for two; nothing is required of the others (they come in as extras)
    const need = Math.min(through ? O.throughTop : O.quota, nk);
    const wasOpen = this.open[g] === 1;
    // (`holds` is a newcomer's test, a group that is open is judged by its children: a box that grows or shrinks across that size does not flap it)
    let ok = this.early && (through || ((holds || wasOpen) && near)) && (this.growing || wasOpen);
    if (ok && !this.growing) {
      // (a child that was not drawn is a newcomer: GROW's)
      if (through) {
        let any = false;
        for (let t = 0; t < need; t++) any ||= this.admitted[this.kidStack[base + t]!] === 1;
        ok = any;
      } else for (let t = 0; t < need && ok; t++) ok = this.admitted[this.kidStack[base + t]!] === 1;
    }
    if (!ok) {
      this.kidTop = base;
      return this.mustOpen[g] === 1 && this.openEmpty(g, k0);
    }
    const savedObs = this.nObs;
    const savedPlan = this.nPlan;
    const savedBoxes = this.boxes;
    const wasGone = this.gone[g]!;
    this.boxes -= this.inBoxes[g]!; // the group's own rectangle goes if the children are taken
    this.gone[g] = 1;
    const entry = k0 >= 0 ? k0 : this.nPlan++;
    this.planIndex[g] = entry;
    this.planNode[entry] = g;
    const keptKids = k0 >= 0 ? this.planKids[k0]! : 0;
    this.planKids[entry] = through ? 0 : need;
    if (!this.growing && !through) {
      // the incumbents' rectangles are reserved while they are judged, against the plates of the others: a more important incumbent does not put
      // its label over a less important one that is about to be kept, which would drop it for nothing and bring it back a step later
      for (let t = 0; t < need; t++) {
        const c = this.kidStack[base + t]!;
        this.addObstacle(c, 2, this.boxX0[c]!, this.boxY0[c]!, this.boxX1[c]!, this.boxY1[c]!);
      }
    }
    if (through) {
      // the first child that fits stands for the group (a unit that was drawn last time is the only one tried in KEEP)
      ok = false;
      for (let t = 0; t < need && !ok; t++) {
        const c = this.kidStack[base + t]!;
        if (this.growing || this.admitted[c] === 1) ok = this.tryKid(c);
      }
    } else for (let t = 0; t < need && ok; t++) ok = this.tryKid(this.kidStack[base + t]!); // one of the first `quota` children has no place: the group stays closed
    for (let k = savedObs; k < this.nObs; k++) if (this.obsKind[k] === 2) this.obsKind[k] = 3; // (the reservations are over)
    this.kidTop = base;
    if (ok) {
      this.inBoxes[g] = 0;
      return true;
    }
    // not enough room: the trial leaves no trace (the groups it opened below are not open, and not counted, any more)
    for (let k = savedPlan; k < this.nPlan; k++) {
      const i = this.planNode[k]!;
      if (i !== g) {
        this.gone[i] = 0;
        this.inBoxes[i] = 0;
      }
    }
    this.nObs = savedObs;
    this.nPlan = savedPlan;
    this.boxes = savedBoxes;
    this.gone[g] = wasGone;
    if (k0 >= 0) this.planKids[k0] = keptKids;
    else this.planIndex[g] = -1;
    return this.mustOpen[g] === 1 && this.openEmpty(g, k0);
  }

  /** Group `g` opens although its children did not find room: a forced place is below it (`mustOpen`). Its children come in as extras, as they fit. `k0` is its plan entry, or -1. */
  private openEmpty(g: number, k0: number): boolean {
    this.gone[g] = 1;
    this.boxes -= this.inBoxes[g]!;
    this.inBoxes[g] = 0;
    const entry = k0 >= 0 ? k0 : this.nPlan++;
    this.planIndex[g] = entry;
    this.planNode[entry] = g;
    this.planKids[entry] = 0;
    return true;
  }

  /**
   * Child `c` of a group on trial (or an extra), as a DRAWABLE UNIT: a place is its box; a child group is, in this order, (1) opened into its own
   * most important children when the first `quota` of them fit (`resolve`), (2) its own box when that fits, (3) opened THROUGH: replaced by its
   * single most important unit, recursively to any depth (`resolve(c, true)`: a nested area whose box and long label do not fit is replaced by the
   * place or the smaller area inside it). A child group that was open in the last evaluation tries (3) before (2), so a node already drawn is not
   * traded for its group's box. In KEEP the test is the incumbent's (LEAVE thresholds), in GROW the newcomer's. Returns whether something of `c`
   * is on the screen now, with the plan, the obstacles and the budget updated; nothing changes when not.
   */
  private tryKid(c: number, extra = false): boolean {
    if (!this.isGroup[c]) return this.takeBox(c);
    if (this.resolve(c)) return true;
    // (a unit that a group NEEDS in order to open is its box, its own children or, for an AREA, its single most important unit: a country or a
    // region that does not fit does not count, a city does not stand in for it. An extra decides nothing: a group that fits in no other form is
    // replaced by its most important unit)
    const through = extra || this.kind[c] === "area" || this.kind[c] === "country";
    if (!this.growing && this.stayThrough(c)) return this.resolve(c, true) || this.takeBox(c); // (kept as it was: whatever it is, it was open)
    return this.takeBox(c) || (through && this.resolve(c, true));
  }

  /**
   * Group `c` was open in the last evaluation and keeps its place of an incumbent: it is not traded for its own box, unless the camera is back out
   * of the zoom it opened at by `stickyZoom`, is zooming OUT, and the box now fits with the room of a newcomer (`gapPx.enter`): then it merges back into its box (a zoom-out;
   * with the two different gaps, a box that just fits and just does not cannot flip it back and forth). A zoom-in never takes a drawn node away.
   */
  private stayThrough(c: number): boolean {
    if (this.open[c] !== 1) return false;
    return !(this.zoomingOut && this.cam.zoom < this.openZoom[c]! - LOD.open.stickyZoom && this.fits(c, false));
  }

  /** Node `c` as a box if it `fits`: it joins the plan, its rectangle and its label's plate become obstacles and it counts for the budget. */
  private takeBox(c: number): boolean {
    // (KEEP keeps what was drawn as a box: a node that was not is a newcomer, judged with the ENTER thresholds in GROW)
    if (!this.growing && this.boxedPrev[c] !== 1) return false;
    if (!this.fits(c, !this.growing)) return false;
    if (this.slotOf(c) < 0) this.planBox(c);
    this.bigHidden[c] = 0;
    this.slotNow[c] = this.plateCand[c]!;
    this.addObstacle(c, 0, this.boxX0[c]!, this.boxY0[c]!, this.boxX1[c]!, this.boxY1[c]!);
    this.addObstacle(c, 1, this.plateX, this.plateY, this.plateX + this.labelW[c]!, this.plateY + this.labelH[c]!);
    this.countBox(c);
    return true;
  }

  /**
   * Whether child `c` can be drawn as a box: the screen has room for one more box (a box off the screen is free), it keeps `gap` px (the
   * larger of the gaps along x and y) from every other rectangle and label (those of the groups on trial are not counted: they go if their
   * children are taken), and its label has a position (the planner's own, whole label) that keeps the same gap. `keep` is the lenient test of
   * an incumbent: the leave gap, the budget plus `budgetKeep`. The plate it found is left in `plateX`, `plateY`.
   */
  private fits(c: number, keep: boolean): boolean {
    const O = LOD.open;
    const x0 = this.boxX0[c]!;
    const y0 = this.boxY0[c]!;
    const x1 = this.boxX1[c]!;
    const y1 = this.boxY1[c]!;
    // the screen only counts for the budget: a box off it is judged like any other (so what is drawn does not depend on where the edge is, and
    // a box that pans in is already there), its label has its place wherever the planner will put it
    if (keep && this.boxedPrev[c] === 1 && !this.zoomingOut && this.plateCand[c]! >= 0) {
      // an incumbent on a zoom-in or a pan keeps its box and its plate without the leave test (the gaps only grow: see `stickyZoom`), as long as neither touches
      // another node (`TOUCH_PX`) and the plate is still on the canvas
      const touch = Math.min(LOD.open.touchPx, this.gapLeave);
      if (this.clear(x0, y0, x1, y1, touch, c, false, this.isGroup[c] ? -1 : c)) {
        this.plateAt(c, this.plateCand[c]!);
        if (this.plateOnCanvas(c) && this.clear(this.plateX, this.plateY, this.plateX + this.labelW[c]!, this.plateY + this.labelH[c]!, touch, c, false)) return true;
      }
    }
    const onScreen = x1 > this.vx0 && x0 < this.vx1 && y1 > 0 && y0 < this.vy1;
    if (onScreen && this.boxes >= (keep ? this.budget + O.budgetKeep : this.budget)) return false;
    const gap = keep ? this.gapLeave : this.gapEnter;
    if (!this.clear(x0, y0, x1, y1, gap, c, false, this.isGroup[c] ? -1 : c)) return false;
    return this.plateFor(c, gap * O.plateGapRatio, keep);
  }

  /** The plate in `plateX`, `plateY` is nested inside child `c`'s own rectangle (`plateAt` 6). */
  private plateInside(c: number): boolean {
    return this.plateX >= this.boxX0[c]! && this.plateY >= this.boxY0[c]! && this.plateX < this.boxX1[c]! && this.plateY < this.boxY1[c]!;
  }

  /** The true boxes (no minimum size) of places `a` and `b` overlap. */
  private trueOverlap(a: number, b: number): boolean {
    return this.trueX0[a]! < this.trueX1[b]! && this.trueX1[a]! > this.trueX0[b]! && this.trueY0[a]! < this.trueY1[b]! && this.trueY1[a]! > this.trueY0[b]!;
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
   * The rectangle keeps `gap` px from every obstacle (the larger of the gaps along x and y), except those of `own` and of a group on trial or
   * opened (`gone`). The reserved boxes of the incumbents other than `own` count only when `reserved` (a plate while the incumbents are judged).
   */
  private clear(ax0: number, ay0: number, ax1: number, ay1: number, gap: number, own: number, reserved: boolean, boxOf = -1): boolean {
    const o = this.obs;
    for (let k = 0; k < this.nObs; k++) {
      const kind = this.obsKind[k]!;
      const owner = this.obsOwner[k]!;
      if (kind === 3 || owner === own || this.gone[owner]) continue;
      if (kind === 2 && !reserved) continue;
      // two places whose TRUE boxes overlap (two neighbouring communes cut out of each other) never come apart with the zoom: the room between
      // their rectangles is not asked of them (their labels still keep clear)
      if (kind === 0 && boxOf >= 0 && !this.isGroup[owner] && this.trueOverlap(boxOf, owner)) continue;
      const dx = Math.max(o[4 * k]! - ax1, ax0 - o[4 * k + 2]!);
      const dy = Math.max(o[4 * k + 1]! - ay1, ay0 - o[4 * k + 3]!);
      if ((dx > dy ? dx : dy) < gap) return false;
    }
    return true;
  }

  /**
   * The first of the positions of child `c`'s label (the planner's own: above and below the box on each side, then right and left, with the
   * same room to the box) that is clear of every obstacle by `gap`; false when there is none. An incumbent
   * tries the position it had first. Leaves the plate in `plateX`, `plateY`.
   */
  private plateFor(c: number, gap: number, keep: boolean): boolean {
    const w = this.labelW[c]!;
    const h = this.labelH[c]!;
    const mine = keep ? this.plateCand[c]! : -1;
    // An incumbent first looks for a position that is also clear of the reserved boxes of the other incumbents, then, failing that, for one that is clear of what is really there: a more
    // important incumbent is never dropped for a less important one that may itself be dropped (it would come back a step later and flap).
    for (let pass = 0; pass < (keep ? 2 : 1); pass++) {
      for (let t = 0; t < 8; t++) {
        // the position it had first (while kept), then the seven in the planner's order (the nested one last: a box too big for a plate outside it)
        const cand = t === 0 ? mine : t - 1;
        if (cand < 0 || (t > 0 && cand === mine)) continue;
        this.plateAt(c, cand);
        if (!this.plateOnCanvas(c)) continue; // (the planner keeps a plate on the canvas)
        if (!this.clear(this.plateX, this.plateY, this.plateX + w, this.plateY + h, gap, c, keep && pass === 0, this.isGroup[c] ? -1 : c)) continue;
        this.plateCand[c] = cand;
        return true;
      }
    }
    return false;
  }

  /**
   * The plate in `plateX`, `plateY` (child `c`'s label) is on the canvas, or its box is wholly off it: a box that touches the canvas gets a plate on
   * it (a plate beyond an edge is a position the planner does not have); a box wholly off it is judged like any other.
   */
  private plateOnCanvas(c: number): boolean {
    const cam = this.cam;
    const touches = this.boxX1[c]! > 0 && this.boxX0[c]! < cam.width && this.boxY1[c]! > 0 && this.boxY0[c]! < cam.height;
    if (this.plateInside(c)) return this.plateX + this.labelW[c]! <= Math.min(this.boxX1[c]!, cam.width) && this.plateY + this.labelH[c]! <= Math.min(this.boxY1[c]!, cam.height);
    return !touches || (this.plateX >= 0 && this.plateY >= 0 && this.plateX + this.labelW[c]! <= cam.width && this.plateY + this.labelH[c]! <= cam.height);
  }

  /**
   * The plate of child `c`'s label at position `cand` (0 above-left, 1 above-right, 2 below-left, 3 below-right, 4 right, 5 left, 6 nested in the
   * top-left corner of the part of the box on the canvas: the planner's own positions): left in `plateX`, `plateY`. Always true.
   */
  private plateAt(c: number, cand: number): boolean {
    const w = this.labelW[c]!;
    const h = this.labelH[c]!;
    const g = LABEL_TYPE.boxGap;
    const bleed = LABEL_TYPE.bleed;
    if (cand === 6) {
      const inset = this.cam.cell + LABEL_TYPE.nestInset;
      this.plateX = Math.max(this.boxX0[c]!, 0) + inset;
      this.plateY = Math.max(this.boxY0[c]!, 0) + inset;
      return true;
    }
    this.plateX = cand === 0 || cand === 2 ? this.boxX0[c]! - bleed : cand === 1 || cand === 3 ? this.boxX1[c]! - w + bleed : cand === 4 ? this.boxX1[c]! + g : this.boxX0[c]! - w - g;
    // (the same clamp as the planner's `spotAt`, one function: a box within `bleed` of the canvas's edge keeps its slots above its corners. The
    // planner's SLIDE back onto the screen is not shared: it admits plates the cut's calibrated crowding rules were not tuned with, and `open.test.ts`'s
    // sweeps (pairs closer than the leave gap) go over their limits with it)
    if (cand < 4) this.plateX = holdBleedOnScreen(CUT_SPOTS[cand]!, this.plateX, w, this.cam.width, bleed);
    this.plateY = cand < 2 ? this.boxY0[c]! - h - g : cand < 4 ? this.boxY1[c]! + g : this.boxY0[c]! - LABEL_TYPE.bleedY;
    return true;
  }

  /** Node `i` is wanted drawn, with the interior mask the switch (with its hysteresis) says. */
  private mark(i: number, cam: LodCamera) {
    this.want[i] = 1;
    const minSide = LOD.floorCells * cam.cell; // (the box drawn at its floor is the one that is masked)
    const f = 1 - smooth((this.side[i]! / minSide - LOD.fillFadeFrom) / (LOD.fillFadeTo - LOD.fillFadeFrom));
    const on = this.fillOn[i]! ? f > LOD.fillHyst.off : f > LOD.fillHyst.on;
    this.fillOn[i] = on ? 1 : 0;
    this.wantFill[i] = this.fillOn[i]!;
  }
}

/** The cut's four slots that hang out of the box's edge (`plateAt` 0 to 3) as the planner's slot ids. */
const CUT_SPOTS: readonly number[] = [SPOT.aboveLeft, SPOT.aboveRight, SPOT.belowLeft, SPOT.belowRight];

/** Nodes of a tree from the seam's places and groups (`GlobeGroup`, `GlobePlace`). */
export function buildLodNodes(
  places: readonly { slug: string; name: string; lat: number; lon: number; labelPriority: number; viewRadiusKm?: number | undefined; bbox?: Bbox | undefined; groupSlug?: string | undefined; countryCode?: string | undefined; entries?: readonly EntryRef[] | undefined }[],
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
      entries: p.entries,
      bbox: p.bbox,
    })),
  ];
}
