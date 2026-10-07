import { describe, expect, it } from "vitest";
import { countryName, placeLabelTexts } from "./country-names";

describe("country names", () => {
  it("English region names, including codes outside ISO 3166-1 proper that CLDR knows", () => {
    expect(countryName("CO")).toBe("Colombia");
    expect(countryName("VN")).toBe("Vietnam");
    expect(countryName("XK")).toBe("Kosovo");
  });
  it("unknown, malformed or missing codes give no name", () => {
    for (const c of [undefined, "", "ZZ", "fr", "FRA", "F1", "  "]) expect(countryName(c as string | undefined), String(c)).toBeNull();
  });
});

describe("place label texts: the country goes on the only place of its country", () => {
  it("counts over every place given, not what is in view", () => {
    const t = placeLabelTexts([
      { name: "Bogotá", countryCode: "CO" },
      { name: "Paris", countryCode: "FR" },
      { name: "Lyon", countryCode: "FR" },
      { name: "Hanoi", countryCode: "VN" },
      { name: "Nowhere" },
      { name: "Odd", countryCode: "ZZ" },
    ]);
    expect(t).toEqual(["Bogotá, Colombia", "Paris", "Lyon", "Hanoi, Vietnam", "Nowhere", "Odd"]);
  });
});
