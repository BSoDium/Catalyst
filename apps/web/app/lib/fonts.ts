/**
 * The self-hosted type (docs/design-tokens.md, "Typography"). The files are in `public/fonts/` and declared with `@font-face` in
 * `app.css`; their names carry the package version (@fontsource-variable 5.3.0) so `vercel.json` can cache them `immutable` for a
 * year: a new cut is a new name. `fonts.test.ts` keeps the CSS, this list and the folder in step.
 */
export const FONT_DIR = "/fonts/";

export const FONT_FILES = {
  /** Bricolage Grotesque, wght 200-800 and opsz 12-96 (the display cut is the one the headlines use at 96). */
  display: "bricolage-grotesque-5.3.0-latin-wght-opsz.woff2",
  /** Newsreader, wght 200-800 and opsz 6-72, roman and italic: the reading face (the headline and the poem's title use its display optical sizes). */
  reading: "newsreader-5.3.0-latin-wght-opsz.woff2",
  readingItalic: "newsreader-5.3.0-latin-wght-opsz-italic.woff2",
  /** JetBrains Mono, wght 100-800: page metadata only (the map's text stays the system mono stack). */
  meta: "jetbrains-mono-5.3.0-latin-wght.woff2",
} as const;

/** The one file the home page asks for before the stylesheet's `@font-face` is even matched: the navigation's text is set in it. */
export const DISPLAY_FONT_URL = `${FONT_DIR}${FONT_FILES.display}`;

/** The faces a trip card's giant word can be set in besides the three above (components/trip-map.tsx `FACES`, #510): declared in `app.css` and fetched only when a card uses one, never preloaded. */
export const POSTER_FONT_FILES = {
  /** Bitter, wght 100-900. */
  slab: "bitter-5.3.0-latin-wght.woff2",
  /** Archivo, wght 100-900 and wdth 62-125 (the width axis condenses a long word without squeezing its glyphs). */
  condensed: "archivo-5.3.0-latin-wdth-wght.woff2",
  /** Caveat, wght 400-700. */
  script: "caveat-5.3.0-latin-wght.woff2",
} as const;
