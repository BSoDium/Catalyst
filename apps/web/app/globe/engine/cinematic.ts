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
 * played in this browser session, the page is not a debug one, and the session's seeded draw says so (`chance`). And the visitor can ask for it, always
 * (the search palette's "I like surprises", `onDemandPlan`), not under reduced motion.
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
   * globe is tilted on its axis and its wordmark orbits on the same slant); it eases in with the pull-back and is put upright over the last `shape.levelMs` before the word lands (the lockup is level), as the camera comes down to `lockLat`.
   */
  tiltDeg: 12,
  /** The camera's latitude at the lockup, degrees (the page's is brought to it with the levelling): the word on the equator is then a nearly straight line. */
  lockLat: -4,
  /**
   * The word is SOLID (engine/cinematic-word.ts: a mesh with a front, a bevel, walls and a back, made from the baked outlines of a plain sans) and COLOURLESS:
   * every surface is a step from the PAGE's colour towards its ink (`tone`: how far, per scheme), so that it lies in the page instead of over it. Fully lit,
   * the face is nearly the white of the light page; on the dark page it is a deep grey that blends with the scene. What shows it is a bright OUTLINE (the
   * front bevel, `tone.outline` of the way to the ink: the ink itself, a thin line, as the globe's own linework) and the walls, a little further than the face.
   * The metal shows by REFLECTION only, as in space (nothing lights it but a few soft boxes and strips): `glint` is the reflections' signed strength (a light
   * sheen on the dark page, a darker one on the light, where a brighter one cannot show), `light.faceShine`, `wallShine` and `edgeShine` how much each kind of
   * surface takes of it. The thickness is `depthCaps` cap heights and the bevel is `bevelCaps` wide and deep.
   * All of it is drawn in a few dithered levels (`levels`), on the art's own pixels (the caption's canvas is drawn at the art's resolution), as the globe is.
   */
  tone: {
    light: { face: 0.006, side: 0.016, back: 0.04, outline: 0.4, glint: -0.62, exposure: 1.18, sky: 0, faceGain: 0.3 },
    dark: { face: 0.03, side: 0.055, back: 0.015, outline: 0.5, glint: 0.62, exposure: 1, sky: 1, faceGain: 1 },
  },
  levels: 7,
  depthCaps: 0.3,
  bevelCaps: 0.05,
  /** The bevel is a quarter circle in this many steps (a few more triangles, a bevel that catches the light along its width). */
  bevelSegments: 3,
  /**
   * The light, in the CAMERA's frame (x right, y up, z towards the viewer), so it comes from the same side of the screen wherever the word is on its
   * orbit: a key light from the upper left and in front, a weak fill from the lower right, an ambient share, and a sharp highlight (Blinn-Phong) and a REFLECTION
   * of a procedural studio (engine/caption-layer.ts `studio`) that makes the surfaces read as polished metal: `metal` is its share of the surface (`faceMetal` on the faces, which stay the lighter) (the rest is
   * `albedo * (ambient + diffuse * key + filler * fill)`), `reflect` its brightness. `inside`: how much of the light the backs of the letters (towards the planet, not in the sun) keep. `edgeShine` and
   * `faceShine`: how bright the thin strip lights of the studio are in the bevel's reflection and in a face's (the glints that run along the edges).
   */
  light: { key: [-0.5, 0.45, 0.74] as const, fill: [0.6, -0.3, 0.4] as const, ambient: 0.5, diffuse: 0.5, filler: 0.14, specular: 0.22, shininess: 90, faceShine: 0.8, wallShine: 1.1, edgeShine: 1.5, outlineMix: 0.6 },
  radius: 2,
  /**
   * On its way out the letters DISSOLVE in the art's ordered dither, one by one, as they pass behind the planet (no shrinking, no clipping line): a fragment is
   * gone once its angle from the page's view axis (as the planet sees it) is `to` degrees, going from whole at `from`; the word's last stretch finishes what is left
   * (`final`: the share of the exit from which everything dissolves, whatever its span). The ring is 1.5 radii above the planet: from the far cameras it is seen beside
   * the disc up to about 125 degrees, so the dissolve is done by 124, right at the limb.
   */
  dissolve: { from: 96, to: 124, final: 0.9 },
  capScale: 2,
  maxCapScale: 6,
  fill: 2.05,
  maxHalfScreen: 0.47,
  /**
   * The timing (engine/caption.ts `EggShape`, ms), made to the sound's length (`SOUND` in cinematic-sound.ts: 24.1 s, a long crescendo and its final chord
   * 20.25 s in, which is where the word lands: 0.5 + 0.4 + 19.35): the rows leave in `leaveMs`, the stage is empty for `gapMs`, the word comes in in `enterMs` (a very
   * long ease from `ease`: 1, against 2.2 for the regular rows, that lands at the roll's own speed), holds rolling through `ampDeg` for `holdMs` (long enough to read the studio's small line under the globe),
   * and leaves in `exitMs`. The globe pulls back by `zoomLevels` levels of zoom (0.7: to 62 % of its size, the word and the ring with it) and
   * LEANS over the first `zoomInMs`, stays so for as long as the word is on the stage, and comes back upright over the `zoomOutMs` AFTER it has
   * gone (the whole is `eggMs`: about 24 s, begun at 13 s in; the idle hold at 30 s waits for it, `Renderer.freezeWhenIdle`).
   */
  shape: { leaveMs: 500, gapMs: 400, enterMs: 19350, ease: 1, holdMs: 3400, exitMs: 1450, ampDeg: 2.5, zoomLevels: 1, zoomInMs: 6000, zoomOutMs: 1400, zoomCutMs: 1000, levelMs: 5500 },
  /**
   * Where the word starts: the longitude its LEADING end (the west one) begins at, degrees east, in the earth's own frame, not the page's. The flight's
   * first camera is over Greece (22 E) at 0.15 earth radii, from where the equatorial shell is seen only up to about 111 E: the word starts BEYOND that
   * (so that it is behind the planet at `wordFromU`, and rises over the horizon, as the studio's does). (The start, relative
   * to the page's meridian, is worked out from this and the word's span: `CaptionLayer.sync`.)
   */
  leadStartLon: 218,
  /**
   * The word is not drawn before this point of the flight (0..1): while the camera dives in from the page's view no camera could hide a word that long (its span is
   * wider than the unseen part of the ring), so it is not there; at this point the camera is in place at the opening shot and the word, by `leadStartLon`, is behind
   * the planet, to rise over the horizon.
   */
  wordFromU: 0.35,
  /** The continents are filled with the ink for the whole interlude (the planet's disc, `GlobeScene.setLand`), eased in over `inMs` and out over `outMs`. */
  land: { inMs: 900, outMs: 1400, cutMs: 600 },
  /**
   * What the interlude does to the PLANET, each off for now (the globe keeps its own pixel look, outline and dither, through it; the lit planet and the
   * lights are kept in the code for a later pass): `fill` the continents filled with the ink in a dither lit by one sun, with a dithered atmosphere (`land.ts`,
   * `occluderMaterial`), `cities` the places' lights at the chord.
   */
  planet: { fill: false, cities: false },
  /** The atmosphere (a thin grey glow round the planet's limb): how much of it, for the whole interlude. `dim`: the letters seen through it (a sight line that passes within `reach` planet radii of the limb before reaching them) dim by up to `amount` into the page's colour (dark page) or a grey `lightTone` of the way to the ink (light page: the page's white would lighten them). */
  atmosphere: { amount: 1, dim: { amount: 0.85, reach: 0.16, lightTone: 0.5 } },
  /**
   * The studio's small line under the globe, a parody of its own ("A COMCAST COMPANY"), set in the page's light sans in wide-spaced capitals: it comes in over `inMs` once the
   * word has landed and goes with its exit over `outMs`. `gap`: how far under the planet's centre its middle is, in planet radii (the studio's is 1.24); `size`: its height, planet
   * radii, at least `minPx`; `tracking`: its letter spacing, em.
   */
  tagline: { text: "This is a parody, please don't sue me", inMs: 700, outMs: 700, gap: 1.24, size: 0.062, minPx: 9, tracking: 0.28 },
  /** The places' lights come up through the dither when the word lands (the chord), over `inMs`, and go over `outMs`. */
  city: { inMs: 240, outMs: 500 },
  /** The side the word comes in from: EAST (1), as the studio's does. */
  side: 1 as 1 | -1,
  /**
   * When it begins, as the number of cycles of the first showing that go by first (a cycle is 6.9 s): the second time the first row would leave,
   * 13 s in (a visitor has settled; it is about 24 s long and the idle hold at 30 s waits for it).
   */
  cycles: [1] as const,
} as const;

/**
 * The interlude's plan, or null: a pure function of the session's seed and what is known about the visit.
 */
export function planCinematic(input: { seed: number; returning: boolean; played: boolean; reduced: boolean }): CinematicPlan | null {
  const { seed, returning, played, reduced } = input;
  if (reduced) return null;
  const shape = { ...CINEMATIC.shape };
  if (!returning || played) return null;
  const next = seededUnit((seed ^ 0x43494e45) | 0);
  next(); // (the first draw of a small seed is poorly mixed)
  if (next() >= CINEMATIC.chance) return null;
  const cycles = CINEMATIC.cycles;
  return { n: cycles[Math.min(cycles.length - 1, Math.floor(next() * cycles.length))]!, shape, side: CINEMATIC.side };
}

/** The plan of an interlude the visitor asked for (the search palette's entry): at the first chance, drawn or not, once per asking. */
export function onDemandPlan(): CinematicPlan {
  return { n: 0, shape: { ...CINEMATIC.shape }, side: CINEMATIC.side };
}

/** Debug pages (what the browser checks run in) never draw it by chance. */
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
  if (onDebugPage()) return null;
  return planCinematic({ seed, reduced, ...visitState(local, session) });
}

/** The egg has begun: it will not play again in this browser session. */
export function notePlayed(): void {
  markPlayed(sessionStores().session);
}
