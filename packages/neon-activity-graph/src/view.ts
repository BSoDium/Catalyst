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
  return { side: strips > 1 ? 0.3 : 3.2, near: strips > 1 ? 1.6 : 2.6, far: strips > 1 ? 0.5 : 0.6 };
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
    // (only a shorter strip is moved, to the middle of a full one: the weight of the days no longer moves a strip, which made one strip stand far from the others, and a ragged picture)
    void moment;
    const own = (Math.min(perStrip, weeks - k * perStrip) - 1) / 2;
    return sum > 0 ? Math.max(-3, Math.min(3, middle - own)) : 0;
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

/** Where the scene's pits are seen: half the side of their opening (the pit's 0.46 and the lip round it, 5 % more) and the height of the layers lying over the ground (the pit's shading is drawn there). */
export const PIT_HALF = 0.48;
export const PIT_LEVEL = 0.11;

/**
 * The place-holder: every day of the year as a flat rounded square on the ground, projected as the scene's camera sees it, fitted into a box of the given aspect ratio the way the scene fits itself (`fit` in the scene, with a
 * typical tallest column). Returns the SVG `viewBox` and one path of all the squares (to be filled).
 */
export function placeholderTiles(weeks: number, strips: number, aspect: number, tallest = TYPICAL_TALLEST, shifts?: readonly number[]) {
  const { corners, at } = slabFor(weeks, strips, shifts);
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
  const { mx, my, halfH } = frameOf(strips, weeks, at, project, x0, x1, y0, y1, aspect);
  // a rounded square (half side `PIT_HALF`, the opening of the scene's pit with its lip, corner radius 0.16 like the blocks'), at the height of the layers over the ground (`PIT_LEVEL`) where the pit is seen, its outline sampled in world space and then projected, so the foreshortening is the scene's own
  const outline: [number, number][] = [];
  for (const [cx, cz, a0] of [[PIT_HALF - 0.16, PIT_HALF - 0.16, 0], [-(PIT_HALF - 0.16), PIT_HALF - 0.16, Math.PI / 2], [-(PIT_HALF - 0.16), -(PIT_HALF - 0.16), Math.PI], [PIT_HALF - 0.16, -(PIT_HALF - 0.16), Math.PI * 1.5]] as const) {
    for (let i = 0; i <= 3; i++) {
      const a = a0 + (i / 3) * (Math.PI / 2);
      outline.push([cx + 0.16 * Math.cos(a), cz + 0.16 * Math.sin(a)]);
    }
  }
  let d = "";
  for (let week = 0; week < weeks; week++) {
    for (let day = 0; day < 7; day++) {
      const c = at(week, day);
      const pts = outline.map(([dx, dz]) => project(c.x + dx, PIT_LEVEL, c.z + dz));
      d += `M${pts.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join("L")}Z`;
    }
  }
  return { viewBox: `${(mx - halfH * aspect).toFixed(3)} ${(my - halfH).toFixed(3)} ${(2 * halfH * aspect).toFixed(3)} ${(2 * halfH).toFixed(3)}`, d };
}

/**
 * Where the blocks will be on the screen, in CSS pixels of a `width` x `height` box, before anything is drawn: the same camera and fit as the scene's, taking every day as a block (the scene's own, `ContentBounds`, replaces it once it
 * is laid out: the left edge differs by a few pixels at most, when the first days are empty). Lets a caption be placed at the first paint and never move.
 */
export function predictBounds(weeks: number, strips: number, width: number, height: number, tallest = TYPICAL_TALLEST, shifts?: readonly number[]) {
  const { corners, at, rects } = slabFor(weeks, strips, shifts);
  const ax = screenAxes();
  const project = (px: number, py: number, pz: number) => ({ x: dot(ax.x, [px, py, pz]), y: -dot(ax.y, [px, py, pz]) });
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [cx, cz] of corners(roomFor(strips))) for (const cy of [0, tallest]) {
    const p = project(cx, cy, cz);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const aspect = width / height;
  const { mx, my, halfH } = frameOf(strips, weeks, at, project, x0, x1, y0, y1, aspect);
  const toPx = (p: { x: number; y: number }) => ({ x: ((p.x - (mx - halfH * aspect)) / (2 * halfH * aspect)) * width, y: ((p.y - (my - halfH)) / (2 * halfH)) * height });
  let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
  void rects;
  for (let w = 0; w < weeks; w++) for (let d = 0; d < 7; d++) {
    const { x, z } = at(w, d);
    for (const [dx, dz] of [[-0.46, -0.46], [0.46, -0.46], [-0.46, 0.46], [0.46, 0.46]] as const) {
      const f = toPx(project(x + dx, 0, z + dz));
      l = Math.min(l, f.x); r = Math.max(r, f.x); b = Math.max(b, f.y);
    }
    t = Math.min(t, toPx(project(x, tallest, z)).y);
  }
  return { left: l, right: r, top: t, bottom: b };
}

/**
 * How much of its light each block lets through to the camera, 0 to 1 (1: nothing in front of it). The camera never moves, so what stands in front of a block is known from the geometry: another block, nearer the camera, that covers some of its
 * outline on the screen. Light that comes through a block of glass is dimmed by it (`absorb` for a block that covers it wholly, less for part of it), and through several blocks it is dimmed again, never below `floor`. Without this a clump of
 * bright blocks, one in front of the other, adds up to one overexposed blob; with it the ones behind are quieter and the ones in front stand out.
 * `boxes` are the blocks' columns: centre x and z, bottom `y0` and height `h` (they are 0.92 wide).
 */
export function glassShades(boxes: readonly { x: number; z: number; y0: number; h: number }[], absorb = 0.3, floor = 0.4): number[] {
  const ax = screenAxes();
  const depthAxis = norm(CAMERA_DIR);
  const HALF = 0.46;
  const rects = boxes.map((b) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const dx of [-HALF, HALF]) for (const dz of [-HALF, HALF]) for (const y of [b.y0, b.y0 + b.h]) {
      const p = [b.x + dx, y, b.z + dz];
      const sx = dot(p, ax.x);
      const sy = dot(p, ax.y);
      x0 = Math.min(x0, sx);
      x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy);
      y1 = Math.max(y1, sy);
    }
    return { x0, x1, y0, y1, depth: dot([b.x, b.y0 + b.h / 2, b.z], depthAxis) };
  });
  return rects.map((a, i) => {
    const area = (a.x1 - a.x0) * (a.y1 - a.y0);
    let shade = 1;
    rects.forEach((b, j) => {
      if (j === i || b.depth <= a.depth) return;
      const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (w <= 0 || h <= 0) return;
      shade *= 1 - absorb * Math.min(1, (w * h) / area);
    });
    return Math.max(floor, shade);
  });
}

/** The strips' shifts (`stripShifts`) for the days of the layers `layers` (each: its weeks and its cells with their week, day and intensity 0..1): the weight of a day is that of its blocks, as the scene weighs them. The same for the scene and for the place-holder. */
export function shiftsFromLayers(layers: readonly { weeks: number; cells: readonly { week: number; day: number; t: number }[] }[], strips: number): number[] {
  const weeks = layers[0]?.weeks ?? 53;
  const weigh = new Map<number, number>();
  for (const m of layers) for (const c of m.cells) weigh.set(c.week * 7 + c.day, (weigh.get(c.week * 7 + c.day) ?? 0) + 0.18 + c.t * 2.2);
  return stripShifts(weeks, strips, (week, day) => weigh.get(week * 7 + day) ?? 0.18);
}

/** What the picture is centred on, and how far it must reach each side of that, in the camera's frame: the middle of the box, or, for strips, their rows' centre of gravity (see the scene's `fit`). */
function frameOf(strips: number, weeks: number, at: (w: number, d: number) => { x: number; z: number }, project: (x: number, y: number, z: number) => { x: number; y: number }, x0: number, x1: number, y0: number, y1: number, aspect: number) {
  let mx = (x0 + x1) / 2;
  if (strips > 1) {
    const perStrip = Math.ceil(weeks / strips);
    let sum = 0;
    for (let k = 0; k < strips; k++) {
      const c = at(k * perStrip + (perStrip - 1) / 2, 3);
      sum += project(c.x, 0, c.z).x;
    }
    mx = sum / strips;
  }
  const halfH = Math.max((y1 - y0) / 2, Math.max(x1 - mx, mx - x0) / aspect) * 1.04;
  return { mx, my: (y0 + y1) / 2, halfH };
}

/** How tall the tallest column of these two layers is (what the scene fits the picture to; the place-holder takes it too, when the data is there, so that it is the same size). */
export function tallestOfLayers(top: { cells: readonly { value: number; t: number }[] }, bottom: { cells: readonly { value: number; t: number }[] }): number {
  let tallest = 1;
  top.cells.forEach((g, i) => {
    const w = bottom.cells[i];
    let y = 0;
    if (w && w.value > 0) y = 0.18 + w.t * 2.3 + 0.04;
    if (g.value > 0) y += 0.18 + g.t * 2.3;
    tallest = Math.max(tallest, y);
  });
  return tallest;
}

/**
 * How much light there is BEHIND each block, seen by the camera: the sum, over the blocks farther from it whose outline on the screen is covered by this one, of their brightness times the share of this block's outline they fill. A glass
 * with lamps behind it is lit by them (what is seen through it, and what scatters in it), a glass against the dark is not. `brightness` is each block's own (the rod's brightest channel). The camera does not move, so this is worked out once.
 */
export function lightBehind(boxes: readonly { x: number; z: number; y0: number; h: number }[], brightness: readonly number[]): number[] {
  const ax = screenAxes();
  const depthAxis = norm(CAMERA_DIR);
  const HALF = 0.46;
  type P = [number, number];
  const cross = (o: P, p: P, q: P) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  // the block's real outline on the screen (the convex hull of its 8 corners), not its bounding rectangle: a rectangle would count the neighbours beside a block as lamps behind it
  const hullOf = (pts: P[]): P[] => {
    const s2 = [...pts].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
    const lo: P[] = [];
    for (const p of s2) {
      while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, p) <= 0) lo.pop();
      lo.push(p);
    }
    const up: P[] = [];
    for (const p of [...s2].reverse()) {
      while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, p) <= 0) up.pop();
      up.push(p);
    }
    return [...lo.slice(0, -1), ...up.slice(0, -1)];
  };
  const inside = (h: P[], p: P) => {
    for (let k = 0; k < h.length; k++) if (cross(h[k]!, h[(k + 1) % h.length]!, p) < 0) return false;
    return true;
  };
  const shapes = boxes.map((b) => {
    const pts: P[] = [];
    for (const dx of [-HALF, HALF]) for (const dz of [-HALF, HALF]) for (const y of [b.y0, b.y0 + b.h]) {
      const p = [b.x + dx, y, b.z + dz];
      pts.push([dot(p, ax.x), dot(p, ax.y)]);
    }
    const hull = hullOf(pts);
    return {
      hull,
      x0: Math.min(...pts.map((q) => q[0])),
      x1: Math.max(...pts.map((q) => q[0])),
      y0: Math.min(...pts.map((q) => q[1])),
      y1: Math.max(...pts.map((q) => q[1])),
      depth: dot([b.x, b.y0 + b.h / 2, b.z], depthAxis),
    };
  });
  const N = 7;
  return shapes.map((a, i) => {
    // sample points of this block's outline
    const samples: P[] = [];
    for (let u = 0; u < N; u++) for (let v = 0; v < N; v++) {
      const q: P = [a.x0 + ((u + 0.5) / N) * (a.x1 - a.x0), a.y0 + ((v + 0.5) / N) * (a.y1 - a.y0)];
      if (inside(a.hull, q)) samples.push(q);
    }
    if (!samples.length) return 0;
    let sum = 0;
    shapes.forEach((b, j) => {
      if (j === i || b.depth >= a.depth) return;
      if (Math.min(a.x1, b.x1) <= Math.max(a.x0, b.x0) || Math.min(a.y1, b.y1) <= Math.max(a.y0, b.y0)) return;
      let hit = 0;
      for (const q of samples) if (inside(b.hull, q)) hit++;
      if (hit) sum += (brightness[j] ?? 0) * (hit / samples.length);
    });
    return sum;
  });
}
