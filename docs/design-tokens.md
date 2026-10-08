# Design tokens

The UI system built on these tokens (frames, micro-labels, kind coding, components) is in [design-system.md](design-system.md); this file keeps the values.

Source of truth: `apps/web/app/app.css`. Colors, radii, motion and layout are CSS variables on `:root`;
Tailwind 4 reads them through `@theme` / `@theme inline`. Light and dark follow `prefers-color-scheme`
(no toggle for visitors; `[data-scheme="light"|"dark"]` forces a scheme on a subtree and is set only by the dev styleguide). Names match shadcn/ui's contract so selectively added components work unchanged.

Principles: monochrome with one accent, generous spacing, clear hierarchy. System fonts only (no remote font requests).
The navbar has no surface of its own: it floats over the page and a gradient scrim keeps it readable (see "Nav scrim").

## Color

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--background` | `#fbfbfb` | `#0a0a0a` | page |
| `--foreground` | `#0a0a0a` | `#f5f5f5` | text, primary fill |
| `--accent` | `#ececec` | `#1f1f1f` | hover and selected rows |
| `--muted-foreground` | `#595959` | `#a3a3a3` | secondary text (AA: 6.8:1 light, 7.9:1 dark) |
| `--subtle-foreground` | `#6f6f6f` | `#8a8a8a` | the map's credits line: dimmer than muted text by COLOUR (4.9:1 light, 5.7:1 dark against the page; muted is 6.8 / 7.9), never by opacity; hover and keyboard focus raise it to `--foreground` |
| `--border` | `rgb(0 0 0 / .14)` | `rgb(255 255 255 / .16)` | hairlines |
| `--border-strong` | `rgb(0 0 0 / .4)` | `rgb(255 255 255 / .45)` | outlined buttons (not the credits dialog, which uses `--border`) |
| `--ring` | `#0a0a0a` | `#f5f5f5` | focus ring (2px outline, 2px offset, all focusable elements) |
| `--primary` / `--primary-foreground` | `#0a0a0a` / `#fbfbfb` | `#f5f5f5` / `#0a0a0a` | default button |
| `--globe-grid`, `--globe-limb` | `rgb(0 0 0 / .12)`, `rgb(0 0 0 / .3)` | `rgb(255 255 255 / .14)`, `rgb(255 255 255 / .34)` | no longer read by the map: the graticule is the palette's `faint` level (level 3) and the horizon outline is one level fainter (level 2, `outlineLevel` in `engine/colors.ts`: 1.24:1 light, 1.21:1 dark against the page; it was `soft` until 2026-10-07 and `faint` until 2026-10-08, when the owner found the globe's ring still too visible; floor 1.2:1, `colors.test.ts`); the tokens remain for any other use |

### Map palette

The globe and the street map draw with one grey palette derived from `--background` and `--foreground` only (OKLab interpolation, `app/globe/engine/palette.ts`, `PALETTE_LEVELS` = 12 levels: page colour, 10 map greys, full ink). The map greys (levels 1 to 9) only reach `MAP_CONTRAST` (0.40 light, 0.42 dark; it was 0.55 / 0.58 until 2026-10-08, when the owner asked to wash the map out so the boxes and labels stand out) of the way to the ink, so everything the map draws is recessive: the loudest map tone (`coast`: coastlines, country borders, the water's edge) is 3.1:1 / 3.2:1 against the page (was 5.2:1 / 5.5:1, floor 1.5:1), the roads are below it (motorways level 7, primary 6, secondary 5, tertiary 3, the decor 2 and 1: 2.1:1 at the loudest, 1.42:1 for tertiary, the faint end untouched at 1.10 / 1.24 / 1.42 light, see `docs/street-architecture.md`, "Road hierarchy"), so a box at rest dominates the map. One level above the coast, `peak` (level 10) is the box at rest and keeps its old tone, `BOX_CONTRAST` (0.55 / 0.58: 5.2:1 / 5.5:1, 1.7 times the coast's contrast), so the box stays the loudest of the greys by a wide margin. The full ink (`ink`, 19:1 / 18:1) is kept for the hovered, focused or selected detection box and for the route; a box at rest is the `peak` level (above the coast); the LABELS are HTML text in the page's `--foreground` in every state, see "Typography" (the pixel label tones, `textFloorLevel` in `palette.ts`, remain for pixel text that is part of the map), see `docs/web-architecture.md`, "Detection boxes". Named roles: `wash` (building fills), `faint` (graticule; the globe's horizon outline is the level below it), `soft` (rail, paths, horizon, the dots of parks and dashes of water), `mid` (region borders, building outlines), `strong` (rivers, lakes), `coast` (coast, country borders, the water's edge: the loudest the map gets), `peak` (the box at rest), `ink`. Contrast against the page per level at 12 levels, light / dark: 1.10 / 1.08, 1.24 / 1.20, 1.42 / 1.39, 1.48 / 1.45, 1.61 / 1.58, 1.81 / 1.79, 2.10 / 2.10, 2.52 / 2.55, `coast` 3.12 / 3.18, `peak` 5.23 / 5.51, `ink` 19.1 / 18.2. A token change reaches both renderers with no code change, light and dark; `app/globe/engine/readability.test.ts` recomputes the contrast of labels, markers, attribution and nav over the map from the tokens. Spec and comparison: `docs/pixel-line-rules.md` section 7 and `docs/palette/`.

The globe's ocean has no token of its own: it is `--background` (the disc and the clear colour are exactly the page colour, so the canvas never shows a seam). The detail panel uses `--background` at 85% with a backdrop blur.

UI-system additions (2026-10-08, values and use in design-system.md): `--surface` (`#f4f4f4` / `#121212`, the panel plate), `--line-faint` (grid and tick texture), the one accent `--signal` (`#00698c` / `#38d4f5`, 5.6:1 and 10.6:1 on the surface) with `--signal-foreground` and `--signal-wash`, the `--inverse-*` set (an inverted frame's rebinding), and a faint hue per kind (`--kind-article|project|artwork|poem|place`, decorative only). `design-system.test.ts` keeps the four copies of the colour list (light, dark, and the two forced-scheme rules) identical and asserts the AA pairs.

Tailwind utilities: `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-accent`, etc.
The map and the globe stay monochrome: the accent `--signal` and the kind hues are for the data-display UI only, and there is no destructive color on purpose (an error is the word ERROR in a bracket and an inverted tag).

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

Light scheme: kept (dark specks of 11 and 24 levels below the page colour on 251), because at those values it reads as the same barely-there haze as the dark one and the stipple does not compete with the boxes; `?no-sky` is the off switch.

### Map card and credits line

`MAP_CARD` (`app/lib/map-card.ts`) is the small card that sits over the map: `rounded-sm border border-border bg-background/80 px-1.5 py-0.5 font-mono text-[10px] leading-4 tracking-wide backdrop-blur-sm`. Two things use it, so they match: the dev-only content badge (`PREVIEW local data not published`, bottom left, muted text, above the credits on phones) and the credits line. A test (`components/map-card.test.ts`) fails if either drops a class of it. Colour is not part of it.

`AttributionButton` (`components/attribution-button.tsx`) is the credits line: one line of selectable mono text with the main contributors ("© OpenStreetMap · OpenFreeMap · Natural Earth", from `core/attribution.ts`), in the dim `--subtle-foreground` at full opacity, then one more middle dot (the same separator as between the credits: "… · Natural Earth · See more ↖"; an `aria-hidden` span of the card's flex row, OUTSIDE the clipped text, so it stays beside the button when the line is clipped), then a "See more" button with a lucide `ArrowUpLeft` (`aria-hidden`), at the bottom right of the map, left of the detail panel's inset. The text is clipped, never wrapped, when the screen is narrow (last items first). The button is a `<button aria-haspopup="dialog" aria-label="See more credits">` that opens the credits dialog; it is 16 px high with an invisible `::after` that makes the touch target 44 px below `md`. Hover and keyboard focus raise the colour to `--foreground`, plus the global focus ring. The text halo of the old link (`.credits-link`) is gone: the card's plate does its job (worst case, a full-strength peak map line under a glyph, is 3.7:1 in light; `readability.test.ts`, which reads the plate from `MAP_CARD`). The credits dialog uses `--border` (the card's hairline) for its panel and its Close button, not `--border-strong`.

## Typography

- Sans: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- Mono (labels, small caps): `ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`
- `.label`: mono, `text-xs`, uppercase, `0.08em` tracking, muted color.
- `.map-label` and `.map-halo` (the names of the map's detection boxes, `app.css`; two lines, the name and a second line with the country or number of places and the linked entries): the mono stack; the name 14 px weight 500, the second line 11 px weight 400, 0.01 / 0.02em tracking, line heights 18 / 14 px, 6 x 3 px plate padding (`LABEL_TYPE` in `app/globe/engine/label-text.ts`, which the layout also measures with); 3 px between a label and its box. EVERY label has a `--background` plate with a feathered edge (`.map-halo`: a two-layer `box-shadow` of `--background`, blur 8 px / spread 3 px, in a layer below the boxes); the name is `--foreground`, the second line `--muted-foreground` (6.8:1 light, 7.9:1 dark on the plate: AA); no underline, no text-shadow, no opacity; hovered: unchanged; selected: `--foreground` plate with `--background` text (inverted), the second line `color-mix(--background 72%, --foreground)` (10:1 light, 7.9:1 dark), no feather. `docs/web-architecture.md`, "Labels in device pixels".

| Step | Size / line height | Use |
| --- | --- | --- |
| `text-xs` | 12 / 18 px | labels |
| `text-sm` | 14 / 22 px | lists, nav, buttons |
| `text-base` | 16 / 26.4 px | body |
| `text-lg` | 18 / 28 px | summaries |
| `text-xl` | 22 / 30 px | item titles |
| `text-2xl` | 28 / 34 px | panel headings |
| `text-3xl` | 36 / 40 px | page headings |
| `text-4xl` | 48 / 52 px | full-screen entry title |
| `text-micro` | 11 / 16 px | micro-labels (mono, uppercase, 0.12em: `.ds-micro`), the floor for any text |

## Spacing

Tailwind's default 4px scale (`--spacing: 0.25rem`). Page gutters are 12 to 16px (navbar) and 24px (panel,
content pages). Content pages use a `max-w-2xl` reading column. Touch targets: interactive elements are
`min-h-11` (44px) on viewports below `md`.

Layout variables:

| Token | Value |
| --- | --- |
| `--navbar-height` | `3.5rem` |
| `--scrim-height` | `calc(var(--navbar-height) + 2.5rem)` |
| `--list-width` | `18rem` (the places list when revealed by keyboard focus) |
| `--panel-pad`, `--grid-gap` | `1.5rem`, `1rem` (panel padding; the 12-column grid's gutter) |
| `--control-h`, `--control-h-sm` | `2.75rem` below md (44 px touch rule); `2.25rem` / `2rem` from md |
| `--hairline`, `--bracket-len`, `--bracket-w`, `--tick-step` | `1px`, `10px`, `1px`, `8px` (frames and tick scales) |

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
- Colour: a 14-stop `linear-gradient` from `--background` at 96% alpha to transparent, with stops eased roughly like a
  smoothstep so there is no visible start or end line. The stops use `color-mix(in srgb, var(--background) N%,
  transparent)`, so it follows light and dark with no extra tokens.
- Blur: three child `<span>`s, each a `backdrop-filter: blur()` (1.5px, 4px, 9px) masked by its own `mask-image`
  gradient to a shorter strip (55%, 75% and 50% of the height). The blurs add up, so blur is strongest at the top and
  tapers to nothing: a progressive blur without a hard edge.
- `prefers-reduced-transparency: reduce`: the spans are hidden and the gradient stays opaque longer (solid for the
  first half, then fading), so the text stays readable without any blur.
- Where it applies: every route except the globe screen (`/` and `/locations/:slug`), where the page colour is the
  ocean and dimming the map would be a defect. The open desktop detail panel has an `absolute` copy scoped to the
  panel (the panel is its own backdrop root), which covers only the panel's width. The panel's scroll area starts
  `navbar-height + 1rem` from the top so its first line is not dimmed at rest.
- Content pages start `navbar-height + 3rem` from the top; `:target` scroll margins use `navbar-height + 1.5rem`.
- Tuning knobs for the owner: `--scrim-height`, the stop list, and the three blur radii and mask ends.
