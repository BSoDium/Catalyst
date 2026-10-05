import { describe, expect, it } from "vitest";
import { panelInset } from "./layout";

describe("panelInset", () => {
  it("is half the viewport while the panel is open on desktop", () => {
    expect(panelInset(1440, true, false)).toBe(720);
    expect(panelInset(1025, true, false)).toBe(513);
  });
  it("is zero when closed, on mobile, or before the viewport is known", () => {
    expect(panelInset(1440, false, false)).toBe(0);
    expect(panelInset(390, true, true)).toBe(0);
    expect(panelInset(0, true, false)).toBe(0);
    expect(panelInset(Number.NaN, true, false)).toBe(0);
  });
});
