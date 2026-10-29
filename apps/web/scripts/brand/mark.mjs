// The site's mark, as data: a 16 x 16 pixel grid, one bit per cell. Two plain shapes, a square (the bounding box) and a disc (the
// globe), overlapping; where they overlap the ink is knocked out (exclusive or). Nothing else: no outline, no gradient, no texture,
// no word. It reads at 16 px, sits beside a wordmark as it is (the studio look of the site: heavy type, hairlines, one geometric
// shape), and the pixel cells are the grid's own, so it stays on the globe's pixel-art footing. It renders identically at any whole
// multiple of 16 px.
//
// Everything that shows the mark is derived from `MARK` (scripts/brand/build.mjs writes public/favicon.svg and the PNG icons;
// app/components/ui/logo-mark.tsx carries the same path and a test compares the two). Change the mark here, run `pnpm --filter
// @catalyst/web brand`, copy the path into the component (the test says when they differ).

export const GRID = 16;

/** `#` is ink, `.` is empty. 16 rows of 16 cells. */
export const MARK = [
  "##########......",
  "##########......",
  "##########......",
  "##########......",
  "########..##....",
  "######....####..",
  "#####.....#####.",
  "#####.....#####.",
  "####......######",
  "####......######",
  "....############",
  "....############",
  ".....##########.",
  ".....##########.",
  "......########..",
  "........####....",
];

/** The mark as one SVG path (`d`): each horizontal run of ink cells is a `h` rectangle, in grid units. Integer coordinates only. */
export function markPath(rows = MARK) {
  const runs = [];
  rows.forEach((row, y) => {
    for (const m of row.matchAll(/#+/g)) runs.push(`M${m.index} ${y}h${m[0].length}v1h-${m[0].length}z`);
  });
  return runs.join("");
}

/**
 * A standalone SVG of the mark at `px` CSS px (a whole multiple of 16 is crisp). `fill` is a colour, or `null` for the scheme-aware
 * favicon: ink follows `prefers-color-scheme` (near-black on light, near-white on dark; the two page colours of app.css).
 */
export function markSvg({ px = 32, fill = null, rows = MARK } = {}) {
  const d = markPath(rows);
  if (fill) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="${px}" height="${px}" shape-rendering="crispEdges"><path fill="${fill}" d="${d}"/></svg>\n`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="${px}" height="${px}" shape-rendering="crispEdges">
  <style>path{fill:#0a0a0a}@media (prefers-color-scheme:dark){path{fill:#f5f5f5}}</style>
  <path d="${d}"/>
</svg>
`;
}

// The favicon and the app icons are NOT the mark: they are the blue-screen frown ":(" turned on its side (the owner's handle, BSoDium), on the blue
// screen's own blue, the same 16 x 16 pixel footing. Two eyes and a mouth that is an arc opening to the right; 10 x 10 cells, centred on the grid.
// The mark above stays the site's logo (the header, `logo-mark.tsx`).
export const FACE = [
  "................",
  "................",
  "................",
  "...........##...",
  "...##.....##....",
  "...##....##.....",
  "........##......",
  "........##......",
  "........##......",
  "........##......",
  "...##....##.....",
  "...##.....##....",
  "...........##...",
  "................",
  "................",
  "................",
];

/** The blue of the blue screen of death (Windows 10 and 11), the tile behind the face. */
export const FACE_TILE = "#0078d7";
export const FACE_INK = "#ffffff";

/** The favicon: the face on its blue tile, the same in both colour schemes (a blue square reads on a light tab and a dark one). */
export function faceSvg({ px = 32 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="${px}" height="${px}" shape-rendering="crispEdges">
  <rect width="${GRID}" height="${GRID}" fill="${FACE_TILE}"/>
  <path fill="${FACE_INK}" d="${markPath(FACE)}"/>
</svg>
`;
}
