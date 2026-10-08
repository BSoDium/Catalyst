/**
 * Measurements of the PEEK pass (engine/lod-tree.ts `peekPass`), pure and renderer independent: the numbers of docs/web-architecture.md,
 * "Peeks", and the assertions of `peek.test.ts`. A sweep puts the camera on a few view centres, zooms in at rest step after step (so
 * the hysteresis memory is the one a real zoom leaves) and measures what is drawn WITH and WITHOUT the peeks: the peek pass never feeds
 * back into the cut, so "without" is exactly what the app drew before it existed.
 *
 * Labels are placed by the real planner (`planLabels`, a full plan) for the overlap count and the free room; a peek it can only place over
 * other labels is dropped, as `BoxScene` does.
 */
import { stripCountry } from "./country-names";
import { bboxExtentsKm, bboxFitRadiusKm, type Bbox } from "./framing";
import { LABEL_TYPE, labelVariants } from "./label-text";
import { peeksToDrop, planLabels, pxUnits, type PlanItem } from "./label-plan";
import { LOD, LodTree, buildLodNodes, labelScoreOf, newLodCamera, setLodCamera, type GroupKind, type LodCamera, type LodNodeInput } from "./lod-tree";

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
  peek: boolean;
  /** Slug of the host of a peek. */
  host: string | null;
  box: Rect;
  /** The plate of its label at the planner's first position (above the box's top-left corner). */
  tab: Rect;
  score: number;
  name: string;
  chip: string | null;
}

export interface Metrics {
  /** Boxes on the screen (drawn and touching the free area). */
  boxes: number;
  peeks: number;
  /** Share of the 100 x 18 px probe plates on a 20 px lattice that touch no plate and no box outline. */
  freeRoom: number;
  /** Pairs of drawn nodes whose boxes or planned plates overlap (a peek inside its host's box does not count). */
  overlaps: number;
  /** Labels the real planner could only place over another label, and the peeks it refused (dropped before counting the rest). */
  planOverlaps: number;
  planOverlapPeeks: number;
}

export const camera = (lon: number, lat: number, zoom: number, free: number = SWEEP.width): LodCamera => {
  const c = newLodCamera();
  setLodCamera(c, { lon, lat, zoom }, { width: SWEEP.width, height: SWEEP.height, centreX: free / 2 }, free, SWEEP.cell);
  return c;
};

/** Everything the tree draws at rest for a camera (the transitions run to their end), peeks flagged. Moves the tree's memory to this camera. */
export function drawnAt(tree: LodTree, cam: LodCamera): Drawn[] {
  tree.alphas({ ...cam });
  const out: Drawn[] = [];
  for (let k = 0; k < tree.count; k++) {
    const i = tree.visible[k]!;
    if (tree.life.target[i] !== 1 || !(tree.isGroup[i] ? tree.members[i]! > 0 : tree.shown[i])) continue;
    const box = { x0: tree.boxX0[i]!, y0: tree.boxY0[i]!, x1: tree.boxX1[i]!, y1: tree.boxY1[i]! };
    const tx = box.x0 - LABEL_TYPE.padX;
    const own = tree.priority[i]! + (tree.isGroup[i] ? 0 : LOD.placePriorityBonus);
    const host = tree.peekHost[i]!;
    out.push({
      slug: tree.slug[i]!,
      kind: tree.kind[i]!,
      peek: host >= 0,
      host: host >= 0 ? tree.slug[host]! : null,
      box,
      tab: { x0: tx, y0: box.y0 - tree.labelH[i]! - LABEL_TYPE.boxGap, x1: tx + tree.labelW[i]!, y1: box.y0 - LABEL_TYPE.boxGap },
      score: labelScoreOf(own, host >= 0 ? tree.priority[host]! : null),
      name: tree.text[i]!,
      chip: tree.chip[i]!,
    });
  }
  return out;
}

const hit = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const onScreen = (r: Rect, free: number = SWEEP.width) => r.x1 > 0 && r.x0 < free && r.y1 > 0 && r.y0 < SWEEP.height;

/**
 * Metrics of a set of drawn nodes (filter `peek` out of it for the "before" side). The labels are placed by the real planner (a full plan,
 * no memory); a peek whose label it can only put over others is dropped, as `BoxScene` does, and the plan runs again for the rest, until none is.
 */
export function measure(nodes: readonly Drawn[], free: number = SWEEP.width): Metrics {
  let visible = nodes.filter((n) => onScreen(n.box, free));
  let plates: Rect[] = [];
  let dropped = 0;
  const pad = LOD.peek.gapPx.leave;
  for (;;) {
    const items: PlanItem[] = visible.map((n) => ({
      score: n.score,
      area: (n.box.x1 - n.box.x0) * (n.box.y1 - n.box.y0),
      key: n.slug,
      rect: { c0: n.box.x0, r0: n.box.y0, c1: n.box.x1, r1: n.box.y1 },
      variants: labelVariants(n.name, n.chip),
      prev: null,
      avoid: n.peek ? visible.filter((m) => m !== n && m.slug !== n.host).map((m) => ({ x0: m.box.x0 - pad, y0: m.box.y0 - pad, x1: m.box.x1 + pad, y1: m.box.y1 + pad })) : undefined,
    }));
    const res = planLabels(items, { cols: SWEEP.width, rows: SWEEP.height }, pxUnits(SWEEP.cell));
    plates = res.map((r) => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h }));
    const drop = peeksToDrop(visible.map((n, k) => ({ box: n.box, plate: plates[k]!, peek: n.peek, host: visible.findIndex((m) => m.slug === n.host), overlap: res[k]!.overlap, onScreen: true })));
    if (!drop.length) break;
    dropped += drop.length;
    const gone = new Set(drop.map((k) => visible[k]!.slug));
    visible = visible.filter((n) => !gone.has(n.slug));
  }
  // overlapping pairs: a plate over another plate or over another node's box, two boxes (bar a peek inside its host's box)
  let overlaps = 0;
  let planOverlaps = 0;
  for (let a = 0; a < visible.length; a++) {
    const p = visible[a]!;
    if (visible.some((_, b) => b !== a && plates[a]!.x0 < plates[b]!.x1 && plates[a]!.x1 > plates[b]!.x0 && plates[a]!.y0 < plates[b]!.y1 && plates[a]!.y1 > plates[b]!.y0 && b > a)) planOverlaps++;
    for (let b = a + 1; b < visible.length; b++) {
      const q = visible[b]!;
      const pInQ = p.host === q.slug;
      const qInP = q.host === p.slug;
      if ((!pInQ && !qInP && hit(p.box, q.box)) || (!pInQ && hit(plates[a]!, q.box)) || (!qInP && hit(plates[b]!, p.box)) || hit(plates[a]!, plates[b]!)) overlaps++;
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
  return { boxes: visible.length, peeks: visible.filter((n) => n.peek).length, freeRoom: total ? room / total : 1, overlaps, planOverlaps, planOverlapPeeks: dropped };
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

export const sweepZooms = (from = 2, to = 9, step = 0.25): number[] => {
  const out: number[] = [];
  for (let z = from; z <= to + 1e-9; z += step) out.push(Math.round(z * 1e6) / 1e6);
  return out;
};

export interface SweepRow {
  centre: string;
  zoom: number;
  before: Metrics;
  after: Metrics;
}

/** Zoom in at rest over each centre (a fresh tree per centre: the hysteresis memory is that of one zoom), measuring with and without the peeks. */
export function runSweep(nodes: readonly LodNodeInput[], centres: readonly SweepCentre[] = SWEEP_CENTRES, zooms: readonly number[] = sweepZooms()): SweepRow[] {
  const rows: SweepRow[] = [];
  for (const c of centres) {
    const tree = new LodTree(nodes);
    for (const z of zooms) {
      const all = drawnAt(tree, camera(c.lon, c.lat, z));
      rows.push({ centre: c.name, zoom: z, before: measure(all.filter((n) => !n.peek)), after: measure(all) });
    }
  }
  return rows;
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
