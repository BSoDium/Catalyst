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
import { bboxExtentsKm, bboxFitRadiusKm, type Bbox } from "./framing";
import type { LabelSub } from "./label-sub";
import { LABEL_TYPE, labelVariants } from "./label-text";
import { boxesToAvoid, planLabels, pxUnits, type PlanItem } from "./label-plan";
import { LOD, LodTree, buildLodNodes, newLodCamera, setLodCamera, type GroupKind, type LodCamera, type LodNodeInput } from "./lod-tree";

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
    });
  }
  return out;
}

const hit = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const onScreen = (r: Rect, free: number = SWEEP.width) => r.x1 > 0 && r.x0 < free && r.y1 > 0 && r.y0 < SWEEP.height;

/** Metrics of a set of drawn nodes. The labels are placed by the real planner (a full plan, no memory). */
export function measure(nodes: readonly Drawn[], free: number = SWEEP.width): Metrics {
  const visible = nodes.filter((n) => onScreen(n.box, free));
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
  }));
  const res = planLabels(items, { cols: SWEEP.width, rows: SWEEP.height }, pxUnits(SWEEP.cell));
  const plates: Rect[] = res.map((r) => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h }));
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
 * The areas of the multi-scale hierarchy of the Moroccan trip (an area inside an area inside a country: "Marrakesh region" > "Marrakesh area"), centred on the
 * group's published coordinates. Their boxes carry long labels ("Marrakesh region") that do not fit where the places inside do: they open THROUGH their most
 * important unit (`LodTree.tryKid`), so they may be open with a single node of theirs drawn.
 */
export const SWEEP_AREAS: readonly { slug: string; lon: number; lat: number }[] = [
  { slug: "morocco", lon: -11.8, lat: 28.8 },
  { slug: "marrakesh-region", lon: -8.2, lat: 31.6 },
  { slug: "casablanca-area", lon: -6.7, lat: 33.9 },
  { slug: "laayoune-area", lon: -12.2, lat: 27.8 },
  { slug: "caidat-d-ait-sedrate-jbel-region", lon: -4.9, lat: 31.3 },
];

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

/** Zoom in at rest on the group's view and find where the group opens; `early: false` is the size rule alone. */
export function openingOf(nodes: readonly LodNodeInput[], group: { slug: string; lon: number; lat: number }, early: boolean, from = 2, to = 9, step = 0.01): Opening {
  const tree = new LodTree(nodes, { early });
  const g = tree.indexOf(group.slug);
  for (const z of sweepZooms(from, to, step)) {
    const d = drawnAt(tree, camera(group.lon, group.lat, z));
    if (tree.isOpen(g)) {
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
