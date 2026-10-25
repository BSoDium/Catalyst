import { describe, expect, it } from "vitest";
import {
  CAPTION_FACE,
  CAPTION_FACES,
  CAPTION_FALLBACK_STYLE,
  CAPTION_STYLES,
  CaptionMotion,
  bandMesh,
  captionColors,
  captionFont,
  type CaptionRun,
  entranceSides,
  runsText,
  seededUnit,
  easeInCubic,
  easeOutExpo,
  entranceMs,
  entranceStart,
  faceTowardsViewer,
  layoutCaption,
  leavingAngle,
  lineHidden,
  parallelPoint,
  shellHorizon,
  occludedAngle,
  planPieces,
  fitScale,
  shellWindowFactor,
  shellXY,
  placeRows,
  rowLatitudes,
  bandLat,
  inBand,
  minScaleFor,
  shellY,
  DRIFT,
  cycleMs,
  cycleOf,
  driftVelocity,
  pendulumX,
  rowX,
  splitRuns,
  visibleHalfSpan,
  unitBand,
  bandPoint,
  dimPresence,
} from "./caption";
import { DEG, cameraDistance, lonLatToVec3, viewBasis } from "./geo";
import { CAPTION, START_VIEW } from "./tuning";

/** The home screen's four rows (two that take turns, two that stay), with the words picked out as the site does (`siteCaption`). */
const LINES: CaptionRun[][] = [
  [{ text: "A " }, { text: "personal archive", style: "heavy" }, { text: "," }],
  [{ text: "organised around " }, { text: "places", style: "heavy-italic" }, { text: "." }],
  [{ text: "Drag to " }, { text: "explore", style: "heavy" }, { text: "." }],
  [{ text: "Pick a " }, { text: "place", style: "heavy" }, { text: "." }],
];
/** The other phrase sets (rows of the same slot). */
const SECTIONS_ROWS: CaptionRun[][] = [
  [{ text: "Software", style: "mono" }, { text: " \u00b7 " }, { text: "Articles", style: "heavy" }],
  [{ text: "Artworks", style: "heavy-italic" }, { text: " \u00b7 " }, { text: "Poetry", style: "script" }],
];
/** Widths in ems of a run (a serif at about half an em a letter, the heavy cuts a little wider, the mono at its own pitch). */
const measure = (r: CaptionRun) => r.text.length * (r.style === "heavy" || r.style === "heavy-italic" ? 0.56 : r.style === "mono" ? 0.53 : 0.5);
const DESKTOP = 330; // the planet's radius at the lowest zoom, CSS px, at 1440x900
const PHONE = 150; // and at 390x844
/** The camera's distance at the lowest zoom of a 1440 x 900 window (what the layer is told). */
const D_REST = 5.8;
const layout = (rPx = DESKTOP) => layoutCaption({ rows: LINES, measure, rPx, d: D_REST });
const d = cameraDistance(2.2, 900);
/** The screen height (planet radii) of a point of the earth frame seen from a camera over `lat`, longitude 0: the point's component along the view's north. */
const screenY = (p: readonly number[], lat: number) => {
  const { north } = viewBasis({ lon: 0, lat, zoom: 1 }, 900);
  return p[0]! * north[0] + p[1]! * north[1] + p[2]! * north[2];
};

describe("real parallels", () => {
  it("is the shell: every point at `CAPTION.radius`, and a row of a band is a circle of one latitude about the earth's axis", () => {
    for (const line of layout().lines) {
      const m = bandMesh(line, 24, 1, CAPTION.depth);
      const cols = 25;
      for (let j = 0; j < 2; j++) {
        let y = NaN;
        for (let i = 0; i < cols; i++) {
          const k = (j * cols + i) * 3;
          expect(Math.hypot(m.positions[k]!, m.positions[k + 1]!, m.positions[k + 2]!)).toBeCloseTo(CAPTION.radius, 5);
          if (i === 0) y = m.positions[k + 1]!;
          expect(m.positions[k + 1]!).toBeCloseTo(y, 5); // the same height along the axis: the same parallel
        }
      }
    }
  });

  it("has the tilt and the curvature of the graticule's parallel at the view's latitude: from the north the ends rise, from the south they fall, at the equator it is straight", () => {
    const line = layout().lines[0]!;
    for (const view of [28, 55, 0, -28, -50]) {
      const mid = screenY(parallelPoint(0, line.baseLat, 1), view);
      const end = screenY(parallelPoint(line.halfSpan, line.baseLat, 1), view);
      // the graticule's dotted parallel at the same latitude, on the planet's surface, for the same two longitudes
      const gMid = screenY(lonLatToVec3(0, line.baseLat), view);
      const gEnd = screenY(lonLatToVec3(line.halfSpan / DEG, line.baseLat), view);
      expect(end - mid).toBeCloseTo(gEnd - gMid, 9); // the shell is the surface scaled: the same shape
    }
    // the line lies in the plane of its parallel: all its points are at one height along the earth's axis, whatever the camera
    const ys = [-1, -0.3, 0, 0.5, 1].map((u) => parallelPoint(u * line.halfSpan, line.baseLat, CAPTION.radius)[1]);
    for (const y of ys) expect(y).toBeCloseTo(CAPTION.radius * Math.sin(line.baseLat * DEG), 9);
  });

  it("is centred on the central meridian: the strip is symmetric about longitude 0", () => {
    const line = layout().lines[0]!;
    const m = bandMesh(line, 20, 1, CAPTION.depth);
    const cols = 21;
    const first = [m.positions[0]!, m.positions[1]!, m.positions[2]!];
    const last = [m.positions[(cols - 1) * 3]!, m.positions[(cols - 1) * 3 + 1]!, m.positions[(cols - 1) * 3 + 2]!];
    expect(first[0]).toBeCloseTo(-last[0]!, 6);
    expect(first[1]).toBeCloseTo(last[1]!, 6);
    expect(first[2]).toBeCloseTo(last[2]!, 6);
  });

  it("is wound counter-clockwise seen from outside, on every slice: every triangle's normal points away from the planet (back faces are the far side's)", () => {
    const line = layout().lines[2]!;
    const m = bandMesh(line, 12, CAPTION.slices, CAPTION.depth);
    const P = (i: number) => [m.positions[3 * i]!, m.positions[3 * i + 1]!, m.positions[3 * i + 2]!] as const;
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = P(m.indices[t]!);
      const b = P(m.indices[t + 1]!);
      const c = P(m.indices[t + 2]!);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const centre = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      expect(n[0]! * centre[0]! + n[1]! * centre[1]! + n[2]! * centre[2]!).toBeGreaterThan(0);
    }
  });

  it("reads left to right: texture u grows with the longitude (east), v is 1 at the top (the higher latitude)", () => {
    const line = layout().lines[0]!;
    const m = bandMesh(line, 10, 1, CAPTION.depth);
    expect(m.uvs[2]).toBeGreaterThan(m.uvs[0]!);
    expect(m.positions[3]).toBeGreaterThan(m.positions[0]!);
    const cols = 11;
    expect(m.uvs[2 * cols + 1]).toBe(1);
    expect(m.positions[3 * cols + 1]).toBeGreaterThan(m.positions[1]!);
  });

  it("is a stack: the front face at the shell, `depth` of slices behind it towards the planet, every slice with its layer", () => {
    const line = layout().lines[1]!;
    const slices = CAPTION.slices;
    const m = bandMesh(line, 8, slices, CAPTION.depth);
    const perSlice = 9 * 2;
    expect(m.layers).toHaveLength(slices * perSlice);
    expect(m.indices).toHaveLength(slices * 8 * 6);
    const radius = (n: number) => Math.hypot(m.positions[3 * n]!, m.positions[3 * n + 1]!, m.positions[3 * n + 2]!);
    expect(m.layers[0]).toBe(0);
    expect(radius(0)).toBeCloseTo(CAPTION.radius - CAPTION.depth, 5);
    const front = (slices - 1) * perSlice;
    expect(m.layers[front]).toBe(1);
    expect(radius(front)).toBeCloseTo(CAPTION.radius, 5);
    expect(CAPTION.radius - CAPTION.depth).toBeGreaterThan(1.02); // the back of the letters is still clear of the surface
  });

  it("is ONE unit strip for every line: the vertex shader's parallel (`bandPoint`) gives the same points as the built mesh", () => {
    const unit = unitBand();
    expect(unit.attributes.length / 3).toBe((64 + 1) * 2 * CAPTION.slices);
    const line = layout(DESKTOP).lines[3]!;
    const m = bandMesh(line, 64, CAPTION.slices, CAPTION.depth);
    const p: [number, number, number] = [0, 0, 0];
    for (const i of [0, 5, 64, 65, 130, 400, unit.attributes.length / 3 - 1]) {
      bandPoint(line, unit.attributes[3 * i]!, unit.attributes[3 * i + 1]!, unit.attributes[3 * i + 2]!, CAPTION.depth, CAPTION.radius, p);
      expect(m.positions[3 * i]).toBeCloseTo(p[0], 5);
      expect(m.positions[3 * i + 1]).toBeCloseTo(p[1], 5);
      expect(m.positions[3 * i + 2]).toBeCloseTo(p[2], 5);
    }
  });
});

describe("the rows are on fixed parallels, centred on the equator", () => {
  const pieces = (rPx = DESKTOP) => planPieces({ rows: LINES, measure, rPx }).pieces;
  const place = (rPx = DESKTOP, d = D_REST) => {
    const p = pieces(rPx);
    const k = fitScale(p, d, minScaleFor(p, rPx));
    return { k, placements: placeRows(p, d, k), p };
  };

  it("spaces the baselines uniformly ON THE SCREEN at the load view (within a pixel), top to bottom, the block's capitals centred on the equator", () => {
    const { placements } = place();
    expect(placements).toHaveLength(4);
    const capDeg = placements[0]!.capR / CAPTION.radius / DEG;
    // the first and last rows are where the nominal step puts them; the middle ones are moved to the equal screen steps
    const nominal = rowLatitudes(4, placements[0]!.capR);
    expect(placements[0]!.baseLat).toBeCloseTo(nominal[0]!, 9);
    expect(placements[3]!.baseLat).toBeCloseTo(nominal[3]!, 9);
    expect(nominal[0]! + nominal[3]!).toBeCloseTo(-capDeg, 9); // (mean + half a cap = 0)
    for (let i = 1; i < 4; i++) expect(placements[i]!.baseLat).toBeLessThan(placements[i - 1]!.baseLat);
    const ys = placements.map((p) => shellY(0, p.baseLat, START_VIEW.lat, D_REST));
    const gaps = ys.slice(1).map((y, i) => ys[i]! - y);
    for (const g of gaps) expect(Math.abs(g - gaps[0]!) * 600).toBeLessThan(0.05);
    // and within a few percent from anywhere in the band
    for (const cam of [-CAPTION.band.deg, 0, CAPTION.band.deg]) {
      const yc = placements.map((p) => shellY(0, p.baseLat, cam, D_REST));
      const gc = yc.slice(1).map((y, i) => yc[i]! - y);
      for (const g of gc) expect(Math.abs(g / gc[0]! - 1)).toBeLessThan(0.4);
    }
  });

  it("does not depend on the camera: the same placements whatever latitude is asked (there is no latitude in the call)", () => {
    expect(placeRows(pieces(), D_REST, 1).map((p) => p.baseLat)).toEqual(placeRows(pieces(), D_REST, 1).map((p) => p.baseLat));
    expect(rowLatitudes(4, 0.084)[0]).toBeGreaterThan(0);
    expect(rowLatitudes(4, 0.084)[3]).toBeLessThan(0);
    expect(rowLatitudes(0, 0.084)).toEqual([]);
  });

  it("fits every row to its chord at BOTH ends of the band, at one static scale: desktop and phone planets", () => {
    for (const rPx of [DESKTOP, PHONE]) {
      const { k, placements } = place(rPx);
      expect(k).toBeGreaterThan(CAPTION.minScale);
      expect(k).toBeLessThanOrEqual(1);
      const psi = shellHorizon(D_REST) * CAPTION.visibleFraction;
      for (const p of placements)
        for (const cam of [CAPTION.band.deg, -CAPTION.band.deg, 0]) expect(p.halfSpan).toBeLessThanOrEqual(visibleHalfSpan(cam, p.baseLat, psi) + 1e-9);
    }
    // the words stay inside the planet's disc on the screen, for every camera of the band
    for (const rPx of [DESKTOP, PHONE]) {
      const { placements } = place(rPx);
      const limit = CAPTION.maxHalfWidth / Math.sqrt(D_REST * D_REST - 1);
      for (const p of placements) for (const cam of [CAPTION.band.deg, -CAPTION.band.deg, 0]) expect(Math.abs(shellXY(Math.min(p.halfSpan, Math.PI / 2), p.baseLat, cam, D_REST)[0])).toBeLessThanOrEqual(limit + 1e-9);
    }
  });

  it("shrinks the whole block together, statically, when a row would not fit even so", () => {
    const wide = [[{ text: "x".repeat(80) }]];
    const p = planPieces({ rows: wide, measure: () => 40, rPx: DESKTOP }).pieces;
    const k = fitScale(p, D_REST, 0.05);
    expect(k).toBeLessThan(1);
    expect(placeRows(p, D_REST, k)[0]!.capR / p[0]!.cap).toBeCloseTo(k, 9);
  });

  it("sizes the crisp canvas's window to the SHELL's silhouette: a point of the shell near the limb is inside it (the owner's vertical cut at 1.15-1.25 radii)", () => {
    for (const d of [3, 5.8, 13, 30]) {
      const f = shellWindowFactor(d);
      expect(f).toBeGreaterThan(CAPTION.radius); // never narrower than the shell's radius in planet radii
      // the silhouette of the shell in the tangent plane, in units of the planet's: r / sqrt(d^2 - r^2) over 1 / sqrt(d^2 - 1)
      expect(f).toBeCloseTo((CAPTION.radius / Math.sqrt(d * d - CAPTION.radius ** 2)) / (1 / Math.sqrt(d * d - 1)), 9);
      // the old window (1.2 planets' radii) cut a shell that floats at 1.25
      if (CAPTION.radius > 1.2) expect(f).toBeGreaterThan(1.2);
    }
  });

  it("knows the band: held to its nearest edge, and in it within a slack", () => {
    expect(bandLat(5)).toBe(5);
    expect(bandLat(-60)).toBe(-CAPTION.band.deg);
    expect(bandLat(85)).toBe(CAPTION.band.deg);
    expect(inBand(CAPTION.band.deg)).toBe(true);
    expect(inBand(CAPTION.band.deg + 1)).toBe(false);
    expect(inBand(-CAPTION.band.deg - 1, 1.5)).toBe(true);
    expect(START_VIEW.lat).toBeLessThan(CAPTION.band.deg);
  });

  it("makes every row one cap height, the call to action under the others", () => {
    const l = layout().lines;
    expect(l).toHaveLength(4);
    for (const line of l) expect(line.capR).toBeCloseTo(l[0]!.capR, 9);
    for (let i = 1; i < l.length; i++) expect(l[i]!.baseLat).toBeLessThan(l[i - 1]!.baseLat);
  });

  it("is the same block on a phone planet as on a desktop one, never under three quarters of the least letter size", () => {
    const ph = place(PHONE).placements;
    ph.forEach((p) => expect(p.capR * PHONE).toBeGreaterThanOrEqual(0.75 * CAPTION.minCapPx - 1e-6));
    expect(ph.length).toBe(place(DESKTOP).placements.length);
  });

  it("knows how far from the central meridian a parallel is seen well, 0 when not at all and pi over the pole", () => {
    expect(visibleHalfSpan(0, 0, 0.5)).toBeCloseTo(0.5, 9);
    expect(visibleHalfSpan(0, 80, 0.5)).toBe(0); // farther than that even at its middle
    expect(visibleHalfSpan(80, 80, 0.5)).toBe(Math.PI); // seen over the pole: all of it is near
  });

  it("is sized by the ink the faces report (an overhanging script is not clipped): the box's width is what the layout gives the strip", () => {
    const wide = (r: CaptionRun) => r.text.length * 0.5;
    const rows = [[{ text: "Poetry", style: "script" as const }]];
    const a = layoutCaption({ rows, measure: wide, rPx: DESKTOP, d: D_REST });
    const b = layoutCaption({ rows, measure: wide, box: () => ({ widthEm: 3.6, aboveCaps: 1.5, belowCaps: 0.8 }), rPx: DESKTOP, d: D_REST });
    expect(b.lines[0]!.widthEm).toBe(3.6);
    expect(b.lines[0]!.aboveCaps).toBe(1.5);
    expect(b.lines[0]!.belowCaps).toBe(0.8);
    expect(b.lines[0]!.halfSpan).toBeGreaterThan(a.lines[0]!.halfSpan); // 3.6 ems of ink against 3 of advance
  });

  it("cuts a phrase at the delimiter nearest the middle (a separator dot is dropped), at a clause end before a plain space, and says null where there is none", () => {
    const m = (r: CaptionRun) => r.text.length;
    const line: CaptionRun[] = [{ text: "A " }, { text: "personal archive", style: "heavy" }, { text: ", organised around " }, { text: "places", style: "heavy-italic" }, { text: "." }];
    const cut = splitRuns(line, m)!;
    expect(cut.map(runsText)).toEqual(["A personal archive,", "organised around places."]);
    const dots = splitRuns([...SECTIONS_ROWS[0]!, { text: " \u00b7 " }, ...SECTIONS_ROWS[1]!], m)!;
    expect(dots.map(runsText)).toEqual(["Software \u00b7 Articles", "Artworks \u00b7 Poetry"]);
    expect(splitRuns([{ text: "Explore" }], m)).toBeNull();
    expect(cut[0]!.some((r) => r.style === "heavy")).toBe(true);
    expect(cut[1]!.some((r) => r.style === "heavy-italic")).toBe(true);
  });
});

describe("the rows' trajectory: in, a steady roll through the centre, out", () => {
  const start = 2.6;
  const Ein = CAPTION.enter.ms;
  const T = CAPTION.cycle.dwellMs;
  const Eout = CAPTION.cycle.exitMs;
  const v = () => driftVelocity();
  const slope = (f: (t: number) => number, t: number, h = 0.5) => (f(t + h) - f(t - h)) / (2 * h);

  it("starts hidden behind the planet, rolls from +amp to -amp over the dwell and leaves hidden on the other side", () => {
    expect(rowX(-100, start)).toBe(start);
    expect(rowX(0, start)).toBe(start);
    expect(rowX(Ein, start)).toBeCloseTo(DRIFT.amp, 12);
    expect(rowX(Ein + T / 2, start)).toBeCloseTo(0, 12);
    expect(rowX(Ein + T, start)).toBeCloseTo(-DRIFT.amp, 12); // the dwell ends at -amp
    expect(rowX(Ein + T + Eout, start)).toBeCloseTo(-start, 12);
    expect(rowX(cycleMs() + 5000, start)).toBe(-start);
    expect(cycleMs()).toBe(Ein + T + Eout);
  });

  it("is one monotone path: a row never turns back", () => {
    for (const s0 of [1.7, 2.2, 3.0, Math.PI]) {
      let last = Infinity;
      for (let t = 0; t <= cycleMs(); t += 7) {
        const x = rowX(t, s0);
        expect(x).toBeLessThanOrEqual(last + 1e-12);
        last = x;
      }
    }
  });

  it("rolls at a constant speed 2 amp / dwell through the centre", () => {
    expect(v()).toBeCloseTo((2 * DRIFT.amp) / T, 15);
    for (const t of [Ein + 1, Ein + T * 0.3, Ein + T * 0.5, Ein + T * 0.9]) expect(slope((u) => rowX(u, start), t)).toBeCloseTo(-v(), 9);
    // 7 to 9 degrees either side, over 5.5 s: about 3 degrees a second
    expect((v() * 1000 * 180) / Math.PI).toBeGreaterThan(1.5);
    expect((v() * 1000 * 180) / Math.PI).toBeLessThan(3.5);
  });

  it("has no velocity jump at the seams: the entrance lands at the roll's speed and the exit starts at it", () => {
    for (const s0 of [1.8, 2.6, 3.1]) {
      const f = (t: number) => rowX(t, s0);
      // (one-sided slopes, a hair either side of each seam)
      for (const seam of [Ein, Ein + T]) {
        const left = (f(seam - 0.001) - f(seam - 0.05)) / 0.049;
        const right = (f(seam + 0.05) - f(seam + 0.001)) / 0.049;
        expect(Math.abs(left / -v() - 1)).toBeLessThan(1e-2);
        expect(Math.abs(right / -v() - 1)).toBeLessThan(1e-2);
      }
      // and no jump in position either
      expect(Math.abs(f(Ein - 1e-6) - f(Ein + 1e-6))).toBeLessThan(1e-9);
      expect(Math.abs(f(Ein + T - 1e-6) - f(Ein + T + 1e-6))).toBeLessThan(1e-9);
    }
  });

  it("never overshoots: the entrance stays outside +amp until it lands on it, the roll stays within +-amp, the exit never comes back", () => {
    const eps = 1e-9;
    for (const s0 of [1.8, 2.6, 3.1]) {
      for (let t = 0; t <= Ein; t += 3) expect(rowX(t, s0)).toBeGreaterThanOrEqual(DRIFT.amp - eps);
      for (let t = Ein; t <= Ein + T; t += 7) {
        expect(rowX(t, s0)).toBeLessThanOrEqual(DRIFT.amp + eps);
        expect(rowX(t, s0)).toBeGreaterThanOrEqual(-DRIFT.amp - eps);
      }
      for (let t = Ein + T; t <= Ein + T + Eout; t += 3) expect(rowX(t, s0)).toBeLessThanOrEqual(-DRIFT.amp + eps);
    }
    // the entrance takes about a second (the owner's 900 to 1100) and lands at the roll's speed: no stop-then-go
    expect(Ein).toBeGreaterThanOrEqual(900);
    expect(Ein).toBeLessThanOrEqual(1100);
    const last = (rowX(Ein - 1, 2.6) - rowX(Ein, 2.6)) / 1;
    expect(last / v()).toBeGreaterThan(0.9);
    expect(last / v()).toBeLessThan(1.5);
  });

  it("has no kick in the acceleration at the seams either: the quintic eases leave and join the roll at zero acceleration", () => {
    for (const s0 of [1.8, 2.6, 3.1]) {
      const f = (t: number) => rowX(t, s0);
      const second = (t: number, h = 1) => (f(t + h) - 2 * f(t) + f(t - h)) / (h * h);
      const scale = (s0 - DRIFT.amp) / (Ein * Ein);
      for (const seam of [Ein, Ein + T]) {
        for (const off of [-4, -2, 2, 4]) expect(Math.abs(second(seam + off))).toBeLessThan(0.25 * scale);
      }
      // inside the entrance and the exit the acceleration is real (the ease), and the roll's is nil
      expect(Math.abs(second(Ein / 2))).toBeGreaterThan(0.2 * scale);
      expect(Math.abs(second(Ein + T / 2))).toBeLessThan(1e-12);
    }
  });

  it("enters fast (most of the way in the first third), and leaves accelerating (ease-in)", () => {
    expect((start - rowX(Ein / 3, start)) / (start - DRIFT.amp)).toBeGreaterThan(0.6);
    // the exit's speed grows to the end
    const sp = (t: number) => Math.abs(slope((u) => rowX(u, start), t));
    const e0 = Ein + T;
    expect(sp(e0 + Eout * 0.5)).toBeGreaterThan(sp(e0 + 5));
    expect(sp(e0 + Eout * 0.95)).toBeGreaterThan(sp(e0 + Eout * 0.5));
  });

  it("keeps the rows that stay swinging about the centre with the same amplitude, continuously, and never leaves", () => {
    const f = (t: number) => pendulumX(t, start);
    expect(f(0)).toBe(start);
    expect(f(Ein)).toBeCloseTo(0, 12);
    // position and velocity continuous at the join
    const left = (f(Ein - 0.001) - f(Ein - 0.5)) / 0.499;
    const right = (f(Ein + 0.5) - f(Ein + 0.001)) / 0.499;
    expect(Math.abs(left / right - 1)).toBeLessThan(1e-2);
    let hi = -Infinity;
    let lo = Infinity;
    for (let t = Ein; t < Ein + 6 * T; t += 11) {
      hi = Math.max(hi, f(t));
      lo = Math.min(lo, f(t));
    }
    expect(hi).toBeCloseTo(DRIFT.amp, 3);
    expect(lo).toBeCloseTo(-DRIFT.amp, 3);
    // the same amplitude as the roll, half its speed's turn-round: it reaches -amp at the end of a dwell like a rolling row
    expect(f(Ein + T / 2)).toBeCloseTo(-DRIFT.amp, 9);
  });

  it("counts the cycle a row is in, and how far into it", () => {
    expect(cycleOf(-1)).toEqual({ n: -1, local: -1 });
    expect(cycleOf(0)).toEqual({ n: 0, local: 0 });
    expect(cycleOf(cycleMs() - 1).n).toBe(0);
    expect(cycleOf(cycleMs())).toEqual({ n: 1, local: 0 });
    expect(cycleOf(2.5 * cycleMs()).n).toBe(2);
  });

  it("scales the shade by how present a row is: none behind the planet, full in place and anywhere in the roll, both sides", () => {
    expect(dimPresence(start, start)).toBe(0);
    expect(dimPresence(-start, start)).toBe(0);
    expect(dimPresence(0, start)).toBe(1);
    expect(dimPresence(DRIFT.amp, start)).toBe(1);
    expect(dimPresence(-DRIFT.amp, start)).toBe(1);
    expect(dimPresence((start + DRIFT.amp) / 2, start)).toBeCloseTo(0.5, 9);
    expect(dimPresence(1, 0)).toBe(1);
  });

  it("dwells several seconds on the roll, and enters and leaves within about a second each", () => {
    expect(CAPTION.cycle.dwellMs).toBeGreaterThanOrEqual(5000);
    expect(CAPTION.cycle.dwellMs).toBeLessThanOrEqual(6500);
    expect(CAPTION.enter.ms + CAPTION.cycle.exitMs).toBeLessThan(2000);
  });
});

describe("what is seen: faces and the horizon", () => {
  it("is on a front face while the point is nearer the view axis than the shell's horizon, `acos(r / d)`, and culled past it", () => {
    const h = shellHorizon(d);
    expect(h).toBeCloseTo(Math.acos(CAPTION.radius / d), 12);
    expect(h).toBeLessThan(Math.PI / 2);
    expect(faceTowardsViewer(h - 0.01, d)).toBe(true);
    expect(faceTowardsViewer(h + 0.01, d)).toBe(false);
    expect(faceTowardsViewer(Math.PI, d)).toBe(false);
  });

  it("is before the globe's own horizon: the strip's face turns away before the limb (it is then seen from behind)", () => {
    expect(shellHorizon(d)).toBeLessThan(Math.acos(1 / d));
  });

  it("goes behind the planet's body at `occludedAngle`: where the shell's projection falls back to the disc's edge, past the poles of the view", () => {
    for (const dist of [3, 5.8, 13, 30]) {
      const psi = occludedAngle(dist);
      expect(psi).toBeGreaterThan(Math.PI / 2);
      expect(psi).toBeLessThan(Math.PI);
      // the projection of that point is the planet's disc's tangent radius
      const x = (CAPTION.radius * Math.sin(psi)) / (dist - CAPTION.radius * Math.cos(psi));
      expect(x).toBeCloseTo(1 / Math.sqrt(dist * dist - 1), 9);
      // and between the shell's horizon and there the row is OUTSIDE the disc (seen from behind, curling back), never inside it
      const mid = (shellHorizon(dist) + psi) / 2;
      expect((CAPTION.radius * Math.sin(mid)) / (dist - CAPTION.radius * Math.cos(mid))).toBeGreaterThan(1 / Math.sqrt(dist * dist - 1));
    }
  });

  it("hides a line only once all of it is behind the planet's body, on either side: past the shell's horizon it is still drawn (from behind)", () => {
    const line = { halfSpan: 0.8, baseLat: 0 };
    const h = shellHorizon(d);
    const o = occludedAngle(d);
    // on the equator seen from the equator the central angle is the longitude offset itself
    expect(lineHidden(o + 0.8 + 0.01, line, d, 0)).toBe(true);
    expect(lineHidden(-(o + 0.8 + 0.01), line, d, 0)).toBe(true);
    expect(lineHidden(o + 0.8 - 0.05, line, d, 0)).toBe(false);
    expect(lineHidden(h + 0.8 + 0.1, line, d, 0)).toBe(false); // (the old rule hid it here: it vanished in the open, beside the planet)
    expect(lineHidden(0, line, d, 0)).toBe(false);
  });

  it("counts the parallel's own latitude: a line high up stays in view longer than its longitude says (it curves round the pole)", () => {
    const line = { halfSpan: 0.4, baseLat: 60 };
    const theta = occludedAngle(d) + 0.4 + 0.1;
    expect(lineHidden(theta, { ...line, baseLat: 0 }, d, 0)).toBe(true);
    expect(lineHidden(theta, line, d, 50)).toBe(false);
  });

  it("starts every line hidden: from `entranceStart` the whole line is behind the horizon of any camera the page has, at any view latitude it can have", () => {
    for (const viewLat of [28, 10, -20, 40]) {
      for (const l of layout(DESKTOP).lines) {
        const start = entranceStart(l, viewLat);
        expect(start).toBeGreaterThanOrEqual(CAPTION.enter.fromDeg * DEG);
        expect(start).toBeLessThanOrEqual(Math.PI);
        for (const dist of [cameraDistance(0.5, 900), cameraDistance(2.2, 900), cameraDistance(6.5, 900), 1.2]) {
          // a pole-ward parallel seen over the pole is in view from every side: it cannot be hidden by turning
          if (visibleHalfSpan(viewLat, l.baseLat, occludedAngle(dist)) >= Math.min(Math.PI, start) - l.halfSpan - 1e-9) continue;
          expect(lineHidden(start, l, dist, viewLat)).toBe(true);
        }
      }
    }
  });
});

describe("the entrance: fast, then a slow settle, staggered, a function of time", () => {
  const start = 2.6;

  it("is easeOutExpo: 0 at 0, 1 at 1, most of the way in the first tenth, monotonic", () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
    expect(easeOutExpo(0.1)).toBeGreaterThan(0.45);
    expect(easeOutExpo(0.5)).toBeGreaterThan(0.96);
    let last = 0;
    for (let p = 0; p <= 1; p += 0.01) {
      expect(easeOutExpo(p)).toBeGreaterThanOrEqual(last);
      last = easeOutExpo(p);
    }
  });

  it("brings a line from its start to its roll within `enter.ms`, covering most of the way in the first third", () => {
    const m = new CaptionMotion();
    m.setStarts([start, start]);
    m.enter(0);
    expect(m.angle(0, 0, start)).toBe(start);
    expect(m.angle(CAPTION.enter.ms, 0, start)).toBeCloseTo(DRIFT.amp, 9);
    expect((start - m.angle(CAPTION.enter.ms / 3, 0, start)) / (start - DRIFT.amp)).toBeGreaterThan(0.6);
    expect(CAPTION.enter.ms).toBeGreaterThanOrEqual(800);
    expect(CAPTION.enter.ms).toBeLessThanOrEqual(1100);
  });

  it("staggers the lines: line 1 starts `staggerMs` after line 0, goes the same way, and the stagger stays in the roll", () => {
    expect(CAPTION.enter.staggerMs).toBeGreaterThanOrEqual(420);
    expect(CAPTION.enter.staggerMs).toBeLessThanOrEqual(500);
    const g = CAPTION.enter.staggerMs;
    const m = new CaptionMotion();
    m.setStarts([start, start]);
    m.enter(0);
    for (const t of [0, 100, g - 1]) expect(m.angle(t, 1, start)).toBe(start); // it has not started
    for (const t of [g + 40, g + 200, g + 600]) expect(m.angle(t, 1, start)).toBeGreaterThan(m.angle(t, 0, start));
    expect(entranceMs(2)).toBe(CAPTION.enter.ms + CAPTION.enter.staggerMs);
    // in the roll row 1 is exactly row 0 `staggerMs` behind: the block shears gently
    for (const t of [3000, 4200, 6000]) expect(m.angle(t, 1, start)).toBeCloseTo(m.angle(t - g, 0, start), 9);
  });

  it("is a function of time alone: the same turn at any frame rate, a stalled frame moves a row by one capped step", () => {
    const a = new CaptionMotion();
    a.setStarts([start]);
    a.enter(0);
    const b = new CaptionMotion();
    b.setStarts([start]);
    b.enter(0);
    // 144 fps for 3 s against 20 fps for 3 s: the same clock
    for (let t = 0; t <= 3000; t += 1000 / 144) a.tick(t);
    for (let t = 0; t <= 3000; t += 50) b.tick(t);
    expect(a.angle(3000, 0, start)).toBeCloseTo(b.angle(3000, 0, start), 2);
    // a stall: one frame 10 s later moves the clock by at most `maxStepMs`
    const c = new CaptionMotion();
    c.setStarts([start]);
    c.enter(0);
    c.tick(100);
    const before = c.angle(100, 0, start);
    c.tick(10100);
    const after = c.angle(10100, 0, start);
    expect(after).toBeCloseTo(rowX(2 * CAPTION.drift.maxStepMs, start), 9);
    expect(Math.abs(after - before)).toBeGreaterThan(0);
  });

  it("leaves quickly, on behind the planet the other way, from wherever it was", () => {
    expect(CAPTION.leaveMs).toBeLessThanOrEqual(250);
    expect(leavingAngle(0, 0.7, start)).toBe(0.7);
    expect(leavingAngle(CAPTION.leaveMs, 0.7, start)).toBeCloseTo(-start, 12);
    expect(easeInCubic(0.5)).toBeCloseTo(0.125, 12);
    const m = new CaptionMotion();
    m.setStarts([start, start]);
    m.enter(0);
    m.leave(300, "orbit"); // cut short: where they had got to
    const a0 = m.angle(300, 0, start);
    expect(a0).toBeCloseTo(rowX(300, start), 9);
    const mid = m.angle(300 + CAPTION.leaveMs / 2, 0, start);
    expect(mid).toBeLessThan(a0);
    expect(m.phase).toBe("out");
    m.angle(300 + CAPTION.leaveMs + 1, 0, start);
    expect(m.phase).toBe("hidden");
    expect(m.animating).toBe(false);
  });

  it("waits for the first frame on load, then plays; a returning showcase plays at once; reduced motion is the final composition", () => {
    const m = new CaptionMotion();
    m.setStarts([start]);
    m.enter(null);
    expect(m.waiting).toBe(true);
    expect(m.angle(5000, 0, start)).toBe(start);
    m.begin(1000, CAPTION.enter.loadDelayMs);
    expect(m.waiting).toBe(false);
    expect(m.angle(1000, 0, start)).toBe(start);
    expect(m.angle(1000 + CAPTION.enter.loadDelayMs + 300, 0, start)).toBeLessThan(0.5 * start);
    m.angle(1000 + CAPTION.enter.loadDelayMs + CAPTION.enter.ms + 10, 0, start);
    expect(m.phase).toBe("rest");
    expect(m.animating).toBe(false); // (the entrance is over: the roll's own capped loop takes it from here)
    expect(m.drifting).toBe(true);
    const r = new CaptionMotion();
    r.setStarts([start]);
    r.continuous = false; // reduced motion: still, at the centre
    r.settle(true);
    expect(r.angle(0, 0, start)).toBe(0);
    expect(r.angle(50000, 0, start)).toBe(0);
    expect(r.animating).toBe(false);
    expect(r.drifting).toBe(false);
    r.settle(false);
    expect(r.angle(0, 0, start)).toBe(start);
  });
});

describe("leaving and entering again, cut short", () => {
  const start = 2.6;

  it("keeps a line that has not begun to arrive behind the planet: it does not sweep across the face on its way out", () => {
    const m = new CaptionMotion();
    m.setStarts([start, start]);
    m.enter(0);
    // 50 ms in: line 0 has begun, line 1 is still waiting for its stagger (260 ms)
    m.leave(50, "orbit");
    for (const t of [50, 90, 150, 240]) {
      expect(m.angle(t, 1, start)).toBe(start);
      expect(m.angle(t, 0, start)).toBeLessThan(start);
    }
    // while a line that was in view goes on across, and ends hidden on the other side
    expect(m.angle(50 + CAPTION.leaveMs * 0.99, 0, start)).toBeLessThan(0);
    // a showcase that ends before its first frame (a pending entrance) never shows anything
    const p = new CaptionMotion();
    p.setStarts([start]);
    p.enter(null);
    expect(p.animating).toBe(false); // nothing moves before the first frame gives it a clock
    p.leave(10, "orbit");
    for (const t of [10, 100, 200]) expect(p.angle(t, 0, start)).toBe(start);
  });

  it("goes on from where it is when a leaving is cut short by an entrance: no jump, no stagger, and it settles into its place", () => {
    const m = new CaptionMotion();
    m.setStarts([start, start]);
    m.enter(0);
    m.leave(400, "orbit");
    const at = [m.angle(520, 0, start), m.angle(520, 1, start)];
    m.enter(520);
    expect(m.phase).toBe("in");
    // the first reading of the new entrance is the last one of the leaving
    expect(m.angle(520, 0, start)).toBeCloseTo(at[0]!, 9);
    expect(m.angle(520, 1, start)).toBeCloseTo(at[1]!, 9);
    for (let t = 530; t <= 520 + CAPTION.enter.ms; t += 40) {
      expect(Math.abs(m.angle(t, 0, start))).toBeLessThanOrEqual(Math.max(Math.abs(at[0]!), DRIFT.amp) + 1e-9);
    }
    m.angle(520 + CAPTION.enter.ms + entranceMs(2), 0, start);
    // (settled into the roll: no stagger for a line that was already on its way)
    expect(m.angle(520 + CAPTION.enter.ms + 2000, 0, start)).toBeCloseTo(rowX(2 * CAPTION.enter.ms + 2000, start), 9);
    expect(m.phase).toBe("rest");
  });

  it("enters from behind the planet when it comes from hidden, and ignores an entrance while one is running", () => {
    const m = new CaptionMotion();
    m.setStarts([start]);
    m.enter(0);
    m.leave(10, "orbit");
    m.angle(10 + CAPTION.leaveMs + 1, 0, start); // out -> hidden
    m.enter(1000);
    expect(m.angle(1000, 0, start)).toBe(start);
    const mid = m.angle(1100, 0, start);
    m.enter(1100); // a second show while in: nothing restarts
    expect(m.angle(1100, 0, start)).toBe(mid);
  });
});

describe("the sides the lines come in from", () => {
  const start = 2.6;
  const make = (seed: number | null, lines = 3) => {
    const m = new CaptionMotion();
    m.seed = seed;
    m.setStarts(Array(lines).fill(start));
    return m;
  };

  it("is all from the east without a seed (the plain default), at the start angle", () => {
    const m = make(null);
    m.enter(0);
    for (let i = 0; i < 3; i++) expect(m.angle(0, i, start)).toBe(start);
  });

  it("is random per line and per entrance, deterministic for a seed, and may repeat", () => {
    const a = entranceSides(12345, 1, 3);
    expect(entranceSides(12345, 1, 3)).toEqual(a);
    expect(a.every((x) => x === 1 || x === -1)).toBe(true);
    // across entrances and seeds both sides turn up, and over many draws neither dominates
    let west = 0;
    let n = 0;
    for (let seed = 1; seed <= 40; seed++) for (let e = 1; e <= 5; e++) for (const side of entranceSides(seed, e, 3)) (n++, side === -1 && west++);
    expect(west / n).toBeGreaterThan(0.35);
    expect(west / n).toBeLessThan(0.65);
    // two lines of one entrance can share a side (it is not a shuffle)
    const same = [...Array(60).keys()].some((seed) => new Set(entranceSides(seed + 1, 1, 3)).size === 1);
    expect(same).toBe(true);
  });

  it("starts each line on its own side, travels in with the same curve, and rests in place from either", () => {
    const m = make(7);
    m.enter(0);
    const sides = [0, 1, 2].map((i) => Math.sign(m.angle(0, i, start)));
    expect(sides).toEqual(entranceSides(7, 1, 3));
    for (let i = 0; i < 3; i++) {
      const t = 700 + i * CAPTION.enter.staggerMs;
      expect(m.angle(t, i, start)).toBeCloseTo(sides[i]! * rowX(700, start), 9);
    }
    m.angle(entranceMs(3) + 5, 0, start);
    expect(m.phase).toBe("rest");
    // in the roll each line is within the amplitude of the centre, and goes the way it came: through it, to the other side
    for (let i = 0; i < 3; i++) {
      const a = m.angle(4000, i, start);
      expect(Math.abs(a)).toBeLessThanOrEqual(DRIFT.amp + 1e-9);
      expect(Math.sign(m.angle(4000 + 100, i, start) - a)).toBe(-sides[i]!);
    }
  });

  it("draws new sides for each entrance from hidden, but a leaving cut short goes on from where each line is, on its own side", () => {
    const m = make(99);
    m.enter(0);
    const first = [0, 1, 2].map((i) => m.side(i));
    m.leave(400, "orbit");
    const at = [0, 1, 2].map((i) => m.angle(400, i, start));
    m.angle(400 + CAPTION.leaveMs + 1, 0, start); // out -> hidden
    const n = m.entranceNumber;
    m.enter(2000);
    expect(m.entranceNumber).toBe(n + 1);
    expect([0, 1, 2].map((i) => m.side(i))).toEqual(entranceSides(99, n + 1, 3));
    // cut short: the same sides, no jump
    const k = make(99);
    k.enter(0);
    k.leave(400, "orbit");
    const stay = [0, 1, 2].map((i) => k.side(i));
    k.enter(450);
    expect([0, 1, 2].map((i) => k.side(i))).toEqual(stay);
    expect(stay).toEqual(first);
    expect(at.length).toBe(3);
  });

  it("keeps a line that has not begun behind the planet on its own side when the leaving begins early (west or east)", () => {
    const m = make(5);
    m.enter(0);
    m.leave(50, "orbit");
    for (const t of [50, 90, 240]) {
      for (let i = 1; i < 3; i++) expect(m.angle(t, i, start)).toBe(start * m.side(i));
    }
  });

  it("takes the FIRST entrance's sides from the session seed on the layer's real path (seed set, then show, then the rows are laid out), not from the null default", () => {
    let west = 0;
    let allEast = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      // the layer: a fresh motion, its seed assigned in the constructor, `show(null)` before the first frame, the rows set when the build lands
      const m = new CaptionMotion();
      m.seed = (Math.imul(i + 1, 2654435761) >>> 1) | 0;
      m.enter(null);
      m.setStarts([start, start, start, start], [0, 1, 2, 3]);
      const sides = [0, 1, 2, 3].map((r) => m.side(r));
      west += sides.filter((x) => x === -1).length;
      if (sides.every((x) => x === 1)) allEast++;
      // the sign of the turn is the side: east is positive, the line starts to the right and travels left
      expect(sides.map((x, r) => Math.sign(m.angle(0, r, start)))).toEqual(sides.map((x) => (x === 1 ? 1 : -1)));
    }
    expect(west / (4 * N)).toBeGreaterThan(0.44);
    expect(west / (4 * N)).toBeLessThan(0.56);
    expect(allEast / N).toBeLessThan(0.2); // 1 in 16 on paper
    // a missing seed is the plain default: all from the east (documented; the layer always gives one)
    const n = new CaptionMotion();
    n.enter(null);
    n.setStarts([start, start], [0, 1]);
    expect([n.side(0), n.side(1)]).toEqual([1, 1]);
  });

  it("gives the same sequence for the same seed (the generator)", () => {
    const r1 = seededUnit(42);
    const r2 = seededUnit(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });
});

describe("leaving: a fade, or the orbit", () => {
  const start = 2.6;
  const make = () => {
    const m = new CaptionMotion();
    m.setStarts([start, start, start]);
    return m;
  };

  it("fades by default: nothing moves, the lines stay where they were, and the caption is hidden after `fadeMs`", () => {
    const m = make();
    m.enter(0);
    m.angle(CAPTION.enter.ms + 3 * CAPTION.enter.staggerMs + 50, 0, start); // in place: rest
    expect(m.phase).toBe("rest");
    m.leave(5000);
    expect(m.phase).toBe("fade");
    expect(m.animating).toBe(false); // no frames are asked for: the fade is the compositor's
    const frozen = [0, 1, 2].map((i) => m.angle(5000, i, start));
    for (const t of [5000, 5050, 5100, 5170]) for (let i = 0; i < 3; i++) expect(m.angle(t, i, start)).toBe(frozen[i]); // where the roll was
    m.tick(5000 + CAPTION.fadeMs - 1);
    expect(m.phase).toBe("fade");
    m.tick(5000 + CAPTION.fadeMs);
    expect(m.phase).toBe("hidden");
    expect(m.animating).toBe(false);
  });

  it("freezes a line mid-entrance where it was when the fade begins (no travel)", () => {
    const m = make();
    m.enter(0);
    const at = m.angle(400, 0, start);
    expect(at).toBeGreaterThan(0);
    m.leave(400);
    for (const t of [400, 450, 560]) expect(m.angle(t, 0, start)).toBe(at);
  });

  it("keeps the orbit exit: `leave(now, \"orbit\")` sends the lines on behind the planet, as before", () => {
    const m = make();
    m.enter(0);
    m.angle(CAPTION.enter.ms + 3 * CAPTION.enter.staggerMs + 50, 0, start);
    m.leave(5000, "orbit");
    expect(m.phase).toBe("out");
    expect(m.animating).toBe(true);
    const mid = m.angle(5000 + CAPTION.leaveMs / 2, 0, start);
    expect(mid).toBeLessThan(0);
    expect(m.angle(5000 + CAPTION.leaveMs + 1, 0, start)).toBe(start);
    expect(m.phase).toBe("hidden");
  });

  it("enters again from a fade as from hidden: a fresh entrance with sides drawn again", () => {
    const m = new CaptionMotion();
    m.seed = 11;
    m.setStarts([start, start, start]);
    m.enter(0);
    m.angle(5000, 0, start);
    m.leave(5000);
    m.tick(5000 + CAPTION.fadeMs);
    const n = m.entranceNumber;
    m.enter(6000);
    expect(m.entranceNumber).toBe(n + 1);
    expect(m.phase).toBe("in");
    expect(Math.abs(m.angle(6000, 0, start))).toBe(start);
  });

  it("is quick: the fade is between 150 and 220 ms", () => {
    expect(CAPTION.fadeMs).toBeGreaterThanOrEqual(150);
    expect(CAPTION.fadeMs).toBeLessThanOrEqual(220);
  });
});

describe("faces, styles and colours", () => {
  it("is a classic serif of its own (Old Standard TT, one file a weight), the site's mono and one handwriting, loaded by the globe", () => {
    expect(CAPTION_FACES.serif.family).toMatch(/Caption Serif/);
    expect(CAPTION_FACES.mono.family).toMatch(/JetBrains Mono/);
    expect(CAPTION_FACES.serif.url).toBeNull(); // (its files are per style: a file a weight)
    expect(CAPTION_STYLES.plain.url).toMatch(/^\/fonts\/old-standard-tt-\d+\.\d+-latin-400\.woff2$/);
    expect(CAPTION_STYLES.heavy.url).toMatch(/^\/fonts\/old-standard-tt-\d+\.\d+-latin-700\.woff2$/);
    expect(CAPTION_FACES.mono.url).toBeNull();
    expect(CAPTION_FACES.script.url).toMatch(/^\/fonts\/imperial-script-\d+\.\d+-latin-400\.woff2$/);
    expect(CAPTION_FACE.capEm).toBeCloseTo(0.712, 3); // Old Standard TT's cap height over its em (OS/2 sCapHeight 712 / 1000)
  });

  it("has heavier weights for the highlights and a font string per style that names its face, weight and italic", () => {
    expect(CAPTION_STYLES.heavy.weight).toBeGreaterThan(CAPTION_STYLES.plain.weight);
    expect(CAPTION_STYLES["heavy-italic"].italic).toBe(true);
    expect(captionFont("heavy-italic", 100)).toMatch(/^italic 700 100px "Caption Serif"/);
    expect(captionFont("mono", 100)).toMatch(/JetBrains Mono Variable/);
    // the mono and the script are scaled to the serif's cap height
    expect(captionFont("mono", 100)).toContain(`${100 * CAPTION_FACES.mono.scale}px`);
    expect(CAPTION_FALLBACK_STYLE.script).toBe("heavy-italic");
  });

  it("is text-coloured letters in a mid-tone contour and thickness, all solid: the face the secondary text tone, a picked-out word BSoD Blue", () => {
    const light = { background: [0.984, 0.984, 0.984], ink: [0.039, 0.039, 0.039], coast: [0.56, 0.56, 0.56], outline: [0.9, 0.9, 0.9], grid: [0.8, 0.8, 0.8], ramp: [] } as never;
    const dark = { background: [0.039, 0.039, 0.039], ink: [0.96, 0.96, 0.96], coast: [0.38, 0.38, 0.38], outline: [0.1, 0.1, 0.1], grid: [0.2, 0.2, 0.2], ramp: [] } as never;
    const l = captionColors(light);
    const d = captionColors(dark);
    expect(Object.keys(l).sort()).toEqual(["accent", "accentOutline", "accentSide", "face", "outline", "side"]);
    const lum = (c: readonly number[]) => {
      const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
    };
    const ratio = (a: readonly number[], b: readonly number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    for (const [t, bg] of [[l, [0.984, 0.984, 0.984]], [d, [0.039, 0.039, 0.039]]] as const) {
      // the face is a grey text tone, legible; the blue is legible for large letters (3:1 or more) and is blue
      expect(t.face[0]).toBeCloseTo(t.face[1]!, 9);
      expect(ratio(t.face, bg)).toBeGreaterThan(4.5);
      expect(ratio(t.accent, bg)).toBeGreaterThan(3);
      expect(t.accent[2]!).toBeGreaterThan(t.accent[0]! + 0.1);
      // the contour reads against the page (1.8 to 2.3:1) and is clearly less strong than the letters; the thickness a step closer to the page
      expect(ratio(t.outline, bg)).toBeGreaterThan(1.8);
      expect(ratio(t.outline, bg)).toBeLessThan(2.3);
      expect(ratio(t.outline, t.face)).toBeGreaterThan(3);
      expect(ratio(t.side, bg)).toBeGreaterThan(1.1); // quieter since 2026-10-21 (it was 1.7, then 1.3)
      expect(ratio(t.side, bg)).toBeLessThan(ratio(t.outline, bg));
    }
    // a tinted word's contour and thickness derive from ITS face by the same shares as the neutral ones from the neutral face
    for (const [t, bg] of [[l, [0.984, 0.984, 0.984]], [d, [0.039, 0.039, 0.039]]] as const) {
      for (const i of [0, 1, 2]) {
        expect((t.accentOutline[i]! - bg[i]!) / (t.accent[i]! - bg[i]!)).toBeCloseTo((t.outline[i]! - bg[i]!) / (t.face[i]! - bg[i]!), 6);
        expect((t.accentSide[i]! - bg[i]!) / (t.accent[i]! - bg[i]!)).toBeCloseTo((t.side[i]! - bg[i]!) / (t.face[i]! - bg[i]!), 6);
      }
      // and the tinted letter reads as one: its contour is bluer than the neutral contour
      expect(t.accentOutline[2]! - t.accentOutline[0]!).toBeGreaterThan(t.outline[2]! - t.outline[0]! + 0.02);
    }
    // the lapis blue is muted: low chroma (the 700 or 400 step mixed 60 % into the text tone), still blue and legible
    expect(d.accent[2]).toBeGreaterThan(d.accent[0]! + 0.1);
    expect(d.accent[2]).toBeLessThan(0.95);
    // mode `page`: the exact page colour for both
    const p = captionColors(light, "page");
    expect([...p.outline]).toEqual([0.984, 0.984, 0.984]);
    expect([...p.side]).toEqual([...p.outline]);
  });

  it("keeps the accent on a run through the cut of a phrase (a word picked out stays picked out)", () => {
    const line: CaptionRun[] = [{ text: "A " }, { text: "personal archive", style: "heavy", accent: "blue" }, { text: ", organised around " }, { text: "places", style: "heavy", accent: "blue" }, { text: "." }];
    const cut = splitRuns(line, (r) => r.text.length)!;
    expect(cut[0]!.find((r) => r.style === "heavy")!.accent).toBe("blue");
    expect(cut[1]!.find((r) => r.style === "heavy")!.accent).toBe("blue");
  });
});

describe("the idle settle: every row eases to the middle before the page holds still", () => {
  const start = 2.6;
  const make = (seed: number | null) => {
    const m = new CaptionMotion();
    m.seed = seed;
    m.setFixedFrom(2);
    m.setStarts([start, start, start, start], [0, 1, 2, 3]);
    m.enter(0);
    return m;
  };
  /** Run the clock to `t` ms in 20 ms frames (a 20 fps loop would be coarser: the maths is a function of time). */
  const run = (m: CaptionMotion, t: number) => {
    for (let x = 0; x <= t; x += 20) {
      m.tick(x);
      for (let i = 0; i < 4; i++) m.angle(x, i, start);
    }
  };

  it("brings every row to the middle in `parkMs`, from any moment of the entrance, the roll and the exit, on either side", () => {
    // the times cover the entrance (500), the roll (3000), a row's exit (7000 to 7400), the second cycle's entrance (8000) and its roll (12000)
    for (const seed of [null, 7, 99]) {
      for (const at of [500, 1500, 3000, 6600, 7000, 7300, 7500, 8000, 12000, 20000]) {
        const m = make(seed);
        run(m, at);
        m.beginPark(at);
        expect(m.isParking).toBe(true);
        const end = at + CAPTION.park.parkMs;
        m.tick(end + 1);
        for (let i = 0; i < 4; i++) expect(Math.abs(m.angle(end + 1, i, start))).toBeLessThan(1e-9);
        expect(m.parkDone).toBe(true);
        // and it stays there, whatever the time
        for (const later of [end + 500, end + 60000]) for (let i = 0; i < 4; i++) expect(m.angle(later, i, start)).toBe(0);
        expect(m.drifting).toBe(false);
      }
    }
  });

  it("goes there without a pop and without turning back: the first reading is where the row was, then each |turn| only falls", () => {
    for (const at of [1500, 3000, 7300, 12000]) {
      const m = make(7);
      run(m, at);
      const before = [0, 1, 2, 3].map((i) => m.angle(at, i, start));
      m.beginPark(at);
      const first = [0, 1, 2, 3].map((i) => m.angle(at, i, start));
      first.forEach((a, i) => expect(a).toBeCloseTo(before[i]!, 9));
      let last = first.map(Math.abs);
      for (let x = at + 20; x <= at + CAPTION.park.parkMs; x += 20) {
        const now = [0, 1, 2, 3].map((i) => Math.abs(m.angle(x, i, start)));
        now.forEach((a, i) => expect(a).toBeLessThanOrEqual(last[i]! + 1e-12));
        last = now;
      }
    }
  });

  it("resumes without a pop: the rows blend from the middle (or where they were) into the roll, which goes on from its middle", () => {
    const m = make(7);
    run(m, 3000);
    m.beginPark(3000);
    m.tick(5000);
    m.angle(5000, 0, start);
    m.unpark(9000);
    expect(m.parkDone).toBe(false);
    const first = [0, 1, 2, 3].map((i) => m.angle(9000, i, start));
    first.forEach((a) => expect(Math.abs(a)).toBeLessThan(1e-9));
    // within the blend the turn stays within the amplitude, and after it the roll goes on
    for (let x = 9020; x <= 9000 + CAPTION.park.resumeMs + 400; x += 20) {
      m.tick(x);
      for (let i = 0; i < 4; i++) expect(Math.abs(m.angle(x, i, start))).toBeLessThanOrEqual(DRIFT.amp + 1e-9);
    }
    expect(m.drifting).toBe(true);
  });
});
