import { describe, expect, it } from "vitest";
import { cardPlace } from "./moon-overlay";

describe("cardPlace", () => {
  const W = 412;
  const H = 915;
  const card = { w: 230, h: 110 };

  it("is to the right of the moon, centred on it, where there is room", () => {
    const p = cardPlace({ x: 60, y: 300, r: 12 }, card.w, card.h, W, H);
    expect(p.side).toBe("right");
    expect(p.y).toBeCloseTo(300 - card.h / 2, 5);
  });

  it("is to the left where it does not fit on the right", () => {
    expect(cardPlace({ x: 380, y: 300, r: 12 }, card.w, card.h, W, H).side).toBe("left");
  });

  it("goes below, its left edge on the moon's, where it fits on neither side", () => {
    const p = cardPlace({ x: 206, y: 300, r: 12 }, card.w, card.h, W, H);
    expect(p.side).toBe("below");
    expect(p.y).toBeGreaterThan(300 + 12);
    expect(p.x + card.w).toBeLessThanOrEqual(W - 8);
  });

  it("goes above where there is no room below, and stays inside the window", () => {
    const p = cardPlace({ x: 330, y: H - 40, r: 12 }, card.w, card.h, W, H);
    expect(p.side).toBe("above");
    expect(p.y + card.h).toBeLessThanOrEqual(H - 40 - 12);
    expect(p.x).toBeGreaterThanOrEqual(8);
    expect(p.x + card.w).toBeLessThanOrEqual(W - 8);
  });
});
