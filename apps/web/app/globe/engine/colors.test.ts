import { describe, expect, it } from "vitest";
import { over, parseCssColor } from "./colors";

describe("parseCssColor", () => {
  it("parses computed rgb() and rgba()", () => {
    expect(parseCssColor("rgb(251, 251, 251)")).toEqual({ rgb: [251 / 255, 251 / 255, 251 / 255], a: 1 });
    expect(parseCssColor("rgba(0, 0, 0, 0.14)")?.a).toBeCloseTo(0.14);
  });
  it("parses the space syntax with a slash alpha", () => {
    const c = parseCssColor("rgb(255 255 255 / 0.45)");
    expect(c?.rgb).toEqual([1, 1, 1]);
    expect(c?.a).toBeCloseTo(0.45);
    expect(parseCssColor("rgb(0 0 0 / 40%)")?.a).toBeCloseTo(0.4);
  });
  it("parses color(srgb ...) and hex", () => {
    expect(parseCssColor("color(srgb 1 0.5 0 / 0.5)")).toEqual({ rgb: [1, 0.5, 0], a: 0.5 });
    expect(parseCssColor("#0a0a0a")?.rgb[0]).toBeCloseTo(10 / 255);
    expect(parseCssColor("#fff")?.rgb).toEqual([1, 1, 1]);
  });
  it("returns null for what it does not understand", () => {
    expect(parseCssColor("oklch(0.5 0.1 200)")).toBeNull();
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor("rgb(a, b, c)")).toBeNull();
  });
});

describe("over", () => {
  it("composites translucent ink onto a fill", () => {
    const r = over({ rgb: [0, 0, 0], a: 0.5 }, [1, 1, 1]);
    expect(r[0]).toBeCloseTo(0.5);
    expect(over({ rgb: [0.2, 0.3, 0.4], a: 1 }, [1, 1, 1])).toEqual([0.2, 0.3, 0.4]);
  });
});
