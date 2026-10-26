import { describe, expect, it } from "vitest";
import { SMOOTH_DEFAULT, parseSmooth } from "./smooth";

describe("the smooth experiment's flag", () => {
  it("asks for nothing without the flag, the default for a bare one, and a number within 0 and 1 for a value", () => {
    expect(parseSmooth(null)).toBeNull();
    expect(parseSmooth("")).toBe(SMOOTH_DEFAULT);
    expect(parseSmooth("0.3")).toBe(0.3);
    expect(parseSmooth("1")).toBe(1);
    expect(parseSmooth("0")).toBe(0);
    expect(parseSmooth("7")).toBe(1);
    expect(parseSmooth("-2")).toBe(0);
    expect(parseSmooth("nonsense")).toBe(SMOOTH_DEFAULT);
  });
});
