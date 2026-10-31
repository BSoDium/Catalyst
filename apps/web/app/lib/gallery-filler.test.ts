import { describe, expect, it } from "vitest";
import { layoutMasonry, SLOT } from "./masonry";
import { GALLERY_FILLER, planFiller } from "./gallery-filler";

const height = (t: { count: number; ratio: number }) => t.ratio + t.count * SLOT;

describe("the gallery filler", () => {
  it("gives every wall at least two rows", () => {
    const plan = planFiller([0.67, 1.25, 0.67]);
    for (const columns of [1, 2, 3, 4]) expect(plan.count(columns)).toBeGreaterThanOrEqual(2 * columns);
  });
  it("ends every wall in filler, below the last picture, so a flush cut never touches one", () => {
    for (const real of [[], [0.67], [0.67, 1.25, 0.67, 0.8, 1.5, 0.67, 1, 0.75, 1.3], Array(18).fill(0.75)]) {
      const plan = planFiller(real);
      for (const columns of [1, 2, 3, 4]) {
        const ratios = [...real, ...plan.tiles.slice(0, plan.count(columns)).map((p) => Math.min(2, Math.max(0.4, p.height / p.width)))];
        const totals = layoutMasonry(ratios, columns).totals;
        const tallestReal = Math.max(0, ...layoutMasonry(real, columns).totals.map(height));
        expect(Math.min(...totals.map(height))).toBeGreaterThanOrEqual(tallestReal + 1 - 1e-9);
      }
    }
  });
  it("carries a tile in each wall that counts it, and the counts are a prefix of the tiles", () => {
    const plan = planFiller([0.67, 1.25, 0.67]);
    plan.tiers.forEach((columns, i) => {
      for (const c of [1, 2, 3, 4]) expect(columns.includes(c)).toBe(plan.count(c) > i);
    });
    expect(plan.tiles).toHaveLength(Math.max(...[1, 2, 3, 4].map((c) => plan.count(c))));
  });
  it("points at media files of the demo set", () => {
    for (const p of GALLERY_FILLER) expect(p.src).toMatch(/^\/media\/demo\/stock-[a-z-]+\.jpg$/);
  });
});
