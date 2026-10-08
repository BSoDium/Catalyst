import { describe, expect, it } from "vitest";
import { countryName, stripCountry } from "./country-names";

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

describe("stripCountry: a name that already carries its own country", () => {
  it("removes a trailing ', <country>' when it is the place's own country", () => {
    expect(stripCountry("London, United Kingdom", "GB")).toBe("London");
    expect(stripCountry("New York, United States", "US")).toBe("New York");
    expect(stripCountry("Bogotá, Colombia", "CO")).toBe("Bogotá");
    expect(stripCountry("Saint-Denis, France ", "FR")).toBe("Saint-Denis");
  });
  it("is case-insensitive on the country, and keeps the name's own case", () => {
    expect(stripCountry("Hanoi, VIETNAM", "VN")).toBe("Hanoi");
  });
  it("only the place's own country, only at the end, only the whole tail", () => {
    expect(stripCountry("Kingston, Jamaica", "GB")).toBe("Kingston, Jamaica"); // another country
    expect(stripCountry("Colombia, Bogotá", "CO")).toBe("Colombia, Bogotá"); // not at the end
    expect(stripCountry("Cali, Colombia Norte", "CO")).toBe("Cali, Colombia Norte");
    expect(stripCountry("Georgia, Atlanta", "US")).toBe("Georgia, Atlanta");
    expect(stripCountry("Paris, Texas", "FR")).toBe("Paris, Texas");
  });
  it("a name that is only the country, or no known country, is left alone", () => {
    expect(stripCountry("Colombia", "CO")).toBe("Colombia");
    expect(stripCountry(", Colombia", "CO")).toBe(", Colombia");
    expect(stripCountry("London, United Kingdom", undefined)).toBe("London, United Kingdom");
    expect(stripCountry("London, United Kingdom", "ZZ")).toBe("London, United Kingdom");
  });
});
