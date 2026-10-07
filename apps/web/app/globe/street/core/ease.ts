/**
 * The temporal ease: the rule that turns "what the classifier says now" into "what is presented", frame after frame, so that content
 * which appears or disappears for any reason other than the camera MOVING it (a tile arriving after a slow request, a tile leaving, a
 * tone step of a level-of-detail class, the globe-to-street cut) goes through the grey levels instead of popping, whether the camera
 * rests, pans or zooms. `gl/pixel-pass.ts` (`FRAG_EASE`) is the GPU twin of `easeImage`; the tests pin one to the other's rules.
 *
 * Inputs per frame, all art images of palette LEVELS (0 = page colour):
 *   T   the classified image of this frame (the target)
 *   Tp  the classified image of the previous frame (not eased)
 *   P   the image presented at the previous frame
 *   W   where every cell of this frame was in the previous one (`core/warp.ts`: identity, an affine map or a globe mesh)
 *
 * The presented level of a cell `c` of this frame:
 *   1. T(c) = 0 and the warped P(c) = e > 0: the old content is gone. If a lit cell of T is within `radius` cells with a level of at
 *      least e - 1, the content only MOVED (a line one cell over, a dash that slid along its road): the cell is cleared at once.
 *      Otherwise it was removed: it fades out, `step` levels per tick.
 *   2. T(c) > 0: look in the previous TARGET Tp, around the warped position, for a cell of the same level. Found: it is the same
 *      content, so its presented tone P (not its target) is the base and the fade continues as the camera moves ("tone follows the
 *      content", which is what keeps a tile that arrived mid-pan fading in while it slides). Not found: new content (or a changed
 *      tone): the base is the warped P(c). Either way the cell moves from the base towards T(c) by at most `step` levels.
 *   3. A cell the previous frame did not show at all (a pan uncovered it, or the globe had no ground there): the target at once.
 * With the identity warp `radius` is 0 and the rule reduces to "move every cell towards its target by at most `step` levels".
 *
 * Two kinds of lit cell are told apart (`LevelImage.line`): LINES follow the camera (the rules above, with the warp); FILL cells (the
 * water and park patterns) are anchored to the screen, so they are tracked on screen with the lattice-sized radius `FILL_RADIUS`: a lit
 * fill cell next to fill of the same tone was already there (the region just slid), a lit fill cell with none near is a tile that arrived.
 */
import { MESH_STEP, NO_WARP, warpPoint, type WarpMesh } from "./warp";

export const EASE = {
  /**
   * Time per palette level of the fade (ms): a cell that goes from the page colour to the loudest map tone (level 10 of 12) takes
   * 10 x this, about a quarter of a second. Also the pace of the globe-to-street cut.
   */
  msPerLevel: 24,
  /** Frames longer than this (a hidden tab, a stall) count as this long, so a fade never jumps. */
  maxDtMs: 100,
  /**
   * A camera jump (a `jumpTo` across the map, a restored view): the content moved by more than this many cells between two frames, so
   * the previous image says nothing about this one. It is dropped and the new image taken as it is (a cut, not a double exposure).
   */
  jumpCells: 30,
  /** Match radius of lines in cells when the camera moved: a thin line is rasterised with up to a cell of jitter, dashes slide along their road. */
  radius: 2,
} as const;

/** Whole levels to move this frame, from the elapsed time and the fractional remainder carried over from the previous frames. */
export function stepBudget(carry: number, dtMs: number, msPerLevel: number = EASE.msPerLevel): { step: number; carry: number } {
  const dt = Math.min(Math.max(0, dtMs), EASE.maxDtMs);
  const b = carry + dt / msPerLevel;
  const step = Math.min(255, Math.floor(b + 1e-9));
  return { step, carry: Math.min(1, b - step) };
}

/**
 * Match radius of LINES for a warp: 0 when nothing moved (a tile arrival or a settle tick: every change eases), else `EASE.radius`
 * (a pan, even by whole cells, rasterises a thin line with a cell of jitter; a zoom or the globe moves content by up to a cell more).
 */
export function matchRadius(mesh: Pick<WarpMesh, "kind" | "exact" | "scale">): number {
  return mesh.kind === "identity" ? 0 : EASE.radius;
}

/** An art image of palette levels with the kind of each lit cell: a LINE (1: roads, coast, borders: moves with the camera) or not (0: a fill pattern, anchored to the screen). */
export interface LevelImage {
  lvl: Uint8Array;
  line: Uint8Array;
}

export interface EaseFrame {
  cols: number;
  rows: number;
  /** T, Tp, P */
  target: LevelImage;
  prevTarget: LevelImage;
  prev: LevelImage;
  /** null = identity */
  mesh: WarpMesh | null;
  step: number;
  /** match radius of LINES (cells); fills use `FILL_RADIUS` always */
  radius: number;
}

/**
 * Fill patterns (water dashes, park dots; `PATTERN` in core/palette.ts) are a function of the SCREEN cell, never of the world, so under
 * pan and zoom their lit cells do not move with the content: a region of fill slides over a fixed lattice. They are therefore tracked
 * on screen, with a radius that covers the lattice's period: a fill cell is "the same content as before" when a lit fill cell of the same
 * level was within this many cells in the previous frame, and a removed fill cell is "moved" when lit fill is still that close.
 */
export const FILL_RADIUS = 4;

export interface CellOut {
  lvl: number;
  line: number;
}

const lv = (img: LevelImage, cols: number, rows: number, x: number, y: number): number => (x < 0 || y < 0 || x >= cols || y >= rows ? 0 : img.lvl[y * cols + x]!);
const ln = (img: LevelImage, cols: number, rows: number, x: number, y: number): number => (x < 0 || y < 0 || x >= cols || y >= rows ? 0 : img.line[y * cols + x]!);

/** Previous-frame cell of the new cell (x, y): `null` when it was off the old image or off the globe (nothing to look up). */
function oldCell(f: EaseFrame, x: number, y: number): [number, number] | null {
  if (!f.mesh || f.mesh.kind === "identity") return [x, y];
  const p = warpPoint(f.mesh, x + 0.5, y + 0.5, MESH_STEP);
  if (!p) return null;
  const ox = Math.floor(p[0]);
  const oy = Math.floor(p[1]);
  return ox < 0 || oy < 0 || ox >= f.cols || oy >= f.rows ? null : [ox, oy];
}

/** The presented level and kind of one cell (the reference of the shader). */
export function easeCell(f: EaseFrame, x: number, y: number): CellOut {
  const { cols, rows, target: T, prevTarget: Tp, prev: P } = f;
  const t = T.lvl[y * cols + x]!;
  const tLine = T.line[y * cols + x]!;
  const step = f.step;
  const slew = (base: number) => base + Math.max(-step, Math.min(step, t - base));

  // ---- fill part: screen anchored, identity lookups
  let fill = 0;
  const pHere = lv(P, cols, rows, x, y);
  const pFill = pHere > 0 && ln(P, cols, rows, x, y) === 0;
  if (t > 0 && !tLine) {
    let base = pFill ? pHere : 0;
    let best = Infinity;
    for (let dy = -FILL_RADIUS; dy <= FILL_RADIUS; dy++) for (let dx = -FILL_RADIUS; dx <= FILL_RADIUS; dx++) {
      if (lv(Tp, cols, rows, x + dx, y + dy) !== t || ln(Tp, cols, rows, x + dx, y + dy) !== 0) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 < best && ln(P, cols, rows, x + dx, y + dy) === 0) {
        best = d2;
        base = lv(P, cols, rows, x + dx, y + dy);
      }
    }
    fill = slew(base);
  } else if (t === 0 && pFill) {
    let moved = false;
    for (let dy = -FILL_RADIUS; dy <= FILL_RADIUS && !moved; dy++) for (let dx = -FILL_RADIUS; dx <= FILL_RADIUS; dx++) {
      const l = lv(T, cols, rows, x + dx, y + dy);
      if (l > 0 && ln(T, cols, rows, x + dx, y + dy) === 0 && l + 1 >= pHere) { moved = true; break; }
    }
    fill = moved ? 0 : pHere - Math.min(pHere, step);
  }

  // ---- line part: warped lookups
  let line = 0;
  const here = oldCell(f, x, y);
  if (!here) {
    line = t > 0 && tLine ? t : 0; // nothing before: the target at once
  } else {
    const eRaw = lv(P, cols, rows, here[0], here[1]);
    const e = ln(P, cols, rows, here[0], here[1]) === 1 ? eRaw : 0;
    const R = f.radius;
    if (t > 0 && tLine) {
      // the base: the line's own presented tone; with none, the fill tone the cell was showing (a road over a lake takes over from it, no dip)
      let base = e > 0 ? e : pFill ? pHere : 0;
      let best = Infinity;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const o = oldCell(f, x + dx, y + dy);
        if (!o) continue;
        if (lv(Tp, cols, rows, o[0], o[1]) === t && ln(Tp, cols, rows, o[0], o[1]) === 1) {
          const d2 = dx * dx + dy * dy;
          if (d2 < best && ln(P, cols, rows, o[0], o[1]) === 1) {
            best = d2;
            base = lv(P, cols, rows, o[0], o[1]); // the same line as before: its presented tone
          }
        }
      }
      line = slew(base);
    } else if (e > 0) {
      let moved = false;
      for (let dy = -R; dy <= R && !moved; dy++) for (let dx = -R; dx <= R; dx++) {
        const l = lv(T, cols, rows, x + dx, y + dy);
        if (l > 0 && ln(T, cols, rows, x + dx, y + dy) === 1 && l + 1 >= e) { moved = true; break; }
      }
      line = moved ? 0 : e - Math.min(e, step);
    }
  }
  // the louder of the two parts wins (a line over a fill); equal: the line
  return line >= fill ? { lvl: line, line: line > 0 ? 1 : 0 } : { lvl: fill, line: 0 };
}

/** The presented image of a frame (CPU reference: tests and the self check of the GPU pass). */
export function easeImage(f: EaseFrame): LevelImage {
  const out: LevelImage = { lvl: new Uint8Array(f.cols * f.rows), line: new Uint8Array(f.cols * f.rows) };
  for (let y = 0; y < f.rows; y++) for (let x = 0; x < f.cols; x++) {
    const c = easeCell(f, x, y);
    out.lvl[y * f.cols + x] = c.lvl;
    out.line[y * f.cols + x] = c.line;
  }
  return out;
}

export { NO_WARP };
