/**
 * Measurements of the EARLY OPENING of groups (engine/lod-tree.ts `LodTree.cut`, `LOD.open`), pure and renderer independent: the numbers of
 * docs/web-architecture.md, "Opening a group into its most important children", and the assertions of `open.test.ts`. A sweep puts the camera on
 * a few view centres, zooms in at rest step after step (so the hysteresis memory is the one a real zoom leaves) and measures what is drawn WITH
 * the early opening and with the size rule alone (`new LodTree(nodes, { early: false })`: a group opens, with all its children, when its box
 * covers `boxMaxTo` of the screen: what the map did before the early opening).
 *
 * Labels are placed by the real planner (`planLabels`, a full plan) for the overlap count and the free room.
 */
import { stripCountry } from "./country-names";
import { bboxExtentsKm, bboxFitRadiusKm, EARTH_RADIUS_KM, type Bbox } from "./framing";
import type { LabelSub } from "./label-sub";
import { LABEL_TYPE, labelVariants } from "./label-text";
import { SPOT } from "./pixel-labels";
import { boxesToAvoid, planLabels, pxUnits, type PlanItem, type PlanResult, type Prev } from "./label-plan";
import { LOD, LodTree, buildLodNodes, newLodCamera, placePxPerKm, setLodCamera, type GroupKind, type LodCamera, type LodNodeInput } from "./lod-tree";

/** The planner's candidates for the positions the cut reserves (`LodTree.plateSlot`), as `box-scene.ts` maps them. */
const CUT_SPOT: readonly number[] = [SPOT.aboveLeft, SPOT.aboveRight, SPOT.belowLeft, SPOT.belowRight, SPOT.right, SPOT.left, SPOT.insideTopLeft];

/** The screen of the sweeps: the owner's laptop, free area 1440 x 900, art cell 2.5 px. */
export const SWEEP = { width: 1440, height: 900, cell: 2.5 } as const;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A node drawn at rest. */
export interface Drawn {
  slug: string;
  kind: string;
  /** Slug of the enclosing group (undefined for a root). */
  parent: string | undefined;
  box: Rect;
  /** The plate of its label at the planner's first position (above the box's top-left corner). */
  tab: Rect;
  score: number;
  name: string;
  sub: LabelSub | null;
  /** The planner candidate (`SPOT`) the cut reserved for its label (`LodTree.plateSlot`), undefined when it was drawn whatever the room. */
  pref: number | undefined;
}

export interface Metrics {
  /** Boxes on the screen (drawn and touching the free area). */
  boxes: number;
  /** Share of the 100 x 18 px probe plates on a 20 px lattice that touch no plate and no box outline. */
  freeRoom: number;
  /** Pairs of drawn nodes whose boxes or planned plates overlap. */
  overlaps: number;
  /** Labels the real planner could only place over another label. */
  planOverlaps: number;
  /** The overlapping pairs, for a message: "a b box-box", "a b plate(a)-box"... */
  pairs: string[];
}

export const camera = (lon: number, lat: number, zoom: number, free: number = SWEEP.width): LodCamera => {
  const c = newLodCamera();
  setLodCamera(c, { lon, lat, zoom }, { width: SWEEP.width, height: SWEEP.height, centreX: free / 2 }, free, SWEEP.cell);
  return c;
};

/** A screen: the canvas (`width` x `height`), its view centre and the free map area around it (the detail panel leaves less than the whole width). */
export interface Screen {
  width: number;
  height: number;
  centreX: number;
  freeWidth: number;
}

/** The screen of the sweeps (1440 x 900, nothing open). */
export const SCREEN_SWEEP: Screen = { width: SWEEP.width, height: SWEEP.height, centreX: SWEEP.width / 2, freeWidth: SWEEP.width };
/**
 * The screen of the owner's two screenshots of 2026-10-12 (the "Europe" view and the "Balkans" view): a 902 x 652 window whose free map area is 800 px
 * wide, centred 400 px from the left. Found by fitting the places' projected positions to the boxes of the screenshot (error 2.6 px): Europe is lon 14,
 * lat 38, zoom 2.9; the Balkans view is at zoom 4.85 (its centre cannot be told from a crop, the Balkans centre of the sweeps is used).
 */
export const SCREEN_OWNER: Screen = { width: 902, height: 652, centreX: 400, freeWidth: 800 };

/** The camera of an evaluation on a screen. */
export const cameraOn = (screen: Screen, lon: number, lat: number, zoom: number): LodCamera => {
  const c = newLodCamera();
  setLodCamera(c, { lon, lat, zoom }, { width: screen.width, height: screen.height, centreX: screen.centreX }, screen.freeWidth, SWEEP.cell);
  return c;
};

/** Everything the tree draws at rest for a camera (the transitions run to their end). Moves the tree's memory to this camera. */
export function drawnAt(tree: LodTree, cam: LodCamera): Drawn[] {
  tree.alphas({ ...cam });
  const out: Drawn[] = [];
  for (let k = 0; k < tree.count; k++) {
    const i = tree.visible[k]!;
    if (tree.life.target[i] !== 1 || !(tree.isGroup[i] ? tree.members[i]! > 0 : tree.shown[i])) continue;
    const box = { x0: tree.boxX0[i]!, y0: tree.boxY0[i]!, x1: tree.boxX1[i]!, y1: tree.boxY1[i]! };
    const tx = box.x0 - LABEL_TYPE.bleed;
    out.push({
      slug: tree.slug[i]!,
      kind: tree.kind[i]!,
      parent: tree.parent[i]! >= 0 ? tree.slug[tree.parent[i]!]! : undefined,
      box,
      tab: { x0: tx, y0: box.y0 - tree.labelH[i]! - LABEL_TYPE.boxGap, x1: tx + tree.labelW[i]!, y1: box.y0 - LABEL_TYPE.boxGap },
      score: tree.priority[i]! + (tree.isGroup[i] ? 0 : LOD.placePriorityBonus),
      name: tree.text[i]!,
      sub: tree.sub[i]!,
      pref: CUT_SPOT[tree.plateSlot(i)],
    });
  }
  return out;
}

const hit = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const onScreen = (r: Rect, free: number = SWEEP.width, left = 0, height: number = SWEEP.height) => r.x1 > left && r.x0 < left + free && r.y1 > 0 && r.y0 < height;

/** The gap between two rectangles as the cut measures it (`LodTree.clear`): the larger of the gaps along x and y; negative when they overlap. */
export const rectGap = (a: Rect, b: Rect): number => Math.max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);

/** The nodes of `nodes` on the free area of `screen`, with the plate of each as the real planner places it (a full plan, no memory). */
export function planDrawn(nodes: readonly Drawn[], screen: Screen = SCREEN_SWEEP): { visible: Drawn[]; plates: Rect[]; results: PlanResult[] } {
  const left = screen.centreX - screen.freeWidth / 2;
  const visible = nodes.filter((n) => onScreen(n.box, screen.freeWidth, left, screen.height));
  const pad = LOD.open.gapPx.leave;
  const boxPlates = visible.map((n) => ({ x0: n.box.x0 - pad, y0: n.box.y0 - pad, x1: n.box.x1 + pad, y1: n.box.y1 + pad }));
  const items: PlanItem[] = visible.map((n, k) => ({
    score: n.score,
    area: (n.box.x1 - n.box.x0) * (n.box.y1 - n.box.y0),
    key: n.slug,
    rect: { c0: n.box.x0, r0: n.box.y0, c1: n.box.x1, r1: n.box.y1 },
    variants: labelVariants(n.name, n.sub),
    prev: null,
    avoid: boxesToAvoid(boxPlates, k, labelVariants(n.name, n.sub)[0]!.w + labelVariants(n.name, n.sub)[0]!.h + 2 * pad),
    pref: n.pref,
  }));
  const results = planLabels(items, { cols: screen.width, rows: screen.height }, pxUnits(SWEEP.cell));
  const plates: Rect[] = results.map((r) => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h }));
  return { visible, plates, results };
}

/** Metrics of a set of drawn nodes. The labels are placed by the real planner (a full plan, no memory). */
export function measure(nodes: readonly Drawn[], free: number = SWEEP.width): Metrics {
  const { visible, plates } = planDrawn(nodes, { ...SCREEN_SWEEP, centreX: free / 2, freeWidth: free });
  // overlapping pairs: a plate over another plate or over another node's box, two boxes
  let overlaps = 0;
  let planOverlaps = 0;
  const pairs: string[] = [];
  for (let a = 0; a < visible.length; a++) {
    if (visible.some((_, b) => b > a && hit(plates[a]!, plates[b]!))) planOverlaps++;
    for (let b = a + 1; b < visible.length; b++) {
      const kinds = [
        hit(visible[a]!.box, visible[b]!.box) ? "box-box" : "",
        hit(plates[a]!, visible[b]!.box) ? `plate(${visible[a]!.slug})-box` : "",
        hit(plates[b]!, visible[a]!.box) ? `plate(${visible[b]!.slug})-box` : "",
        hit(plates[a]!, plates[b]!) ? "plate-plate" : "",
      ].filter(Boolean);
      if (kinds.length) {
        overlaps++;
        pairs.push(`${visible[a]!.slug} ${visible[b]!.slug} ${kinds.join(",")}`);
      }
    }
  }
  // free label room on a lattice: probe plates touching no plate and no box outline
  let room = 0;
  let total = 0;
  for (let y = 0; y + 18 <= SWEEP.height; y += 20) {
    for (let x = 0; x + 100 <= free; x += 20) {
      total++;
      const probe = { x0: x, y0: y, x1: x + 100, y1: y + 18 };
      let blocked = false;
      for (let k = 0; k < visible.length && !blocked; k++) {
        if (hit(probe, plates[k]!)) blocked = true;
        else if (hit(probe, visible[k]!.box)) {
          // a probe wholly inside a big hollow box touches no outline; anything else touching it does
          const bx = visible[k]!.box;
          blocked = !(probe.x0 > bx.x0 + 2.5 && probe.x1 < bx.x1 - 2.5 && probe.y0 > bx.y0 + 2.5 && probe.y1 < bx.y1 - 2.5);
        }
      }
      if (!blocked) room++;
    }
  }
  return { boxes: visible.length, freeRoom: total ? room / total : 1, overlaps, planOverlaps, pairs };
}

/** The room the cut asks of a node (`LOD.open.gapPx.enter`): the crowding count of the sweeps is taken against it. */
export const CROWD_GAP = 24;

export interface Crowding {
  /** Nodes drawn on the free area. */
  nodes: number;
  /** Pairs of them closer than `gap` px: boxes of the two, the full label plates (both lines) of the two, or the plate of one against the box of the other. */
  near: number;
  /** ... of which the boxes alone, the plates alone (plate against plate), a plate against the other's box. */
  nearBoxes: number;
  nearPlates: number;
  nearCross: number;
  /** Pairs whose boxes or plates overlap (a gap below 0). */
  overlapping: number;
  /** The nearest pairs, "a b <gap>", for a message. */
  worst: string[];
}

/** Crowding of the drawn nodes of a screen (labels placed by the real planner); `exempt` leaves out the pairs that cannot be told apart by zooming (two roots, two places whose own boxes overlap). */
export function crowding(nodes: readonly Drawn[], screen: Screen = SCREEN_SWEEP, gap: number = CROWD_GAP, exempt?: (a: Drawn, b: Drawn) => boolean): Crowding {
  const { visible, plates } = planDrawn(nodes, screen);
  const out: Crowding = { nodes: visible.length, near: 0, nearBoxes: 0, nearPlates: 0, nearCross: 0, overlapping: 0, worst: [] };
  const rows: [number, string][] = [];
  for (let a = 0; a < visible.length; a++) {
    for (let b = a + 1; b < visible.length; b++) {
      if (exempt?.(visible[a]!, visible[b]!)) continue;
      const gb = rectGap(visible[a]!.box, visible[b]!.box);
      const gp = rectGap(plates[a]!, plates[b]!);
      const gc = Math.min(rectGap(plates[a]!, visible[b]!.box), rectGap(plates[b]!, visible[a]!.box));
      const g = Math.min(gb, gp, gc);
      if (g >= gap) continue;
      out.near++;
      if (gb < gap) out.nearBoxes++;
      if (gp < gap) out.nearPlates++;
      if (gc < gap) out.nearCross++;
      if (g < 0) out.overlapping++;
      rows.push([g, `${visible[a]!.slug} ${visible[b]!.slug} ${g.toFixed(0)} (box ${gb.toFixed(0)}, plates ${gp.toFixed(0)}, cross ${gc.toFixed(0)})`]);
    }
  }
  out.worst = rows.sort((x, y) => x[0] - y[0]).slice(0, 6).map((r) => r[1]);
  return out;
}

export interface Flicker {
  /** Labels planned over the jitter (summed over the steps). */
  labels: number;
  /** Slot changes: a label planned in two consecutive steps with another candidate position or another wording (the planner's own sticky plan, as the tracker runs it). */
  changes: number;
  /** Nodes that were drawn in one step and not in the next, or the other way round (the cut). */
  toggles: number;
}

/** The camera moves of the flicker metric: a pixel or three along each axis, and a hair of zoom (0.3 % of the scale). */
export const JITTER: readonly (readonly [number, number, number])[] = [
  [2, 0, 0],
  [0, 2, 0.003],
  [-2, 0, 0],
  [0, -2, -0.003],
  [1, 1, 0],
  [-1, -1, 0.002],
  [3, 0, 0],
  [-3, 0, -0.002],
  [0, 3, 0],
  [0, 0, 0],
];

/**
 * Slot changes and cut flips of a small camera jitter around a view: the tree is evaluated at each step (it keeps its memory, as in the app), the
 * labels are planned by the real planner with the previous step's choice as `prev`, held (what the tracker's plan does between frames), and the choices
 * and the drawn sets are compared step to step. A stable layout has none.
 */
export function flickerAt(tree: LodTree, screen: Screen, lon: number, lat: number, zoom: number): Flicker {
  const out: Flicker = { labels: 0, changes: 0, toggles: 0 };
  const left = screen.centreX - screen.freeWidth / 2;
  drawnAt(tree, cameraOn(screen, lon, lat, zoom));
  let memory = new Map<string, Prev>();
  let last = new Set<string>();
  let first = true;
  const pxPerKm = placePxPerKm(zoom, screen.height, 1);
  const kmPerDeg = (Math.PI / 180) * EARTH_RADIUS_KM;
  for (const [dx, dy, dz] of [[0, 0, 0], ...JITTER] as const) {
    const cam = cameraOn(screen, lon + dx / pxPerKm / kmPerDeg / Math.max(0.2, Math.cos((lat * Math.PI) / 180)), lat + dy / pxPerKm / kmPerDeg, zoom + dz);
    const drawn = drawnAt(tree, cam);
    const visible = drawn.filter((n) => onScreen(n.box, screen.freeWidth, left, screen.height));
    const pad = LOD.open.gapPx.leave;
    const boxPlates = visible.map((n) => ({ x0: n.box.x0 - pad, y0: n.box.y0 - pad, x1: n.box.x1 + pad, y1: n.box.y1 + pad }));
    const items: PlanItem[] = visible.map((n, k) => ({
      score: n.score,
      area: (n.box.x1 - n.box.x0) * (n.box.y1 - n.box.y0),
      key: n.slug,
      rect: { c0: n.box.x0, r0: n.box.y0, c1: n.box.x1, r1: n.box.y1 },
      variants: labelVariants(n.name, n.sub),
      prev: memory.get(n.slug) ?? null,
      avoid: boxesToAvoid(boxPlates, k, labelVariants(n.name, n.sub)[0]!.w + labelVariants(n.name, n.sub)[0]!.h + 2 * pad),
      pref: n.pref,
      // (the tracker keeps a young choice while the camera moves, `TRACK.dwellMs`: a jitter is shorter than that; the plates snap to the art-pixel lattice
      // one by one, so the bare planner would otherwise trade a slot for a better one that came free by a cell)
      hold: memory.has(n.slug),
    }));
    const res = planLabels(items, { cols: screen.width, rows: screen.height }, pxUnits(SWEEP.cell));
    const next = new Map<string, Prev>();
    visible.forEach((n, k) => {
      const r = res[k]!;
      const was = memory.get(n.slug);
      next.set(n.slug, { variant: r.variant, cand: r.cand, dx: r.x - n.box.x0, dy: r.y - n.box.y0 });
      if (!first && was) {
        out.labels++;
        if (was.variant !== r.variant || was.cand !== r.cand) out.changes++;
      }
    });
    const now = new Set(visible.map((n) => n.slug));
    if (!first) for (const s of new Set([...last, ...now])) if (last.has(s) !== now.has(s)) out.toggles++;
    memory = next;
    last = now;
    first = false;
  }
  return out;
}

/** Two nodes that no zoom tells apart: two roots, or two places whose own boxes overlap on the ground (two communes cut out of each other). */
export function inseparable(tree: LodTree): (a: Drawn, b: Drawn) => boolean {
  const half = (i: number): [number, number] => {
    const hx = tree.halfXKm[i]!;
    return hx > 0 ? [hx, tree.halfYKm[i]!] : [tree.radiusKm[i]! / LOD.halfSideDivisor, tree.radiusKm[i]! / LOD.halfSideDivisor];
  };
  return (a, b) => {
    if (a.parent === undefined && b.parent === undefined && a.kind !== "place" && b.kind !== "place") return true;
    if (a.kind !== "place" || b.kind !== "place") return false;
    const i = tree.indexOf(a.slug);
    const j = tree.indexOf(b.slug);
    const [ax, ay] = half(i);
    const [bx, by] = half(j);
    const dy = Math.abs(tree.lat[i]! - tree.lat[j]!) * 111.19;
    const dx = Math.abs(tree.lon[i]! - tree.lon[j]!) * 111.19 * Math.cos((((tree.lat[i]! + tree.lat[j]!) / 2) * Math.PI) / 180);
    return dx < ax + bx && dy < ay + by;
  };
}

/** What a leg of the crowding sweep adds up to. */
export interface LegTotals {
  views: number;
  nodes: number;
  /** Pairs closer than 24 px (the enter gap) / than 12 px (the leave gap) / overlapping, by boxes, plates and a plate against a box. */
  near24: number;
  near12: number;
  overlapping: number;
  /** The flicker metric over a jitter of every view (`flickerAt`): label-frames, slot changes, nodes that came or went. */
  labels: number;
  changes: number;
  toggles: number;
}

/**
 * The crowding sweep of the design: every view centre, zoom 2 to 8 in steps of 0.25: IN (a slow zoom in at rest), OUT (back out from 8: the memory of what
 * was drawn on the way in keeps things drawn) and FRESH (every view from a tree that has seen nothing, a jump). The flicker metric is taken on the first two.
 */
export function crowdSweep(nodes: readonly LodNodeInput[], screen: Screen = SCREEN_SWEEP, centres: readonly SweepCentre[] = SWEEP_CENTRES, zooms: readonly number[] = sweepZooms(2, 8, 0.25)): { in: LegTotals; out: LegTotals; fresh: LegTotals } {
  const leg = (): LegTotals => ({ views: 0, nodes: 0, near24: 0, near12: 0, overlapping: 0, labels: 0, changes: 0, toggles: 0 });
  const res = { in: leg(), out: leg(), fresh: leg() };
  const add = (t: LegTotals, tree: LodTree, drawn: Drawn[], flick: Flicker | null) => {
    const exempt = inseparable(tree);
    const c24 = crowding(drawn, screen, 24, exempt);
    t.views++;
    t.nodes += c24.nodes;
    t.near24 += c24.near;
    t.near12 += crowding(drawn, screen, 12, exempt).near;
    t.overlapping += c24.overlapping;
    if (flick) {
      t.labels += flick.labels;
      t.changes += flick.changes;
      t.toggles += flick.toggles;
    }
  };
  for (const c of centres) {
    const tree = new LodTree(nodes);
    for (const z of zooms) {
      const d = drawnAt(tree, cameraOn(screen, c.lon, c.lat, z));
      add(res.in, tree, d, flickerAt(tree, screen, c.lon, c.lat, z));
    }
    for (const z of [...zooms].reverse()) {
      const d = drawnAt(tree, cameraOn(screen, c.lon, c.lat, z));
      add(res.out, tree, d, flickerAt(tree, screen, c.lon, c.lat, z));
    }
    for (const z of zooms) {
      const t2 = new LodTree(nodes);
      add(res.fresh, t2, drawnAt(t2, cameraOn(screen, c.lon, c.lat, z)), null);
    }
  }
  return res;
}

export interface SweepCentre {
  name: string;
  lon: number;
  lat: number;
}

/** The view centres of the report (design: Western Europe, Europe, Iberia, the Balkans, the Andes, the Maghreb). */
export const SWEEP_CENTRES: readonly SweepCentre[] = [
  { name: "Western Europe", lon: 5, lat: 46 },
  { name: "Europe", lon: 12, lat: 50 },
  { name: "Iberia", lon: -3.6, lat: 40.3 },
  { name: "Balkans", lon: 19.9, lat: 43.5 },
  { name: "Andes", lon: -67, lat: -14 },
  { name: "Maghreb", lon: -8, lat: 30 },
];

/** The groups of the owner's complaint and the view that centres each (Italy: the group the early opening is most delicate for, its neighbours are close). */
export const SWEEP_GROUPS: readonly { slug: string; lon: number; lat: number }[] = [
  { slug: "western-europe", lon: 5, lat: 46 },
  { slug: "balkans", lon: 19.9, lat: 43.5 },
  { slug: "iberia", lon: -3.6, lat: 40.3 },
  { slug: "central-europe", lon: 17.5, lat: 49.5 },
  { slug: "italy", lon: 12.5, lat: 43.5 },
];

/**
 * The areas of the multi-scale hierarchy of one country (an area inside an area inside a country), centred on the group's published coordinates
 * rounded to 0.1 degree: the country itself, then its areas that hold at least `minChildren` nodes, by slug. They are read from the projection, so
 * no place name is written here. Their boxes carry long labels that do not fit where the places inside do: they open THROUGH their most important
 * unit (`LodTree.tryKid`), so they may be open with a single node of theirs drawn. The country defaults to the one the preview's nested areas are in.
 */
export function sweepAreasOf(nodes: readonly LodNodeInput[], country = "morocco", minChildren = 3): { slug: string; lon: number; lat: number }[] {
  const tenth = (x: number) => Math.round(x * 10) / 10;
  const children = new Map<string, number>();
  for (const n of nodes) if (n.parent) children.set(n.parent, (children.get(n.parent) ?? 0) + 1);
  const areas = nodes
    .filter((n) => n.kind === "area" && n.parent === country && (children.get(n.slug) ?? 0) >= minChildren)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((n) => ({ slug: n.slug, lon: tenth(n.lon), lat: tenth(n.lat) }));
  return nodes.some((n) => n.slug === country) ? [{ slug: country, lon: -11.8, lat: 28.8 }, ...areas] : areas;
}

export const sweepZooms = (from = 2, to = 9, step = 0.25): number[] => {
  const out: number[] = [];
  for (let z = from; z <= to + 1e-9; z += step) out.push(Math.round(z * 1e6) / 1e6);
  return out;
};

export interface SweepRow {
  centre: string;
  zoom: number;
  /** The size rule alone (a group opens with all its children when its box is `boxMaxTo` of the screen). */
  before: Metrics;
  /** The early opening. */
  after: Metrics;
}

/** Zoom in at rest over each centre (a fresh tree per centre: the hysteresis memory is that of one zoom), measuring with and without the early opening. */
export function runSweep(nodes: readonly LodNodeInput[], centres: readonly SweepCentre[] = SWEEP_CENTRES, zooms: readonly number[] = sweepZooms()): SweepRow[] {
  const rows: SweepRow[] = [];
  for (const c of centres) {
    const early = new LodTree(nodes);
    const sizeOnly = new LodTree(nodes, { early: false });
    for (const z of zooms) {
      rows.push({ centre: c.name, zoom: z, before: measure(drawnAt(sizeOnly, camera(c.lon, c.lat, z))), after: measure(drawnAt(early, camera(c.lon, c.lat, z))) });
    }
  }
  return rows;
}

/** The nodes below `group` (any depth) among `drawn`. */
export function belowGroup(tree: LodTree, drawn: readonly Drawn[], group: string): Drawn[] {
  const g = tree.indexOf(group);
  return drawn.filter((n) => {
    for (let a = tree.parent[tree.indexOf(n.slug)]!; a >= 0; a = tree.parent[a]!) if (a === g) return true;
    return false;
  });
}

export interface Opening {
  /** First zoom (steps of `step` from `from`) at which the group is open: replaced by its children, or by those of them that fit. -1: never in range. */
  zoom: number;
  /** Nodes below the group drawn at that zoom (its children and, if one opened with it, theirs), and the number of places below it. */
  shown: number;
  total: number;
  /** Boxes on the screen at that zoom, and the pairs of overlapping boxes or plates among them. */
  boxes: number;
  overlaps: number;
}

/** Zoom in at rest on the group's view and find where the group opens with at least `minShown` nodes of it drawn; `early: false` is the size rule alone. */
export function openingOf(nodes: readonly LodNodeInput[], group: { slug: string; lon: number; lat: number }, early: boolean, from = 2, to = 9, step = 0.01, minShown = 1): Opening {
  const tree = new LodTree(nodes, { early });
  const g = tree.indexOf(group.slug);
  for (const z of sweepZooms(from, to, step)) {
    const d = drawnAt(tree, camera(group.lon, group.lat, z));
    // open, with at least `minShown` of what is below it drawn (a group open through its one place that fits is not yet "open into its children")
    if (tree.isOpen(g) && belowGroup(tree, d, group.slug).length >= minShown) {
      const m = measure(d);
      return { zoom: z, shown: belowGroup(tree, d, group.slug).length, total: tree.total[g]!, boxes: m.boxes, overlaps: m.overlaps };
    }
  }
  return { zoom: -1, shown: 0, total: tree.total[g]!, boxes: 0, overlaps: 0 };
}

/** The part of a published projection the tree is built from (`PublishedProjection`, packages/schemas). */
export interface ProjectionLike {
  places: { slug: string; name: string; coordinates: { lat: number; lon: number }; labelPriority: number; bbox?: Bbox; viewRadiusKm?: number; group?: string; countryCode?: string }[];
  groups: { slug: string; name: string; kind: GroupKind; parent?: string; coordinates: { lat: number; lon: number }; viewRadiusKm: number; labelPriority: number }[];
}

/**
 * The tree's nodes for a published projection, as the app builds them (app/lib/projection.ts `toGlobePlace`: a valid bounding box is the place's
 * rectangle and sets its view radius, the name loses its own country) without the app's modules, which the globe must not import.
 */
export function nodesFromProjection(p: ProjectionLike): LodNodeInput[] {
  return buildLodNodes(
    p.places.map((x) => {
      const bbox = bboxExtentsKm(x.bbox) ? x.bbox : undefined;
      const viewRadiusKm = (bbox && bboxFitRadiusKm(bbox)) ?? x.viewRadiusKm;
      return {
        slug: x.slug,
        name: stripCountry(x.name, x.countryCode),
        lat: x.coordinates.lat,
        lon: x.coordinates.lon,
        labelPriority: x.labelPriority,
        viewRadiusKm,
        bbox,
        groupSlug: x.group,
        countryCode: x.countryCode,
      };
    }),
    p.groups.map((g) => ({ slug: g.slug, name: g.name, kind: g.kind, parent: g.parent, lat: g.coordinates.lat, lon: g.coordinates.lon, viewRadiusKm: g.viewRadiusKm, labelPriority: g.labelPriority })),
  );
}
