import { describe, expect, it } from "vitest";
import { cardPosition, formatDay, formatValue, outlinePath } from "./overlay-math";
import { placeholderMarkup } from "./placeholder";

describe("outlinePath", () => {
  it("turns the points into a closed path", () => {
    expect(outlinePath("1.0,2.0 3.5,4.0 5,6")).toBe("M1.0 2.0L3.5 4.0L5 6Z");
    expect(outlinePath("")).toBe("");
  });
});

describe("cardPosition", () => {
  const box = { width: 800, height: 300 };
  const card = { width: 200, height: 80 };
  it("hangs above the column, centred", () => {
    expect(cardPosition({ x: 400, y: 200 }, box, card)).toEqual({ x: 300, y: 106, below: false });
  });
  it("goes below when there is no room above", () => {
    expect(cardPosition({ x: 400, y: 40 }, box, card)).toMatchObject({ y: 54, below: true });
  });
  it("stays inside the box", () => {
    expect(cardPosition({ x: 5, y: 200 }, box, card).x).toBe(8);
    expect(cardPosition({ x: 795, y: 200 }, box, card).x).toBe(800 - 8 - 200);
  });
});

describe("formatters", () => {
  it("reads a date in UTC and a value", () => {
    expect(formatDay("2026-11-19", "en")).toBe("Thu, Nov 19, 2026");
    expect(formatValue(3)).toBe("3");
    expect(formatValue(3.46)).toBe("3.5");
  });
});

describe("placeholderMarkup", () => {
  it("is the same SVG for the same inputs (server and browser), fitted to the aspect", () => {
    const a = placeholderMarkup({ strips: 1, aspect: 4 });
    expect(a).toBe(placeholderMarkup({ strips: 1, aspect: 4 }));
    expect(a).toContain("<svg");
    expect(a).not.toBe(placeholderMarkup({ strips: 4, aspect: 0.8 }));
  });
});

describe("cardPosition in a narrow box", () => {
  it("never puts the card outside a box wider than the card, and centres it in one that is not", () => {
    const card = { width: 256, height: 90 };
    for (const x of [0, 10, 195, 380, 390]) {
      const p = cardPosition({ x, y: 200 }, { width: 390, height: 400 }, card);
      expect(p.x).toBeGreaterThanOrEqual(8 - 0.001);
      expect(p.x + card.width).toBeLessThanOrEqual(390 - 8 + 0.001);
    }
    expect(cardPosition({ x: 30, y: 200 }, { width: 200, height: 400 }, card).x).toBe(200 / 2 - 128);
  });
});
