/**
 * The caption: the pure maths (no DOM, no Three.js; unit tested in `caption.test.ts`). The Three.js objects are engine/caption-layer.ts; the tuned
 * numbers are `CAPTION` (engine/tuning.ts); docs/web-architecture.md, "Orbiting type".
 *
 * Model. A few lines of type float over the planet on a shell of radius `CAPTION.radius` (well above the surface, so it orbits it: the
 * parallax against the coastlines is visible while the globe turns). Each line lies on a REAL PARALLEL of the globe: the circle of latitude `L`
 * about the earth's own axis, so in whatever orientation the camera has (the view's latitude tilts the axis towards or away from the viewer,
 * which is the tilt and the curvature of the graticule's dotted parallels) the line has exactly the tilt and curvature of that parallel, as the
 * owner asked: seen from the north it bends one way, from the south the other, from the equator it is straight. A line is centred on the
 * VIEW's central meridian (it stays in the middle of the face while the earth turns under it), so in the earth's frame
 *
 *   P(a, L) = r (cos L sin a, sin L, cos L cos a)          a: longitude from the central meridian, L: latitude
 *
 * and the mesh is turned about the earth's axis (y) by the view's longitude plus the entrance's turn. Geometry is built once per layout;
 * nothing is laid out per frame. The lines are on the globe's scene: depth-tested against the planet and drawn from both sides (a ring of type seen from behind), so a letter past the
 * horizon is not there (it can never be seen from behind, mirrored).
 */
import { CAPTION, START_VIEW } from "./tuning";
import type { GlobeTheme } from "./colors";
import { clamp, DEG } from "./geo";

/* ------------------------------------------------------------------ the faces */

/** The three faces of the caption: the reading serif, the site's mono and an ornate copperplate script (Imperial Script). */
export type CaptionFaceKey = "serif" | "mono" | "script";

/**
 * The look of a stretch of words. `plain` is the reading serif in a medium weight; `heavy` and `heavy-italic` the same face at the top of its weight
 * axis (the words to highlight); `mono` the site's code face; `script` a calligraphic script.
 */
export type CaptionStyleKey = "plain" | "heavy" | "heavy-italic" | "mono" | "script";

/** A stretch of a line in one style (the app's words: engine/types `GlobeCaptionSpan` is the same shape). */
/** The caption has ONE palette: BSoD Blue, used sparingly. */
export type CaptionHue = "blue";

export interface CaptionRun {
  text: string;
  style?: CaptionStyleKey;
  /** In a palette's pastel text tone, not the secondary text tone. */
  accent?: CaptionHue;
  /** Thickened by this many caps (a stroke in the face colour) instead of the face's own: the cinematic interlude's word is heavier than the rows. */
  embolden?: number;
}

/** What the caption says: phrase sets that take turns in the upper rows, each set a few rows, and the rows under them that stay (the call to action). */
export interface CaptionContent {
  sets: readonly (readonly (readonly CaptionRun[])[])[];
  fixed: readonly (readonly CaptionRun[])[];
}

/** One style: its face, weight and slant; `url` is its own file (a face with a file per weight), else the face's. */
export interface CaptionStyleDef {
  face: CaptionFaceKey;
  weight: number;
  italic: boolean;
  url?: string;
}

/** The serif's files: Old Standard TT (SIL OFL 1.1, Alexey Kryukov), kern-only subsets of Basic Latin and the middle dot, one file a weight. */
const SERIF_FILES = { 400: "/fonts/old-standard-tt-3.000-latin-400.woff2", 700: "/fonts/old-standard-tt-3.000-latin-700.woff2" } as const;

export const CAPTION_STYLES: Readonly<Record<CaptionStyleKey, CaptionStyleDef>> = {
  plain: { face: "serif", weight: 400, italic: false, url: SERIF_FILES[400] },
  heavy: { face: "serif", weight: 700, italic: false, url: SERIF_FILES[700] },
  // (the family has no bold italic: the style is the bold roman, registered as italic so the canvas does not slant it; the app does not use it)
  "heavy-italic": { face: "serif", weight: 700, italic: true, url: SERIF_FILES[700] },
  mono: { face: "mono", weight: 700, italic: false },
  script: { face: "script", weight: 400, italic: false },
};

/**
 * Per face: the CSS family (the page's own faces are declared in app.css and already in the page; the handwriting is added by the layer with the
 * `FontFace` API only when a caption has a word in it), the stack behind it, the size it is drawn at relative to the serif (so the caps agree: the
 * mono's capitals are taller than the serif's at one em, the handwriting's much smaller), a baseline drop in ems and the tracking in ems (the
 * face's own plus `CAPTION.tracking`: the caption is set in capitals, which want a little air).
 */
export const CAPTION_FACES = {
  serif: { family: '"Caption Serif"', fallback: 'Georgia, "Times New Roman", serif', scale: 1, dy: 0, tracking: 0.005 + CAPTION.tracking.serif, embolden: 0, url: null },
  mono: { family: '"JetBrains Mono Variable"', fallback: 'ui-monospace, Menlo, Consolas, monospace', scale: 0.95, dy: 0, tracking: CAPTION.tracking.mono, embolden: 0, url: null },
  script: {
    family: '"Caption Script"',
    fallback: '"Snell Roundhand", "Apple Chancery", "Segoe Script", cursive',
    scale: 1.079,
    dy: 0,
    tracking: 0.004 + CAPTION.tracking.script,
    /** A formal script's hairlines would vanish under a thin outline: its letters are thickened by this many caps (a stroke in the face colour). */
    embolden: 0.05,
    url: "/fonts/imperial-script-1.010-latin-400.woff2",
  },
} as const;

/** The serif's own metrics, which the whole caption is measured in (a cap height is the serif's; the other faces are scaled to it). */
export const CAPTION_FACE = {
  /** Cap height over the em, as the serif sets it. */
  capEm: 0.712,
  /** The line box in caps: above the baseline (ascenders, with the outline) and below it (descenders, the script's too, with the outline). */
  above: 1.4,
  below: 0.55,
} as const;

/** `#rrggbb` as 0..1 channels. */
export const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

/**
 * The colours of the caption for a theme, all solid (alpha 1). The look (round 9): the letters are TEXT-coloured (the secondary text tone:
 * `face`; the few words in blue: `accent`) inside a contour and a thickness that are a MID TONE between the page and the text (`outline`, then
 * `side` one step closer to the page): present, clearly less strong than the letters, opaque, so a glyph is cut out of the globe's linework
 * by a halo that gives it depth.
 */
export function captionColors(theme: GlobeTheme, sideMode: "page" | "mix" | "edge" = CAPTION.colors.sideMode): {
  face: readonly [number, number, number];
  accent: readonly [number, number, number];
  /** The contour and the thickness of a tinted word: derived from ITS face as the neutral ones are from the neutral face. */
  accentOutline: readonly [number, number, number];
  accentSide: readonly [number, number, number];
  outline: readonly [number, number, number];
  side: readonly [number, number, number];
} {
  const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  const dark = lum(theme.background) < 0.5;
  const mix = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t];
  const face = hex(dark ? CAPTION.colors.text.dark : CAPTION.colors.text.light);
  const accent = hex(dark ? CAPTION.colors.accent.dark : CAPTION.colors.accent.light);
  const page: [number, number, number] = [theme.background[0], theme.background[1], theme.background[2]];
  const k = dark ? 0 : 1;
  const outlineMix = [CAPTION.colors.outlineMix.dark, CAPTION.colors.outlineMix.light][k]!;
  const sideMix = [CAPTION.colors.sideMix.dark, CAPTION.colors.sideMix.light][k]!;
  const outline = sideMode === "page" ? page : mix(page, face, outlineMix);
  const side = sideMode === "page" ? page : mix(page, face, sideMix);
  const accentOutline = sideMode === "page" ? page : mix(page, accent, outlineMix);
  const accentSide = sideMode === "page" ? page : mix(page, accent, sideMix);
  return { face, accent, accentOutline, accentSide, outline, side };
}

/** The face asked of the system when a face could not be had: the handwriting is the one that can fail (its file), and the heavy italic serif stands in for it. */
export const CAPTION_FALLBACK_STYLE: Readonly<Partial<Record<CaptionStyleKey, CaptionStyleKey>>> = { script: "heavy-italic" };

/** The CSS `font` of a style at `px`. */
export function captionFont(style: CaptionStyleKey, px: number): string {
  const st = CAPTION_STYLES[style];
  const f = CAPTION_FACES[st.face];
  return `${st.italic ? "italic " : ""}${st.weight} ${px * f.scale}px ${f.family}, ${f.fallback}`;
}

/* ------------------------------------------------------------------ geometry */

/** One line of the caption, laid out. */
export interface CaptionLine {
  /** The words, as styled runs (a drawn line is these runs one after the other on one baseline). */
  runs: CaptionRun[];
  /** The plain text of the line (the runs joined). */
  text: string;
  /** The logical line it belongs to (a wrapped line has two pieces). */
  parent: number;
  /** Latitude of its baseline, degrees: a real parallel. */
  baseLat: number;
  /** Cap height and em in planet radii (arc length on the shell). */
  capR: number;
  emR: number;
  /** Half the line's width in longitude, radians (the text is centred on the central meridian). */
  halfSpan: number;
  /** The band's latitude extent, radians, below and above the baseline. */
  below: number;
  above: number;
  /** The same in caps (the texture's own height above and below the baseline). */
  aboveCaps: number;
  belowCaps: number;
  /** The band's width in ems, as the faces set it: the words, what they overhang, and the room of the outline. */
  widthEm: number;
}

/** What a piece of a line needs: the width of its texture in ems and its height above and below the baseline in caps (the ink's own extent, overhangs included). */
export interface PieceBox {
  widthEm: number;
  aboveCaps: number;
  belowCaps: number;
}

/** A row of the caption before it has a place: its words, its nominal size and what it needs. Fixed by the planet's size; the camera's tilt only moves it. */
export interface CaptionPiece {
  runs: CaptionRun[];
  text: string;
  /** The row it is (0 is the top one). */
  parent: number;
  /** The cap height the row is meant to have, planet radii of arc (before any shrinking to fit a chord). */
  cap: number;
  box: PieceBox;
}

export interface CaptionLayout {
  lines: CaptionLine[];
  /** The scale the whole block was shrunk by to fit its chords (1: not at all). */
  scale: number;
}

export interface LayoutInput {
  /** The rows, top to bottom, each a list of styled runs. */
  rows: readonly (readonly CaptionRun[])[];
  /** The cap height of each row, planet radii (default: `CAPTION.capR`, one size for every row). */
  caps?: readonly number[];
  /** A run's advance in ems (of the serif: measured from the face the run is set in). */
  measure(run: CaptionRun): number;
  /**
   * What a piece of a line needs, measured from the faces (the ink's bounding box, not the advance: a script overhangs its last glyph's advance,
   * an italic its first). Absent: the advances and the face constants.
   */
  box?(runs: readonly CaptionRun[]): PieceBox;
  /** The planet's radius at the lowest zoom, CSS px (the least size a letter may have is in CSS px). */
  rPx: number;
  /** The camera's distance at the lowest zoom (planet radii): the chords the block is fitted to. */
  d: number;
}

/** The plain text of some runs. */
export const runsText = (runs: readonly CaptionRun[]): string => runs.map((r) => r.text).join("");

/** One word of a line, with the space that follows it, in its style. */
interface Token {
  text: string;
  style: CaptionStyleKey | undefined;
  accent: CaptionHue | undefined;
}

const tokenize = (runs: readonly CaptionRun[]): Token[] => {
  const out: Token[] = [];
  for (const r of runs) for (const m of r.text.matchAll(/\S+\s*|\s+/g)) out.push({ text: m[0], style: r.style, accent: r.accent });
  return out;
};

/** Adjacent tokens of one style are one run again (kerning and ligatures across the space). */
const toRuns = (tokens: readonly Token[]): CaptionRun[] => {
  const out: CaptionRun[] = [];
  for (const t of tokens) {
    const last = out[out.length - 1];
    if (last && last.style === t.style && last.accent === t.accent) last.text += t.text;
    else out.push({ text: t.text, ...(t.style ? { style: t.style } : {}), ...(t.accent ? { accent: t.accent } : {}) });
  }
  if (out.length) {
    out[0]!.text = out[0]!.text.replace(/^\s+/, "");
    out[out.length - 1]!.text = out[out.length - 1]!.text.replace(/\s+$/, "");
  }
  return out.filter((r) => r.text.length > 0);
};

const isSeparator = (t: Token): boolean => /^[\u00b7|\u2022]\s*$/.test(t.text);

/**
 * A line cut in two where it reads best: the boundary nearest its middle by width, a separator dot ("·", dropped at the cut) or the end of a
 * sentence or clause preferred to a plain space; null when it has no place to be cut.
 */
export function splitRuns(runs: readonly CaptionRun[], measure: (run: CaptionRun) => number): [CaptionRun[], CaptionRun[]] | null {
  const tokens = tokenize(runs);
  if (tokens.length < 2) return null;
  const w = tokens.map((t) => measure({ text: t.text, ...(t.style ? { style: t.style } : {}) }));
  const total = w.reduce((a, b) => a + b, 0);
  let best: { score: number; a: Token[]; b: Token[] } | null = null;
  let before = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (isSeparator(t)) {
      if (i > 0 && i < tokens.length - 1) {
        const score = Math.abs(before - total / 2);
        if (best === null || score < best.score) best = { score, a: tokens.slice(0, i), b: tokens.slice(i + 1) };
      }
    } else if (i > 0) {
      const prev = tokens[i - 1]!;
      if (!isSeparator(prev) && t.text.trim() !== "" && prev.text.trim() !== "") {
        // a cut after a full stop or a comma is better than one between two words of a phrase
        const bonus = /[.,;:!?]\s*$/.test(prev.text) ? 0.12 * total : 0;
        const score = Math.abs(before - total / 2) - bonus + 0.12 * total;
        if (best === null || score < best.score) best = { score, a: tokens.slice(0, i), b: tokens.slice(i) };
      }
    }
    before += w[i]!;
  }
  if (!best) return null;
  const a = toRuns(best.a);
  const bb = toRuns(best.b);
  return a.length && bb.length ? [a, bb] : null;
}

/** Arc width of a text in longitude (radians) on the parallel at `lat` (degrees) for a cap height `capR`. */
export const spanOf = (widthEm: number, capR: number, lat: number, r: number = CAPTION.radius): number => (widthEm * capR) / CAPTION_FACE.capEm / (r * Math.cos(clamp(lat, -85, 85) * DEG));

/**
 * The rows of the caption as pieces: each at the caption's one cap height and never under `minCapPx`
 * CSS px. The rows are what the app gave (it wraps its own phrases, so each row is one line of type); nothing here depends on the camera: the same
 * pieces serve every camera, and `placeRows` gives them their fixed parallels.
 */
export function planPieces(input: Pick<LayoutInput, "rows" | "caps" | "measure" | "box" | "rPx">): { pieces: CaptionPiece[] } {
  const floorCap = CAPTION.minCapPx / input.rPx;
  const boxOf = (rs: readonly CaptionRun[]): PieceBox =>
    input.box?.(rs) ?? { widthEm: rs.reduce((a, r) => a + input.measure(r), 0), aboveCaps: CAPTION_FACE.above, belowCaps: CAPTION_FACE.below };
  const pieces = input.rows.map((runs, i): CaptionPiece => {
    const nominal = input.caps?.[i] ?? CAPTION.capR;
    return { runs: [...runs], text: runsText(runs), parent: i, cap: Math.max(nominal, floorCap), box: boxOf(runs) };
  });
  return { pieces };
}

/**
 * How far from the view's central meridian (radians of longitude) the parallel at `lat` is within `psi` radians of the view's axis, seen from a
 * camera at latitude `viewLat`: the longitude at which `sin(vl) sin(L) + cos(vl) cos(L) cos(a)` falls to `cos(psi)`. 0 when even its middle is
 * farther than that, pi when the whole parallel is nearer (a parallel seen over the pole).
 */
export function visibleHalfSpan(viewLat: number, lat: number, psi: number): number {
  const vl = viewLat * DEG;
  const L = lat * DEG;
  const den = Math.cos(vl) * Math.cos(L);
  if (Math.abs(den) < 1e-9) return Math.sin(vl) * Math.sin(L) >= Math.cos(psi) ? Math.PI : 0;
  const x = (Math.cos(psi) - Math.sin(vl) * Math.sin(L)) / den;
  return x >= 1 ? 0 : x <= -1 ? Math.PI : Math.acos(x);
}

/**
 * The screen height (planet radii, at the camera's focal length) of the point at longitude `a` from the view's central meridian on the parallel
 * `lat` (degrees) of the shell, for a camera over latitude `phi` at distance `d`. The whole of a line's projection: its curve on the screen.
 */
export function shellY(a: number, lat: number, phi: number, d: number, r: number = CAPTION.radius): number {
  const L = lat * DEG;
  const F = phi * DEG;
  const ca = Math.cos(a);
  const cl = Math.cos(L);
  const sl = Math.sin(L);
  return (r * (sl * Math.cos(F) - cl * ca * Math.sin(F))) / (d - r * (sl * Math.sin(F) + cl * ca * Math.cos(F)));
}

/** The screen position (x right, y up; planet radii at the focal length) of the point at longitude `a` on the parallel `lat` of the shell seen from latitude `phi`. */
export function shellXY(a: number, lat: number, phi: number, d: number, r: number = CAPTION.radius, out: [number, number] = [0, 0]): [number, number] {
  const L = lat * DEG;
  const F = phi * DEG;
  const ca = Math.cos(a);
  const cl = Math.cos(L);
  const sl = Math.sin(L);
  const depth = d - r * (sl * Math.sin(F) + cl * ca * Math.cos(F));
  out[0] = (r * cl * Math.sin(a)) / depth;
  out[1] = (r * (sl * Math.cos(F) - cl * ca * Math.sin(F))) / depth;
  return out;
}

export interface Placement {
  baseLat: number;
  /** Cap height after shrinking, planet radii of arc. */
  capR: number;
  halfSpan: number;
  /** Screen height of the baseline at the central meridian (tests read it). */
  y: number;
}


/* ------------------------------------------------------------------ the rows on the equator */

/**
 * The baseline latitudes of `n` rows of cap height `capR`: FIXED parallels centred on the equator (the middle of the block's capitals is on
 * latitude 0), `CAPTION.rows.stepCaps` cap heights from one baseline to the next on average, and, when the camera's distance `d` is given,
 * spaced UNIFORMLY ON THE SCREEN for the load view (`START_VIEW`): equal steps in latitude are unequal on the screen the moment the
 * equator is not at the middle of the view (the farther from the view's centre, the more a degree is foreshortened), so the middle rows are
 * moved to the equal steps between the first and the last. Independent of the camera at run time: nothing about the tilt moves a row.
 */
export function rowLatitudes(n: number, capR: number, d?: number): number[] {
  const capDeg = capR / CAPTION.radius / DEG;
  const step = CAPTION.rows.stepCaps * capDeg;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(((n - 1) / 2 - i) * step - capDeg / 2);
  if (d === undefined || n < 3) return out;
  const cam = START_VIEW.lat;
  const y0 = shellY(0, out[0]!, cam, d);
  const y1 = shellY(0, out[n - 1]!, cam, d);
  for (let i = 1; i < n - 1; i++) {
    const y = y0 + ((y1 - y0) * i) / (n - 1);
    let lo = out[n - 1]! - 1;
    let hi = out[0]! + 1;
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      if (shellY(0, mid, cam, d) < y) lo = mid;
      else hi = mid;
    }
    out[i] = (lo + hi) / 2;
  }
  return out;
}

/** The pieces on their fixed parallels at scale `scale` of their cap heights (1: as planned): the placements `lineOf` turns into strips. */
export function placeRows(pieces: readonly CaptionPiece[], d: number, scale = 1, out: Placement[] = []): Placement[] {
  const n = pieces.length;
  const caps = pieces.map((p) => p.cap * scale);
  const lats = rowLatitudes(n, caps.reduce((a, c) => Math.max(a, c), 0), d);
  for (let i = 0; i < n; i++) {
    out[i] = { baseLat: lats[i]!, capR: caps[i]!, halfSpan: spanOf(pieces[i]!.box.widthEm, caps[i]!, lats[i]!) / 2, y: shellY(0, lats[i]!, 0, d) };
  }
  out.length = n;
  return out;
}

/** The camera latitude the caption may be shown at: `lat` held to the band (`CAPTION.band.deg`), the nearest edge when it is outside. */
export const bandLat = (lat: number): number => clamp(lat, -CAPTION.band.deg, CAPTION.band.deg);

/** Whether `lat` is inside the band, within `slackDeg`. */
export const inBand = (lat: number, slackDeg = 0): boolean => Math.abs(lat) <= CAPTION.band.deg + slackDeg + 1e-9;

/**
 * The scale (up to 1) the whole block is drawn at so that every row fits the chord of its parallel for ANY camera inside the band: the worst of
 * the two ends of the band (`visibleHalfSpan`, `hardSpanDeg`) and the planet's disc (`maxHalfWidth`). Static: it depends on the planet's size and the camera's distance only, never on
 * where the camera looks, so a tilt cannot make the letters change size. Never under `minScale`.
 */
export function fitScale(pieces: readonly CaptionPiece[], d: number, minScale: number = CAPTION.minScale): number {
  if (pieces.length === 0) return 1;
  const psi = shellHorizon(d) * CAPTION.visibleFraction;
  const hard = (CAPTION.hardSpanDeg * DEG) / 2;
  const fits = (k: number): boolean => {
    const pl = placeRows(pieces, d, k);
    return pl.every((p) => {
      const room = Math.min(hard, visibleHalfSpan(CAPTION.band.deg, p.baseLat, psi), visibleHalfSpan(-CAPTION.band.deg, p.baseLat, psi));
      // (the roll carries the row `DRIFT.amp` either way: its chord must hold at the end of it)
      if (p.halfSpan + DRIFT.amp > room + 1e-9) return false;
      // ...and inside the planet's disc on the screen (`maxHalfWidth` of its silhouette's radius): a row that overhangs the limb lands on the
      // page's own text beside it, whatever its chord is
      const limit = CAPTION.maxHalfWidth / Math.sqrt(Math.max(1.0001, d * d - 1));
      for (const cam of [CAPTION.band.deg, -CAPTION.band.deg, 0]) {
        const hs = Math.min(p.halfSpan, Math.PI / 2);
        if (Math.abs(shellXY(hs, p.baseLat, cam, d)[0]) > limit + 1e-9) return false;
      }
      return true;
    });
  };
  if (fits(1)) return 1;
  if (!fits(minScale)) return minScale;
  let lo = minScale;
  let hi = 1;
  for (let it = 0; it < 14; it++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}


/**
 * The least scale the block may be shrunk to on a planet `rPx` CSS px in radius: the smallest letter is never under three quarters of the least
 * size (`minCapPx`), and the block is never under `CAPTION.minScale` of its size. (At the extreme tilt of a small planet a line may then reach
 * nearer the limb than it would like: legible and foreshortened beats tiny.)
 */
export function minScaleFor(pieces: readonly CaptionPiece[], rPx: number): number {
  const smallest = pieces.reduce((a, p) => Math.min(a, p.cap), Infinity);
  if (!Number.isFinite(smallest) || smallest <= 0) return CAPTION.minScale;
  return clamp((0.75 * CAPTION.minCapPx) / (rPx * smallest), CAPTION.minScale, 1);
}

/**
 * The cinematic interlude's one big row on its own shell of radius `r` (a higher orbit than the rows': it floats clear of the surface and curves
 * round the limb), centred on the equator (a single row's baseline is half its cap height under it): the largest cap height in `[minCap, maxCap]`
 * (planet radii) whose row, rolling through `ampRad` either way, stays in front of the shell's horizon (the same share of it as the rows) and
 * reaches no farther than `fill` of the planet's silhouette radius on the screen for any camera inside the band (the rows' own limit is
 * `CAPTION.maxHalfWidth`; the big word may overhang the disc a little: on the equator, level with the page's own text nowhere). The smallest
 * is returned when none fits (a very small planet).
 */
export function placeEgg(box: PieceBox, d: number, r: number, o: { fill: number; minCap: number; maxCap: number; ampRad: number }): Placement {
  const sil = 1 / Math.sqrt(Math.max(1.0001, d * d - 1));
  const hard = (CAPTION.hardSpanDeg * DEG) / 2;
  const psi = shellHorizon(d, r) * CAPTION.visibleFraction;
  const at = (cap: number): Placement => {
    const baseLat = -cap / r / DEG / 2;
    return { baseLat, capR: cap, halfSpan: spanOf(box.widthEm, cap, baseLat, r) / 2, y: shellY(0, baseLat, 0, d, r) };
  };
  const fits = (cap: number): boolean => {
    const p = at(cap);
    const room = Math.min(hard, visibleHalfSpan(CAPTION.band.deg, p.baseLat, psi), visibleHalfSpan(-CAPTION.band.deg, p.baseLat, psi));
    if (p.halfSpan + o.ampRad > room + 1e-9) return false;
    for (const cam of [CAPTION.band.deg, -CAPTION.band.deg, 0]) if (Math.abs(shellXY(Math.min(p.halfSpan, Math.PI / 2), p.baseLat, cam, d, r)[0]) > o.fill * sil + 1e-9) return false;
    return true;
  };
  if (fits(o.maxCap)) return at(o.maxCap);
  if (!fits(o.minCap)) return at(o.minCap);
  let lo = o.minCap;
  let hi = o.maxCap;
  for (let it = 0; it < 30; it++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return at(lo);
}

/**
 * Lay the caption out: the pieces (`planPieces`) on their fixed parallels (`placeRows`) at the static fit (`fitScale`). The layer does the same
 * steps itself; this is the whole of it in one call, for tests and checks.
 */
export function layoutCaption(input: Pick<LayoutInput, "rows" | "caps" | "measure" | "box" | "rPx" | "d">): CaptionLayout & { placements: Placement[] } {
  const { pieces } = planPieces(input);
  const scale = fitScale(pieces, input.d, minScaleFor(pieces, input.rPx));
  const placements = placeRows(pieces, input.d, scale);
  return { lines: pieces.map((p, i) => lineOf(p, placements[i]!)), scale, placements };
}


/** A piece at its placement, as the line the strip is built from. */
export function lineOf(p: CaptionPiece, pl: Placement, into?: CaptionLine, r: number = CAPTION.radius): CaptionLine {
  const capLat = pl.capR / r;
  const line = into ?? ({} as CaptionLine);
  line.runs = p.runs;
  line.text = p.text;
  line.parent = p.parent;
  line.baseLat = pl.baseLat;
  line.capR = pl.capR;
  line.emR = pl.capR / CAPTION_FACE.capEm;
  line.halfSpan = pl.halfSpan;
  line.below = capLat * p.box.belowCaps;
  line.above = capLat * p.box.aboveCaps;
  line.aboveCaps = p.box.aboveCaps;
  line.belowCaps = p.box.belowCaps;
  line.widthEm = p.box.widthEm;
  return line;
}

/** A point of the shell in the earth's frame at longitude `a` (from the central meridian) and latitude `lat` (degrees), radius `r` (default the shell's). */
export function parallelPoint(a: number, lat: number, r: number = CAPTION.radius, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const L = lat * DEG;
  const cl = Math.cos(L);
  out[0] = r * cl * Math.sin(a);
  out[1] = r * Math.sin(L);
  out[2] = r * cl * Math.cos(a);
  return out;
}

export interface BandMesh {
  positions: Float32Array;
  uvs: Float32Array;
  /** 0 for the farthest slice (towards the planet), 1 for the front face. */
  layers: Float32Array;
  indices: Uint16Array;
}

/**
 * The strip of one line, `slices` of it stacked radially from `r - depth` (back) to `r` (the front face), each of `nu` columns along the longitude
 * (the text's direction, left to right) and one row, wound counter-clockwise seen from OUTSIDE (so back-face culling removes the far side). The
 * texture's u runs along the longitude, v up the latitude (1 at the top). The band lies on the parallel of `line.baseLat`: v = 0 is `below` under it.
 */
export function bandMesh(line: CaptionLine, nu: number, slices: number, depth: number, r: number = CAPTION.radius): BandMesh {
  const unit = unitBand(nu, slices);
  const n = unit.attributes.length / 3;
  const positions = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const layers = new Float32Array(n);
  const p: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const u = unit.attributes[3 * i]!;
    const v = unit.attributes[3 * i + 1]!;
    const k = unit.attributes[3 * i + 2]!;
    bandPoint(line, u, v, k, depth, r, p);
    positions.set(p, 3 * i);
    uvs[2 * i] = u;
    uvs[2 * i + 1] = v;
    layers[i] = k;
  }
  return { positions, uvs, layers, indices: unit.indices };
}

/** Columns of the strip every line shares: about one every 2 degrees of longitude at the widest a line goes (the strip is flat between columns: the shell's sag is far under a pixel). */
export const BAND_COLUMNS = 64;

/**
 * The strip's UNIT geometry, shared by every line: per vertex `(u, v, layer)`, u along the line (0 to 1), v across it (0 the bottom edge, 1 the
 * top), layer 0 for the farthest slice and 1 for the front face; the vertex shader puts it on the parallel (`bandPoint` is the same formula).
 */
export function unitBand(nu: number = BAND_COLUMNS, slices: number = CAPTION.slices): { attributes: Float32Array; indices: Uint16Array } {
  const cols = nu + 1;
  const perSlice = cols * 2;
  const attributes = new Float32Array(slices * perSlice * 3);
  const indices = new Uint16Array(slices * nu * 6);
  let t = 0;
  for (let s = 0; s < slices; s++) {
    const k = slices === 1 ? 1 : s / (slices - 1);
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < cols; i++) {
        const n = s * perSlice + j * cols + i;
        attributes[3 * n] = i / nu;
        attributes[3 * n + 1] = j;
        attributes[3 * n + 2] = k;
      }
    }
    for (let i = 0; i < nu; i++) {
      const v00 = s * perSlice + i;
      const v10 = v00 + 1;
      const v01 = v00 + cols;
      const v11 = v01 + 1;
      indices[t++] = v00;
      indices[t++] = v10;
      indices[t++] = v11;
      indices[t++] = v00;
      indices[t++] = v11;
      indices[t++] = v01;
    }
  }
  return { attributes, indices };
}

/**
 * The point of the strip of `line` at `(u, v, layer)` of the unit band, in the earth's frame: what the vertex shader computes (a line is its
 * parallel, its width in longitude and its extent in latitude; the strip itself never changes).
 */
export function bandPoint(line: Pick<CaptionLine, "baseLat" | "halfSpan" | "below" | "above">, u: number, v: number, layer: number, depth: number, r: number = CAPTION.radius, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const lat = line.baseLat - line.below / DEG + v * ((line.below + line.above) / DEG);
  return parallelPoint((u * 2 - 1) * line.halfSpan, lat, r - depth * (1 - layer), out);
}

/* ------------------------------------------------------------------ visibility */

/**
 * The angle from the view axis, radians, beyond which a point of the shell cannot be seen: the shell's front faces are those whose outward normal
 * faces the camera at distance `d` (planet radius 1): `cos(psi) > r / d`. Past it a face is culled (and the planet's depth hides what is behind it).
 */
export const shellHorizon = (d: number, r: number = CAPTION.radius): number => Math.acos(clamp(r / d, -1, 1));

/**
 * How many silhouette radii of the planet the shell's own silhouette is across, seen from distance `d`: the whole caption (every point of the
 * shell, hidden or not) projects inside it, so a window of the crisp canvas that is this much larger than the planet's disc never cuts a row.
 * (`tan` of the half angle of a sphere of radius `s` is `s / sqrt(d^2 - s^2)`.)
 */
export const shellWindowFactor = (d: number, r: number = CAPTION.radius): number => (r * Math.sqrt(Math.max(1e-6, d * d - 1))) / Math.sqrt(Math.max(1e-6, d * d - r * r));

/**
 * The central angle from the view axis, radians, from which a point of the shell is BEHIND THE PLANET'S BODY for any camera at distance `d`: its
 * projection is inside the planet's disc and it is on the far side, so the depth buffer hides it. Between the shell's horizon (`shellHorizon`:
 * where the strip's face turns away) and this angle a row is seen from behind, curling back towards the planet over the page, which is how it
 * goes round: `r sin(psi) / (d - r cos(psi))` falls back to the disc's tangent radius `1 / sqrt(d^2 - 1)` at this angle.
 */
export function occludedAngle(d: number, r: number = CAPTION.radius): number {
  const t = 1 / Math.sqrt(Math.max(1.0001, d * d - 1));
  const phi = Math.atan(t);
  const arg = (t * d) / (r * Math.sqrt(1 + t * t));
  return Math.PI - phi - Math.asin(clamp(arg, -1, 1));
}

/** Whether a point at central angle `psi` from the view axis is on a front face. */
export const faceTowardsViewer = (psi: number, d: number, r: number = CAPTION.radius): boolean => psi < shellHorizon(d, r);

/**
 * A line turned by `theta` about the earth's axis (positive: to the right) is entirely out of sight: the nearest point of its parallel is past the
 * shell's horizon. The central angle from the view axis to the point of the parallel `baseLat` at longitude offset `a` from the view's centre is
 * `acos(sin(vl) sin(L) + cos(vl) cos(L) cos(a))`; the line's nearest point is at the offset `max(0, |theta| - halfSpan)`.
 */
export function lineHidden(theta: number, line: Pick<CaptionLine, "halfSpan" | "baseLat">, d: number, viewLat: number, r: number = CAPTION.radius): boolean {
  const off = Math.max(0, Math.abs(theta) - line.halfSpan);
  const vl = viewLat * DEG;
  const L = line.baseLat * DEG;
  // (the band stands above its baseline: take the latitude nearest the view's own, so a band that straddles the limb counts as seen)
  const cos = Math.sin(vl) * Math.sin(L) + Math.cos(vl) * Math.cos(L) * Math.cos(Math.min(off, Math.PI));
  // (hidden only once all of it is behind the planet's body: past the horizon of the strip's face a row is seen from behind, and goes round)
  return Math.acos(clamp(cos, -1, 1)) >= occludedAngle(d, r);
}

/* ------------------------------------------------------------------ the entrance */

/** Fast start, slow settle: 1 - 2^(-10 p), exactly 0 at 0 and 1 at 1. */
export const easeOutExpo = (p: number): number => (p >= 1 ? 1 : p <= 0 ? 0 : 1 - 2 ** (-10 * p));
/** Slow start, quick end. */
export const easeInCubic = (p: number): number => {
  const x = clamp(p, 0, 1);
  return x * x * x;
};

/**
 * Where a line starts, east of its resting place, radians: far enough that all of it is behind the planet for any camera the page has. The
 * point of its parallel at longitude offset `a` from the view's centre is out of sight when `sin(vl) sin(L) + cos(vl) cos(L) cos(a)` is under
 * `r / d` (`d` at its largest, `START_D`: the farther the camera, the less is hidden); the line starts that far plus its own half width.
 * (A parallel near the pole can be seen from the other side of the planet over the pole: then it starts at the farthest, 180 degrees.)
 */
export function entranceStart(line: Pick<CaptionLine, "halfSpan" | "baseLat">, viewLat: number, dMax: number = START_D, r: number = CAPTION.radius): number {
  const vl = viewLat * DEG;
  const L = line.baseLat * DEG;
  const denom = Math.cos(vl) * Math.cos(L);
  const need = denom > 1e-6 ? (Math.cos(occludedAngle(dMax, r)) - Math.sin(vl) * Math.sin(L)) / denom : -1;
  const hidden = Math.acos(clamp(need, -1, 1));
  return Math.min(Math.PI, Math.max(CAPTION.enter.fromDeg * DEG, hidden + line.halfSpan + 4 * DEG));
}

/** The camera distance the entrance's start is computed for when none is given: beyond the farthest the page has (the lowest zoom of a narrow phone is about 13). */
const START_D = 16;

/** Time the whole entrance takes: the last line's start and its duration. */
export const entranceMs = (lines: number): number => CAPTION.enter.ms + Math.max(0, lines - 1) * CAPTION.enter.staggerMs;

/** The turn `t` ms after leaving began, from `from`: on, the other way, behind the planet (`ms`: the orbit exit's duration). */
export function leavingAngle(t: number, from: number, start: number, ms: number = CAPTION.leaveMs): number {
  return from + (-start - from) * easeInCubic(t / ms);
}

/* ------------------------------------------------------------------ the rows' trajectory: in, roll through the centre, out */

/**
 * ONE continuous trajectory per row, in the direction of its travel: `x` is the turn of the row along its parallel measured so that it
 * DECREASES, from `start` (hidden behind the planet on the side it came from) through `+amp` to `-amp` and on to `-start` (hidden on the other side).
 * The row's turn is `side * x` (the side it came in from: +1 east). Three pieces, joined with matching positions, velocities AND accelerations (no kink and no kick at a seam):
 *
 *   in     `enter.ms`: quintic Hermite from `start` to `+amp`, fast to begin with and landing at the drift's own velocity (an ease-out that does not
 *          come to rest: it flows into the roll);
 *   roll   `cycle.dwellMs`: constant velocity `2 amp / dwellMs`, from `+amp` to `-amp` (a gentle rolling through the central meridian);
 *   out    `cycle.exitMs`: quintic Hermite from `-amp` at the drift's velocity to `-start`, accelerating (an ease-in), hidden at its end.
 *
 * The rows that stay (the call to action) cannot leave: they land at the centre and swing about it as a pendulum with the roll's period doubled
 * and the same amplitude (`pendulumX`): position and velocity continuous with their entrance, forever, never leaving.
 */
export const DRIFT = {
  /** Half the roll, radians. */
  amp: (CAPTION.drift.ampDeg * Math.PI) / 180,
  /** The slope an ease starts (in) or ends (out) with, in distances over the piece's duration (a quintic with zero end accelerations stays monotone up to about 2.5). */
  ease: 2.2,
} as const;

/**
 * How a row's trajectory is shaped: how long its entrance takes and the slope it starts with (`DRIFT.ease`: in distances over its duration), and
 * optionally the roll's and the exit's durations (`CAPTION.cycle` when absent). The regular rows use the defaults; the cinematic row its own.
 */
export interface EnterShape {
  ms: number;
  ease: number;
  dwellMs?: number;
  exitMs?: number;
}

/** The roll's velocity, radians per ms (constant). */
export const driftVelocity = (): number => (2 * DRIFT.amp) / CAPTION.cycle.dwellMs;

/** Time one row takes from its entrance to the start of its next one: in, the roll, out. */
export const cycleMs = (): number => CAPTION.enter.ms + CAPTION.cycle.dwellMs + CAPTION.cycle.exitMs;

/**
 * Quintic Hermite on p in [0, 1]: values `x0`, `x1`, slopes `m0`, `m1` per unit p, and ZERO acceleration at both ends (so the join with a
 * constant-speed roll, or with a pendulum, has no kick in its acceleration either: position, velocity and acceleration are continuous).
 */
function hermite(p: number, x0: number, x1: number, m0: number, m1: number): number {
  const p2 = p * p;
  const p3 = p2 * p;
  const p4 = p3 * p;
  const p5 = p4 * p;
  return (1 - 10 * p3 + 15 * p4 - 6 * p5) * x0 + (p - 6 * p3 + 8 * p4 - 3 * p5) * m0 + (10 * p3 - 15 * p4 + 6 * p5) * x1 + (-4 * p3 + 7 * p4 - 3 * p5) * m1;
}

/**
 * Where a row is, `tau` ms after ITS entrance began (negative: not begun, hidden at `start`): `x` of the trajectory above, `start` the
 * magnitude of the angle it comes in from. A function of time only.
 */
export function rowX(tau: number, start: number, amp: number = DRIFT.amp, enter: EnterShape = { ms: CAPTION.enter.ms, ease: DRIFT.ease }): number {
  const Ein = enter.ms;
  const T = enter.dwellMs ?? CAPTION.cycle.dwellMs;
  const Eout = enter.exitMs ?? CAPTION.cycle.exitMs;
  const v = (2 * amp) / T;
  const D = Math.max(1e-6, start - amp);
  if (tau <= 0) return start;
  if (tau < Ein) return hermite(tau / Ein, start, amp, -enter.ease * D, -v * Ein);
  if (tau < Ein + T) return amp - v * (tau - Ein);
  if (tau < Ein + T + Eout) return hermite((tau - Ein - T) / Eout, -amp, -start, -v * Eout, -DRIFT.ease * D);
  return -start;
}

/**
 * The rows that stay: the entrance lands at the centre with the pendulum's own speed, then `-amp sin(pi (tau - Ein) / dwellMs)` (period twice the
 * roll's). Continuous in position and velocity, and never leaves.
 */
export function pendulumX(tau: number, start: number, amp: number = DRIFT.amp): number {
  const Ein = CAPTION.enter.ms;
  const T = CAPTION.cycle.dwellMs;
  if (tau <= 0) return start;
  const w = Math.PI / T;
  if (tau < Ein) return hermite(tau / Ein, start, 0, -DRIFT.ease * start, -amp * w * Ein);
  return -amp * Math.sin(w * (tau - Ein));
}

/** The turn of the row `tau` ms into its `n`th cycle (that is `rowX` of `tau - n * cycleMs()`); the cycle's own index for the sets. */
export function cycleOf(tau: number): { n: number; local: number } {
  if (tau < 0) return { n: -1, local: tau };
  const P = cycleMs();
  const n = Math.floor(tau / P);
  return { n, local: tau - n * P };
}

/**
 * How present a row is, 0 (behind the planet at its start) to 1 (in its place, and anywhere within the roll's `amp`): what the dimming behind it
 * is scaled by, so the shade comes and goes with the words (an entrance, an exit) and not before them. A function of the row's turn only.
 */
export function dimPresence(theta: number, start: number, amp: number = DRIFT.amp): number {
  if (!(start > amp + 1e-9)) return 1;
  return clamp(1 - Math.max(0, Math.abs(theta) - amp) / (start - amp), 0, 1);
}

export type CaptionPhase = "hidden" | "in" | "out" | "fade" | "rest" | "egg";

/**
 * The cinematic interlude's timing (engine/cinematic.ts has the values): every row leaves round the orbit (`leaveMs`), the stage is empty for `gapMs`,
 * then ONE big row comes in (`enterMs`, a long ease that starts at `ease` and lands at the roll's own speed through `ampDeg`), holds, rolling
 * gently through `ampDeg` (`holdMs`), and leaves (`exitMs`); the normal entrance follows.
 */
export interface EggShape {
  leaveMs: number;
  gapMs: number;
  enterMs: number;
  ease: number;
  holdMs: number;
  exitMs: number;
  ampDeg: number;
  /**
   * The globe pulls back while it lasts (everything on it, the word included, is smaller: a smoothstep of `zoomInMs` from where the interlude
   * begins, held while the word is on the stage, and back in the `zoomOutMs` that follow its exit), by `zoomLevels` levels of zoom (2^-levels of its size). `zoomCutMs`: how long a cut-short interlude
   * (a gesture) takes to give the size back.
   */
  zoomLevels: number;
  zoomInMs: number;
  zoomOutMs: number;
  zoomCutMs: number;
}

/** The interlude as planned for a session: after cycle `n` of the first showing has begun to leave, from the side `side` (-1 west, +1 east). */
export interface CinematicPlan {
  n: number;
  shape: EggShape;
  side: 1 | -1;
}

/**
 * Time the whole interlude takes, ms: the rows leave, the stage is empty, the word comes in, holds and goes, and THEN the globe gives its size and its
 * lean back (`zoomOutMs`: owner, 2026-10-23, "do not untilt the view until the word has left").
 */
export const eggMs = (s: EggShape): number => s.leaveMs + s.gapMs + s.enterMs + s.holdMs + s.exitMs + s.zoomOutMs;

/** The row's trajectory in the interlude: `rowX` with the interlude's own shape. `tau`: ms since the big row's entrance began. */
export const eggX = (tau: number, start: number, s: EggShape): number => rowX(tau, start, (s.ampDeg * Math.PI) / 180, { ms: s.enterMs, ease: s.ease, dwellMs: s.holdMs, exitMs: s.exitMs });

/** How the caption leaves: a fade (the interaction's exit: cheap) or the orbit (the lines travel behind the planet). */
export type CaptionExit = "fade" | "orbit";

/** The caption's clock: what it is doing and since when. `now` is any monotonic clock in ms. */
/** A small seeded generator (mulberry32): the same seed, the same sides, in tests and in a capture. */
export function seededUnit(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The side each line comes in from along its parallel for entrance number `n` of a session seeded `seed`: -1 from the west, +1 from the east, at
 * random per line (it may repeat). Pure and deterministic.
 */
export function entranceSides(seed: number, n: number, lines: number): (1 | -1)[] {
  const next = seededUnit((seed ^ Math.imul(n + 1, 0x9e3779b1)) | 0);
  next(); // (the first draw of a small seed is poorly mixed)
  return Array.from({ length: lines }, () => (next() < 0.5 ? -1 : 1));
}

export class CaptionMotion {
  phase: CaptionPhase = "hidden";
  /**
   * The session's seed for the sides the lines come in from, per entrance. Null: every line from the east (the plain, deterministic default of
   * the pure tests); the layer gives it a random one per session, a check or a capture sets its own.
   */
  seed: number | null = null;
  private entrances = 0;

  /**
   * The rare cinematic interlude (engine/cinematic.ts). Null: none (reduced motion, a visitor who must not see it, a session that has seen it).
   * Once the first showing's clock reaches the plan's moment the interlude begins (`onCinematic` is told, once); when it is over (or cut short by
   * a showing) the plan is spent and the normal entrance follows (`onResume`).
   */
  egg: CinematicPlan | null = null;
  onCinematic: (() => void) | null = null;
  /** The interlude is over, ran out or cut short (once per interlude): what it started (the sound) lets go. */
  onCinematicEnd: (() => void) | null = null;
  onResume: (() => void) | null = null;
  /** The clock reading (ms) when the interlude began; negative: not under way. */
  private eggAt = -1;
  /** How far behind the planet the big row starts (set every frame by the layer: it follows the camera's tilt like every row's) and where it was when a leaving cut it short. */
  private eggStart = 0;
  private eggFrozen: number | null = null;
  private eggFrom: number[] = [];

  /** Checks and captures: a seed again from its first entrance (the same seed, the same sides), drawn at once. */
  reseed(seed: number | null): void {
    this.seed = seed;
    this.entrances = 0;
    this.rollSides();
  }

  /** The number of the entrance whose sides are drawn now (1 for the first). */
  get entranceNumber(): number {
    return this.entrances;
  }
  private sides: (1 | -1)[] = [];

  /** The side line `i` (by its turn in the stagger) comes in from now: +1 east, -1 west. */
  side(i: number): 1 | -1 {
    return this.sides[this.order[i] ?? i] ?? 1;
  }

  /** Draw the sides of the next entrance (a new entrance from hidden does it itself; a capture or a check may ask for it, with another seed). */
  rollSides(): void {
    this.entrances++;
    const n = this.turns();
    this.sides = this.seed === null ? Array<1 | -1>(n).fill(1) : entranceSides(this.seed, this.entrances, n);
  }

  private t0 = 0;
  /**
   * The caption's own clock, ms since its entrance began (negative while the page's fade-in goes first): advanced by `tick` with a capped step, so
   * it stands still while nothing is drawn (a hidden tab, the street map, a fade) and a stall cannot make the rows jump. Before the first `tick`
   * (the pure tests) time is read from `now` and `t0`.
   */
  private clock = 0;
  private lastNow = -1;
  private ticked = false;
  /** Rows from this index on stay (the call to action): they swing about the centre and never leave. */
  private fixedFrom = Infinity;
  /** The roll goes on at rest (false under reduced motion: the final composition, still). */
  continuous = true;
  /** The clock stands still (the energy pass: no input for a long while, a blurred window, a globe out of view): the composition stays as it is. */
  frozen = false;
  /** Parking (the idle settle): every row eases to the middle, then stays there (`parked`) until an input; and the blend back into the roll. */
  private parking: { t0: number; from: number[] } | null = null;
  parked = false;
  private resuming: { t0: number; from: number[] } | null = null;

  /** Begin parking at `now`: each row eases from where it is to the middle in `CAPTION.park.parkMs` (a smoothstep: no velocity at either end). */
  beginPark(now: number): void {
    if (this.parking || this.parked || this.phase === "egg") return;
    const from = this.starts.map((s, i) => this.angle(now, i, s));
    if (this.phase === "in") this.phase = "rest"; // (an entrance still under way is cut short: the rows go on from where they are)
    this.parking = { t0: now, from };
  }

  /** The parking has run its course (every row is in the middle). */
  get parkDone(): boolean {
    return this.parked;
  }

  get isParking(): boolean {
    return this.parking !== null;
  }

  /** Leave the park (an input): the rows blend from where they are into the roll, which goes on from its middle, in `CAPTION.park.resumeMs`. */
  unpark(now: number): void {
    if (!this.parking && !this.parked) return;
    const from = this.starts.map((s, i) => this.angle(now, i, s));
    this.parking = null;
    this.parked = false;
    this.resuming = { t0: now, from };
    // the roll goes on from its middle: row 0 is at 0 (the middle of the dwell), the others are as far from it as their stagger says
    this.clock = CAPTION.enter.ms + CAPTION.cycle.dwellMs / 2;
    this.ticked = true;
    this.phase = "rest";
  }
  private starts: number[] = [];
  /** An `in` that waits for the first frame (the time starts when something is there to see). */
  private pending = false;

  /** The turn in the stagger of each line: a wrapped line's pieces come in together (its logical line's index); by default, the line's own. */
  private order: number[] = [];

  /** The rows from `row` on are the ones that stay (they swing about the centre; the earlier ones roll through it and leave). */
  setFixedFrom(row: number): void {
    this.fixedFrom = row;
  }

  /** Where each line starts (radians), and its place in the stagger, set once the lines are laid out. */
  setStarts(starts: readonly number[], order?: readonly number[]): void {
    this.starts = [...starts];
    this.order = order ? [...order] : starts.map((_, i) => i);
    if (this.sides.length < this.turns()) this.rollSides();
  }

  private turns(): number {
    return (this.order.length ? Math.max(...this.order) : 0) + 1;
  }

  /**
   * The showcase begins: the lines come in. From hidden they start behind the planet (`start`, staggered). When a leaving is cut short the lines
   * are on the face or on their way out on the other side: each goes on from exactly where it is (no stagger, no jump) and settles into its place.
   */
  enter(now: number | null): void {
    if (this.phase === "in") return;
    this.enterFrom = null;
    if (this.eggAt >= 0) this.dropEgg(); // (a showing restarts the clock: an interlude that began is over, and is not shown again)
    if (this.phase === "out" && now !== null) {
      // (a leaving cut short goes on from where each line is: its sides are the ones it left by)
      this.enterFrom = this.starts.map((s, i) => this.angle(now, i, s));
    } else this.rollSides();
    this.parking = null;
    this.parked = false;
    this.resuming = null;
    this.phase = "in";
    this.pending = now === null;
    this.t0 = now ?? 0;
    // (a leaving cut short: the lines are on the face, so the entrance is skipped, they blend into the roll over `enter.ms` and there is no stagger)
    this.staggerOn = this.enterFrom === null;
    this.offset = this.enterFrom === null ? 0 : CAPTION.enter.ms;
    this.clock = this.offset;
    this.lastNow = now ?? -1;
    this.ticked = false;
  }

  /** Whether the lines are staggered (not for an entrance that cut a leaving short) and where the clock starts (the entrance skipped, then). */
  private staggerOn = true;
  private offset = 0;

  /** Where each line was when an entrance cut a leaving short (null: from behind the planet). */
  private enterFrom: number[] | null = null;

  /** Whether `enter` is waiting for a first time reading. */
  get waiting(): boolean {
    return this.phase === "in" && this.pending;
  }

  /** Begin the clock of a pending entrance, `delayMs` from `now` (the page's own fade-in goes first). */
  begin(now: number, delayMs = 0): void {
    if (this.waiting) {
      this.t0 = now + delayMs;
      this.clock = this.offset - delayMs;
      this.lastNow = now;
      this.pending = false;
    }
  }

  /**
   * The showcase ends: the lines on the face go on behind the planet the other way. A line that has not begun to arrive (waiting for the first
   * frame, its load delay or its stagger) is still behind the planet, and STAYS there: it does not sweep across the face on its way "out".
   */
  leave(now: number, exit: CaptionExit = "fade"): void {
    if (this.phase === "hidden" || this.phase === "out" || this.phase === "fade") return;
    // each line goes on from where it is now (an entrance cut short keeps every line where it had got to)
    this.eggFrozen = this.phase === "egg" ? this.eggTheta() : null; // (the big row stays where it is for the fade)
    // (an interlude cut short is over for its sound at once: it lets go over a fade of its own, not at the length of the file; the plan itself is
    // dropped later, by the next showing)
    if (this.phase === "egg") this.onCinematicEnd?.();
    this.leaveAngles = this.starts.map((s, i) => this.angle(now, i, s));
    this.leaveStays = this.leaveAngles.map((a, i) => Math.abs(a - (this.starts[i] ?? 0) * this.side(i)) < 1e-9);
    this.phase = exit === "orbit" ? "out" : "fade";
    this.t0 = now;
  }

  /**
   * Once per frame: advance the clock (a step of at most `CAPTION.drift.maxStepMs`: the roll stands still while nothing is drawn) and end a fade
   * that has run its course (nothing else moves in a fade).
   */
  tick(now: number): void {
    if (this.phase === "fade" && now - this.t0 >= CAPTION.fadeMs) this.phase = "hidden";
    if (this.lastNow >= 0 && (this.phase === "in" || this.phase === "rest" || this.phase === "egg") && !this.pending && !this.frozen) {
      this.clock += Math.min(Math.max(now - this.lastNow, 0), CAPTION.drift.maxStepMs);
      this.ticked = true;
      if (this.egg && this.eggAt < 0 && this.phase === "rest" && this.motionAllowed && this.clock >= this.eggTrigger()) this.beginEgg(now);
      else if (this.egg && this.phase === "egg" && this.clock - this.eggAt >= eggMs(this.egg.shape)) this.endEgg(now);
    }
    this.lastNow = now;
  }

  /** The clock now, ms since the entrance began (the first row's). */
  private time(now: number): number {
    return this.ticked ? this.clock : now - this.t0 + this.offset;
  }

  /** Checks and captures: move the clock (ms since the entrance began) to `ms`. */
  seek(ms: number): void {
    this.clock = ms;
    this.ticked = true;
  }

  /** The side line `i` comes in from in its `n`th cycle (the first is the entrance's own draw; later ones are drawn from the session's seed). */
  sideAt(n: number, i: number): 1 | -1 {
    if (n <= 0) return this.side(i);
    if (this.seed === null) return 1;
    const turns = this.turns();
    return entranceSides((this.seed ^ 0x5bd1e995) | 0, n, turns)[this.order[i] ?? i] ?? 1;
  }

  /** Which cycle line `i` is in now and how far into it (ms): the layer picks the phrase set by it. `n` is -1 before the line's own start. */
  cycle(now: number, i: number): { n: number; local: number } {
    if (this.parking || this.parked) return { n: 0, local: CAPTION.enter.ms + CAPTION.cycle.dwellMs / 2 };
    const k = this.order[i] ?? i;
    const t = this.pinned !== null ? this.pinned : this.time(now);
    return cycleOf(t - (this.staggerOn ? k * CAPTION.enter.staggerMs : 0));
  }

  /** Per line: it was still at its start when the leaving began. */
  private leaveStays: boolean[] = [];

  private leaveAngles: number[] = [];

  /** Jump to the final state (reduced motion): in place, or gone. */
  settle(on: boolean): void {
    this.phase = on ? "rest" : "hidden";
    if (this.eggAt >= 0) this.dropEgg();
  }

  /** Checks and captures only: hold the entrance at `ms` after its start (null releases it). */
  pinned: number | null = null;
  /** Checks and captures only: hold every line at this turn, radians (the limb close-ups: a line half past the horizon, on either side). */
  pinnedAngle: number | null = null;

  /** The turn of a line in its trajectory at clock `t` (ms since the entrance began), radians (positive: east of its place). */
  private timelineAngle(t: number, i: number, magnitude: number): number {
    const k = this.order[i] ?? i;
    const tau = t - (this.staggerOn ? k * CAPTION.enter.staggerMs : 0);
    const c = cycleOf(tau);
    const fixed = i >= this.fixedFrom;
    const n2 = fixed ? Math.min(c.n, 0) : c.n;
    const local2 = fixed ? tau : c.local;
    const side = this.sideAt(Math.max(0, n2), i);
    if (!this.continuous) return 0;
    const x = fixed ? pendulumX(local2, magnitude) : rowX(local2, magnitude);
    return side * x;
  }

  /** The turn of line `i` now, radians (positive: east of its place); `magnitude` is how far behind the planet it starts, the side is the line's. */
  angle(now: number, i: number, magnitude: number): number {
    if (this.pinnedAngle !== null) return this.pinnedAngle;
    const start = magnitude * this.side(i);
    if (this.pinned !== null) return this.timelineAngle(this.pinned, i, magnitude);
    switch (this.phase) {
      case "hidden":
        return start;
      case "rest": {
        if (this.parked) return 0;
        if (this.parking) {
          const p = clamp((now - this.parking.t0) / CAPTION.park.parkMs, 0, 1);
          if (p >= 1) {
            this.parked = true;
            this.parking = null;
            return 0;
          }
          return (this.parking.from[i] ?? 0) * (1 - p * p * (3 - 2 * p));
        }
        const tl = this.timelineAngle(this.time(now), i, magnitude);
        if (this.resuming) {
          const p = clamp((now - this.resuming.t0) / CAPTION.park.resumeMs, 0, 1);
          if (p >= 1) this.resuming = null;
          else {
            const e = p * p * (3 - 2 * p);
            return (this.resuming.from[i] ?? 0) * (1 - e) + tl * e;
          }
        }
        return tl;
      }
      case "in": {
        if (this.pending) return this.enterFrom?.[i] ?? start;
        const t = this.time(now);
        if (t >= (this.staggerOn ? entranceMs(this.turns()) : 2 * CAPTION.enter.ms)) this.phase = "rest";
        const from = this.enterFrom?.[i];
        const tl = this.timelineAngle(Math.max(t, 0), i, magnitude);
        if (from === undefined) return t <= 0 ? start : tl;
        // an entrance that cut a leaving short: from where the line was, blended into the roll over the entrance's time (the blend's slope is
        // zero at both ends, so the join has the roll's own velocity)
        const p = clamp((t - this.offset) / CAPTION.enter.ms, 0, 1);
        const e = p * p * (3 - 2 * p);
        return from * (1 - e) + tl * e;
      }
      case "egg": {
        // the interlude's first part: every row goes on round the orbit and behind the planet (the orbit exit's own path), then the stage is empty
        const L = this.egg?.shape.leaveMs ?? 0;
        const t = this.clock - this.eggAt;
        return t >= L ? start : leavingAngle(t, this.eggFrom[i] ?? 0, start, L);
      }
      case "fade":
        // the lines stay on their own turn (the camera still moves them on the screen) and the canvas fades
        return this.leaveAngles[i] ?? 0;
      case "out": {
        const t = now - this.t0;
        if (t >= CAPTION.leaveMs) {
          this.phase = "hidden";
          return start;
        }
        if (this.leaveStays[i]) return start;
        return leavingAngle(t, this.leaveAngles[i] ?? 0, start);
      }
    }
  }

  /** Something is moving (the frame loop must keep going). */
  get animating(): boolean {
    // (a pending entrance is not a frame loop: nothing moves until the first frame has given it a clock)
    // (the interlude pulls the globe back: it is the globe's own frames, not the caption's alone)
    return this.pinned === null && this.pinnedAngle === null && ((this.phase === "in" && !this.pending && !this.frozen) || this.phase === "out" || (this.phase === "egg" && !this.frozen));
  }

  /** The steady roll is on: the rows are in and moving (a slower, capped frame loop of the caption's own: `CAPTION.drift.frameMs`). */
  get drifting(): boolean {
    return this.pinned === null && this.pinnedAngle === null && this.phase === "rest" && this.continuous && !this.frozen && !this.parked;
  }

  /* ------------------------------ the cinematic interlude ------------------------------ */

  /** The interlude is under way (the rows are leaving, the stage is empty, or the big row is on it). */
  get eggActive(): boolean {
    return this.phase === "egg";
  }

  /**
   * How far the globe has pulled back now, 0 to 1 (a function of the interlude's clock: smooth, 0 at its start and at its end), 0 outside it. The
   * layer turns it into levels of zoom (`EggShape.zoomLevels`) and gives the size back at a fixed pace when the interlude is cut short.
   */
  eggZoom(): number {
    if (this.phase !== "egg" || !this.egg || this.eggAt < 0) return 0;
    const s = this.egg.shape;
    const t = this.clock - this.eggAt;
    const smooth = (p: number) => {
      const x = clamp(p, 0, 1);
      return x * x * (3 - 2 * x);
    };
    return Math.min(smooth(t / s.zoomInMs), smooth((eggMs(s) - t) / s.zoomOutMs));
  }

  /**
   * How far the camera's flight has got, 0 to 1 (engine/flight.ts): linear in the interlude's clock from its start to the moment the word lands (the rows'
   * leaving, the empty stage and the word's entrance), 1 from then on; 1 too outside the interlude (the page's own camera).
   */
  eggFlight(): number {
    if (this.phase !== "egg" || !this.egg || this.eggAt < 0) return 1;
    const s = this.egg.shape;
    return clamp((this.clock - this.eggAt) / (s.leaveMs + s.gapMs + s.enterMs), 0, 1);
  }

  /** Where the big row starts, radians behind the planet (the layer: it follows the camera's tilt). */
  setEggStart(rad: number): void {
    this.eggStart = rad;
  }

  /** Nothing is moving the rows by hand: not parking, not blending back from a park, motion is on. */
  private get motionAllowed(): boolean {
    return this.continuous && !this.parking && !this.parked && !this.resuming && this.pinned === null && this.pinnedAngle === null;
  }

  /** The clock reading the interlude begins at: when the first showing's first row would begin to leave, `n` turns of the sets on. */
  private eggTrigger(): number {
    return (this.egg?.n ?? 0) * cycleMs() + CAPTION.enter.ms + CAPTION.cycle.dwellMs;
  }

  /**
   * Begin the interlude NOW, from the resting roll (the owner's key with `?cinematic`, so that it can be seen again, with its sound, without a reload
   * and without a click: a key is a gesture that does not leave the presentation). False when it cannot: no plan, the rows are not rolling, or one
   * is under way.
   */
  replayEgg(now: number): boolean {
    if (!this.egg || this.phase !== "rest" || !this.motionAllowed) return false;
    this.beginEgg(now);
    return true;
  }

  private beginEgg(now: number): void {
    this.eggFrom = this.starts.map((s, i) => this.angle(now, i, s));
    this.eggAt = this.clock;
    this.eggFrozen = null;
    this.phase = "egg";
    this.onCinematic?.();
  }

  /** The interlude has run its course: the normal showing begins again from its first phrase set, as an entrance does. */
  private endEgg(now: number): void {
    this.dropEgg();
    this.enter(now);
    this.onResume?.();
  }

  /** The interlude is over (it ran out, or something else took the view): spent, never again. */
  private dropEgg(): void {
    if (this.egg) this.onCinematicEnd?.();
    this.egg = null;
    this.eggAt = -1;
    this.eggFrozen = null;
  }

  /**
   * The turn of the big row now, radians (positive: east of the central meridian), or null while it is not on the stage (before it comes in, after
   * it has gone, or outside the interlude). A leaving cut short holds it where it was for the fade.
   */
  eggTheta(): number | null {
    if (this.eggFrozen !== null) return this.eggFrozen;
    if (this.phase !== "egg" || !this.egg || this.eggAt < 0) return null;
    const s = this.egg.shape;
    const t = this.clock - this.eggAt - s.leaveMs - s.gapMs;
    if (t <= 0 || t >= s.enterMs + s.holdMs + s.exitMs) return null;
    return this.egg.side * eggX(t, this.eggStart, s);
  }
}

/* ------------------------------------------------------------------ page flags */

/** Live switch (module state, like `RING_STATE`): `applyShowcaseFlags` sets it from the page before the renderer is built. */
export const SHOWCASE_STATE = { enabled: true };

/**
 * The home screen's showcase (the page opens zoomed out, the boxes give way to the caption, the planet is lifted) is on every page but a debug one
 * (`?globe-debug`, what the browser checks run in: their assertions predate it, they open at the whole-globe fit); `?showcase` (or sessionStorage
 * "showcase" = "1") turns it on there. `?no-ring` switches the ring AND the caption off (the page is then the one of before the showcase).
 */
export function applyShowcaseFlags(): void {
  SHOWCASE_STATE.enabled = true;
  try {
    const q = new URLSearchParams(location.search);
    const debug = q.has("globe-debug") || sessionStorage.getItem("globe-debug") === "1";
    if (debug && !(q.has("showcase") || sessionStorage.getItem("showcase") === "1")) SHOWCASE_STATE.enabled = false;
  } catch {
    // no storage: keep the default
  }
}
