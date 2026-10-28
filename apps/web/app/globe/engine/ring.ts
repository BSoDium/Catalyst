/**
 * The ring of type: the pure maths (no DOM; unit tested in `ring.test.ts`). The drawing is engine/ring-layer.ts; the tuned numbers are `RING`
 * (engine/tuning.ts); docs/web-architecture.md, "Ring of type".
 *
 * Model. A FLAT circle of text on the screen, concentric with the planet's disc: the circle of the globe's silhouette (`silhouetteRadiusPx`), a
 * little larger (`RING.gap`), with the letters' baseline on it and their tops pointing outward, running clockwise from twelve o'clock, all of them
 * the same size, facing the viewer, none of them hidden by the planet (the ring is outside the disc). It is not an object in the globe's space: no
 * tilt, no perspective, no far arc. Everything is a function of the silhouette's radius `r`, so it scales with the planet and a ring that closes
 * evenly at one size closes at every size.
 *
 *   glyph k of `repeats * line.length`, at the angle  a_k = phase + k * 2pi / M  (clockwise from the top)
 *   baseline radius   Rb = r (1 + gap)             the glyph's centre is half a cap height further out
 *   glyph size        em = r * emPerR              (`ringLayout` picks emPerR and the tracking once per viewport)
 *   position          (cx + R sin a, cy - R cos a); turned by a about its centre, so its top points away from the planet
 */
import { clamp, DEG, silhouetteZoom, smoothstep } from "./geo";
import { rampLevel, roleLevel } from "./palette";
import { RING } from "./tuning";
import { NIGHT } from "./surface";

/* ------------------------------------------------------------------ page flags */

/** Live switch (module state, like `SPIN` and `SKY_STATE`): `applyRingFlags` sets it from the page before the renderer is built. */
export const RING_STATE = { enabled: true };

/**
 * `?no-ring` (or sessionStorage "no-ring" = "1") switches the ring off on any page: the lowest zoom is then the whole-globe fit again, exactly as
 * before it existed. A page in debug mode (`?globe-debug`, what the browser checks run in) has it OFF by default, because their assertions
 * (the lowest zoom is the fit, zero rAF at rest, palette-only pixels) predate it; `?ring` (or sessionStorage "ring" = "1") turns it on there.
 */
export function applyRingFlags(): void {
  RING_STATE.enabled = true;
  try {
    const q = new URLSearchParams(location.search);
    const debug = q.has("globe-debug") || sessionStorage.getItem("globe-debug") === "1";
    const wanted = !debug || q.has("ring") || sessionStorage.getItem("ring") === "1";
    if (q.has("no-ring") || sessionStorage.getItem("no-ring") === "1" || !wanted) RING_STATE.enabled = false;
  } catch {
    // no storage: keep the default
  }
}

/* ------------------------------------------------------------------ text and layout */

/** The line that goes round the ring: the phrases in capitals joined by the separator, and one more separator that closes the loop. */
export function ringText(phrases: readonly string[], separator: string = RING.separator): string {
  const parts = phrases.map((p) => p.trim().toLocaleUpperCase("en")).filter((p) => p.length > 0);
  return parts.length === 0 ? "" : parts.join(separator) + separator;
}

/** Height of a capital over the baseline, in em, of the monospace stacks. The atlas centres the capitals on their cell with half of it (`BASELINE`). */
export const CAP_HEIGHT_EM = 0.72;
/** The tightest tracking (em) the layout allows: below it the letters would touch. */
const MIN_TRACKING = 0.02;

export interface RingLayout {
  /** Times the line goes round: a whole number, so the ring closes. */
  repeats: number;
  /** The em of the letters as a fraction of the silhouette's radius. */
  emPerR: number;
  /** Tracking in em (added to the monospace's 0.6 em advance) that makes the letters close the circle exactly. */
  tracking: number;
}

/** The em (CSS px) the letters aim at beside a planet of radius `r` CSS px: the least `targetEmPx`, more for a big planet, up to `maxEmPx`. */
export function ringTargetEm(r: number): number {
  const { targetEmPx, emPerPlanet, maxEmPx } = RING.type;
  return clamp(r * emPerPlanet, targetEmPx, maxEmPx);
}

/**
 * How the line sits round the ring, for a viewport: from the silhouette's radius at the lowest zoom (`rFloorPx`), where the letters should be
 * `RING.type.targetEmPx` tall. The circumference of the baseline there is C. The count is the whole number `n` whose em at the NOMINAL tracking,
 * `C / (n * length * (0.6 + tracking))`, is nearest the target (by ratio). The em is then that value held within `emSlack` of the target and
 * the tracking takes up what is left, so `n * length` advances of `em * (0.6 + tracking)` are exactly C: the seam closes evenly. Both are then
 * kept as ratios of the silhouette, so they hold at every zoom. A function of the viewport, not of the zoom: nothing reflows while zooming.
 */
export function ringLayout(lineLength: number, rFloorPx: number): RingLayout {
  const target = ringTargetEm(rFloorPx);
  const adv = RING.type.advanceEm;
  const nominal = adv + RING.type.tracking;
  if (lineLength <= 0 || !(rFloorPx > 0)) return { repeats: 1, emPerR: target / Math.max(1, rFloorPx), tracking: RING.type.tracking };
  const circumference = 2 * Math.PI * rFloorPx * (1 + RING.gap);
  const emFor = (n: number) => circumference / (n * lineLength * nominal);
  const n0 = Math.max(1, Math.floor(emFor(1) / target));
  const off = (n: number) => Math.abs(Math.log(emFor(n) / target));
  const repeats = off(n0) <= off(n0 + 1) ? n0 : n0 + 1;
  const slack = RING.type.emSlack;
  let em = clamp(emFor(repeats), target * (1 - slack), target * (1 + slack));
  let tracking = circumference / (repeats * lineLength * em) - adv;
  if (tracking < MIN_TRACKING) {
    // A ring too small for this much text at the smallest allowed em: the letters shrink instead of touching.
    tracking = MIN_TRACKING;
    em = circumference / (repeats * lineLength * (adv + tracking));
  }
  return { repeats, emPerR: em / rFloorPx, tracking };
}

/* ------------------------------------------------------------------ the lowest zoom and the fade */

/**
 * The lowest zoom the camera may go to with the ring: the planet and the whole ring (the letters' tops at `Rb + cap`, and a glyph of room) in the
 * free area with `RING.zoom.fitMargin` of its smaller half-side left empty, and never less than `RING.zoom.floorBelowFit` levels below the
 * whole-globe fit `fit`. `height` is the viewport's (it sets the focal length); `freeWidth` the width the globe is centred in.
 */
export function ringFloorZoom(a: { fit: number; freeWidth: number; height: number }): number {
  const { fit, height } = a;
  return Math.min(fit - RING.zoom.floorBelowFit, silhouetteZoom(ringRoomRadius(a), height));
}

/**
 * The largest planet radius (CSS px) whose whole ring fits the free area with `RING.zoom.fitMargin` of its smaller half-side left empty: the ring's
 * outer radius is `r (1 + gap)` plus the letters' height at the em the layout will pick (the target at most `emSlack` above) and a glyph of room.
 * `ringFloorZoom` keeps the ring at least `floorBelowFit` levels below the fit; a page that places the globe itself (`placeAbove`) may go up to this.
 */
export function ringRoomRadius(a: { freeWidth: number; height: number }): number {
  const room = (Math.min(a.freeWidth, a.height) / 2) * (1 - RING.zoom.fitMargin);
  // The letters' size depends on the planet's (`ringTargetEm`): the radius that fits is found by letting the reach follow the radius (it settles at once).
  let r = 1;
  for (let i = 0; i < 4; i++) {
    const t = ringTargetEm(r);
    r = Math.max(1, (room - (CAP_HEIGHT_EM * t * (1 + RING.type.emSlack) + t)) / (1 + RING.gap));
  }
  return r;
}

/**
 * How present the ring is, 0..1, from the zoom: 0 at the whole-globe fit `fit` and above (and when there is no room below it), 1 from
 * `RING.zoom.fade.to` of the way down to the lowest zoom `floor`, a smoothstep between `fade.from` and `fade.to`. Monotonic, a function of the
 * zoom alone (no timer): zooming in fades it out and it is gone before the camera is back at the fit.
 */
export function ringAlpha(zoom: number, fit: number, floor: number): number {
  const span = fit - floor;
  if (!(span > 1e-6)) return 0;
  const t = clamp((fit - zoom) / span, 0, 1);
  const { from, to } = RING.zoom.fade;
  return smoothstep(clamp((t - from) / (to - from), 0, 1));
}

/** The palette level of the letters for a strength: a staircase of tones up to the role's level (a fade is a tone ramp, never a half-transparent grey), 0 = not drawn. */
export function ringTone(alpha: number, levels: number): number {
  return alpha > 0 ? rampLevel(alpha, roleLevel(RING.tone, levels)) : 0;
}

/* ------------------------------------------------------------------ glyphs */

/** The glyphs of one frame, as parallel arrays (no allocation per frame). Spaces are not in it. */
export class GlyphBuffer {
  /** Centre of the glyph, container CSS px. */
  x = new Float32Array(0);
  y = new Float32Array(0);
  /** Angle of the glyph, radians clockwise from twelve o'clock: its top points that way, away from the planet. */
  angle = new Float32Array(0);
  /** UTF-16 code of the character. */
  code = new Uint16Array(0);
  /** Index of the character in the line (`k mod length`): which phrase a glyph is in. */
  idx = new Uint16Array(0);
  /** Glyphs in the buffer. */
  count = 0;
  /** The em of every glyph, CSS px (all the same). */
  em = 0;
  /** Radius of the baseline and of the glyphs' centres, CSS px. */
  baseline = 0;
  radius = 0;
  /** Extent of the circle the glyph centres lie on, container CSS px. */
  minX = 0;
  maxX = 0;
  minY = 0;
  maxY = 0;

  ensure(n: number): void {
    if (this.x.length >= n) return;
    const cap = Math.max(n, this.x.length * 2, 64);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.angle = new Float32Array(cap);
    this.code = new Uint16Array(cap);
    this.idx = new Uint16Array(cap);
  }
}

export interface PlaceArgs {
  text: string;
  layout: RingLayout;
  /** The ring's turn, radians clockwise. */
  phase: number;
  /** The planet's silhouette radius now, CSS px, and its centre on the container. */
  r: number;
  cx: number;
  cy: number;
}

/**
 * Place the glyphs of the whole ring for one frame. Glyph k (of `repeats * text.length`, equal steps round) carries character `k mod length`, at
 * angle `phase + k * step` clockwise from the top, so the text reads clockwise. Returns the count. Pure: depends on its arguments only.
 */
export function placeGlyphs(out: GlyphBuffer, p: PlaceArgs): number {
  const L = p.text.length;
  const M = L * Math.max(1, p.layout.repeats);
  out.ensure(M);
  out.count = 0;
  if (L === 0) return 0;
  const step = (2 * Math.PI) / M;
  const em = p.layout.emPerR * p.r;
  const baseline = p.r * (1 + RING.gap);
  // The letter's centre is half a cap height out from its baseline.
  const radius = baseline + (CAP_HEIGHT_EM / 2) * em;
  out.em = em;
  out.baseline = baseline;
  out.radius = radius;
  let n = 0;
  for (let k = 0; k < M; k++) {
    const code = p.text.charCodeAt(k % L);
    if (code === 32) continue;
    const a = p.phase + k * step;
    out.x[n] = p.cx + radius * Math.sin(a);
    out.y[n] = p.cy - radius * Math.cos(a);
    out.angle[n] = a;
    out.code[n] = code;
    out.idx[n] = k % L;
    n++;
  }
  out.minX = p.cx - radius;
  out.maxX = p.cx + radius;
  out.minY = p.cy - radius;
  out.maxY = p.cy + radius;
  out.count = n;
  return n;
}

/** The ring's turn at `elapsedMs` of its own clock, radians clockwise (the direction and speed of `RING`). */
export function ringPhase(elapsedMs: number): number {
  return (RING.startDeg + RING.direction * RING.degPerSec * (elapsedMs / 1000)) * DEG;
}

/**
 * The tone of a ring letter under the planet's night, as a (fractional, in 1/8) palette level: a letter at `angle` (radians clockwise from twelve o'clock) stands over the limb's point (sin, cos, 0) in the camera's frame, lit as that point of the planet is; its
 * level `lv` goes `NIGHT.ringDim` of the way to `nightLevel` (the page's on the dark page, the ink's on the light one) by how dark it is, never under 1 (level 0 is the page's own colour: an opaque letter of it would hide what is behind). Pure.
 */
export function ringNightLevel(lv: number, nightLevel: number, night: number, angle: number, sun: readonly [number, number, number]): number {
  if (night <= 0.001) return lv;
  const dot = Math.sin(angle) * sun[0] + Math.cos(angle) * sun[1];
  const x = clamp((dot - NIGHT.litFrom) / (NIGHT.litTo - NIGHT.litFrom), 0, 1);
  const lf = lv + (nightLevel - lv) * night * (1 - x * x * (3 - 2 * x)) * NIGHT.ringDim;
  return Math.max(Math.min(1, lv), Math.round(lf * 8) / 8);
}
