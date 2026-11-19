/**
 * The geometry the activity picture shares between its 3D scene (`components/activity-scene.tsx`) and its place-holder (`components/activity-panel.tsx`): the pitch of the days, the strips of a narrow page, the camera's
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
  return { side: 3.2, near: strips > 1 ? 4.4 : 2.6, far: 0.6 };
}

/** The slab: `weeks` weeks laid out in `strips` strips (equal length, one behind the other); `at` gives the centre of a day on the ground (x across, z in depth). */
export function slabFor(weeks: number, strips: number) {
  const perStrip = Math.ceil(weeks / strips);
  return {
    width: perStrip * PITCH,
    total: strips * 7 * PITCH + (strips - 1) * STRIP_GAP,
    at: (week: number, day: number) => ({
      x: (week % perStrip) * PITCH + 0.5,
      z: Math.floor(week / perStrip) * (7 * PITCH + STRIP_GAP) + day * PITCH + 0.5,
    }),
  };
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
  const { width, total, at } = slabFor(weeks, strips);
  const room = roomFor(strips);
  const ax = screenAxes();
  const project = (px: number, py: number, pz: number) => ({ x: dot(ax.x, [px, py, pz]), y: -dot(ax.y, [px, py, pz]) });
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const cx of [-room.side, width + room.side]) for (const cy of [0, tallest]) for (const cz of [-room.near, total + room.far]) {
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
