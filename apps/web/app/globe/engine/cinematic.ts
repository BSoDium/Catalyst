import { seededUnit, type CinematicPlan } from "./caption";
import { markPlayed, sessionStores, visitState } from "./visit";

/**
 * The caption's rare cinematic interlude (an easter egg, issue #293), after the studio logo's opening: once in a long while every line leaves
 * round the orbit (the caption's own orbit exit), the stage stays empty for a beat, and ONE big word, twice the size of the others and centred on
 * the equator, rises out of the planet's shadow from the west, slowly, settles for a long time, and goes on round the far side; then the usual
 * showing begins again from its first phrase set. The word is decoration: the caption is hidden from assistive technology, the real copy is in
 * the page, and nothing changes in the layout.
 *
 * It costs nothing at rest: it runs in the caption's own 30 a second loop like the roll (`CaptionMotion.drifting`), with no timer, and it is
 * frozen like the roll by the energy pass's hold.
 *
 * When it may play (all of them): the visitor has been here before (a first visit would only be puzzled by it), motion is not reduced, it has not
 * played in this browser session, the page is not a debug one, and the session's seeded draw says so (`chance`). `?cinematic` (or sessionStorage
 * "cinematic" = "1") plays it at the end of the first cycle, whatever the rest says (not under reduced motion): for the owner and for captures.
 */
export const CINEMATIC = {
  /** The share of eligible sessions it plays in. */
  chance: 0.12,
  /**
   * The word, in the heavy serif and the caption's own colours, on a shell of its own: `radius` (the rows' is 1.25), a higher orbit, so that it
   * floats clear of the surface and curves round the limb like the studio's wordmark. Its cap height is as large as its chord allows
   * (`placeEgg`): at least `capScale` times the rows' (twice), at most `maxCapScale`, and its half width on the screen reaches `fill` of the
   * planet's silhouette radius at most (the rows' limit is 1.04: the word is on the equator, level with none of the page's text, so it may
   * overhang the disc's sides: the studio's wordmark is about 1.8 times as wide as its globe) and `maxHalfScreen` of the stage's width (a
   * phone's planet is nearly as wide as the screen: the word must not leave it).
   */
  word: "UNIVERSAL",
  // (the word is baked into engine/cinematic-glyphs.ts: another word, or weight, is `pnpm --filter @catalyst/web bake:word <word> <weight> <opsz>`; a test holds the two together)
  /**
   * The planet and the word lean to the left while the globe is pulled back (degrees, the north pole toward the left of the screen: the studio's
   * globe is tilted on its axis and its wordmark orbits on the same slant); it eases in and out with the pull-back.
   */
  tiltDeg: 12,
  /**
   * The word is SOLID (engine/cinematic-word.ts: a mesh with a front, a bevel, walls and a back, made from the baked outlines of the page's display face
   * at weight 700, the optical size 12 cut: wide and sturdy, all capitals, sharp corners): a WHITE face on either page, a front bevel in BSoD blue (the site's accent, app.css `--palette-blue`: #0078d7 on the light page, a
   * lighter step of it on the dark) that is the word's outline, and grey walls only a step from the page (`sideColor`). The thickness is `depthCaps` cap
   * heights (the rows' is a fifth of one; 0.5 was too much) and the bevel is `bevelCaps` wide and deep.
   */
  outline: { light: "#0078d7", dark: "#4aa3f5" },
  face: "#ffffff",
  sideColor: { light: "#c3c8d1", dark: "#646b79" },
  depthCaps: 0.3,
  bevelCaps: 0.036,
  /** The bevel is a quarter circle in this many steps (a few more triangles, a bevel that catches the light along its width). */
  bevelSegments: 3,
  /**
   * The light, in the CAMERA's frame (x right, y up, z towards the viewer), so it comes from the same side of the screen wherever the word is on its
   * orbit: a key light from the upper left and in front, a weak fill from the lower right, an ambient share, and a sharp highlight (Blinn-Phong) and a REFLECTION
   * of a procedural studio (engine/caption-layer.ts `studio`) that makes the surfaces read as polished metal: `metal` is its share of the surface (`faceMetal` on the faces, which stay the lighter) (the rest is
   * `albedo * (ambient + diffuse * key + filler * fill)`), `reflect` its brightness. `inside`: how much of the light the backs of the letters (towards the planet, not in the sun) keep. `edgeShine` and
   * `faceShine`: how bright the thin strip lights of the studio are in the bevel's reflection and in a face's (the glints that run along the edges).
   */
  light: { key: [-0.45, 0.65, 0.62] as const, fill: [0.6, -0.3, 0.4] as const, ambient: 0.5, diffuse: 0.5, filler: 0.14, specular: 0.22, shininess: 90, metal: 0.55, faceMetal: 0.38, reflect: 0.85, inside: 0.78, edgeShine: 1.6, faceShine: 0.25 },
  radius: 2,
  capScale: 2,
  maxCapScale: 6,
  fill: 2.05,
  maxHalfScreen: 0.47,
  /**
   * The timing (engine/caption.ts `EggShape`, ms), made to the sound's length (`SOUND` in cinematic-sound.ts: 24.1 s, a long crescendo and its final chord
   * 20.25 s in, which is where the word lands: 0.5 + 0.4 + 19.35): the rows leave in `leaveMs`, the stage is empty for `gapMs`, the word comes in in `enterMs` (a very
   * long ease from `ease`: 1, against 2.2 for the regular rows, that lands at the roll's own speed), holds rolling through `ampDeg` for `holdMs`,
   * and leaves in `exitMs`. The globe pulls back by `zoomLevels` levels of zoom (0.7: to 62 % of its size, the word and the ring with it) and
   * LEANS over the first `zoomInMs`, stays so for as long as the word is on the stage, and comes back upright over the `zoomOutMs` AFTER it has
   * gone (the whole is `eggMs`: about 24 s, begun at 13 s in; the idle hold at 30 s waits for it, `Renderer.freezeWhenIdle`).
   */
  shape: { leaveMs: 500, gapMs: 400, enterMs: 19350, ease: 1, holdMs: 1000, exitMs: 1450, ampDeg: 2.5, exitExtraDeg: 14, zoomLevels: 0.7, zoomInMs: 6000, zoomOutMs: 1400, zoomCutMs: 1000 },
  /**
   * Where the word starts: the longitude its LEADING end (the west one) begins at, degrees east, in the earth's own frame, not the page's. The flight's
   * first camera is over Greece (22 E) at 0.15 earth radii, from where the equatorial shell is seen only up to about 111 E: the word starts BEYOND that
   * (135 E), so that it is hidden when the camera arrives and comes up over the horizon about three seconds in, as the studio's does. (The start, relative
   * to the page's meridian, is worked out from this and the word's span: `CaptionLayer.sync`.)
   */
  leadStartLon: 135,
  /**
   * The word is not drawn before this point of the flight (0..1): while the camera dives in from the page's view it could be seen from the high camera,
   * beside the planet, and would be seen to appear. The camera is in place at 0.1.
   */
  wordFromU: 0.1,
  /** The continents are filled with the ink for the whole interlude (the planet's disc, `GlobeScene.setLand`), eased in over `inMs` and out over `outMs`. */
  land: { inMs: 900, outMs: 1400, cutMs: 600 },
  /** The side the word comes in from: EAST (1), as the studio's does. */
  side: 1 as 1 | -1,
  /**
   * When it begins, as the number of cycles of the first showing that go by first (a cycle is 6.9 s): the second time the first row would leave,
   * 13 s in (a visitor has settled; it is about 24 s long and the idle hold at 30 s waits for it).
   */
  cycles: [1] as const,
} as const;

/**
 * The interlude's plan, or null: a pure function of the session's seed and what is known about the visit. `forced`: at the first row's first
 * exit, drawn or not (never under reduced motion).
 */
export function planCinematic(input: { seed: number; returning: boolean; played: boolean; reduced: boolean; forced?: boolean }): CinematicPlan | null {
  const { seed, returning, played, reduced, forced = false } = input;
  if (reduced) return null;
  const shape = { ...CINEMATIC.shape };
  if (forced) return { n: 0, shape, side: CINEMATIC.side };
  if (!returning || played) return null;
  const next = seededUnit((seed ^ 0x43494e45) | 0);
  next(); // (the first draw of a small seed is poorly mixed)
  if (next() >= CINEMATIC.chance) return null;
  const cycles = CINEMATIC.cycles;
  return { n: cycles[Math.min(cycles.length - 1, Math.floor(next() * cycles.length))]!, shape, side: CINEMATIC.side };
}

/** The page's own flag: `?cinematic` or sessionStorage "cinematic" = "1". */
export function cinematicForced(): boolean {
  try {
    return new URLSearchParams(location.search).has("cinematic") || sessionStorage.getItem("cinematic") === "1";
  } catch {
    return false;
  }
}

/** Debug pages (what the browser checks run in) never play it, unless it is asked for. */
function onDebugPage(): boolean {
  try {
    return new URLSearchParams(location.search).has("globe-debug") || sessionStorage.getItem("globe-debug") === "1";
  } catch {
    return false;
  }
}

/** The plan for this page load: what the layer is given. */
export function planForPage(seed: number, reduced: boolean): CinematicPlan | null {
  const { local, session } = sessionStores();
  const forced = cinematicForced();
  if (onDebugPage() && !forced) return null;
  return planCinematic({ seed, reduced, forced, ...visitState(local, session) });
}

/** The egg has begun: it will not play again in this browser session. */
export function notePlayed(): void {
  markPlayed(sessionStores().session);
}
