/**
 * The geometry the activity picture shares between its 3D scene (`graph.ts`) and a place-holder drawn flat in front of it (`placeholderTiles`): the pitch of the days, the strips of a narrow page, the camera's
 * direction, the room around the slab, and the projection of a flat day onto the screen. Pure (no three.js): the place-holder is the same slab seen by the same camera, drawn flat, so the scene replaces it in place.
 */
export const PITCH = 1.12;
export const STRIP_GAP = 1.6;
/** From where the isometric camera looks at the slab (it sits on this side of it). */
export const CAMERA_DIR = [-0.3, 0.5, -1] as const;
/** The tallest column of a year of data (the 3D framing is fitted to it; the place-holder takes this one). */
export const TYPICAL_TALLEST = 4.4;

/** The room around the slab for the glow of the outermost columns (world units): the sides, under it (nearer the camera) and behind it. */
export function roomFor(strips: number) {
  return { side: strips > 1 ? -1.4 : 3.2, near: strips > 1 ? 1.6 : 2.6, far: strips > 1 ? 0.5 : 0.6 };
}

/**
 * The slab: `weeks` weeks laid out in `strips` strips (equal length, one behind the other); `at` gives the centre of a day on the ground (x across, z in depth). On a page with several strips each one is moved along x by the amount
 * that cancels what the camera's tilt does to it on the screen (a strip farther in depth is seen farther to one side): the strips are then stacked straight on the screen, in a staircase on the ground, and the picture is
 * about a third narrower than with the strips side by side in x, so the fit can enlarge it.
 */
export function slabFor(weeks: number, strips: number, shifts?: readonly number[]) {
  const perStrip = Math.ceil(weeks / strips);
  // (`shifts`: a further move of each strip along x, in weeks, from `stripShifts`: the strips are made to look centred, not only to be; moved all to the same side of zero, so that no strip is left of the slab's first column)
  const low = shifts ? Math.min(...shifts) : 0;
  const extra = (k: number) => (shifts ? ((shifts[k] ?? 0) - low) * PITCH : 0);
  const spread = shifts ? (Math.max(...shifts) - low) * PITCH : 0;
  const pitchZ = 7 * PITCH + STRIP_GAP;
  const ax = screenAxes().x;
  // (the screen x of a point is dot(ax, p): a step of `pitchZ` in z is cancelled by a step of -pitchZ * ax.z / ax.x in x)
  const step = strips > 1 ? (-pitchZ * ax[2]) / ax[0] : 0;
  const offset = (k: number) => (step >= 0 ? k * step : (strips - 1 - k) * -step) + extra(k);
  const rects = Array.from({ length: strips }, (_, k) => ({ x0: offset(k), x1: offset(k) + perStrip * PITCH, z0: k * pitchZ, z1: k * pitchZ + 7 * PITCH }));
  return {
    width: perStrip * PITCH + (strips - 1) * Math.abs(step) + spread,
    total: strips * 7 * PITCH + (strips - 1) * STRIP_GAP,
    rects,
    /** The corners (x, z) of the slab with the room around it, for fitting the picture in its box: each strip's, the room at the sides of all, under the first and behind the last. */
    corners(room: { side: number; near: number; far: number }) {
      return rects.flatMap((r, k) => {
        const z0 = r.z0 - (k === 0 ? room.near : 0);
        const z1 = r.z1 + (k === strips - 1 ? room.far : 0);
        return [[r.x0 - room.side, z0], [r.x1 + room.side, z0], [r.x0 - room.side, z1], [r.x1 + room.side, z1]] as [number, number][];
      });
    },
    at: (week: number, day: number) => {
      const k = Math.floor(week / perStrip);
      return { x: offset(k) + (week % perStrip) * PITCH + 0.5, z: k * pitchZ + day * PITCH + 0.5 };
    },
  };
}

/**
 * How far to move each strip of a narrow page along x (in weeks) so that the weight of the blocks of every strip is centred on the page: a strip whose busy days are on its left looks left, a shorter last strip (53 weeks in 4 strips are 14, 14, 14 and
 * 11) is left of the others. `weightAt(week, day)` is how much the day weighs on the eye (its blocks' height); the centre of gravity of each strip is brought to the middle of a full strip. At most 3 weeks either way. Pure.
 */
export function stripShifts(weeks: number, strips: number, weightAt: (week: number, day: number) => number): number[] {
  if (strips <= 1) return [0];
  const perStrip = Math.ceil(weeks / strips);
  const middle = (perStrip - 1) / 2;
  return Array.from({ length: strips }, (_, k) => {
    let sum = 0;
    let moment = 0;
    for (let i = 0; i < perStrip; i++) {
      const week = k * perStrip + i;
      if (week >= weeks) break;
      for (let day = 0; day < 7; day++) {
        const w = Math.max(0, weightAt(week, day));
        sum += w;
        moment += w * i;
      }
    }
    return sum > 0 ? Math.max(-3, Math.min(3, middle - moment / sum)) : 0;
  });
}

const norm = (v: readonly number[]) => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l] as const;
};
const cross = (a: readonly number[], b: readonly number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!] as const;
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** The camera's screen axes in the world (what three.js's `lookAt` makes of the direction with +y up): a world point's screen position is its dot product with each. */
function screenAxes() {
  const z = norm(CAMERA_DIR);
  const x = norm(cross([0, 1, 0], z));
  const y = cross(z, x);
  return { x, y };
}

/**
 * The place-holder: every day of the year as a flat rounded square on the ground, projected as the scene's camera sees it, fitted into a box of the given aspect ratio the way the scene fits itself (`fit` in the scene, with a
 * typical tallest column). Returns the SVG `viewBox` and one path of all the squares (to be filled).
 */
export function placeholderTiles(weeks: number, strips: number, aspect: number, tallest = TYPICAL_TALLEST) {
  const { corners, at } = slabFor(weeks, strips);
  const room = roomFor(strips);
  const ax = screenAxes();
  const project = (px: number, py: number, pz: number) => ({ x: dot(ax.x, [px, py, pz]), y: -dot(ax.y, [px, py, pz]) });
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [cx, cz] of corners(room)) for (const cy of [0, tallest]) {
    const p = project(cx, cy, cz);
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const halfH = Math.max((y1 - y0) / 2, (x1 - x0) / 2 / aspect) * 1.04;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  // a rounded square on the ground (half side 0.46, corner radius 0.16 like the blocks'), its outline sampled in world space and then projected, so the foreshortening is the scene's own
  const outline: [number, number][] = [];
  for (const [cx, cz, a0] of [[0.3, 0.3, 0], [-0.3, 0.3, Math.PI / 2], [-0.3, -0.3, Math.PI], [0.3, -0.3, Math.PI * 1.5]] as const) {
    for (let i = 0; i <= 3; i++) {
      const a = a0 + (i / 3) * (Math.PI / 2);
      outline.push([cx + 0.16 * Math.cos(a), cz + 0.16 * Math.sin(a)]);
    }
  }
  let d = "";
  for (let week = 0; week < weeks; week++) {
    for (let day = 0; day < 7; day++) {
      const c = at(week, day);
      const pts = outline.map(([dx, dz]) => project(c.x + dx, 0, c.z + dz));
      d += `M${pts.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join("L")}Z`;
    }
  }
  return { viewBox: `${(mx - halfH * aspect).toFixed(3)} ${(my - halfH).toFixed(3)} ${(2 * halfH * aspect).toFixed(3)} ${(2 * halfH).toFixed(3)}`, d };
}
