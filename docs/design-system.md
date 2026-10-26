# Design system

The UI system for the data display: the side panel and the full-screen view that show places and entries (kinds: article, project, artwork, poem, and the place itself) and the list pages. It sits on the values in [design-tokens.md](design-tokens.md) and does not touch the map, its labels or the globe canvas. Live reference: the dev-only styleguide at `/dev/design` (every token and component, both schemes, sample entries as cards and as a panel mock, the loading / empty / error states). Code: `apps/web/app/components/ui/` (React), `app/app.css` (`ds-*` classes and tokens), `app/lib/{entry-kind,labelling,cover-art,contrast}.ts` (pure logic, tested).

## Principle: a quiet personal archive

The first version of this system (2026-10-08) read the brief ("Y2K art, generative art, labellisation, square edges, Watch Dogs style") as a
HUD: corner brackets on every box, index codes, numbered sections, tracked mono labels everywhere. The owner asked for something "a bit less
AI" (2026-10-11) and the system was restrained (2026-10-12). What stayed of the brief is the square edges, the hairlines, the generative
covers and the one accent (cyan until 2026-10-12, orange until 2026-10-13, BSoD blue now); the annotation language is now used only where it carries information.

| Principle | What it means here |
| --- | --- |
| Square edges | Radius 0 everywhere (all `--radius-*` tokens are 0; a test scans the components). No pills, no soft shadows. |
| Few boxes | Spacing and a cover separate things; a hairline box is for the few things that are one (a code block, a link card, the search dialog, an error). A card has no box, a list has no chips, metadata has no inner rules, an empty state is one muted line. No corner brackets anywhere in the UI (the map's detection boxes keep their own corner arms). |
| Label only when it adds information | No decorative numbering (`01 ENTRIES`, `№ 0042`, `000 entries`), no index codes, no eyebrow that repeats the page's title, no kind on a card in a list of one kind, no "Place" on a place. A date, a place, a count, a tag say what they are. |
| Type is the voice | Display type in a very heavy weight against a very thin one, a reading serif for long text, mono for metadata (see "Type"). Interface text (buttons, filters, tags) stays sans at comfortable sizes (16 px or more, secondary 14 px), sentence case; the tracked uppercase mono micro-label is the exception, not the language. |
| One accent, for action and state | The blue `--signal` is the call to action (the primary button's fill, hovered and pressed a step deeper), the link in running text, the focus ring, the selection and the current mark of a navigation or a filter; and it marks state: the contents entry being read, the highlighted search result and its field, the active Frame, the error tag, a toggle that is on; and the marks of generated covers (blue, or one of the other three palettes by seed: "Palettes" below). Never decoration (no numerals, no rules, no labels). The text stays black and white: a page is ink on its own colour with one blue signal (2026-10-14, owner: "rather black and white" editorial and LCD-adjacent, no cream). |
| Generative art | Entries without an image get a **seeded procedural cover**: a small dithered grid in the palette plus one signal mark. Deterministic, subtle, never carrying information. |
| Clean grid | 4 px base grid; 12-column panel grid with 16 px gutters; 24 px panel padding. |

## Tokens

All in `app.css`; light and dark keep the map's near-black / near-white family. Contrast values are tested (`lib/design-system.test.ts`) and shown live on `/dev/design`.

### Colour roles

| Role | Token | Light | Dark | Notes |
| --- | --- | --- | --- | --- |
| Page | `--background` | `#fbfbfb` | `#0a0a0a` | unchanged |
| Panel plate | `--surface` | `#f4f4f4` | `#121212` | the Frame's fill: one step off the page, replaces elevation |
| Sunken / hover | `--accent` | `#ececec` | `#1f1f1f` | hover rows, cover background; muted text stays AA on it, `--subtle-foreground` does not (4.25:1): never use subtle there |
| Text | `--foreground` / `--muted-foreground` | `#0a0a0a` / `#595959` | `#f5f5f5` / `#a3a3a3` | 18:1 / 6.4:1 on the surface (light) |
| Hairline / control line | `--border` / `--border-strong` | 14 % / 44 % ink | 16 % / 45 % ink | strong is 3:1 or more (control outline); the hairline is decoration |
| Texture | `--line-faint` | 7 % ink | 9 % ink | the 16 px grid and hatch only |
| **Accent (one)** | `--signal` | `#0076d4` | `#0076d4` | BSoD blue (Windows' `#0078d7`, two steps deeper so white text on it clears AA): for large display text (24 px and up) and marks and fills, 4.2:1 on the surface (light), 4.05:1 (dark). Text under 24 px takes `--signal-text` (`#0067b8` / `#0a93ff`: 5.3:1 / 5.9:1 on the surface). Text on a fill is `--signal-foreground` (`#ffffff`, 4.6:1, both schemes). `--signal-wash` is its 8 % (light) and 12 % (dark) plate for the active Frame. |
| Kind hues | `--kind-article` 275, `-project` 150, `-artwork` 55, `-poem` 340, `-photograph` 215, `-place` (muted grey) | `oklch(.58 .10 H)` | `oklch(.76 .10 H)` | **faint and redundant** (see Kind coding) |
| Call to action | `--primary` / `--primary-foreground`, `--signal-hover`, `--signal-active` | `#0076d4` / `#ffffff`, `#006cc2`, `#0064b2` | the same | the primary button: the accent's fill, white text (4.6:1 at rest, 5.4:1 hovered, 6.1:1 pressed). The fill is a 4.3:1 shape against the dark page and 4.5:1 against the light one (hovered and pressed: 3.7 / 3.3 dark, 5.2 / 5.9 light) |
| Focus | `--ring` | `#0067b8` | `#0a93ff` | the accent's text tone, 3:1 or more on the page, the surface and the hover grey; a primary button's ring is the ink |
| Inverse set | `--inverse-background/-foreground/-muted/-border/-signal` | the dark scheme's ink on page | and vice versa | what an inverted Frame rebinds the colour tokens to (its primary fill and ring are the accent too) |

The accent is for the call to action, for links, for focus and for state, and for the generated covers' marks: the primary button (the entry's "Open host" bar and the one way out of a 404, a 500 or an unknown place), the link in running text (the underline and the text), the focus ring, the selection, the current item of the header (a 2 px underline) and the chosen filter (a 2 px rule), the contents entry being read, the highlighted search result and the palette's active field, the active Frame's edge, the card title's underline under the pointer, a toggle that is on, the error tag. It is not used for numerals, rules, labels or counts, and never for body text. Hover turns a muted tag, filter or header item to the accent's text tone. The ring is the accent's text tone (an entry's links and ring read as one family); the one exception is the primary button, whose ring is the ink (a blue ring round a blue fill reads as a halo, not a ring).

### Kind coding

Each kind has an **icon** from the icon set (article: a page of text; project: a terminal prompt; artwork: an image; poem: a feather; photograph: a camera; place: a map pin; "Icons" below) AND its word (the `project` kind's word is "Software": the contract's kind id and the section's name are separate, `lib/sections.ts`). `KindTag` draws the icon plain beside the word (no box, no tint) and is used only where kinds are mixed: the search results (glyph; the group heading says the word) and the related entries of an entry. A list of one kind, a place's entries (already grouped under "Articles", "Software") and an entry's own header do not repeat it as a tag (the entry says it once, in plain words, in its meta line). The kind hues only tint the lightest tone of a generated cover. Text is never set in a kind hue.

### Palettes

Four hues, added 2026-10-14 at the owner's request; the values, the ladder, the contrast and colour-vision numbers are in [design-tokens.md](design-tokens.md), "Palettes". The interface is still black and white with one blue: the palettes are for **graphics** (generated covers, charts and chart-like elements, marks, tags and badges, route and mode styling later, the globe's marker kinds if the owner wants it) and used sparingly in the chrome.

| Palette | Token prefix | Meant for |
| --- | --- | --- |
| **BSoD Blue** (the owner's handle) | `--palette-blue-*`, `--signal` | The default and the only one in the chrome: everything interactive or primary (the call to action, links, focus, selection, state) is this family, through the existing `--signal*` and `--primary*` tokens, which are its 500, 600 and 700. Software and tools if kinds are given hues |
| **Rainforest Green** (the Amazon trips) | `--palette-green-*` | Nature, travel, the outdoors: trips, routes, expeditions, field notes |
| **Desert Ocre** (the Sahara, the Atacama) | `--palette-ocre-*` | Land and places, deserts, warm highlights: a place's mark, a region, a "warm" accent in a graphic |
| **Violet Purple** (Toulouse's flower) | `--palette-violet-*` | Poetry, the personal, the creative, Toulouse and what is from there |

**Rules.**
- **Blue first.** Anything in the chrome that needs a colour takes blue. Green, ocre and violet do not appear on a button, a link, a focus ring, a selection or the navigation; they are not a second or third call to action.
- **Sparing.** At most one non-blue palette per view in the interface chrome (a tag, a badge, a rule or a plate), and a graphic has at most two palettes. A list of entries is not coloured by kind.
- **Never as text on text.** Colour is a plate, a mark or a fill; running text stays ink. A palette as text is for one short label (`--palette-<hue>-text`, 4.5:1 or more on the page, the surface, the hover grey and its tint), never body text, and never a coloured word on a tint of another hue.
- **Roles, not steps.** A component takes `--palette-<hue>` (the fill), `-on` (its text), `-text` (the hue as text) or `-tint` (a solid plate behind ink text); the raw steps are for graphics that need a ramp (a chart's sequential scale, a pattern). 50 to 500 are filled with the near-black `--palette-black`, 600 to 900 with `--palette-white`.
- **Solid colours.** Tones are solid mixes (a tint is a mix of the fill into the page colour), never opacity; opacity stays for fades and see-through.
- **Hue is redundant.** Same rule as the kind hues: a glyph, a word, a position or a pattern says what a colour says. Where two of green / ocre or blue / violet meet, space them on the ladder (design-tokens.md, "Palettes", pairing rules).
- **Dark.** Not an inversion: the fill is the same 600, the text tone is the bright 500 (light: the deep 700), a tint is a stronger solid mix (16 %, light 10 %). Check both schemes on `/dev/design`, section 15.
- **Print.** Palettes are not rebound: a colour that carries meaning in print must also have its word or pattern (hue is redundant, above).

**Recommended mapping (the owner's call).** The brief asks for the palettes, not for a mapping; nothing below is implemented outside the covers. A suggestion if kinds are to get a hue (as a graphic mark only, always beside the glyph and the word): software blue (the tool, the default), articles green or ocre (the long travel writing), artworks violet (the personal and creative), poetry violet or ocre (to be decided: violet is the one with a story, but artworks and poetry then share it; ocre for poetry would split them), places: ocre for land and desert places, green for forest and jungle places, blue for the rest (a place type needs a `type` field the contract does not have: place kinds would be a content decision as well as a design one). Today the four kinds' own faint hues (`--kind-*`, the tint on a cover's lightest tone) are unchanged.

**In use.** The generated cover's marks: the seed picks one of the four palettes (below). Nothing else yet; the first applications to consider are tags and badges, then a chart-like element, then the globe's marker kinds (the globe's ramp is a monochrome tonal system with the ink for markers, so a hue there needs its own readability pass).

### Type

The direction (2026-10-12): the pixel globe is the only illustrative element; everything else is type. A very heavy display weight against a very thin one (the owner's name: "Elliot" 800, "Négrel-Jerzy" 200), a reading serif for long text, mono for metadata, hairline rules, one accent. Three self-hosted families (`design-tokens.md`, "Typography": files, fallbacks, weights, the scale with its numbers) over the unchanged system stacks. Each role is a class in `app.css` (`.type-*`); a component composes them and names no family itself.

| Role | Face | Where |
| --- | --- | --- |
| `display-xl` (`.type-display-xl`) | Bricolage Grotesque 800, the family name at 200 (`.type-thin`; the given name is the heavy half), tight (0.88 leading, -0.045em), 56 to 158 px | the name on the home page (the hero sets its own size: one line taking about 72 % of the width, stacked on a phone) |
| `display-lg` | Bricolage 800, 36 to 72 px, 0.98 leading | a list's year numerals (`.type-thin`), specimens; an entry's headline is `.entry-title` (Newsreader 700, see "Entry pages") |
| `display-md` | Bricolage 700, 26 to 36 px | a card's title, a section of a list |
| `standfirst` | Newsreader italic 300, 24 to 30 px, balanced | the line under a headline |
| `reading` (`.type-reading`, `.ds-prose`) | Newsreader 400, 18 to 20 px / 1.65, 66 characters per line (`--measure-reading`), `pretty`; `.drop-cap` for the first paragraph (Newsreader 700, in the ink); links underlined in the accent; a quote is `.type-pullquote` (300 italic, 24 to 40 px, between two ink rules); headings Bricolage (h2 800, h3 300) | the body of an entry, the place's text; an entry page sets it at 18 to 21 px / 1.55 |
| `meta` (`.type-meta`) | JetBrains Mono 500, 12 px, uppercase, 0.1em | page metadata: a date, a place, a count, a reading time. Never the map's text |
| interface (existing) | system sans and mono as in the table below | buttons, filters, tags, controls, code blocks, the map and its credits |

The accent as text: `--signal` (large display text and marks) or `--signal-text` (under 24 px); see `design-tokens.md`, "Accent". Colour is never part of a role, and a role never sets a width: the reading column is `--measure-reading`.

What is still the system sans until a component takes a role (the previous table, kept as the interface's scale):

| Use | Face | Size / line | Case |
| --- | --- | --- | --- |
| Page title | sans 600, tracking tight | 36 / 40, 48 / 52 from `md` (`text-3xl`, `text-4xl`) | sentence |
| Panel title | sans 600 | 36 / 40 (a place), 28 / 34 (an entry) | sentence |
| Card title | sans 600 | 22 / 30 (`text-xl`) | sentence |
| Section heading | sans 600 | 18 / 28 (`text-lg`) | sentence |
| Body (a card's summary, a row's name) | sans | 16 / 26 | sentence |
| Secondary (meta lines, captions, tags, counts) | sans, muted | 14 / 22 | sentence |
| Date, coordinates (`.ds-meta`) | mono, tabular, slashed zero, muted | 13 / 20 | as written, untracked |
| Buttons | sans 500 | 14 / 22 | sentence |
| Short code (`.ds-micro`, `MicroLabel`): `ERR / 500`, a key cap | mono, tabular | 11 / 16, 0.12em | UPPERCASE |

Body text is never under 16 px (reading 18 px) and secondary text never under 14 px. The micro-label is for a real code or key cap, never for a title, a kind, a count or a sentence; 11 px is the floor for any text. The two uppercase mono units are `.ds-micro` and `.type-meta`; `design-system.test.ts` counts them.

### Spacing, lines, layout

- 4 px base: Tailwind's scale (`gap-1` = 4 px). Panel padding 24 px (`--panel-pad`), 16 px inside a box.
- `--hairline` 1 px for every frame, divider and control line; the optional tick scale of a divider (`--tick-step` 8 px) is for the styleguide only.
- 12-column grid, 16 px gutter (`--grid-gap`): `Grid` and `Col span spanMd`. Side panel (half the viewport, at least 440 px): one column of blocks. Full screen: reading column 8 + aside 4 (`spanMd`).
- Controls: `--control-h` 44 px below `md` (touch), 36 px from `md`; small 44 / 32 px.

### Elevation

None. No shadows. Separation is space first; where a line is needed, a hairline, the step from `--background` to `--surface`, the active Frame's wash, or an inverted Frame. The detail panel keeps its existing 85 % page colour with backdrop blur (it lets the map continue faintly beneath it); that is a panel property, not a component elevation.

### Motion

Durations are the existing tokens (`design-tokens.md`, "Motion"). Hover and focus colour changes use `--duration-fast` (120 ms); toggles, reveals and state changes `--duration-base` (220 ms); the panel slide `--duration-slow`. The map's own timed transitions (150 to 200 ms) sit between fast and base, so one product feels like one clock. Easing is always `--ease-standard`. Nothing moves on hover (no lift, no scale): only line, fill and text colour change. The loading skeleton's sweep is the one ambient loop (`--duration-scan`); under `prefers-reduced-motion` it is removed and the global rule collapses the rest to ~0.

### Focus and density

The global focus ring (2 px `--ring`, the accent's text tone, 2 px offset, square) applies to everything, on a 5 px moat of the page colour (`box-shadow`, links, buttons, summaries and `tabindex` targets; not the palette's input) so that the ring is 3:1 or more against the moat and not against a cover image, a coast line or the scrim over a picture (measured: without it a ring was 1.2:1 over a mid-grey artwork). An inverted Frame rebinds `--ring`, so it stays visible there; the primary button's ring is the ink. Cards keep one tab stop (the title link); the pointer underlines the title and `:has(:focus-visible)` draws the focus ring around the whole card. Density is one knob, `--control-h`, plus the `sm` size; there is no separate compact theme.

## Components

All in `app/components/ui/`, importable from `~/components/ui` (barrel) or by file. All are presentational and composable: they take data, not routes or loaders.

| Component | Anatomy | States / variants |
| --- | --- | --- |
| `Frame` | hairline box on `--surface`; no decoration | `variant` plain, active (strong line and a faint signal wash), inverted (opposite scheme tokens rebound for the subtree); `interactive` (hover line, focus ring), `padding` none, sm 12, md 16, lg 24; `as` element |
| `MicroLabel` | `.ds-micro` text: a short code in mono capitals | `tone` muted, strong, signal; `as` element. Rare. |
| `KindTag` | the kind's icon plain, and its word | `iconOnly` (control size; the word stays for assistive tech), `solid` (icon in the foreground). Mixed lists only. |
| `StatusTag` | one plain word ("Draft") | `tone` muted (default), default, signal, solid, signal-solid; any string. Shown only when it tells something. |
| `DataList`, `DataRow` | `dl > div > dt + dd`, two columns: the key muted, the value beside it; no rules, no leaders | `mono` values (`.ds-meta`) |
| `Divider` | one hairline, optional tick scale and set-in label (styleguide) | `decorative` (default; `false` renders an `hr`) |
| `Button` | square, sans 500 14 px, 1 px line, 44 px high below md | `primary` (the accent's fill, white text; hover and pressed a step deeper), `secondary` (outlined), `ghost`, `link` (accent text, underlined) (`default` and `outline` kept as aliases of primary / secondary); size default, sm; hover, focus-visible, disabled; `asChild`. In the entry's marginalia (`.entry-margin`) a button is not styled as one of its links: the "Open host" bar is the primary button |
| `IconButton` | square `Button` with a control-size icon (20 px); `label` is required (the accessible name) | same variants; the panel's close is `ghost` |
| `Toggle` | `Button` with `aria-pressed`; pressed = the accent's fill, white text (a ghost toggle: the hover grey) | name never changes with state |
| `ExpandToggle` | ghost `Toggle` of the panel / full-screen switch; icon swaps outward / inward diagonals | `expanded`, `showLabel`, size |
| `SegmentedControl` | group of `Toggle`s sharing 1 px lines (wraps on phones) | one value; the scheme choice in the styleguide |
| `CoverArt` | inline SVG of a dithered grid; `aria-hidden`; box takes the grid's aspect ratio | `seed`, `kind` (tint), `cols`, `rows`, `pattern` (field, bars, rings, stream, lattice; default: the seed picks), `palette` (blue, green, ocre, violet; default: the seed picks) |
| `MetadataStrip` | `dl` of plain lines (date, place); the keys are for assistive technology only | one line each, truncated |
| `SectionHeader` | the heading in sans 18 px, a muted count after it; no number, no rule | `as` h2, h3, h4; `meta` |
| `ScrollRow` | a sideways-scrolling row with the native scrollbar hidden and two 44 px arrow buttons (solid page-colour plate, chevron) that exist only while there is more on that side | `noun` ("Scroll tags left"); out of the tab order; smooth, instant under reduced motion. "Scroll row" below |
| `TagList` | `ul` of muted text separated by middle dots (CSS) | static or links (44 px hit area on phones via `::before`) |
| `Stack`, `Grid`, `Col` | flex column with a 4 px-scale gap; the 12-column grid; a column with `span` / `spanMd` | |
| `Skeleton`, `StatePanel` | skeleton block with a scan sweep; the three non-content states; `headingLevel` (1 to 4) and `titleId` (focus target) | `state` loading (polite `role=status`, `aria-busy`, no frame), empty (one muted line: no frame, glyph or code), error (`role=alert`, an active Frame, the `ERR / 500` code in mono, `Error`, a retry action) |
| `EntryCard` | cover (authored image or generated, 16:9, one hairline) + optional kind (`showKind`, mixed lists only) + title + three-line summary + status + date and places as two plain lines + the first three tags as muted text | one link (the title), stretched over the card with `::after`; hover underlines the title, focus-within draws a ring; `orientation="horizontal"` puts the cover beside the text inside an `@container` of 28 rem or more (the place panel), `priority` loads the image at once (the first cards of a list) |
| `SensitiveMedia` | a picture frame (`overflow: hidden`, a size container) that holds the picture blurred, with a plate over it: a mono label "Mature content" (eye-off icon) and, in an entry, a small `Toggle` "Show image" | `revealed`; `onRevealedChange` present = the entry's own picture (control, drawn once hydrated; before that the plate says "Image hidden"), absent = a card (label only, no control). `SensitiveMediaScope` / `SensitiveImage` share one state across an entry's pictures |
| `CopyButton` | ghost button that copies a string (or a function of the window) and confirms in place: its word turns to `Copied` (or `Not copied`) for 2 s, a polite status says it; no toast | drawn only once hydrated; clipboard API with an `execCommand` fallback; `glyph`, `label` (the accessible name), `announcement` |
| `Icon` | one icon of the set by name (5 kinds, close, expand, collapse, arrows, enter, command, copy, link, check, search, hash, eye, eye-off, info), from lucide-react | `size` inline (1.1 em), control (1.25 rem, default), large (1.5 rem); decorative (`aria-hidden`); "Icons" below |
| `LogoMark` | the site's mark: a 16 x 16 one-bit grid (a square and a disc overlapping, the overlap knocked out), one path, `currentColor`, `shapeRendering="crispEdges"`; decorative unless given a `title` | `size` (CSS px, a whole multiple of 16 keeps every pixel crisp; default 32), `title`. Not in the header; the styleguide and `LogoWordmark` use it |
| `LogoWordmark` | the mark and the site's name (the owner's name, from `SITE`) as text, semibold and tight, the mark at the height of the capitals | `size` (the mark's; the type follows it, default 16), `name`, `className`. Not in the header |
| `KeyHint` | the shortcut's hint in a `kbd`: the command icon (Mac) or "Ctrl", then K, mono 13 px, muted, **plain text: no border, background or outline anywhere**; empty space of its final width until hydrated | none: the same in the header and on the hero's search line |

### Generative cover art

`lib/cover-art.ts`: `coverArt(seed, { cols, rows, pattern })` is a pure function of the seed (FNV-1a hash, mulberry32 generator, 4x4 Bayer dither): a `Uint8Array` of tonal levels 0 to 3, plus one or two signal marks, all within the grid; sizes clamp to 4..96 cells. `coverPaths` merges horizontal runs into one SVG path per level. Same seed gives the same art on the server and in the browser (no hydration mismatch, nothing stored). Level 1 is the kind's hue at 22 %, levels 2 and 3 are the ink at 20 % and 42 %, the marks are the 600 fill of one of the four palettes (`coverArt(...).palette`: drawn by the seed AFTER the grid and the marks, so the grid and the marks of a seed are what they were before palettes; `palette` forces one, `blue` is `--signal`; the same seed gives the same palette on the server and in the browser). `data-palette` on the SVG selects the fill in `app.css`. Use the entry's slug or id as the seed (stable across edits).

### Entry view (the panel and the full-screen view)

Implemented: `components/entry/entry-view.tsx` (one component for both containers), `components/entry/blocks.tsx` (the body renderer),
`components/place-detail.tsx` (the place), `components/entry-list-page.tsx` (the four list pages). Routes, URL scheme and focus rules:
[web-architecture.md](web-architecture.md#entries-in-the-shell-routes-containers-url-scheme). The typography and the grid are in "Entry pages" below.

Same content, two layouts; `layout` only changes the grid (CSS), never the data, the DOM order or the focus order.

```
<article class="entry" data-surface="reading" aria-labelledby="panel-heading">   // a container: the type scales with its width (cqi)
  [Back to <place>]                                                // only when opened from a place panel
  ARTICLE · Ljubljana, Zagreb +2                       6 min read   // running head (mono, uppercase): kind, places, status / reading time, over ONE hairline (--border-strong), as a list's
  h1#panel-heading                                                 // Newsreader 700; the clause after a comma / colon / dash at 300
  summary                                                          // standfirst: Newsreader italic 300
  2026.03.14   Ljubljana ↗ open on the globe              Copy link // dateline (mono), under an ink rule
  Marginalia: Where, Written, Linked, the authored facts, tags, "Open host", Contents
  Lead image (authored; a generated cover only for an artwork). An article, project or poem cover is a 1.91:1 banner, cropped; an artwork's picture is shown whole in its own proportions (`width` and `height` as published), as wide as the column, at most 80 dvh tall, centred
  Text: BlockRenderer (drop cap, headings, pull quotes, lists, verse, code, link cards); in an article or a project the images are figures
        in the flow, where the author put them ("Figures" below)
  Related (three EntryCards)    Previous / Next of the kind
```

Both layouts are one column on a phone and in the half panel (header, dateline, marginalia in a compact grid, text with its figures). A full screen from 1024 px is a 12-column grid with 28 px gutters: marginalia in columns 1 to 3 (sticky contents), text in 4 to 9, figures in the flow of the text (an article or a project: the text and its figures in 4 to 12; an artwork: image and text in 4 to 12; a poem: title and lines in 4 to 10, marginalia beside the title). The header row of the container
(Close, `ExpandToggle`, both ghost: no box until pointed at) is the panel's, not the view's: it must stay clear of the navbar's row (centred over the map while the panel is open, over the viewport in full screen: it is
clear of both, see "Brand and header"). On a phone the panel is a dialog with a compact header (the close button alone; the content's heading names the
dialog). Lists of entries are hairline rows (`EntryRow`: "Entry pages" below); `EntryCard` (cover, title, summary) remains for the place panel and the related entries. An empty list is one muted line (`StatePanel`,
`headingLevel` 2 under the page's h1).

Body blocks (all plain text, no inner HTML anywhere; a test scans the components for it): `paragraph` (hard line breaks as `<br>`),
`heading` (h2/h3 in the display face, 800 / 300, sentence case, with a stable anchor id and a `#` link on hover; no numbering), `list` (square markers / numerals),
`quote` (the pull quote role, cite as a mono caption), `image` (a figure under an ink rule, no box, width/height to avoid layout shift, lazy, a mono caption that starts with "Fig. N"; an unsafe path is dropped; in an article or a project a flow figure, see "Figures"), `verse` (the reading face, 300 at the poem's scale; one paragraph per stanza, a block per line with its leading
spaces as a `ch` offset and a 2ch hanging indent when it wraps, a 1.4 em stanza gap), `code` (a Frame with the language as a small mono label, a
horizontally scrollable focusable `pre`, a copy button that exists only once hydrated and where the clipboard API does), `link`
(consecutive links form one list of cards; https only, `rel="noopener noreferrer"`, new-tab note for assistive tech; an invalid URL
is shown as plain text), `divider` (a plain `hr`; leading, trailing and repeated dividers are dropped). The pure parts live in
`lib/entry-blocks.ts`.

### Entry pages (typography)

The grammar of the "Article on paper" and "Poem at night" boards of the owner's canvas (2026-10-12), in words. Tokens and numbers: `design-tokens.md`, "Typography" and "Reading surface"; code: `app.css` (reading section, `.entry-*`), `components/entry/`, `lib/entry-typography.ts` (tested). Live: `/dev/design`, section 13.

- **Surface.** The page's own colours (near-white `#fbfbfb` with ink `#0a0a0a` in the light scheme, near-black `#0a0a0a` with `#f5f5f5` in the dark) for an entry (panel and full screen), the four lists, the map, the place panel and the home page: black and white, one blue. The cream "paper" and the warm "night" of the first boards are gone (2026-10-14, owner). One accent, `--paper-signal` for marks and large text, `--paper-signal-text` for small text (the same blues as the page's).
- **Links.** In running text a link is the accent's text tone with its underline; in the marginalia and the dateline it is muted mono with an accent underline and turns to the accent's text tone under the pointer (a list of places and tags is many links, and a column of blue would shout); "Open host" is the primary button.
- **Heavy against thin.** A headline in Newsreader 700 at up to 132 px (0.92, -0.03em, optical size 72), its clause after a comma, a colon or a dash at 300; the standfirst thin italic (300, 24 to 30 px); a pull quote thin italic at up to 40 px between two ink rules; section headings Bricolage 800, third level 300; a list's year numerals Bricolage 200 at the headline scale against titles at 800. A poem's title is Newsreader italic 200 at up to 128 px over lines at 300 (up to 36 px, 1.38).
- **Mono is the apparatus.** Kicker, dateline, marginalia, contents, captions, tags in the marginalia: JetBrains Mono 12 px, muted, the labels (Where, Written, Linked, the authored fact names) uppercase in the ink. Interface text (buttons, filters) stays sans.
- **Rules, not boxes.** No thick-over-thin pair anywhere (owner, 2026-10-14, after the lists': the double rule was "high-contrast"): an entry opens with its kicker row as a running head over one 1 px hairline in `--border-strong`, the same as a list's; a poem has none (its night board is the title alone). Then 1 px ink rules over the dateline, the marginalia, the text, each figure and "Related". No cards, no borders, no brackets, no numbering except "Fig. N" before a caption.
- **Computed, never invented.** The marginalia rows are the places (links, with their region as published), the month and year of the date, and the counts of linked places and entries (the entries count only when the list is not capped); an authored fact of the same name wins. There is no author line: none is published. Reading time is computed (`reading.ts`) unless the entry authors one.
- **Figures.** In an article or a project each image stays where the author put it, between the paragraph before it in the source and the block after it (the third column is gone, 2026-10-15, owner: a figure never sat by the paragraph that cites it). Journalistic, in the manner of a long read: `figure.entry-fig` (`components/entry/figure.tsx`, `.entry-fig` in `app.css`), under a 1 px hairline of the ink.
  - **Width.** The text's measure plus a quarter (`--measure-reading * 1.25`, about 810 px at 1280 and wider) and never more than the column: on a full screen from 1024 px the text and its figures share columns 4 to 12, so a figure may reach into the empty right margin (the marginalia is on its left, so the breakout is to the right: the figure starts at the text's left edge, the caption and the figure share it). Never past the picture itself: `--fig-natural` is the published `width` in CSS pixels, so a 480 px diagram is 480 px (crisp, centred in the wide measure), not stretched; an image without `width` and `height` is a 4:3 placeholder box at the wide width. On a phone, and in the half panel on a small window (a container 40 rem wide or less), the box is the column plus both page gutters: a picture that wide goes edge to edge, a small one keeps the gutter and is centred; the caption keeps the gutter either way (`--fig-inset`, a registered length). No horizontal scroll at any width (checked from 390 to 1920). `loading="lazy"` and the aspect ratio from `width` and `height` (no layout shift). Two figures in a row have the same air as a paragraph and a figure (`.entry-fig + .entry-fig`). An artwork's image and a poem's stay in the text, wide, as before (`ImageView`).
  - **Caption.** Under the picture, in the mono micro type (12 px, 1.6): a bold `Fig. N` in the ink (only when there is a caption; a bare image takes a number in the sequence without saying it), the caption's words in the ink, and a trailing credit in the muted solid tone (`--muted-foreground`, 4.5:1 on the page in both schemes; the contrast audit measures it). The credit is the authored caption's last parenthesis when it opens with a credit word (`(Source: ...)`, `(Photo: ...)`, `(Credit: ...)`, `(Illustration: ...)`, `(Image ...)`, `(Courtesy ...)`, `(Via ...)`, `(Crédit ...)`, `(D'après ...)`, `(Fuente ...)`, `(Quelle ...)`: `splitCaption`, `lib/figures.ts`), kept with its parentheses: the authored text is never changed, only set in two tones. Left-aligned to the figure's left edge, never wider than the picture and never wider than about 60 characters (`max-width: min(100%, 60ch)`), so a wide figure's caption wraps short and a narrow one wraps within the image. No italic: the mono face has none and a synthesised slant is worse than a tone.
  - **Cross references.** A figure with a caption has the id `fig-N` and `tabindex="-1"`: it is the target of a link and takes the focus (shown to the keyboard by `:focus-visible`). The text's mentions of one (`Fig. 3`, `Fig 3`, `Fig.3`, `fig. 3`, `Figure 3`, not `Figs. 2 and 3`, `Fig. 3a`, `Fig. 3.2`, `Fig. 03`, `Config. 3`) in paragraphs, list items and the text of a quote become links to `#fig-3` when a captioned figure of that number exists, link text unchanged (`linkFigureMentions`; the mention of a figure that does not exist, or of a bare image, stays text; never in a heading, a code block, a link card or a quote's cite). `scroll-margin-top` clears the sticky header; the link jumps (no smooth scrolling is set, and the global reduced-motion rule keeps it so). A link to a part of an entry (`#fig-3`, or a section's `#body-...`) works on load: the panel's scroll area, not the page, scrolls, so `DetailPanel` scrolls the target into view when the URL names one inside the entry (it used to scroll back to the top).
  - **Zoom.** When the picture is 10 % or more wider than it is drawn (its `width` against the measured width: `isZoomable`), a transparent button over the picture, named "View figure N larger" (`cursor: zoom-in`, the picture keeps its `alt`), opens it in a native modal `<dialog>` (`FigureLightbox`, in a portal on `body`): the picture at its own width, shrunk to the window and its height, the caption under it; the browser makes the rest of the page inert (the focus trap), focus starts on the Close button, Escape (the panel stays: `lib/panel-escape.ts` leaves a dialog's Escape alone), the Close button and a click on the backdrop close it, and focus returns to the figure's control. The control exists after hydration, once the width is measured and kept in step by a `ResizeObserver`: the server render and a browser without scripts show the plain figure. Not offered while a sensitive entry's images are blurred. The backdrop is a scrim (80 % black, the one see-through that is meant); the dialog itself is the page's solid colours. Not printed (print shows the figures in the flow, no control, no dialog).
  - **Rejected.** A column of figures at the right (the old design: far from the paragraph that cites it, and on a phone after the whole text); centring the text with symmetric breakouts (the marginalia is on the left, a figure reaching into it would cover the contents); a lightbox as an `aria`-less overlay or a library (a native dialog is the focus trap, Escape and the top layer for free); a role=button div or a link over the image (a native button over it keeps the image's `alt`); figures upscaled to the wide measure (a 480 px diagram is crisp at 480).
- **Drop cap.** The first paragraph of an article or a project when it is a paragraph of 200 characters or more that opens with a capital letter, and only then (`dropCapKind`: not an opening quote, not a lowercase letter, not Q or Ç whose tails hang under the baseline, not a capital followed by a mark such as "L'exil" or "I'm", where the mark would be drawn at the letter's size). Newsreader 700 in the ink, **spanning exactly three lines of the body (two in a column under 30 rem)**: its cap-height top is on the cap height of the first line and its baseline on the baseline of line three, so line four starts flush under it with no air below the letter, and the ink's right gap is about a tenth of the letter's em. Done with a float sized from the face's measured metrics (`.drop-cap` in `app.css`; `scripts/entries/dropcap.mjs` checks it in a browser), not `initial-letter`: Chrome's sizes the letter from the face's default cap height and stands 4 to 5 px above the first line at a 21 px body, and engines differ. An accented capital (É) gets room above it in its paragraph; a mark above the letter never meets the rule over the text.
- **Poem.** Title and lines in columns 4 to 10, marginalia (place, date, "open on the globe", the note about the poem) beside the title, lines exactly as authored, one block per line, leading spaces kept; on a phone the title, the lines, then the marginalia.
- **Lists.** The contents page of a journal, not a front page (owner, 2026-10-13: the double rule was "high-contrast"; asked for a journal feel). A **running head** in mono 12 px muted: the journal's name (the owner's, as the site has no logo) at the left, the folio (the plain count, in the kind's count noun: "33 software", "12 of 33 software" when filtered; "4 poems") at the right, over **one** hairline in `--border-strong`. Then air, the section's name at the headline scale in the reading face at a medium weight (500, not the entry headline's 700: the page is a contents page, the entry's title is a headline), then the tag filter in plain space (2 rem under the title) (text links, the chosen one heavier and underlined), then hairline rows: a mono column (date, places, status), the title in Bricolage 800 over a summary in Newsreader 300, the image where there is one; years as thin numerals only where a year holds more than one entry. Rationale: a masthead's thick-over-thin rule is a front page's gesture and shouts over a quiet archive, whereas a running head and a single hairline, as in a literary or academic journal's contents page, give the structure with whitespace and keep the heavy type for the entries. Rejected: a computed italic standfirst under the title ("2022, in Toulouse.": owner, 2026-10-13, it adds nothing), a table of contents with dot leaders and page folios (the rows carry an image and a summary: leaders would fight them), the same title at 700 (a second heavy line over the first row), a rule above the running head (a second line is the double rule again). One h1, one `header` (`data-slot="list-head"`), the filter is a labelled `nav`; an empty list is the head and one muted line. An entry's head is the same running head (`.entry-running`, one rule with `.list-running`).
- **Scale.** The entry is a container: headline, body and poem scale with its width (`cqi`), so the half panel and the full screen are one design at two widths; the clamps are in `app.css` (`--entry-title`, `--entry-body`, `--poem-title`, `--poem-size`).

### Copyright notice

A poem, an article and an artwork end with one line, after the text (and its figures) and before "keep reading": `© <year> <site name>. All rights reserved. Please do not reproduce this <poem|article|artwork> without permission; short quotations with attribution are welcome.` (French for an entry whose `Language` fact is French: "Tous droits réservés. Merci de ne pas reproduire ce poème / ce texte / cette œuvre sans autorisation ; de courtes citations avec mention de l'auteur sont bienvenues."). Software entries are code under the repository's licence and have none; lists, the home page and the globe never show it. It is `.entry-copyright`: the marginalia's mono 12 px in the muted tone (a solid token, 4.5:1 on the page in both schemes, pinned in `lib/contrast-audit.test.ts`), set as a sentence, not in capitals; printed in ink. The year is the entry's date year, else the year of an `updated` stamp (the projection carries none today), else left out. One helper, `copyrightNotice()` in `lib/copyright.ts`, builds the words for the page, `<meta name="copyright">` and the JSON-LD (`copyrightHolder` as a `Person`, `copyrightYear` when known, `copyrightNotice`; no `license`); the holder is `SITE.name`. The site has no feed, so there is nothing to add there; it has no footer either (the credits dialog is the map's data credits).

### Sensitive media

An entry marked `sensitive: true` in the contract (mature content: a figure or anatomy study, for instance) is published and listed like
any other, but **every picture of it is blurred until the visitor asks to see it**, so that someone browsing at work is never exposed by
accident. Code: `components/ui/sensitive-media.tsx`, `.sensitive-media*` in `app.css`, the decisions in `lib/sensitive.ts`; live in
`/dev/design` section 7.

- **Where.** The cover and the image blocks of the entry view (panel and full screen), the image of every card (list rows, `EntryCard` in the
  place panel and under "Related"). Nothing is sharp in the server render, with scripts off, while the page hydrates, or on paper.
- **The blur.** CSS on an attribute (`data-state="hidden"`): `filter: blur(clamp(0.75rem, 6cqi, 3rem))` and `scale(1.3)` inside an
  `overflow: hidden` frame that is its own size container, so the radius follows the width (about five cells across: a 170 px thumbnail and a
  1400 px cover are equally unrecognisable) and the soft edge stays outside the frame. No sharp placeholder, no blur-up from the real image.
  Generated cover art is never blurred (it depicts nothing).
- **The plate.** Centred on a hidden picture: a hairline box on the page colour at 88 %, the label "Mature content" in mono capitals with the
  eye-off icon, then (entry only, once hydrated) the button "Show image". Without scripts the button is not drawn and the plate says "Image
  hidden". On a card the plate is the label alone and does not take pointer events: the card stays one link.
- **The control.** One real `<button>` per picture, a `Toggle` (`aria-pressed`, the name "Show image" never changes, the icon is the action:
  eye to show, eye-off to hide), 44 px high on a phone. Pressing it shows **all of the entry's pictures** (and nothing else: cards stay
  blurred); once shown the plate shrinks to the pressed toggle in the picture's corner, which hides them again. Focus stays on it; a polite
  status says "Image shown" / "Image hidden".
- **Memory.** None. The state lives in the page view only (no storage, cookie or URL): a reload, or leaving and returning, blurs again.
- **Motion.** The unblur is a `--duration-base` transition of `filter` and `transform` only under `prefers-reduced-motion:
  no-preference`; otherwise it is immediate.
- **Print.** Blurred whether revealed or not, the label printed, the control not.
- **Alt text** stays as authored: it is the accessible description (a person using a screen reader is told what the work is, the
  blur is for the eyes).
- **Off the page.** The cover is never the share image (Open Graph, Twitter) nor a JSON-LD `image`: the site's default image is used, and the
  page says `robots: noimageindex`. See web-architecture.md, "Sensitive media".

### The place panel

The name (h1), then one quiet line: region and country (each word once; the country derived from the place's country code), the
coordinates at the precision they are stored with (`48.85° N, 2.35° E`: a value written with two decimals is not padded to four, that would be
false precision) and the dates. Then the summary, the text, the images and the entries grouped by kind under their own headings ("Articles 2",
the cards h3). A place without entries shows nothing for them (no section, no empty box). The kind is not said on the cards (the heading says it).

### Artwork wall (`/artworks`, 2026-10-19, owner: the image-beside-text rows felt flat)

`ArtworkWall` (`components/entry/artwork-wall.tsx`, `lib/masonry.ts`): ONE brick wall for every year (no year headings: the year is in each caption). Pictures keep their own proportions (the contract's cover `width` / `height`, so the space is reserved before the image loads; clamped to 0.4 to 2 height over width, 3:4 without a size, a generated 4:3 cover without a cover), nested in equal columns by the wall's OWN width (a size container: 1 column from 0, 2 from 34 rem, 3 from 62 rem, 4 from 88 rem; the page is 120 rem at most), 10 px apart (`--gap`), square edges, a hairline round each picture.

- **Technique (chosen, and why).** Not CSS columns (they run top to bottom per column: the tab order would too), not `grid-template-rows: masonry` (not in the engines yet), not a script that measures. Equal-width columns make a picture's height, in column widths, equal to its ratio at every viewport, so the placement (shortest column first, leftmost on a tie, in reading order) is computed ONCE on the server for 1, 2, 3 and 4 columns and handed to CSS as custom properties (`--c1..4` column, `--n1..4` pictures above, `--r1..4` their summed ratios); the stylesheet turns them into `top = ratios above * column width + pictures above * (caption + gap)` with `calc()` and the container's `cqi`, and the list's height is a `max()` of its columns. Consequences: no script, no `ResizeObserver`, no hydration difference, no layout shift, the DOM is one `ul` in reading order (the tab order is the DOM order, which reads left to right, then down), and printing falls back to two plain columns.
- **Caption.** Title (the heading's link, stretched over the picture: one tab stop per artwork), then the medium and the year (the `Medium` and `Year` facts, else the date's year). A pointer that hovers (`hover: hover` and `pointer: fine`): a solid page-colour plate over the picture's foot with a strong hairline on top, shown on hover and on keyboard focus at once (no fade, so the plate is never half-transparent over its text; nothing moves). Anything else (touch, whatever the width): a caption line under every picture, always visible, of one fixed height (`--cap`, 4.5 rem: two lines of title and one of the medium) so the rhythm of the bricks holds. Caption height is fixed because the placement is computed before text is laid out.
- **Pictures.** The first four load at once, the rest lazily; `object-fit: cover` in a box of the contract's ratio (the box is within about 1 % of the file's, so nothing visible is cropped). A sensitive artwork keeps `SensitiveMedia` (blurred in the first byte of HTML, "Mature content" plate, no control). The entry page is unchanged.
- **Limits.** A caption plate sits at the picture's foot: on a very tall picture it can be below the fold until the pointer scrolls it in. The caption's reserved height on touch is the same for a one-line and a two-line title.

### Poetry list (`/poetry`, 2026-10-19, owner: wide screens were underused, the sub-text too small and light)

The page is 100 rem wide, as are the other lists and the artwork wall: one width for the four, so the titles and the content keep their left edge from tab to tab (it was 90, 100 and 120 rem, and the left edge moved by up to 10 rem as the visitor changed tabs). Rows are cells of a grid (`.poem-grid`: 1 column, 2 from 44 rem of the page's width (so one at 768 px, whose page is 41 rem wide, two from about 850 px); three would cut the summaries to about 35 characters at 1600 px, so there is no third tier). `PoemRow`: the mono line (place, date) at 14 px, weight 500, muted (`--muted-foreground`: 6.8:1 light, 7.9:1 dark), over the title (Bricolage 800 at 28 to 42 px) over the summary in the reading serif at 20 to 26 px (`clamp(1.25rem, 1.05rem + 0.55cqi, 1.625rem)`), weight 400, in the ink (`--foreground`, a solid colour, 19.1:1 light, 18.2:1 dark), measure 30 em, line height 1.4. Before: summary 19 px weight 300 muted, mono 12 px. Hairline between rows, same anchors and the stretched title link. Tested at 390, 768, 1280, 1920 and 2560 px.

### Career page (`/career`, 2026-10-25, owner: the timeline was ugly and heavy next to the rest of the site)

`components/career-page.tsx`, `lib/career.ts`, the `.career-*` rules of `app.css` (docs/career-page.md has the content contract and the page's structure). The look is the quiet, schematic one of the references the owner gave (a faint rail, small icon tiles, a muted meta line, quiet chips), in the system's own tokens. What was decided, and why:

- **No boxes.** An item is not a card: the type and the spacing group it (organisation, role, when, where, then what was done). The first iteration drew a hairline card per item with a header strip; it read as bulky.
- **The rail** is ONE `--hairline` in `--border` (never `--border-strong`), drawn per item with a 1 px width on an odd 41 px tile so it runs through the exact middle pixel. It **fades out** past the last item (a gradient to transparent over 5 rem), so the timeline is open at its old end instead of cut. This is the only gradient on the page and the only use of transparency; elsewhere "solid colours, not opacity" holds. Forced colours drop gradients, so there the rail is a solid `CanvasText` hairline.
- **The marker** is a 41 px square tile with a 1 px `--border` outline (so a white logo still has a visible square; square edges, no radius: a 4 px radius was tried and rejected), sized to the INK of the two lines beside it, not to their boxes: its top is the top of the organisation's capitals and its bottom the baseline of the role line. Measured in the browser, the organisation (24 px Bricolage 800, line height 1.05) has its baseline 20 px under the item's top and a cap height of 0.66 em = 15.84 px, so its capitals start at 4.16 px; the role (18 px reading, line height 1.4, 4 px under the organisation) has its baseline at 45.19 px. Hence `--career-offset: 4px` and `--career-tile: 41px` (drawn at 4 and 45, within 0.2 px; 41 is odd, so the 1 px rail runs through the exact middle pixel). If the type size or line height of either line changes, measure again (a zero-size inline-block appended to the line gives its baseline; `measureText` of an `H` gives the cap height). The rail leaves a 0.5 rem gap above and below each tile. With a logo (below) the logo fills the tile; without one it is a `--accent` square with the role's icon (`Icon size="large"`) in `--muted-foreground`, and `--signal-text` while the role is in progress (nothing else on the page is blue). The icon is picked from the title's words by `careerIcon` (a founder: rocket, full-stack: layers, front-end: code, design: palette, back-end: server, otherwise the briefcase; education: cuboid, sigma, the cap) and never by the owner (the contract has no field for it).
- **Two columns from 64 rem.** Who, when and where at the left in a FIXED 26 rem (the role or programme is ONE line, never wrapped: it is cut with an ellipsis, and the full text is its `title`, so the logo spans exactly the title and that line) (so the left edge of every item, education included, is one scan line), what was done (highlights, then skills) at the right, the highlights at a 44 rem measure. Under 64 rem one column. **Education and Skills sit side by side** from 80 rem (each is short; stacked they left the right half of the page empty); a block alone, or under 64 rem, is full width.
- **The meta line** puts the dates first: the period (the foreground colour while the role is in progress), then the length of the stay in `--subtle-foreground`, joined by a middle dot (metadata has no inner rules, so no vertical dividers). Employment and place are the line under it, in sentence case in the mono face (the tracked uppercase label is for dates and block titles only).
- **Skill chips are an owner-approved exception** to "a list has no chips": a solid `--accent` rectangle, no outline, 12 px mono, for a role's skills and for the Skills block. They are quiet by construction (no border, no hover, not links). Do not use them for anything else; the entries' tags stay `TagList` (dotted text).
- **The portrait** is a square, not an ID format and not a circle (the system's edges are square), of its own size from 40 rem (`clamp(9rem, 20cqi, 17rem)`, its top level with the name's; NEVER sized from the text beside it: a square whose width came from the height of a text block that depends on its width was a feedback loop and blew up at about 820 px) and 5.5 rem on a phone, with the same 1 px `--border` outline as the career markers; a picture that follows the colour scheme is an SVG with its own `prefers-color-scheme` rule (the site has no scheme toggle), see `docs/portrait/portrait.svg`.
- **The bleed** (owner, 2026-10-26): behind each logo marker and behind the portrait sits the same picture again, scaled up (2.4x the marker, 1.45x the portrait), blurred (1.25 rem, 2.5 rem) and very faint (logos 0.15 light, 0.09 dark; portrait 0.13 light, 0.05 dark: on a dark page a halo glows, so it is fainter there), as if its colours spilled onto the page; the sharp square stays crisp on top. A second decorative `<img alt="" aria-hidden>` of the same file (cached, so no second download); the item and the head are `isolation: isolate` so the bleed stays under the text and above the page; only the screen's edge cuts it (`overflow-x: clip` on the root, not on the content box, which is narrower than a wide screen and would show a hard edge); it is not printed. Opacity here is the one wanted see-through of the page, with the rail's fade.
- **Type** is on the scale: organisation 1.5 rem display, role 1.125 rem reading, highlights 1 rem, chips and the facts line 0.75 rem.
- **Block titles** (Experience, Education, Skills, Elsewhere) are editorial: the reading face at 1.75 to 2.25 rem (`clamp`, in container units), medium weight, the foreground, sentence case. They keep the page's left edge (the tile column's), not the content's: the owner prefers the title to line up with the rule above it. The small uppercase mono label stays for the Languages line.
- **Logos are the markers.** When an organisation or a school has a square logo, it IS the item's marker on the rail (41 px, the tile's outline) and replaces the role icon; it is decorative (`alt=""`: the name follows). Without a logo the marker is the role icon, as above. The logo comes from the published document (`logo` of a role or an education: a `/media/` file with its size, exported by the private repo like the portrait) and wins; while the document has none, the page falls back to a file of its own in `public/career-logos/` (NOT `public/media/`: the content export owns that folder and refuses a foreign file), found from the name by `careerLogo` in `lib/career.ts`.
- **The portrait follows the colour scheme** through a dark variant in the document (`portrait.dark`): the page draws a `<picture>` whose `<source media="(prefers-color-scheme: dark)">` is that file (the site has no scheme toggle, so the media query is the whole story); the faint bleed behind it follows too. Without a variant it is one plain image. `docs/portrait/portrait.svg` is the single-file SVG version of the same idea, kept as the source of the two raster variants (the private pipeline refuses SVG).
- **The header's fade** reaches the top edge of the screen: the row is centred in the navbar's height, a few pixels below the edge, so `.nav-fade` starts 1 rem above the row (it used to start at the row and left a sharp strip of map above the nav text).

### Scroll row (2026-10-19, owner: native scrollbars on phones looked unpolished)

`ScrollRow` (`components/ui/scroll-row.tsx`, `lib/scroll-row.ts`) wraps every sideways-scrolling row of chips; today that is the lists' tag filter (the one `overflow-x` row in the app; a code block's scroller is a text region, not a chip row, and keeps its own). The native scrollbar is hidden (`scrollbar-width: none` and `::-webkit-scrollbar { display: none }`). Arrows replace it: a left one when scrolled away from the start, a right one while more remains (`scrollEdges`, 2 px tolerance, RTL-safe), each a 44 px square with a SOLID page-colour plate (no gradient, no opacity) and a hairline on its inner side, a chevron (`chevron-left` / `chevron-right`), named "Scroll tags left" / "Scroll tags right". One press scrolls four fifths of the visible width, smoothly, instantly under `prefers-reduced-motion: reduce`. State comes from a passive `scroll` listener and a `ResizeObserver` on the row and its content. The row itself stays the scroller (touch swipe, wheel; the keyboard moves focus along its links and the browser keeps the focused one in view); the arrows are extras and are NOT tab stops (a button that vanishes under focus would drop it), they stay in the accessibility tree. The chosen chip (`aria-current`) is brought into view on mount. The server render and the first client render draw no arrow (measured after mount): without scripts the row is a swipeable strip. From `md` the filter wraps and nothing overflows, so no arrow exists.

### Reading aids, lists, search (docs/web-architecture.md has the mechanics)

- **Reading.** Computed `N min read` in the meta line for articles without an authored `Reading time`; a **contents** (>= 3 headings, plain
  text, nested ones indented and muted) in the full view only (same markup in the panel, hidden by CSS), the current section marked
  `aria-current="location"` with a signal tick, a "Jump to contents" skip link beside the copy-link button; a `#` **anchor** on every heading
  (hover, focus, always on touch); **Copy link** in the dateline (a poem: in its marginalia) and **Copy** on code blocks (`CopyButton`); tags are links to the kind's
  filtered list.
- **Lists.** A plain count ("5 articles", "2 of 5 articles" filtered) in mono over the section's name at the headline scale, then a **tag filter**: one row of text links (the chosen
  one heavier and underlined, `aria-current`, no boxes, no counts) under an ink rule, above hairline rows; **year headings** (thin display numerals) only where
  years group entries. The state is the URL (`?tag=`); on a phone the row scrolls sideways (a `ScrollRow`: no native scrollbar, arrows at the edges: "Scroll row" below). `/artworks` is a brick wall and `/poetry` a two-column grid ("Artwork wall", "Poetry list").
- **Empty states.** The home page with no published place keeps the globe, and the hero's hint reads "No place is published yet: start from a list." (no plate, no
  count); a list with no entries is one muted line ("Nothing here yet."); a place with none shows no entries section.
- **Search.** A modal dialog on the surface Frame: a combobox input with the search icon and a plain close icon (no box), group headings in mono, rows of kind
  icon (control size, one size for every kind) + title (display face, 700) + date or region, the highlighted one on the hover grey with a 2 px signal tick, a footer of one quiet line of key hints in plain muted text, with no box (icons for the arrows and Enter, the word "Esc" for the key, each followed by its verb: "Esc close"; not drawn on a coarse pointer, a touch screen has no such keys, and the screen-reader sentence stays) and the result count ("7 results"; when the list is capped at 24, "Showing 24 of 35": the count is the real one). Escape closes the palette only: an open panel under it stays (`lib/panel-escape.ts`: the panel's own Escape ignores a key that belongs to a dialog). The trigger is one 44 px button at every width, in the header's mono capitals: the search icon, the word "Search" and, from `xl` of header width, the `KeyHint` (command icon + K, or Ctrl K); the icon and the command key are the same size (below).
- **Print.** Ink on white, no globe, navigation, controls, contents, related cards or neighbours; external link addresses are written out. The print rule rebinds the page tokens AND the `--paper*` ones to ink on white: the lists' root rule (`:root:has(main[data-surface="reading"])`) is more specific than the page tokens and would otherwise print the dark scheme's night and ivory (`design-system.test.ts`; `entries/check.mjs` emulates print and dark on a list and an entry).

## Icons

One library, one wrapper, one scale (owner, 2026-10-13: the hand-drawn glyph set was too small next to its text everywhere). The set is
**lucide-react** (already a dependency); `components/ui/icon.tsx` is the only file that imports it, and every use is `<Icon name="..." size="..." />`.
Nothing is drawn by hand: `components/ui/icon.test.ts` fails on an inline `<svg>` anywhere in the components other than the brand mark
(`logo-mark.tsx`, a fixed 16 x 16 grid) and the generated cover art (`cover-art.tsx`, a dithered grid, not an icon), on an SVG data URI
in the CSS, on a second importer of the library, on a text character used as an icon (an arrow, the command key, a tick) and on a size given in pixels.

**The scale.** A size says what the icon sits next to, not a number; the values are tokens in `app.css` (`--icon-*`).

| Size (`size=`) | Token | Value | Use | Where |
| --- | --- | --- | --- | --- |
| `inline` | `--icon-inline` | 1.1 em | beside running text or a label: it takes that text's size, so it grows with a display row and stays right in small mono | the arrows of the hero's rows (33 px at 30 px type), "Back to ...", the "Open host" button's arrow, a button's leading arrow, a `KindTag` with its word, the credits' "See more", the phone's credits "i" button (at `text-base`, 17.6 px), **the header's search trigger icon and the command key beside it (13 px at the header's 12 px type: one size for both, the owner's "same size as the command symbol")**, the footer hints of the palette |
| `control` (default) | `--icon-control` | 1.25 rem (20 px) | inside a control or at the head of a row: a fixed size, whatever the text beside it | icon buttons (close, full screen), the hero's search line and the palette's field, a palette result's kind icon and its go arrow, previous / next arrows, the link card's arrow, the heading anchor |
| `large` | `--icon-large` | 1.5 rem (24 px) | alone and prominent, with no text to follow | none yet (the size an empty state's mark would take) |

**Stroke and ends.** One weight, `--icon-stroke: 1.75` in the library's 24-unit grid (it scales with the icon, as a glyph's stems do with its
size: 1.5 px at 20 px, 2.4 px at 33 px, to sit beside Bricolage at 300), and **square ends and mitred joins** at every size (the library's
are round; square edges are the system). Colour is always `currentColor`: an icon is never tinted on its own, so it follows its text, its
hover and its scheme. An icon is decorative (`aria-hidden`); the control or the text that holds it carries the accessible name.

**The set** (names are the interface's; see `ICONS`): kinds `article` (page of text), `project` (terminal prompt), `artwork` (image), `poem`
(feather), `place` (map pin); `close`, `expand`, `collapse`, `arrow-left`, `arrow-right`, `arrow-up`, `arrow-down`, `arrow-up-right`,
`arrow-up-left`, `enter`, `command`, `check`, `copy`, `link`, `hash`, `search`, `eye`, `eye-off` (the reveal control of mature content), `info` (the phone's map credits button). Shown live in `/dev/design`, section 14.

**Map credits on a phone** (2026-10-14, owner: the card is clutter on a small screen; guidelines checked by the coordinator). From 768 px (`md`) the credits are one mono card at the bottom right ("© OpenStreetMap · OpenFreeMap · Natural Earth · See more"). Below it, the OSM Foundation's [Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) say the attribution "should not require individuals to interact with the map or produced work to see the attribution" and sits in a corner of the map by default; it may collapse after a dismiss, automatically on map interaction or after five seconds, as long as the licence information stays findable through an (i) button or an About page. So on a phone: a short solid-plate line "© OpenStreetMap contributors · OpenFreeMap · Natural Earth" is shown at load beside a 28 px "i" button; it collapses to the button alone after 5 s or on the first pan, zoom or tap, once per page load per surface (globe, street map; an in-memory guard, so a remount, a handover or a client-side navigation does not bring it back, but a reload or a new document load shows it again: the credit is visible by default on every arrival, as the guidelines ask), with no animation (so none under reduced motion). The "i" ("Map credits", 44 px target, keyboard reachable) always opens the full credits dialog. Not verified: OpenFreeMap's own terms (the spike quotes their line, "OpenFreeMap (c) OpenMapTiles, Data from OpenStreetMap", but this repo does not reproduce their terms about collapsing) and ODbL's wording for an interactive map beyond the Foundation's guidelines; iOS Safari and real phones. See [design-tokens.md](design-tokens.md) ("Map card and credits line").

**The shortcut hint** (`KeyHint`): the command key is the library's `Command` icon (inline size) followed by "K"; elsewhere the word "Ctrl"
then "K", in mono as plain muted text everywhere it appears (13 px in the hero's search line and the palette, the header's own 12 px in the header, so
that its command icon, 1.1 em, is the same size as the trigger's search icon: `.nav-search .ds-kbd`; the palette's footer writes "Esc" the same way). **A key is never drawn as a box** (owner, 2026-10-13: an outlined "Esc" nested in an outlined row looked poorly nested): no border,
no background, no outline, no padding on `.ds-kbd`; `icon.test.ts` fails on a border or a background on a key hint, and `scripts/home/hero.mjs`
reads the computed style of the hero's, the header's and the palette's. It is decoration (`aria-keyshortcuts` names the shortcut); its space
has its final width on the server so that nothing moves when the platform is known.

## Brand and header

**The mark** (2026-10-12; `scripts/brand/mark.mjs`, `components/ui/logo-mark.tsx`, section 12 of `/dev/design`): a square and a disc
overlapping, the overlap knocked out. The square is the bounding box, the disc is the globe: the two things the map is made of. 16 x 16
grid, one bit per cell, solid shapes, no outline, no gradient, `currentColor`; whole multiples of 16 px stay crisp, and it is legible
at 16 px. It says nothing in words, so it survives a rename; the name sits beside it as the **wordmark** (the owner's name, from `SITE`) (`LogoWordmark`: the mark and
the site's name as text in the display weight, semibold and tight, the mark at the height of the capitals). Both are monochrome: the
accent stays for state. The look of the site is a studio's (heavy typographic work, big bold display type against thin text, mono
accents, hairline grids, restraint) over the pixel-art globe: the mark is the one geometric shape of that language and it never
carries texture. Where it is used: the favicon (SVG, follows the scheme; ICO at 16, 32, 48 px on the dark tile), the home-screen and
manifest icons, the styleguide, and `LogoMark` / `LogoWordmark` for the places that want them (neither is in the header). To change it,
edit `MARK` in `mark.mjs`, run `pnpm --filter @catalyst/web brand`, paste the new path into `logo-mark.tsx`; the test says when they
differ. Alternatives that were drawn and set aside: a pixel sphere with a dithered shadow side inside a dashed bounding box (the first
choice: it carried the globe's own look, but its texture is noise at 16 px and it does not sit beside a wordmark); a solid disc with
a bounding box cut out of it (bold, but a round silhouette like any button); a C-shaped globe holding a place (a monogram that ties the
mark to the project's first name); a disc with one squared corner (a leaf shape, generic).

**The header** (`components/navbar.tsx`): one centred row of text and no logo (owner: the icon in the corner went). In order: "Globe"
(the way home, in mono capitals like the rest: the site's name is the home hero's headline, not the header's), Software, Articles, Artworks, Poetry (muted; the
current one in the foreground and underlined, `aria-current="page"`), the search trigger. **On the home page, while the landing hero is at
rest, there is no header at all** (its four rows are the sections and its search line is the search: docs/landing.md); the header is back,
tabs and search, whenever the hero has stepped back, and on every other route. Centred over the viewport; while the place
or entry panel is open beside the globe it is centred over the map (the left half), so it never meets the panel's Close and expand
controls, and it glides with the panel. Its width decides what it shows (container query; from 56 rem the sections inline, under it one "Sections" button with a sheet of every section and its count, issue #290): "Globe" and the sections always,
the search trigger (icon and word; the icon from 22 rem, under which a 320 px phone keeps the word) always, its key hint from 36 rem. 44 px targets, the trigger as tall as the links. Over content that scrolls (lists, 404, errors) it has the
page scrim; over the globe and the map a soft fade of its own, 85 % of the page colour at the top edge easing to nothing, only as wide
as the row (design-tokens.md, "Nav fade"). Details and measurements: [web-architecture.md](web-architecture.md#floating-navbar-and-scrim).

## Accessibility rules

- Contrast: all text AA (4.5:1) in both schemes on the page, the surface and, for muted text, the hover grey; body text 7:1 or more; control outlines, the focus ring and an icon that is a control's whole label 3:1 or more; the hairlines are deliberately quiet (decorative). `--subtle-foreground` only on the page and the surface. Enforced by `design-system.test.ts` and `contrast-audit.test.ts` (every pair of tokens, in the page, reading and inverted contexts), and measured on the rendered pages, with their real backgrounds and every hover, focus and pressed state, by `scripts/contrast/audit.mjs` (design-tokens.md, "Contrast audit").
- Hue never carries meaning: kind = glyph + word, status = the word, error = the word and an inverted tag, selected = the accent's fill (or an inverted fill on the map's label) and `aria-pressed` (a ghost toggle: the hover grey and its swapped glyph).
- Touch targets 44 px below `md` (`--control-h`, link tags' and heading anchors' `::before`, filter links (44 x 44 at least, also "All") and place rows `min-h-11`; the header's items are 44 x 44 at least, also "Globe" at 320 px).
- Forced colours: the header's fade and the hero's plate are solid `Canvas` (forced colours drop gradients and masks, and the WebGL canvas stays as drawn).
- Without scripts (`@media (scripting: none)`): what only works with a script (`data-needs-script`: the search lines and triggers) is not drawn, and the how-to line stops pointing at the globe.
- Keyboard: DOM order is reading order (header controls, title, sections, footer); one tab stop per card; toggles are real buttons with `aria-pressed`; Escape behaviour stays the panel's.
- Focus is always visible (global ring); no component removes the outline except the card link, whose card shows the focus instead (`:has(:focus-visible)` ring around the card).
- No text in images: covers are generated art with no glyphs and are `aria-hidden`; authored images need `alt`.
- Decoration (the styleguide's grid, hatch and tick scale) is `aria-hidden` or pure CSS and removable without losing information; the middle dots between tags are CSS content with an empty alternative text. Forced colours: pressed buttons use `Highlight`.
- Reduced motion: no ambient animation, transitions collapse to ~0.
- Live regions: loading is `role=status`, errors `role=alert`, the list filter, the search results and "Copied" are polite statuses.

## Dev styleguide

`/dev/design` (`routes/dev-design.tsx`; section 14 is the icon set, the three sizes beside their text and the key hint) is guarded exactly like `/dev/street`: `routes.ts` registers it only when `NODE_ENV !== "production"` or the build sets `CATALYST_DEV_ROUTES=1`, and its loader answers 404 anywhere else. Production builds contain neither the route nor its sample strings (made-up placeholders only). `?scheme=light|dark` or the on-page toggle sets `data-scheme` on `<html>`; the "Both schemes" section forces each scheme per block, whatever the toggle says.
