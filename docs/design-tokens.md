# Design tokens

The UI system built on these tokens (frames, type roles, kind coding, components) is in [design-system.md](design-system.md); this file keeps the values.

Source of truth: `apps/web/app/app.css`. Colors, radii, motion and layout are CSS variables on `:root`;
Tailwind 4 reads them through `@theme` / `@theme inline`. Light and dark follow `prefers-color-scheme`
(no toggle for visitors; `[data-scheme="light"|"dark"]` forces a scheme on a subtree and is set only by the dev styleguide). Names match shadcn/ui's contract so selectively added components work unchanged.

Principles: black and white with one accent (BSoD blue, the call to action; since 2026-10-14 no warm tone anywhere), generous spacing, clear hierarchy. The system stack plus three self-hosted fonts (display, reading, metadata), no remote font requests.
The navbar has no surface of its own: it floats over the page and a gradient (a scrim over content, a fade over the globe) keeps it readable (see "Nav scrim").

## Color

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--background` | `#fbfbfb` | `#0a0a0a` | page |
| `--foreground` | `#0a0a0a` | `#f5f5f5` | text, primary fill |
| `--accent` | `#ececec` | `#1f1f1f` | hover and selected rows |
| `--muted-foreground` | `#595959` | `#a3a3a3` | secondary text (AA: 6.8:1 light, 7.9:1 dark) |
| `--subtle-foreground` | `#6f6f6f` | `#8a8a8a` | the map's credits line: dimmer than muted text by COLOUR (4.9:1 light, 5.7:1 dark against the page; muted is 6.8 / 7.9), never by opacity; hover and keyboard focus raise it to `--foreground` |
| `--border` | `rgb(0 0 0 / .14)` | `rgb(255 255 255 / .16)` | hairlines |
| `--border-strong` | `rgb(0 0 0 / .44)` | `rgb(255 255 255 / .45)` | outlined buttons (not the credits dialog, which uses `--border`); 3.3:1 light, 4.5:1 dark against the page (it was .4, 2.8:1, until 2026-10-14: a control's edge is held to 3:1) |
| `--ring` | `#0067b8` | `#0a93ff` | focus ring (2px outline, 2px offset, all focusable elements, on a 5px moat of `--background`): the accent's text tone, 5.6:1 / 6.3:1 on the page (it was the ink until 2026-10-14). A primary button's ring is the ink: a blue ring round a blue fill would read as a halo |
| `--primary` / `--primary-foreground` | `#0076d4` / `#ffffff` | `#0076d4` / `#ffffff` | the call to action: the default (primary) button is a filled BSoD blue with white text (4.62:1); it was ink on the page's colour until 2026-10-14 |
| `--signal-hover`, `--signal-active` | `#006cc2`, `#0064b2` | the same | a signal fill hovered and pressed: one step and two steps deeper along lightness (white text 5.35:1 and 6.06:1; the fill against the page 5.2:1 and 5.9:1 in light, 3.7:1 and 3.3:1 in dark (3.5:1 and 3.1:1 on the surface plate): a deeper step would clear AA text but lose the 3:1 shape against the near-black page) |
| `--signal` | `#0076d4` | `#0076d4` | the one accent, BSoD blue, the same in both schemes: LARGE display text (24 px, or 18.66 px bold, and up), non-text marks (underline, tick, rule, a cover's mark) and fills. 4.47:1 on the page and 4.20:1 on the surface in light, 4.28:1 and 4.05:1 in dark. See "Accent" below |
| `--signal-text` | `#0067b8` | `#0a93ff` | the accent as text of any size under 24 px: 5.59:1 on the page, 5.26:1 on the surface, 4.89:1 on the hover grey (light); 6.25 / 5.91 / 5.20:1 (dark) |
| `--signal-foreground` | `#ffffff` | `#ffffff` | text on a `--signal` fill: 4.62:1 (both schemes: the fill is the same) |
| `--globe-grid`, `--globe-limb` | `rgb(0 0 0 / .12)`, `rgb(0 0 0 / .3)` | `rgb(255 255 255 / .14)`, `rgb(255 255 255 / .34)` | no longer read by the map: the graticule is the palette's `faint` level (level 3) and the horizon outline is one level fainter (level 2, `outlineLevel` in `engine/colors.ts`: 1.24:1 light, 1.21:1 dark against the page; it was `soft` until 2026-10-07 and `faint` until 2026-10-08, when the owner found the globe's ring still too visible; floor 1.2:1, `colors.test.ts`); the tokens remain for any other use |

### Map palette

The globe and the street map draw with one grey palette derived from `--background` and `--foreground` only (OKLab interpolation, `app/globe/engine/palette.ts`, `PALETTE_LEVELS` = 12 levels: page colour, 10 map greys, full ink). The map greys (levels 1 to 9) only reach `MAP_CONTRAST` (0.40 light, 0.42 dark; it was 0.55 / 0.58 until 2026-10-08, when the owner asked to wash the map out so the boxes and labels stand out) of the way to the ink, so everything the map draws is recessive: the loudest map tone (`coast`: coastlines, country borders, the water's edge) is 3.1:1 / 3.2:1 against the page (was 5.2:1 / 5.5:1, floor 1.5:1), the roads are below it (motorways level 7, primary 6, secondary 5, tertiary 3, the decor 2 and 1: 2.1:1 at the loudest, 1.42:1 for tertiary, the faint end untouched at 1.10 / 1.24 / 1.42 light, see `docs/street-architecture.md`, "Road hierarchy"), so a box at rest dominates the map. One level above the coast, `peak` (level 10) is the box at rest and keeps its old tone, `BOX_CONTRAST` (0.55 / 0.58: 5.2:1 / 5.5:1, 1.7 times the coast's contrast), so the box stays the loudest of the greys by a wide margin. The full ink (`ink`, 19:1 / 18:1) is kept for the hovered, focused or selected detection box and for the route; a box at rest is the `peak` level (above the coast); the LABELS are HTML text in the page's `--foreground` in every state, see "Typography" (the pixel label tones, `textFloorLevel` in `palette.ts`, remain for pixel text that is part of the map), see `docs/web-architecture.md`, "Detection boxes". Named roles: `wash` (building fills), `faint` (graticule; the globe's horizon outline is the level below it), `soft` (rail, paths, horizon, the dots of parks and dashes of water), `mid` (region borders, building outlines), `strong` (rivers, lakes), `coast` (coast, country borders, the water's edge: the loudest the map gets), `peak` (the box at rest), `ink`. Contrast against the page per level at 12 levels, light / dark: 1.10 / 1.08, 1.24 / 1.20, 1.42 / 1.39, 1.48 / 1.45, 1.61 / 1.58, 1.81 / 1.79, 2.10 / 2.10, 2.52 / 2.55, `coast` 3.12 / 3.18, `peak` 5.23 / 5.51, `ink` 19.1 / 18.2. A token change reaches both renderers with no code change, light and dark; `app/globe/engine/readability.test.ts` recomputes the contrast of labels, markers, attribution and nav over the map from the tokens. Spec and comparison: `docs/pixel-line-rules.md` section 7 and `docs/palette/`.

The globe's ocean has no token of its own: it is `--background` (the disc and the clear colour are exactly the page colour, so the canvas never shows a seam). The detail panel uses `--background` at 85% with a backdrop blur.

UI-system additions (2026-10-08, values and use in design-system.md): `--surface` (`#f4f4f4` / `#121212`, the panel plate), `--line-faint` (grid and tick texture), the one accent `--signal` with `--signal-text`, `--signal-foreground` and `--signal-wash` (see "Accent" below; it was a cyan until 2026-10-12 and an orange until 2026-10-13), the `--inverse-*` set (an inverted frame's rebinding, including `--inverse-signal` and `--inverse-signal-text`), and a faint hue per kind (`--kind-article|project|artwork|poem|place`, the generated covers' lightest tone only). `design-system.test.ts` keeps the four copies of the colour list (light, dark, and the two forced-scheme rules) identical and asserts the AA pairs.

### Accent

The one accent is **BSoD blue**, after the owner's handle (BSoDium) and the Windows stop screen: the reference is `#0078d7` (hue 206.5 degrees, HSL 100 % 42 %). Every tone of it keeps that hue and saturation and moves along lightness only, so nothing drifts to cyan or to purple. The fill is `--signal` `#0076d4`, the same in both schemes (two steps deeper than the reference: white text on `#0078d7` itself is 4.499:1, a thousandth under AA, and on `#0076d4` it is 4.62:1). On a fill the text is white (`--signal-foreground`), as on the stop screen. Text under 24 px needs more against a light page than the fill gives (4.47:1 on the page, 3.91:1 on the hover grey) and against a dark one more against the hover grey (3.57:1 for the fill), so `--signal-text` is a tone of the same hue: `#0067b8` in light (5.59:1 on the page, 4.89:1 on the hover grey) and `#0a93ff` in dark (6.25:1 on the page, 5.20:1 on the hover grey). Contrast is computed with `lib/contrast.ts` (WCAG 2) and asserted for every pair, both schemes, by `design-system.test.ts`. Changing the accent later is the accent lines of `app.css` (`--signal`, `--signal-text`, `--signal-foreground`, `--signal-wash`, `--signal-hover`, `--signal-active`, `--primary`, `--ring`, the two `--paper-signal*` and the two `--inverse-signal*`), times the four copies of the list; the tests say what no longer holds. The hover and pressed fills are the same hue and saturation at lightness 38 % and 35 % (the fill is 42 %): the range is bounded below by 3:1 against the dark page and above by 4.5:1 for the white label.

| Use | Token | Rule |
| --- | --- | --- |
| Display text of 24 px and up (or 18.66 px and up in bold), the drop cap, `text-signal` | `--signal` | 3:1 on the page and the surface (`design-system.test.ts`) |
| Non-text marks: link underline, the active tick, the progress line, a cover's mark, a rule | `--signal` | 3:1 |
| Any text under that size (a status word, a micro-label, a meta line) | `--signal-text` (`text-signal-text`) | 4.5:1 on the page, the surface and the hover grey |
| Text on a filled accent block | `--signal-foreground` on `--signal` | 4.5:1; the fill is blue with white on it in both schemes |
| The call to action: a primary button, a toggle that is on | `--primary` (= `--signal`) with `--primary-foreground` (= `--signal-foreground`); hover `--signal-hover`, pressed `--signal-active` | 4.5:1 for the label on all three fills; each fill 3:1 against the page |
| A link in running text, a hovered tag, filter or header item, a key hint on hover | `--signal-text` | 4.5:1 |
| The focus ring | `--ring` (the same tone as `--signal-text`); a primary button's ring is `--foreground` | 3:1 on the page, the surface and the hover grey |
| The selection | `::selection`: `--signal` with `--signal-foreground` | 4.5:1 |
| The current header item, the chosen filter, the active frame's edge, a card title under the pointer | `--signal` as a 2 px underline or rule | 3:1 (marks) |
| Inside an inverted frame | `--signal`, `--signal-text`, `--ring` and `--primary` are rebound to `--inverse-signal` / `--inverse-signal-text` / `--inverse-signal` | 3:1 and 4.5:1 on the inverted page |

The accent stays out of the map and the globe (they are monochrome); on paper (`@media print`) the accent, the ring and the primary fill are black.

Tailwind utilities: `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-accent`, etc.
The map and the globe stay monochrome: the accent `--signal` and the kind hues are for the data-display UI only, and there is no destructive color on purpose (an error is the word Error in an inverted tag).

### Sky

The globe's skybox (`SKY` in `app/globe/engine/tuning.ts`; architecture in web-architecture.md, "Skybox") uses no colour of its own: its tones are palette levels, so a token change reaches it. The band is BELOW the graticule and the horizon outline's neighbour: its two tones are levels 1 and 2 (`skyTop(levels)`, one below `faint`), measured dark 20 and 31 on the page's 10 (graticule 43), light 240 and 227 on 251 (graticule 213). The stars add a third tone, capped at the graticule's own level (`starTop`, level 3; never above it, so the sky cannot outshine the boxes, labels or the graticule's dots): three tiers (levels 1, 2, 3) with a heavy-tailed share, 60 / 28 / 12 %. The horizon outline is level 2 (`outlineLevel`, design-tokens "Map palette"), the band's bright tone. Quantised with a 4x4 Bayer dither on the art cell, never a gradient.

| Constant | Value | Meaning |
| --- | --- | --- |
| `fade.from`, `fade.to`, `fade.limb` | 1, 1.55, 0.55 | earth radii from the disc's centre. The sky is DIMMED, never removed, towards the earth: `limb` (55 %) of its strength from the silhouette to `from`, easing up to all of it at `to` (smoothstep, applied before the dither; stars are thinned at random, not dimmed). It was a cut (nothing inside 1.06 radii, all of it from 1.55) until 2026-10-08, when the owner found it masked the background around the planet |
| `onRho.rho`, `band` | 1.75, 0.05 | the sky is on while the picture's farthest corner is beyond this many radii (hysteresis +-band); timed 200 ms switch |
| `band.gain` | 0.9 | brightest the band gets, of the top tone (1 = the second tone solid) |
| `band.brightness` | edge 0.5, core 1 | anticentre and galactic centre |
| `band.thicknessDeg` | edge 5.5, core 10 | 1 sigma half thickness in degrees of galactic latitude |
| `band.bulge`, `band.rift` | 0.5 share, 7 deg; depth 0.8, 2.6 deg wide | nuclear bulge and the Great Rift dust lane |
| `band.noise` | 3 octaves, floor 0.5, breaks below 0.34 | mottling and dust breaks |
| `stars.count`, `bandBoost`, `tierShares` | 20000, 1.8, [0.6, 0.28, 0.12] | about 430 to 510 in view at the whole-globe view on a desktop (about 46 lit pixels at the brightest tone); up to 1.8x denser along the band. Tones: level 1, level 2, level 3 (the graticule's: the cap). One cell each, no sparkles. Owner 2026-10-08: "not super bright, just a bit brighter", for noise over the band and the open sky |
| `eraDeg` | 70 | the earth rotation angle at load (the sky's one placement against the earth) |
| `seed` | `0x5ca1ab1e` | every random choice (positions, tiers, keep ranks) |

### Ring of type

The ring of type that circles the planet's disc when the globe is zoomed out below its whole-globe fit (`RING` in `app/globe/engine/tuning.ts`; web-architecture.md, "Ring of type") has no colour of its own either: one palette tone, no alpha, the `coast` role (3.1:1 dark / 3.2:1 light on the page: the loudest the MAP itself gets, never above a coastline), its fade a staircase of tones; decorative and `aria-hidden`, so not held to WCAG, and below the boxes (5.2:1) and the labels (ink). Type: `--font-mono` (the labels' stack), weight 500, tracking about 0.14 em like `.nav-link` (adjusted per viewport so the line closes the circle), uppercase, about 11 px (10 to 13) at the lowest zoom, scaling with the planet. No new token.

| Constant | Value | Meaning |
| --- | --- | --- |
| `gap` | 0.06 | the baseline's distance from the silhouette, a fraction of its radius (17 px at the lowest zoom on 1440 x 900) |
| `degPerSec`, `direction`, `startDeg` | 3, 1 (clockwise), 0 | its own turn on its own clock (the globe's idle rotation is 0.2 degrees a second, so the ring turns 15 times faster); degrees clockwise from twelve o'clock at the start |
| `type` | weight 500, tracking 0.14, advance 0.6 em, target 11 px, slack 15 % | the line goes round a whole number of times, nearest the target em; the em may move by the slack and the tracking takes the rest, so the seam closes |
| `zoom.floorBelowFit`, `zoom.fitMargin` | 0.5 levels, 0.12 | the camera goes at least this far below the whole-globe fit, and further until the ring fits the free area with this margin |
| `zoom.fade` | from 0.08, to 0.6 | strength by the way from the fit (0) to the lowest zoom (1): absent up to `from`, full from `to` |
| `tone` | `coast` | palette role of the letters |
| `frameMs`, `maxStepMs`, `maxDpr` | 32, 100, 2 | at most 30 repaints a second, the largest step of its clock, the largest device pixel ratio its canvas is drawn at |

Light scheme: kept (dark specks of 11 and 24 levels below the page colour on 251), because at those values it reads as the same barely-there haze as the dark one and the stipple does not compete with the boxes; `?no-sky` is the off switch.

### Caption (the home screen's words over the planet)

The rows that float over the planet on the home screen (`CAPTION` in `app/globe/engine/tuning.ts`; web-architecture.md, "Caption on the sphere"): the reading serif (Newsreader, the intro's own face, no file of its own) in medium and heavy weights and a heavy italic, the code face (JetBrains Mono, the page's own) for "Software" and an ornate copperplate script (Imperial Script) for "Poetry", set in the **secondary text tone** with two words at most in **BSoD Blue** (the one palette), inside a **contour** (a thin outline outside the glyph) and a short **thickness** on the Z axis (a stack of slices towards the planet) in a **mid tone** between the page and the text: a cut-out of the globe's linework. All solid; the colours are uniforms (`captionColors`), so a theme change is no rebuild.

| Constant | Value | Meaning |
| --- | --- | --- |
| `radius`, `depth`, `slices` | 1.25, 0.016, 28 | the shell the front faces float on, in planet radii (the coastlines and the graticule are at 1); the thickness towards the planet and the slices that make it |
| `capR` | 0.084 | cap height in planet radii of EVERY row (one size for the rows that take turns and the call to action: the hierarchy is the weight and the face); the block shrinks together where a chord needs it |
| `upper`, `tracking` | true, serif 0.05 / mono 0.03 / script 0 | the words are drawn in capitals (the caption only; the script face is exempt: "Poetry" keeps its case) and tracked by this many ems on top of each face's own spacing |
| `dim` | ellipse, alpha 0.55 / 0.55, reach 0.55, bandReach 1.9 | the faint page-colour shade behind the words (mode `ellipse`, `bands` or `none`); strength at the middle per scheme |
| `rows.stepCaps` | 1.45 | the rows are on FIXED parallels centred on the equator, this many cap heights from baseline to baseline at the ends (the middle ones moved so the baselines are equally far apart on the screen at `band.loadLat`) |
| `band` | 10 degrees, snap 800 ms, hysteresis 1.5, `snapTo` edge | the camera latitude the caption needs: outside it the latitude glides (only) to the nearest edge (or the equator) before the entrance; the page opens at `START_VIEW` (lon 0, lat 0) |
| `maxHalfWidth`, `hardSpanDeg`, `visibleFraction`, `minScale` | 1.04, 160, 0.85, 0.2 | a row's half width over the silhouette's radius at most; the most a row spans round its parallel; how near the shell's horizon its ends may go; the least scale of the static fit |
| `minCapPx` | 12 | the smallest letter, CSS px (a block may go to three quarters of it at an extreme tilt on a small planet) |
| `outline`, `texCap` | 0.05, 96 | the outline in cap heights (outside the glyph, so the face keeps its area); texels in a cap height |
| `colors` | text #595959 / #a3a3a3, accent #0076d4 / #70b4ff, `outlineMix` 42 % / 37 %, `sideMix` 11 % / 10 % | the letters are the secondary text tone (`--muted-foreground`); at most two words on screen (and the first numeral of a counts row) take BSoD Blue (`--palette-blue-600` light, `-400` dark: 4.5:1 and 9.1:1); the contour is a mid tone from the page toward the text (1.9:1 and 2.0:1 against the page, 3.5:1 and 4.0:1 against the face), the thickness a step closer (1.15:1). All alpha 1 |
| `enter` | from 100 degrees, 900 ms, stagger 450 ms, 250 ms after load | each row comes round from behind the planet from a random side with an ease-out-expo |
| `cycle` | dwell 5500 ms (the roll), exit 480 ms | the roll's duration (constant speed through the centre) and the orbit exit that follows it (an ease-in that starts at the roll's speed); the next set enters the same way |
| `drift` | amp 8 degrees, frame 32 ms, max step 64 ms | half the roll (along the row's parallel), the least time between the caption's own capped frames (30 a second), the largest step of its clock |
| `fadeMs`, `leaveMs` | 180, 200 | the interaction's exit is an opacity fade of the canvas; the orbit exit (kept) takes `leaveMs` |

Faces (`CAPTION_FACES`, `CAPTION_STYLES`; round 9, 2026-10-19): `plain` Old Standard TT 400 and `heavy` 700 (`heavy-italic` is the 700 roman: the family has no bold italic and the app does not use it), a 19th-century Scotch-Roman / Didone serif (SIL OFL 1.1, Copyright 2011 The Old Standard Project Authors; `public/fonts/old-standard-tt-3.000-latin-400.woff2` 7.8 kB and `-700.woff2` 7.7 kB, `kern`-only subsets of Basic Latin and the middle dot made with `pyftsubset` from the fontsource latin files; licence `LICENSE-old-standard-tt.txt` beside them; cap height 712 / 1000, the `CAPTION_FACE.capEm`): it replaced Newsreader, whose slanted, dropping serifs on L, E and C (the optical-size axis at the largest size, which a canvas cannot set) the owner disliked; `mono` JetBrains Mono 700 (scale 0.95 to the serif's caps), `script` Imperial Script 400 (scale 1.079, thickened 0.05 caps; SIL OFL 1.1, `public/fonts/imperial-script-1.010-latin-400.woff2`, 19.7 kB, `kern` only; licence `LICENSE-imperial-script.txt`). Every file is loaded by the globe with the `FontFace` API only when a caption has a word in it (3 s timeout, fallback style, never a negative result kept). Candidates compared in the real outlined and extruded style: Newsreader (now and drawn at optical size 18), Cinzel, Playfair Display SC, Bodoni Moda, Cormorant SC, Old Standard TT, Libre Caslon Text, Marcellus; Old Standard TT is the chosen one (clean bracketed serifs, a real bold, the look of 19th-century shop-front and cinema lettering); `fontlab-light.png` and `fontlab-dark.png` in the round's scratchpad.

### Map card and credits line

`MAP_CARD` (`app/lib/map-card.ts`) is the small card that sits over the map: `rounded-sm border border-border bg-background/80 px-1.5 py-0.5 font-mono text-[10px] leading-4 tracking-wide backdrop-blur-sm`. Two things use it, so they match: the dev-only content badge (`PREVIEW local data not published`, bottom left, muted text, above the credits on phones) and the credits line. A test (`components/map-card.test.ts`) fails if either drops a class of it. Colour is not part of it.

`AttributionButton` (`components/attribution-button.tsx`) is the credits line: one line of selectable mono text with the main contributors ("© OpenStreetMap · OpenFreeMap · Natural Earth", from `core/attribution.ts`), in the dim `--subtle-foreground` at full opacity, then one more middle dot (the same separator as between the credits: "… · Natural Earth · See more ↖"; an `aria-hidden` span of the card's flex row, OUTSIDE the clipped text, so it stays beside the button when the line is clipped), then a "See more" button with a lucide `ArrowUpLeft` (`aria-hidden`), at the bottom right of the map, left of the detail panel's inset. From `md` (768 px, `useIsMobile`'s line) up only: below it the card is `display: none` (`max-md:hidden`: gone from the tab order and the accessibility tree) and a phone button replaces it (2026-10-14, owner: "the card is clutter on a small screen"). Between `md` and the wide layout the text is clipped, never wrapped, when the room is short (last items first). The card's button is a `<button aria-haspopup="dialog" aria-label="See more credits">` that opens the credits dialog.

**The phone's credits** (`data-attribution="compact"` and `"compact-line"`, same file, `md:hidden`): below `md` the card is replaced by a short line plus a button, in a box at the bottom right (0.5 rem from the right, 0.375 rem or the safe-area inset from the bottom, z 20, at most the width minus 1 rem). The line is "© OpenStreetMap contributors · OpenFreeMap · Natural Earth" (the sources of the tile configuration), mono 10 px in `--subtle-foreground` on a SOLID `--background` plate with a `--border` hairline (no alpha, no blur), real selectable text that wraps between credits (two rows at 390 px, never clipped, never an animation). It is shown at load and collapses to the button alone after 5 s or on the first pointer down or wheel on the map, once per page load per surface (`lib/credits-collapse.ts`, a module-level in-memory guard: kept by a remount or a client-side navigation, reset by a reload; nothing is stored). The button is a 28 px square, solid plate, lucide `Info` (inline size at `text-base`) in `--subtle-foreground` (4.9:1 light, 5.7:1 dark; a mark needs 3:1), `--foreground` on hover and keyboard focus plus the global ring, `aria-label="Map credits"`, `aria-haspopup="dialog"`, an invisible `::after` making the target 44 x 44 px (`after:-inset-[9px]`: the border is outside its box; measured 44 x 44). It is the same element with or without the line (it keeps focus when the line goes) and opens the same `CreditsDialog`; focus returns to whichever of the two is drawn. It is in the globe's box, so the street map has it too; MapLibre's own attribution control is off (`attributionControl: false`), so there is one control. While a place or entry is open on a phone the globe is unmounted and so is this box (the panel covers the screen); the guard keeps the line from coming back on return within the page load. `scripts/home/hero.mjs` checks that nothing of the hero covers whichever of them is drawn. The text halo of the old link (`.credits-link`) is gone: the card's plate does its job (worst case, a full-strength peak map line under a glyph, is 3.7:1 in light; `readability.test.ts`, which reads the plate from `MAP_CARD`). The credits dialog uses `--border` (the card's hairline) for its panel and its Close button, not `--border-strong`.

## Typography

Three self-hosted font families sit beside the system stack. They are SIL Open Font License 1.1 (licences beside the files in `apps/web/public/fonts/`), Latin subset, variable, from `@fontsource-variable` 5.3.0, declared in `app.css` with `font-display: swap`. Nothing is requested from another origin (`font-src 'self'`). Characters outside the Latin subset (Vietnamese place names, Arabic ...) are set glyph by glyph in the system stack (`unicode-range`).

| Token | Stack | File (version in the name: cached `immutable` for a year) | Use |
| --- | --- | --- | --- |
| `--font-display` | `"Bricolage Grotesque Variable"`, `"Bricolage Grotesque Fallback"`, `--font-sans` | `bricolage-grotesque-5.3.0-latin-wght-opsz.woff2`, 77 kB, wght 200 to 800, opsz 12 to 96 | the owner's name on the home page, headlines, headings: heavy against thin |
| `--font-reading` | `"Newsreader Variable"`, `"Newsreader Fallback"`, `ui-serif, Georgia, "Times New Roman", serif` | `newsreader-5.3.0-latin-wght-opsz.woff2` (132 000 B) and `-italic` (146 872 B), wght 200 to 800 and opsz 6 to 72 | the body of an entry, an entry's headline (700), a poem's title and lines, the standfirst, pull quotes |
| `--font-meta` | `"JetBrains Mono Variable"`, `--font-mono` | `jetbrains-mono-5.3.0-latin-wght.woff2`, 40 kB, wght 100 to 800 | page metadata (`.type-meta`) only |
| `--font-sans`, `--font-mono` | the system stacks below, unchanged | none | the interface until a component takes a role; the map's labels, the credits line and the planner's measurement (`--font-mono`) |

Newsreader's optical size (2026-10-12, with the entry pages): the owner's article and poem boards set the headline (132 px, 700) and the poem's title (128 px, 200 italic) at optical size 72, whose forms are finer, tighter and higher in contrast than the text cut (18) of the plain `wght` files. The two files that carry `opsz` replace the two `wght` ones: 132 000 and 146 872 bytes against 58 084 and 64 520, so an entry page that draws both the roman and the italic asks for 156 kB more (woff2, cached `immutable` for a year, not preloaded, requested only where a glyph is drawn). `font-optical-sizing: auto` (in every role) maps the font size in px to the axis, so no `font-variation-settings` is needed: 40 px asks for 40, anything above 72 px gets 72. The fallback faces are unchanged (same hhea metrics; the display cut is a little narrower than the text cut the `size-adjust` was measured on, a few percent at 130 px).

Why the optical-size file: the plain `wght` file of Bricolage is frozen at its text cut (opsz 14). At display sizes the font's own display cut (opsz 96) is about 10 % narrower with finer joints and higher contrast: it is the cut the wordmark is designed in, and `font-optical-sizing: auto` picks it by itself as the size grows. The file is 36 kB larger than the `wght` one and replaces it (one display file, not two). Only this file is preloaded, and only on the home page (`routes/home.tsx`). The reading and metadata files load only where a glyph of them is drawn.

Fallback faces (`"Bricolage Grotesque Fallback"` on Arial / Arial Bold, `"Newsreader Fallback"` on Georgia / Georgia Bold / Georgia Italic): `size-adjust` from the frequency-weighted average advance of English text measured in Chrome at the weights each face stands for (Arial 99 %, Georgia 95.3 % roman, 87 % bold, 86 % italic), `ascent-override` and `descent-override` from the font's hhea metrics over its em divided by `size-adjust`, `line-gap-override` 0. Text set in the fallback has the real face's width and line box to within a few percent, so the swap moves little. JetBrains Mono has none on purpose: every system monospace is 0.6 em wide like it, and the `--font-mono` stack that follows it already is that.

System stacks (unchanged):

- Sans: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- Mono (labels, small caps): `ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`

Weights (`--weight-*`): `thin` 200 and `heavy` 800 are the display pair (the given name 800 against the family name 200: "Elliot" / "Négrel-Jerzy"); `light` 300 (standfirst, pull quote, third-level heading), `reading` 400, `medium` 500, `semibold` 600, `bold` 700. Tailwind's own `font-extralight` (200) and `font-extrabold` (800) are the same numbers.

Roles. A class sets a whole role; `text-<role>` plus `font-display | font-reading | font-meta` does the same in utilities (the `--text-<role>--line-height`, `--letter-spacing` and `--font-weight` are Tailwind's theme keys, so `text-display-xl` carries them).

| Role | Class | Size | Leading | Tracking | Weight | Wrap, features |
| --- | --- | --- | --- | --- | --- | --- |
| `display-xl` (the name) | `.type-display-xl` | `clamp(3.5rem, 11vw, 10rem)`: 56 px on a phone, 158 px at 1440 px | 0.88 | -0.045em | 800 | `balance`, optical sizing auto, no synthesis |
| `display-lg` (an entry's headline) | `.type-display-lg` | `clamp(2.25rem, 1.35rem + 3.7vw, 4.5rem)`: 36 to 72 px | 0.98 | -0.035em | 800 | same |
| `display-md` (a card title, a section) | `.type-display-md` | `clamp(1.625rem, 1.2rem + 1.4vw, 2.25rem)`: 26 to 36 px | 1.06 | -0.025em | 700 | same |
| `standfirst` | `.type-standfirst` | `clamp(1.5rem, 1.25rem + 0.9vw, 1.9rem)`: 24 to 30 px, reading face italic | 1.3 | -0.01em | 300 | `balance` |
| `reading` | `.type-reading` | `clamp(1.125rem, 1.07rem + 0.25vw, 1.25rem)`: 18 to 20 px | 1.65 | 0 | 400 | `pretty`, proportional figures; column `--measure-reading` |
| `meta` | `.type-meta` | 12 px, mono | 16 px | 0.1em | 500 | uppercase, tabular figures, ligatures off |

Modifier: `.type-thin` puts a run of a display heading at the thin end of the weight axis (`Elliot <span class="type-thin">Négrel-Jerzy</span>`: the heading's own weight is the heavy end). `.type-link` underlines in the accent (`.ds-prose` links do the same). `.drop-cap` sets the first letter of a paragraph as a float exactly N lines of the body tall (N = `--dc-n`: 3, 2 in a container under 30 rem), Newsreader 700 at optical size 72 in the ink, computed from the face's measured metrics (ascent 0.735 em, descent 0.265, body cap height 0.672 em, the letter's cap height 0.715 em; `--dc-k` = ((N - 1) x line height + 0.672) / 0.715 body ems, 5.28 em at N = 3 and 1.55 leading; the glyph is put on the baseline of line N by the padding above it, the float's `line-height` is N lines minus that padding, margin-right 0.1 em, margin-bottom -1 px); `[data-drop-cap="accent"]` pads the paragraph for a mark above a capital; `--reading-lh` is the body's leading as a number (set by `.ds-prose`, 1.55 in an entry). A float and not `initial-letter`: measured in Chrome the latter stands 4 to 5 px above the first line. `.type-pullquote` is the reading face in 300 italic, `clamp(1.5rem, 0.9rem + 1.9cqi, 2.5rem)` (40 px at 1328 px) / 1.15, -0.01em, between two 1 px rules of the ink with 18 px padding; `.type-rule` and `.ds-prose hr` a 1 px rule in `--border-strong`. Entry pages add (app.css, reading section, documented in design-system.md, "Entry pages"): `.entry-title` (the headline: Newsreader 700, `--entry-title`, 0.92, -0.03em, 8.95 times `--entry-title` wide at most (the role's size, so a long title that `--title-scale` sets smaller keeps the same column); `data-poem` makes it 200 italic at `--poem-title`, 0.95), `.list-running` / `.entry-running` (the lists' running head and an entry's kicker row: mono 12 px, muted, `space-between`, one 1 px `--border-strong` rule under it; no double rule exists any more), `.list-title` (Newsreader 500, `clamp(2.5rem, 6.4cqi, 5.75rem)`, 1, -0.025em), `.list-filter` (2 rem under the title), `.entry-dateline`, `.entry-margin`, `.entry-figure`, `.ds-caption` (mono 12 px / 1.6, muted: a figure's caption).

Reading measure: `--measure-reading` is 28.5 em of the reading size, 570 px at 20 px: 66 characters of running text (measured in Chrome, 1440 and 390 px wide). It is em and not `ch` on purpose: the "0" of Newsreader is 0.5 em wide against a 0.43 em average letter, so 65 `ch` would be 75 characters. Figures in Newsreader are lining: the subset ships no old-style figures (`onum` is absent from the file), so `font-variant-numeric` only asks for proportional ones.

`.ds-prose` (the entry body) is now the reading face at the `reading` role, headings in the display face (h2 800, h3 and h4 300), blockquotes in light italic, rules hairline. Component utilities (`font-semibold`, `text-2xl`) still win over it where the markup sets them.

Older steps (system sans, still used by the interface):

- `.label`: sans, `text-sm`, sentence case, muted color (the places list's group names and regions). `.ds-meta`: mono 13 / 20, tabular, muted, untracked (dates, coordinates). `.ds-micro`: mono 11 / 16, uppercase, 0.12em (a short code or key cap only).
- `.map-label` (the names of the map's detection boxes, `app.css`; two lines, the name and a second line with the country or number of places and the linked entries): the mono stack; the name 14 px weight 500, the second line 11 px weight 400, 0.01 / 0.02em tracking, line heights 18 / 14 px, 6 x 3 px plate padding (`LABEL_TYPE` in `app/globe/engine/label-text.ts`, which the layout also measures with), which HANGS OUTSIDE the box's edge while the label is not selected (`LABEL_TYPE.bleed` 6 px, `bleedY` 3 px) so that the TEXT is flush with the box's edge, and is inside the card when selected (the label moves by that much with a 120 ms `translate` transition, `--map-label-dx` / `--map-label-dy`); 3 px plus one art cell (2.5 px, 2 px on a phone) between a label and its box's projected rectangle, and the plate follows that rectangle smoothly, to the sub-pixel (not on the map's cell lattice: the drawn box steps by cells, the label does not). EVERY label has a TRANSLUCENT `--background` plate: `--label-plate-alpha` of it (0.86 light, 0.8 dark, a chosen value since 2026-10-13, owner: "not opaque enough"; the WCAG floor, the least that keeps the 11 px second line AA, 4.5:1, over the loudest map tone, a box's outline at rest, is 0.70 / 0.62 and stays computed and pinned: `LABEL_PLATE_FLOOR` in `engine/label-plate.ts`, recomputed in `readability.test.ts`, which also requires the token to be 0.12 or more above it and at most 0.9; the second line is 5.7:1 light / 6.2:1 dark over that tone, the name 16:1 / 14:1), with a 1 to 2 px feather (`box-shadow: 0 0 2px 1px` of the plate's own colour; no halo element); the name is `--foreground`, the second line `--muted-foreground` (6.8:1 light, 7.9:1 dark on the page; AA on the plate by construction); no underline, no text-shadow, no opacity; hovered: unchanged; selected: `--foreground` plate with `--background` text (inverted), the second line `color-mix(--background 72%, --foreground)` (10:1 light, 7.9:1 dark), opaque, no feather; a label drawn over another (the last resort) and reduced transparency: opaque. `docs/web-architecture.md`, "Labels in device pixels".

| Step | Size / line height | Use |
| --- | --- | --- |
| `text-xs` | 12 / 18 px | small mono labels (a code block's language) |
| `text-sm` | 14 / 22 px | secondary text, nav, buttons, captions, tags |
| `text-base` | 16 / 26.4 px | body |
| `text-lg` | 18 / 28 px | summaries |
| `text-xl` | 22 / 30 px | card titles |
| `text-2xl` | 28 / 34 px | panel headings |
| `text-3xl` | 36 / 40 px | page headings |
| `text-4xl` | 48 / 52 px | full-screen entry title |
| `text-micro` | 11 / 16 px | short codes (mono, uppercase, 0.12em: `.ds-micro`), the floor for any text |

## Reading surface

The entry pages and the four lists use the page's own colour in both schemes: **no paper tone** (2026-10-14, owner: the milky cream of the earlier "Article on paper" board was jarring against an editorial, black and white, LCD-adjacent system; until then they sat on `#efeadf` / `#0b0c0f` with a warm ivory ink). Six tokens remain, in the four copies of the scheme blocks (root, dark media rule, both forced rules), so that the reading surface can differ from the page again without touching a component; today each equals the page token it is bound to, and `contrast-audit.test.ts` ("neutral palette") fails on any warm cast in a grey and on a paper that is not the page's colour:

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--paper` | `#fbfbfb` | `#0a0a0a` | the page of an entry or a list (equal to `--background`) |
| `--paper-foreground` | `#0a0a0a` | `#f5f5f5` | ink: text and the rules (equal to `--foreground`) |
| `--paper-muted` | `#595959` | `#a3a3a3` | secondary text and the mono marginalia (6.8:1 / 7.9:1) |
| `--paper-hover` | `#ececec` | `#1f1f1f` | the hover grey (rows, contents links) |
| `--paper-signal` | `#0076d4` | `#0076d4` | the accent as large text and marks |
| `--paper-signal-text` | `#0067b8` | `#0a93ff` | the accent as text under 24 px |

They are bound, not used by name: for an entry's panel (`[data-panel]:has([data-surface="reading"])`), for the root of a list page (`:root:has(main[data-surface="reading"])`) and for one element (`[data-reading-surface]`, the styleguide), `--background`, `--surface`, `--foreground`, `--muted-foreground`, `--accent`, `--border`, `--border-strong`, `--ring`, `--signal`, `--signal-text` and `--primary` take these values, so every component inside follows (the navigation's scrim, the focus ring, the buttons). The rule is unlayered on purpose: the root rule of the page tokens is, and an unlayered rule beats a layered one. The map, the place panel and the home page keep the page colours. `design-system.test.ts` ("reading surface") and `contrast-audit.test.ts` test the pairs in both schemes.

## Palettes

Four hues for graphics, added 2026-10-14 (owner brief): **BSoD Blue** (the owner's handle; the accent's own family and the default), **Rainforest Green** (the Amazon trips), **Desert Ocre** (the Sahara and the Atacama) and **Violet Purple** (Toulouse's flower). Values and checks only here; where to use them is in [design-system.md](design-system.md), "Palettes". Source: `app.css` (`--palette-*`), tests: `lib/palette.test.ts` (the scale, the roles, colour-vision separation), `lib/contrast-audit.test.ts` ("the four palettes"), live: `/dev/design`, section 15.

**One lightness ladder.** Ten steps, 50 to 900, and the same OKLCH lightness at each step in every hue (50 .975, 100 .95, 200 .905, 300 .84, 400 .755, 500 .656, 600 .563, 700 .51, 800 .43, 900 .35), so a hue can stand where another does without a new contrast check. Chroma is tuned per hue (it follows the same bell along the ladder, scaled to what each hue can reach in sRGB: blue .17, violet .17, green .135, ocre .12 at 600). Hue angles (OKLCH): blue 252, green 150, ocre 78, violet 312. The blue's 500, 600 and 700 are the accent's existing values (`#0a93ff` the dark scheme's text tone, `#0076d4` the fill, `#0067b8` the light scheme's text tone), the rest of the ladder was derived from them. One deliberate deviation: green's 600 is .548, not .563, because at .563 white text on it is 4.33:1 (blue's anchor gives 4.62); at .548 it is 4.60:1. The test allows .02 for that one step and .01 elsewhere. Considered and set aside: a fully equal ladder with the near-black as green's on-colour (breaks interchangeability), and violet at hue 295 (a truer blue-violet, but 1.5 against blue under deuteranopia; 312 gives 4.6, still the weak pair: see below).

| Step | OKLCH L | BSoD Blue | Rainforest Green | Desert Ocre | Violet Purple |
| --- | --- | --- | --- | --- | --- |
| 50 | 0.975 | `#f1f8ff` | `#f1faf2` | `#fbf6ee` | `#faf4ff` |
| 100 | 0.95 | `#e3f0ff` | `#e2f4e5` | `#f8eddd` | `#f6e9ff` |
| 200 | 0.905 | `#cae2ff` | `#c7eacd` | `#f2dcbd` | `#eed4ff` |
| 300 | 0.84 | `#a4cfff` | `#a4daae` | `#e6c594` | `#e2b7fd` |
| 400 | 0.755 | `#70b4ff` | `#7ac38a` | `#d2a865` | `#cd94ef` |
| 500 | 0.656 | `#0a93ff` | `#3ea95e` | `#bd8514` | `#b769e2` |
| 600 | 0.563 | `#0076d4` | `#238644` | `#9a6b01` | `#9651bc` |
| 700 | 0.51 | `#0067b8` | `#23793e` | `#875d01` | `#8346a4` |
| 800 | 0.43 | `#005093` | `#1a5f30` | `#6a4801` | `#673682` |
| 900 | 0.35 | `#073b6b` | `#154623` | `#4e3505` | `#4b285f` |

**Names.** The shadcn contract's `--accent` is the hover grey in this repo (and `--accent-foreground`), so the owner's "`--accent` = blue" could not be taken without turning every hover row blue; the blue accent is `--signal` (and `--palette-blue` is the same fill). No `--accent-2..4` exist: the other hues are `--palette-green`, `--palette-ocre` and `--palette-violet`.

**Tokens.** `--palette-<hue>-<step>` is the scale (same in both schemes; `<hue>` is `blue`, `green`, `ocre`, `violet`). The roles pick the step per scheme and are what a component uses:

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--palette-<hue>` | 600 | 600 | the fill, a mark, a bar, a swatch; 3:1 or more as a graphic on the page, the surface and the cover's ground |
| `--palette-<hue>-on` | `#ffffff` | `#ffffff` | text on the fill (4.6:1 or more on all four) |
| `--palette-<hue>-text` | 700 | 500 | the hue as text of any size on the page, the surface, the hover grey and its own tint (4.5:1 or more) |
| `--palette-<hue>-tint` | 600 mixed 10 % into `#fbfbfb` | 600 mixed 16 % into `#0a0a0a` | a plate behind text: a SOLID colour, never an alpha (green `#e5efe9` / `#0e1e13`, ocre `#f1ede2` / `#211a09`, violet `#f1eaf5` / `#201526`, blue `#e2eef7` / `#081b2a`); the ink is 15.8:1 or more on it |
| `--palette-white`, `--palette-black` | `#ffffff`, `#0a0a0a` | same | the on-colour of any step: near-black on 50 to 500, white on 600 to 900 (4.5:1 or more on every step of every hue) |

Tailwind: `bg-palette-green`, `text-palette-green-text`, `bg-palette-green-tint`, `text-palette-green-on` and the same for the other three. The tint is a literal hex computed from the page colour of its scheme (a test recomputes it), so inside an inverted frame, which rebinds the page tokens, a tint stays the one of the page's scheme: do not nest a tint in an inverted frame.

**Dark scheme is not an inversion.** The fill does not move (600 in both: the same hue at the same weight, white text on it, 3.3:1 or more on the near-black page for violet, the weakest), the text tone moves from the deep 700 to the bright 500 (not to 300: the ladder's light end is for tints), and the tint is a stronger 16 % mix because 10 % of a mid colour disappears into near-black. Same logic as the accent's: `--signal` is one fill, `--signal-text` is deeper in light and lighter in dark.

**Contrast** (the page `#fbfbfb`/`#0a0a0a`, the surface `#f4f4f4`/`#121212`, the hover grey and a cover's ground `#ececec`/`#1f1f1f`; the same pairs are in `contrast-audit.test.ts`):

| Pair | Scheme | blue | green | ocre | violet |
| --- | --- | --- | --- | --- | --- |
| Fill on the page (graphic, 3:1) | light | 4.5 | 4.4 | 4.5 | 4.8 |
| | dark | 4.3 | 4.3 | 4.2 | 4.0 |
| Fill on the surface | light | 4.2 | 4.2 | 4.3 | 4.5 |
| | dark | 4.1 | 4.1 | 4.0 | 3.7 |
| Fill on the hover grey / a cover's ground | light | 3.9 | 3.9 | 4.0 | 4.2 |
| | dark | 3.6 | 3.6 | 3.5 | 3.3 |
| White on the fill (text, 4.5:1) | both | 4.6 | 4.6 | 4.7 | 5.0 |
| Text tone on the page | light | 5.6 | 5.2 | 5.6 | 6.0 |
| | dark | 6.3 | 6.6 | 6.2 | 5.8 |
| Text tone on the surface | light | 5.3 | 4.9 | 5.3 | 5.7 |
| | dark | 5.9 | 6.3 | 5.8 | 5.5 |
| Text tone on the hover grey | light | 4.9 | 4.6 | 4.9 | 5.3 |
| | dark | 5.2 | 5.5 | 5.1 | 4.8 |
| Text tone on its tint | light | 4.9 | 4.6 | 5.0 | 5.3 |
| | dark | 5.5 | 5.8 | 5.4 | 5.1 |
| Ink on its tint (body text, 7:1) | light | 16.8 | 16.8 | 16.9 | 16.8 |
| | dark | 16.0 | 15.9 | 15.8 | 16.1 |

**Colour-vision deficiency.** The four 600 fills, simulated (Machado, Oliveira, Fernandes 2009, severity 1.0, in linear sRGB) and compared with CIEDE2000 (about 2.3 is a just-noticeable difference, 10 or more reads as a different colour at a glance):

| Pair | Normal | Protanopia | Deuteranopia | Tritanopia |
| --- | --- | --- | --- | --- |
| blue / green | 48.2 | 48.5 | 46.1 | **11.7** |
| blue / ocre | 52.1 | 54.7 | 57.3 | 54.7 |
| blue / violet | 27.8 | **7.3** | **4.6** | 46.3 |
| green / ocre | 34.6 | **8.1** | 11.2 | 48.0 |
| green / violet | 48.6 | 48.0 | 41.5 | 44.4 |
| ocre / violet | 55.7 | 53.5 | 52.1 | **14.8** |

**Path trails** use the ladder too (the tail, head, lit and spark steps per scheme, the contrast table and the by-route assignment are in [paths.md](paths.md), "Trails"); `--trail-from` / `--trail-to` are the gradient's two ends (blue 500 to violet 700 in light, to violet 400 in dark).

The weak pairs are blue / violet (red-green deficiencies fold a blue and a purple together) and green / ocre (they fold both to a yellowish olive); blue / green is weak only under the rare tritanopia. Pairing rules: (1) hue is never the only carrier: a mark, a chart series or a tag set in a palette also has a shape, a position, a label or a word; (2) when blue and violet, or green and ocre, appear together in one graphic, separate them on the ladder by 300 or more of the step number as well (blue 700 with violet 400: 28 / 20 under deuteranopia / protanopia; green 700 with ocre 300: 33 / 28), not 600 against 600; (3) blue with ocre and green or ocre with violet are the safe adjacent pairs; (4) do not put more than two palettes in one small graphic. The test pins rules 1 and 2 (the 600/600 weakness and the repair).

## Contrast audit

Two automatic checks, run before a palette change ships.

1. **Tokens** (`app/lib/contrast-audit.test.ts`, in `pnpm test`). A table of every foreground / background pair the interface draws, evaluated in both schemes and in the three contexts that rebind the tokens (the page, the reading surface, an inverted frame), plus print: body text 7:1 on the page, the surface and the hover grey; secondary text, the accent as text, a link, a hovered tag or nav item, the key hint, a primary button's label at rest, hovered and pressed, a signal fill's label, the selected label, a disabled label 4.5:1; large display accent text, marks, the primary fill and its hover as shapes, the focus ring and a control's edge 3:1; the signal wash plate; no warm cast in any grey.
2. **Rendered pages** (`apps/web/scripts/contrast/audit.mjs`, a browser, DEMO content). Every route kind (the home page, the place panel, the four lists and a filtered one, an entry of each kind in the panel and full screen, a short note, an archived project, a mature artwork, a poem in French, the 404 pages, the 500 page, the search palette with and without a query and with no result, the credits dialog, the styleguide) in both schemes at 1440 x 900 and 390 x 844. Each element that owns text is scrolled into view; its glyphs are compared with what is really drawn behind THEM (the page is screenshot with and without the text colours, and only the pixels the glyphs changed are compared, so a scrim, a label plate, a gradient, the globe's lines or a hover fill are in the number). Every control (two of each look) is measured at hover, with keyboard focus (forced `:focus-visible`: the ring is checked at 3:1 against what is around it, or a change of look is required) and pressed. Icon-only controls are held to 3:1. Hidden, covered, inert and visually hidden text is skipped and counted; disabled controls are measured but exempt. `CHROME_PATH=... BASE_URL=http://localhost:5463 OUT_DIR=/tmp/contrast node scripts/contrast/audit.mjs` (`--page`, `--scheme`, `--vp` narrow it), exit code 1 on any failure, the full table in `OUT_DIR/contrast-audit.json`.

Results, 2026-10-14 (demo content, Chrome, both schemes, 1440 x 900 and 390 x 844): 27 pages x 4 = 108 loads, 10 418 measures (7 492 texts under 24 px, lowest 4.59:1; 1 498 large texts and icons, lowest 3.74:1; 1 420 focus rings, lowest 3.63:1; hover, focus and pressed states of every control, lowest 4.12:1), 0 failures; 6 044 hidden, covered or inert elements skipped. Before (main's look, same script): the "Open host" bar's label 3.24:1 at rest and 1.63:1 pressed (muted mono text from the marginalia's link rule on the black fill), focus rings 1.0 to 2.7:1 over an image, a coast line or the scrim, the hero row's hovered accent text 2.0:1 over a map line, the heading anchors on touch 2.4:1, the header's hovered items 3.3:1 over a dark picture under the scrim, the palette field and the search triggers with no focus indicator beyond the caret.

Pairs changed: the primary button (ink on page, 19:1, became white on `#0076d4`, 4.62:1; hover `#006cc2`, pressed `#0064b2`); `--border-strong` (light 2.8:1 to 3.3:1); the "Open host" bar's label (3.24:1 to 4.62:1); focus ring (ink to the accent's text tone, on a 5 px page-colour moat, so 3:1 or more over any picture); the hovered tag, filter and header item (ink or muted to `--signal-text`); the nav scrim over a header's text (77% to 92% or more); the hero row's hover (a 90% plate of the page colour under it); the heading anchor on touch (opacity .55 to .75); the focused segmented button and the mobile panel's header row now stack above what overlaps their ring. Not made AA: none. Not measured: Safari and iOS (no `color-mix`/`:has()` fallback was needed in Chrome; WebKit untested), forced colours (separate: system colours), the WebGL globe's own pixels beyond what lies under HTML text.

## Spacing

Tailwind's default 4px scale (`--spacing: 0.25rem`). Page gutters are 12 to 16px (navbar) and 24px (panel,
content pages). Content pages use a `max-w-2xl` reading column. Touch targets: interactive elements are
`min-h-11` (44px) on viewports below `md`.

Layout variables:

| Token | Value |
| --- | --- |
| `--navbar-height` | `3.5rem` |
| `--scrim-height` | `calc(var(--navbar-height) + 2.5rem)` (the page and panel scrim) |
| `--fade-height` | `calc(var(--navbar-height) + 3.5rem)` (the row's own fade over the globe, `.nav-fade`) |
| `--list-width` | `18rem` (the places list when revealed by keyboard focus) |
| `--panel-pad`, `--grid-gap` | `1.5rem`, `1rem` (panel padding; the 12-column grid's gutter) |
| `--control-h`, `--control-h-sm` | `2.75rem` below md (44 px touch rule); `2.25rem` / `2rem` from md |
| `--hairline`, `--tick-step` | `1px`, `8px` (frames and lines; the tick scale of the styleguide's dividers) |
| `--icon-inline` | `1.1em` (an icon beside text: the text's own size; docs/design-system.md, "Icons") |
| `--icon-control` | `1.25rem` (an icon in a control or at the head of a row) |
| `--icon-large` | `1.5rem` (an icon on its own) |
| `--icon-stroke` | `1.75` (the icon stroke in the library's 24-unit grid, square ends and joins, every size) |

The desktop detail panel is `50vw` wide (`md:w-1/2`, from 768px) and full height; there is no panel width token.

## Radii

All three are `0` (2026-10-08): square edges are the system. The names stay so shadcn-style classes (`rounded-md`) and the map card's `rounded-sm` resolve to square; do not add a non-zero radius (`design-system.test.ts` scans `components/ui`).

## Motion

| Token | CSS | `motion/react` (s) | Use |
| --- | --- | --- | --- |
| `--duration-fast` | 120ms | `duration.fast` = 0.12 | hover/focus color changes |
| `--duration-base` | 220ms | `duration.base` = 0.22 | mobile slide-over |
| `--duration-slow` | 360ms | `duration.slow` = 0.36 | desktop panel slide and the globe's re-centring (`TUNING.insetMs`) |
| `--ease-standard` | `cubic-bezier(.2, 0, 0, 1)` | `easeStandard` | everything |
| `--duration-scan` | 1600ms | not mirrored | the loading skeleton's ambient sweep (off under reduced motion; not a state change) |

The seconds values live in `apps/web/app/lib/tokens.ts`; `tokens.test.ts` fails if they drift from the CSS, and if the globe's re-centring duration and easing drift from `--duration-slow` and `--ease-standard`.

Reduced motion (`prefers-reduced-motion: reduce`): the panel has no initial/exit state (instant), the globe jumps to its new centre, the global CSS
reduces all transitions/animations to ~0, `MotionConfig reducedMotion="user"` disables transform animations,
and the globe receives `reducedMotion: true`.

## Nav scrim

The navbar is fully transparent (no box, border or blur of its own). To keep its text readable over scrolling content,
a scrim dims whatever passes beneath it. It is `.nav-scrim` in `app.css`, rendered by `NavScrim`
(`components/nav-scrim.tsx`).

- Geometry: `position: fixed`, top and full width, height `--scrim-height` (navbar height + 2.5rem = 96px),
  `pointer-events: none`, `aria-hidden`, z-index 35 (content and panel 30, navbar 40).
- Colour: a 14-stop `linear-gradient` from `--background` at 97% alpha (92% or more up to a third of the height, where the header's text sits: a hovered, accent-coloured item stays 4.5:1 over a dark picture scrolling under it; it was 96% falling to 77% there until 2026-10-14) to transparent, with stops eased roughly like a
  smoothstep so there is no visible start or end line. The stops use `color-mix(in srgb, var(--background) N%,
  transparent)`, so it follows light and dark with no extra tokens.
- Blur: three child `<span>`s, each a `backdrop-filter: blur()` (1.5px, 4px, 9px) masked by its own `mask-image`
  gradient to a shorter strip (55%, 75% and 50% of the height). The blurs add up, so blur is strongest at the top and
  tapers to nothing: a progressive blur without a hard edge.
- `prefers-reduced-transparency: reduce`: the spans are hidden and the gradient stays opaque longer (solid for the
  first half, then fading), so the text stays readable without any blur.
- Where it applies: every route except the globe screen (`/`, `/locations/:slug` and the entries beside it), where the page colour is
  the ocean and a band the width of the screen would dim the map for nothing: there the row has its own fade (below). The open desktop
  detail panel has an `absolute` copy scoped to the panel (the panel is its own backdrop root), which covers only the panel's width. The
  panel's scroll area starts `navbar-height + 1rem` from the top so its first line is not dimmed at rest.

## Nav fade

The row of the navigation over the globe and the map (`.nav-fade` in `app.css`, a `span` inside the `<nav>`, `aria-hidden`).

- Geometry: `position: absolute` behind the links (`z-index: -1` inside the header's stacking context), `top: 0`, 6 rem wider than the
  row on each side, height `--fade-height` (navbar height + 3.5rem = 112 px; the row itself is 56 px), `pointer-events: none`.
- Colour: the page colour (`--background`) through `color-mix` at 85 % from 0 to 20 % of the height (the row's text is centred at
  25 %: it sits on 83 % or more, the `readability.test.ts` figure for nav links is 80 %), then a smoothstep fall through 81, 72, 58, 43,
  27, 13, 4 % to transparent at 100 %. Both schemes follow with no token of their own.
- Horizontal: a `mask-image` with the same easing over the first and last 6 rem, so the band melts into the map on either side. The
  fade has no `backdrop-filter` (and so no backdrop-root problem with the mask): the gradient alone keeps the text readable and costs no
  extra layer over the WebGL canvas.
- `prefers-reduced-transparency: reduce`: solid page colour for 40 %, then the fall (nothing is translucent that was not before).
  `forced-colors: active`: `Canvas` to transparent. Print: hidden with the header.
- Not rendered in the full-screen entry view (the panel's scrim covers the viewport there) and on the pages that have the page scrim.

- Content pages start `navbar-height + 3rem` from the top; `:target` scroll margins use `navbar-height + 1.5rem`.
- Tuning knobs for the owner: `--scrim-height`, the stop list, and the three blur radii and mask ends.
