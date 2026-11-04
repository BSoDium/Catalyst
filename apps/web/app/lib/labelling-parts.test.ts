import { describe, expect, it } from "vitest";
import { formatPlaceCoordinates, placeCoordinateParts } from "./labelling";

describe("placeCoordinateParts", () => {
  it("cuts each coordinate at the decimals it is stored with, and writes the same text as formatPlaceCoordinates", () => {
    const [lat, lon] = placeCoordinateParts(52.23, -21.0117)!;
    expect(lat).toEqual({ whole: "52", fraction: ".23", hemisphere: "N", text: "52.23° N" });
    expect(lon).toEqual({ whole: "21", fraction: ".0117", hemisphere: "W", text: "21.0117° W" });
    expect(formatPlaceCoordinates(52.23, -21.0117)).toBe("52.23° N, 21.0117° W");
  });
  it("has no fraction for a whole number, and is null out of range", () => {
    expect(placeCoordinateParts(10, 20)![0]).toMatchObject({ whole: "10", fraction: "" });
    expect(placeCoordinateParts(91, 0)).toBeNull();
    expect(placeCoordinateParts(NaN, 0)).toBeNull();
  });
});
