import { layoutMasonry, SLOT } from "~/lib/masonry";

/**
 * The generic photographs that continue the photography wall under its end banner (docs/design-system.md, "Artwork wall"): stock images
 * of the demo set (Pexels licence, credited in `public/media/demo-stock.NOTICE.txt`), drawn faded out, without a link, a caption or an
 * accessible name: they are scenery, not the owner's work. Temporary: the banner and its filler go when the gallery's storage moves to the
 * owner's own bucket (issue #336).
 */
export interface FillerPhoto {
  src: string;
  width: number;
  height: number;
}

/**
 * A tile of generated art (the artworks' wall has no stock images to continue it with): drawn by `CoverArt` from the seed, in the same faded way
 * as the photographs, with the tile's proportions.
 */
export interface FillerArt {
  seed: string;
  width: number;
  height: number;
}

/** What continues a wall under its banner: a stock photograph or a generated tile. */
export type FillerTile = FillerPhoto | FillerArt;

/** The artworks' filler: generated covers of varied proportions (the seeds are fixed, so the wall is the same every time). */
export const ARTWORK_FILLER: readonly FillerArt[] = [
  { seed: "wall-filler-b", width: 4, height: 5 },
  { seed: "wall-filler-a", width: 4, height: 3 },
  { seed: "wall-filler-c", width: 1, height: 1 },
  { seed: "wall-filler-d", width: 3, height: 2 },
  { seed: "wall-filler-e", width: 3, height: 4 },
  { seed: "wall-filler-f", width: 4, height: 3 },
  { seed: "wall-filler-g", width: 1, height: 1 },
];

/** The first tile is a portrait: a phone's wall (one column) carries only that one (the banner lies on it), and it must be tall enough for the banner and for "the wall ends in filler" (`planFiller`). */
export const GALLERY_FILLER: readonly FillerPhoto[] = [
  { src: "/media/demo/stock-photo-archway-rain.jpg", width: 800, height: 1000 },
  { src: "/media/demo/stock-photo-breakwater.jpg", width: 1200, height: 800 },
  { src: "/media/demo/stock-photo-ridges.jpg", width: 1200, height: 800 },
  { src: "/media/demo/stock-photo-platform-sign.jpg", width: 800, height: 800 },
  { src: "/media/demo/stock-cliff-bus.jpg", width: 1200, height: 630 },
  { src: "/media/demo/stock-altiplano-lake.jpg", width: 1200, height: 630 },
  { src: "/media/demo/stock-night-platform.jpg", width: 1200, height: 630 },
];

export interface FillerPlan {
  /** The tiles to draw, in order: the photographs, repeated in a cycle if a wide wall needs more than there are. */
  tiles: FillerTile[];
  /** For each tile, the numbers of columns (1 to 4) of the walls that carry it. */
  tiers: number[][];
  /** How many tiles a wall of `columns` columns carries (the first ones). */
  count: (columns: number) => number;
}

const COLUMNS = [1, 2, 3, 4] as const;
const ratioOf = (p: FillerTile) => Math.min(2, Math.max(0.4, p.height / p.width));
/** In ratio units, a column's height. */
const heightOf = (t: { count: number; ratio: number }) => t.ratio + t.count * SLOT;

/**
 * How many filler tiles each wall needs: at least two rows (twice the columns; ONE tile on one column), more until the SHORTEST column ends more than one
 * column width below the longest column of pictures, so that the wall, cut flush at its shortest column (`masonryListVars`' `flush`),
 * never cuts a real picture and always ends in filler.
 */
export function planFiller(realRatios: readonly number[], photos: readonly FillerTile[] = GALLERY_FILLER): FillerPlan {
  const at = (i: number) => photos[i % photos.length]!;
  const counts: number[] = [];
  for (const columns of COLUMNS) {
    const real = layoutMasonry(realRatios, columns).totals;
    const tallest = Math.max(0, ...real.map(heightOf));
    // at least two rows, except on one column (a phone: there is no brick layout to continue, ONE tile, under the banner, is enough: owner, 2026-11-02, #539)
    let k = columns === 1 ? 1 : 2 * columns;
    for (; k < 4 * columns; k++) {
      const totals = layoutMasonry([...realRatios, ...Array.from({ length: k }, (_, i) => ratioOf(at(i)))], columns).totals;
      if (Math.min(...totals.map(heightOf)) >= tallest + 1) break;
    }
    counts.push(k);
  }
  const total = Math.max(...counts);
  return {
    tiles: Array.from({ length: total }, (_, i) => at(i)),
    tiers: Array.from({ length: total }, (_, i) => COLUMNS.filter((c, ci) => counts[ci]! > i)),
    count: (columns) => counts[columns - 1] ?? 0,
  };
}
