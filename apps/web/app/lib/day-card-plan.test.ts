import { describe, expect, it } from "vitest";
import { CARD_W, plan, route } from "./day-card-plan";

// a column's outline: a hexagon-ish silhouette, its top edge between (100,100) and (112,100)
const COLUMN = "100,100 112,100 120,108 120,170 100,172 92,164 92,108";
const view = { width: 1400, height: 360 };

describe("the day card's place", () => {
  it("is above the column, the connector leaving the middle of the top edge", () => {
    const low = "100,300 112,300 120,308 120,370 100,372 92,364 92,308";
    const p = plan(low, { width: 1400, height: 600 }, null, 124);
    expect(p?.mode).toBe("top");
    expect(p?.from[0]).toBeCloseTo(106, 5);
    expect(p?.from[1]).toBe(300);
    expect(p!.y + 124).toBeLessThan(300); // clear of the outline
  });
  it("goes 45 degrees to the side, from the protruding corner, where there is no room above", () => {
    const p = plan(COLUMN, view, null, 124); // above would end 58 px over the picture's top: allowed down to -48, so not
    expect(p?.mode).toBe("right");
    expect(p?.from).toEqual([120, 108]); // the right-hand top corner, not the left one
    const l = plan("1300,100 1312,100 1320,108 1320,170 1300,172 1292,164 1292,108", view, null, 124);
    expect(l?.mode).toBe("left");
    expect(l?.from).toEqual([1292, 108]);
  });
  it("keeps card and connector clear of the figures", () => {
    const figures = { x: 40, y: -140, w: 400, h: 120 };
    const p = plan("200,10 212,10 220,18 220,80 200,82 192,74 192,18", { width: 1400, height: 360 }, figures, 124)!;
    const card = { x: p.x, y: p.y, w: CARD_W, h: 124 };
    const hit = card.x < figures.x + figures.w && figures.x < card.x + card.w && card.y < figures.y + figures.h && figures.y < card.y + card.h;
    expect(hit).toBe(false);
  });
});

describe("the connector", () => {
  it("is straight up, then 45 degrees into the foot where the card's middle is off the edge's middle", () => {
    expect(route("top", [106, 100], { x: 110, y: -50, w: CARD_W, h: 124 })).toBe("M106 100L106 90L122 74");
    expect(route("top", [106, 100], { x: 60, y: -50, w: CARD_W, h: 124 })).toBe("M106 100L106 74L106 74");
  });
  it("is 45 degrees then flat at the side", () => {
    expect(route("right", [120, 108], { x: 170, y: 40, w: CARD_W, h: 124 })).toBe("M120 108L164 64L170 64");
    expect(route("left", [92, 108], { x: -250, y: 40, w: CARD_W, h: 124 })).toBe("M92 108L48 64L-10 64");
  });
});
