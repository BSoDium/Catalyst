# Design system

The UI system for the data display: the side panel and the full-screen view that show places and entries (kinds: article, project, artwork, poem, and the place itself). It sits on the values in [design-tokens.md](design-tokens.md) and does not touch the map, its labels or the globe canvas. Live reference: the dev-only styleguide at `/dev/design` (every token and component, both schemes, sample entries as cards and as a panel mock, the loading / empty / error states). Code: `apps/web/app/components/ui/` (React), `app/app.css` (`ds-*` classes and tokens), `app/lib/{entry-kind,labelling,cover-art,contrast}.ts` (pure logic, tested).

## Brief, distilled

"A clean UI that revolves around Y2K art, generative art, AI, labellisation, square edges, clean, Watch Dogs style." Read as:

| Principle | What it means here |
| --- | --- |
| Square edges | Radius 0 everywhere (all `--radius-*` tokens are 0; a test scans the components). No pills, no soft shadows. |
| Hairline frames | 1 px lines. A **Frame** has corner brackets (10 px strokes over its corners) and optional registration (crosshair) marks. Depth comes from frames and lines, never from elevation. |
| Labelling language | Everything is annotated like a technical drawing: **micro-labels** (mono, uppercase, tracked) for codes (`ARTICLE / 0042`), coordinates (`12.3456° N / 65.4321° E`), timestamps (`2026.10.08`), status brackets (`[ PUBLISHED ]`), index numbers on sections (`01 BODY`), dotted-leader data rows (`KEY ...... value`), tick-mark scales on dividers. |
| Generative art | Entries without an image get a **seeded procedural cover**: a small dithered grid in the palette plus one signal mark. Deterministic, subtle, never carrying information. |
| Clean grid | 4 px base grid; 12-column panel grid with 16 px gutters; 24 px panel padding. |
| Watch Dogs HUD, restrained | Thin lines, small caps data readouts, a faint 16 px grid or hatch texture only as non-essential decoration. No glow, no scanline overlay on content. |
| Y2K, a touch | Crisp techy mono, the one cyan "signal" accent used as tiny marks. No chrome, no gradients (the only gradients are the skeleton sweep and the nav scrim). |

## Tokens

All in `app.css`; light and dark keep the map's near-black / near-white family. Contrast values are tested (`lib/design-system.test.ts`) and shown live on `/dev/design`.

### Colour roles

| Role | Token | Light | Dark | Notes |
| --- | --- | --- | --- | --- |
| Page | `--background` | `#fbfbfb` | `#0a0a0a` | unchanged |
| Panel plate | `--surface` | `#f4f4f4` | `#121212` | the Frame's fill: one step off the page, replaces elevation |
| Sunken / hover | `--accent` | `#ececec` | `#1f1f1f` | hover rows, cover background; muted text stays AA on it, `--subtle-foreground` does not (4.25:1): never use subtle there |
| Text | `--foreground` / `--muted-foreground` | `#0a0a0a` / `#595959` | `#f5f5f5` / `#a3a3a3` | 18:1 / 6.4:1 on the surface (light) |
| Hairline / control line | `--border` / `--border-strong` | 14 % / 40 % ink | 16 % / 45 % ink | strong is 2.8:1 or more (control outline) |
| Texture | `--line-faint` | 7 % ink | 9 % ink | the 16 px grid and hatch only |
| **Accent (one)** | `--signal` | `#00698c` | `#38d4f5` | a cyan: 5.6:1 on the surface (light), 10.6:1 (dark). Fills use `--signal-foreground` (`#fbfbfb` / `#0a0a0a`, 6.0:1 / 11:1). `--signal-wash` is its 8 to 9 % plate for the active Frame. |
| Kind hues | `--kind-article` 275, `-project` 150, `-artwork` 55, `-poem` 340, `-place` (muted grey) | `oklch(.58 .10 H)` | `oklch(.76 .10 H)` | **faint and redundant** (see Kind coding) |
| Inverse set | `--inverse-background/-foreground/-muted/-border/-signal` | the dark scheme's ink on page | and vice versa | what an inverted Frame rebinds the colour tokens to |

The accent is for: the live / active state (brackets of the active Frame, `[ LIVE ]`, the index numbers of sections, the one or two marks on a cover), nothing else. The focus ring stays the foreground (it must never depend on the accent).

### Kind coding

Hue is only a redundant accent: each kind has a **glyph** on a 12 px grid (article: lines of text; project: terminal prompt `>_`; artwork: two filled squares in a frame; poem: centred verse lines; place: crosshair) AND its word, and the hue only tints the 20 px glyph cell (18 %) and the cover's lightest tone. Text is never set in a kind hue (they are not AA and need not be), so nothing relies on colour. `KindTag` is the one place the coding is rendered.

### Type

No web font is added. The sans and mono stacks of `design-tokens.md` are system fonts (zero bytes, no layout shift, native rendering), and the system mono already reads as the technical HUD face. Swapping to a vendored OFL face later is one token each (`--font-sans`, `--font-mono`); no component names a family.

| Use | Face | Size / line | Case |
| --- | --- | --- | --- |
| Full-screen title | sans 600, tracking tight | 48 / 52 (`text-4xl`) | sentence |
| Panel title | sans 600 | 28 / 34 (`text-2xl`); card title 22 / 30 | sentence |
| Summary | sans | 18 / 28, muted | sentence |
| Body | sans | 16 / 26.4 | sentence |
| Secondary | sans | 14 / 22 | sentence |
| Buttons, values | mono | 12 / 18, 0.08em | buttons uppercase |
| **Micro-label** (`.ds-micro`, `MicroLabel`) | mono, tabular, slashed zero | 11 / 16, 0.12em | UPPERCASE |

Micro-labels are for codes, keys, coordinates, stamps and statuses only, never sentences. 11 px is the floor for any text.

### Spacing, lines, layout

- 4 px base: Tailwind's scale (`gap-1` = 4 px). Panel padding 24 px (`--panel-pad`), 16 px inside cards and below `md`.
- `--hairline` 1 px for every frame, divider and control line; brackets 1 px stroke, 10 px long; tick scale: minor every 8 px (`--tick-step`), major every 40 px.
- 12-column grid, 16 px gutter (`--grid-gap`): `Grid` and `Col span spanMd`. Side panel (half the viewport, at least 440 px): one column of blocks. Full screen: reading column 8 + aside 4 (`spanMd`).
- Controls: `--control-h` 44 px below `md` (touch), 36 px from `md`; small 44 / 32 px.

### Elevation

None. No shadows. Separation is a hairline, the step from `--background` to `--surface`, the active Frame's wash, or an inverted Frame. The detail panel keeps its existing 85 % page colour with backdrop blur (it lets the map continue faintly beneath it); that is a panel property, not a component elevation.

### Motion

Durations are the existing tokens (`design-tokens.md`, "Motion"). Hover and focus colour changes use `--duration-fast` (120 ms); toggles, reveals and state changes `--duration-base` (220 ms); the panel slide `--duration-slow`. The map's own timed transitions (150 to 200 ms) sit between fast and base, so one product feels like one clock. Easing is always `--ease-standard`. Nothing moves on hover (no lift, no scale): only line, fill and bracket colour change. The loading skeleton's sweep is the one ambient loop (`--duration-scan`); under `prefers-reduced-motion` it is removed and the global rule collapses the rest to ~0.

### Focus and density

The global focus ring (2 px `--ring`, 2 px offset, square) applies to everything. An inverted Frame rebinds `--ring`, so it stays visible there. Cards keep one tab stop (the title link); hover and `:has(:focus-visible)` turn the brackets to the signal colour. Density is one knob, `--control-h`, plus the `sm` size; there is no separate compact theme.

## Components

All in `app/components/ui/`, importable from `~/components/ui` (barrel) or by file. All are presentational and composable: they take data, not routes or loaders.

| Component | Anatomy | States / variants |
| --- | --- | --- |
| `Frame` | hairline box on `--surface` + corner brackets (a pseudo-element, no markup) | `variant` plain, active (strong line, signal brackets, wash), inverted (opposite scheme tokens rebound for the subtree; brackets sit 4 px inside); `brackets`, `interactive` (cards: hover and focus-within), `padding` none, sm 12, md 16, lg 24; `as` element |
| `MicroLabel` | `.ds-micro` text | `tone` muted, strong, signal; `as` element |
| `KindTag` | 20 px square glyph cell + the kind's word | `iconOnly` (word stays for assistive tech), `solid` (selected) |
| `StatusTag` | `[ PUBLISHED ]`; the brackets are `aria-hidden` | published, draft, live (adds a signal square), archived, pending, error (solid); any string; `tone` default, muted, signal, solid, signal-solid |
| `DataList`, `DataRow` | `dl > div > dt + dd`; the dotted leader is the key's `::after` | `mono` values; keys wrap on narrow screens |
| `Divider` | hairline, optional tick scale, optional set-in label | `ticks`, `label`, `decorative` (default; `false` renders an `hr`) |
| `Button` | square, mono caps, 1 px line, 44 px high below md | `primary`, `secondary`, `ghost`, `link` (`default` and `outline` kept as aliases of primary / secondary); size default, sm; hover, focus-visible, disabled; `asChild` |
| `IconButton` | square `Button` with a 16 px glyph; `label` is required (the accessible name) | same variants |
| `Toggle` | `Button` with `aria-pressed`; pressed = inverted fill | name never changes with state |
| `ExpandToggle` | `Toggle` of the panel / full-screen switch; glyph swaps outward / inward corners | `expanded`, `showLabel` (footer: glyph + "Full screen"), size |
| `SegmentedControl` | group of `Toggle`s sharing 1 px lines (wraps on phones) | one value; scheme or kind filters |
| `CoverArt` | inline SVG of a dithered grid; `aria-hidden`; box takes the grid's aspect ratio | `seed`, `kind` (tint), `cols`, `rows`, `pattern` (field, bars, rings, stream, lattice; default: the seed picks) |
| `MetadataStrip` | `dl` of `LABEL / value` cells between two hairlines | wraps below md |
| `SectionHeader` | `01` index (signal) + heading in micro type + rule filling the row + right annotation | `as` h2, h3, h4; `meta` |
| `TagList` | `ul` of square outlined chips | static or links (44 px hit area on phones via `::before`) |
| `Stack`, `Grid`, `Col` | flex column with a 4 px-scale gap; the 12-column grid; a column with `span` / `spanMd` | |
| `Skeleton`, `StatePanel` | skeleton block with a scan sweep; the three non-content states; `headingLevel` (1 to 4) and `titleId` (focus target) | `state` loading (polite `role=status`, `aria-busy`), empty, error (`role=alert`, `ERR / 500` code, `[ ERROR ]`, a retry action) |
| `EntryCard` | cover (authored image or generated) + kind tag and `№ 0042` + title + two-line summary + status + metadata strip + tags (`tags`, `linkState`, `id` are optional) | one link (the title), stretched over the card with `::after`; hover and focus-within brackets |
| `Glyph`, `RegMark` | the glyph set (5 kinds, close, expand, collapse, arrows) and the registration crosshair | decorative (`aria-hidden`) |

### Generative cover art

`lib/cover-art.ts`: `coverArt(seed, { cols, rows, pattern })` is a pure function of the seed (FNV-1a hash, mulberry32 generator, 4x4 Bayer dither): a `Uint8Array` of tonal levels 0 to 3, plus one or two signal marks, all within the grid; sizes clamp to 4..96 cells. `coverPaths` merges horizontal runs into one SVG path per level. Same seed gives the same art on the server and in the browser (no hydration mismatch, nothing stored). Level 1 is the kind's hue at 22 %, levels 2 and 3 are the ink at 20 % and 42 %, the marks are `--signal`. Use the entry's slug or id as the seed (stable across edits).

### Entry view (the panel and the full-screen view)

Implemented: `components/entry/entry-view.tsx` (one component for both containers), `components/entry/blocks.tsx` (the body renderer),
`components/place-detail.tsx` (the place), `components/entry-list-page.tsx` (the four list pages). Routes, URL scheme and focus rules:
[web-architecture.md](web-architecture.md#entries-in-the-shell-routes-containers-url-scheme).

Same content, two layouts; `layout` only changes the grid, never the data, the DOM order or the focus order.

```
<article aria-labelledby="panel-heading">                          // panel: half the viewport; full screen: max-w-6xl column
  [Back to <place>]                                                // only when opened from a place panel
  KindTag(iconOnly)  "ARTICLE / 0004"  date  [ STATUS ]            // micro-labels
  h1#panel-heading (text-2xl; text-3xl / 4xl full)                 // the view's one h1, focus target
  summary
  Frame: DataList (meta pairs) + TagList + "Open host" primary button (https only, new tab note)
  Cover: authored image (width/height set) or CoverArt seeded by the slug, in a Frame
  Body: BlockRenderer (h2 / h3, paragraphs, lists, quote, image, verse, code, link cards, divider)
  01 PLACES (links to /locations/:slug)  02 RELATED  prev / next of the kind
```

Panel: one column. Full screen: title (8 columns) with the details frame (4), then reading column (8: cover and body) with the aside
(4: places, related, neighbours). The header row of the container (Close, `ExpandToggle`) is the panel's, not the view's: it must stay
clear of the navbar's links (and, in full screen, of its logo). The footer toggle of the first sketch was dropped: two controls with
the same name are noise, the header one is always reachable. The `PanelMock` in `routes/dev-design.tsx` is the early sketch of the
shape. Lists of entries use `EntryCard` (via `EntryListCard`) in a `Grid` (`Col spanMd={6}`); an empty list is a `StatePanel`
(`headingLevel` 2 under the page's h1).

Body blocks (all plain text, no inner HTML anywhere; a test scans the components for it): `paragraph` (hard line breaks as `<br>`),
`heading` (h2/h3 with a numbered micro-prefix `§ 1`, `§ 1.1` and a stable anchor id), `list` (square markers / mono numerals),
`quote` (hairline rule, cite as micro-label), `image` (hairline frame, width/height to avoid layout shift, lazy, caption as a
micro-label; an unsafe path is dropped), `verse` (mono face so that indentation lines up, one paragraph per stanza, a block per line
with its leading spaces as a `ch` offset and a 2ch hanging indent when it wraps), `code` (a Frame with the language as a label, a
horizontally scrollable focusable `pre`, a copy button that exists only once hydrated and where the clipboard API does), `link`
(consecutive links form one list of cards; https only, `rel="noopener noreferrer"`, new-tab note for assistive tech; an invalid URL
is shown as plain text), `divider` (a `hr` with ticks; leading, trailing and repeated dividers are dropped). The pure parts live in
`lib/entry-blocks.ts`.

## Accessibility rules

- Contrast: all text AA (4.5:1) in both schemes on the page, the surface and, for muted text, the hover grey; body text 7:1 or more; control outlines 2.8:1 or more; the hairlines are deliberately quiet (decorative). `--subtle-foreground` only on the page and the surface. Enforced by `design-system.test.ts`.
- Hue never carries meaning: kind = glyph + word, status = the bracketed word, error = the word and an inverted tag, selected = inverted fill and `aria-pressed`.
- Touch targets 44 px below `md` (`--control-h`, link tags' `::before`, related rows `min-h-11`).
- Keyboard: DOM order is reading order (header controls, title, sections, footer); one tab stop per card; toggles are real buttons with `aria-pressed`; Escape behaviour stays the panel's.
- Focus is always visible (global ring); no component removes the outline except the card link, whose frame shows the focus instead (`:has(:focus-visible)` brackets and line).
- No text in images: covers are generated art with no glyphs and are `aria-hidden`; authored images need `alt`.
- Decoration (grid, hatch, ticks, registration marks, brackets) is `aria-hidden` or pure CSS and removable without losing information. Forced colours: brackets fall back to a plain border, pressed buttons use `Highlight`.
- Reduced motion: no ambient animation, transitions collapse to ~0.
- Live regions: loading is `role=status`, errors `role=alert`.

## Dev styleguide

`/dev/design` (`routes/dev-design.tsx`) is guarded exactly like `/dev/street`: `routes.ts` registers it only when `NODE_ENV !== "production"` or the build sets `CATALYST_DEV_ROUTES=1`, and its loader answers 404 anywhere else. Production builds contain neither the route nor its sample strings (made-up placeholders only). `?scheme=light|dark` or the on-page toggle sets `data-scheme` on `<html>`; the "Both schemes" section forces each scheme per block, whatever the toggle says.
