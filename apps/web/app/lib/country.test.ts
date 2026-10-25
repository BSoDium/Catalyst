import { EMPTY_PROJECTION, type PublishedProjection } from "@catalyst/schemas";
import { describe, expect, it } from "vitest";
import { countryGroupOf, countryPath, entryCountry, parseCountryParam } from "./country";
import { getEntryDetail, listEntries } from "./entries";

const group = (slug: string, kind: "continent" | "country" | "area", parent?: string) => ({ slug, name: slug[0]!.toUpperCase() + slug.slice(1), kind, ...(parent ? { parent } : {}) });
const groups = [group("americas", "continent"), group("brazil", "country", "americas"), group("jutai-area", "area", "brazil"), group("peru", "country", "americas")];
const places = [
  { countryCode: "BR", group: "jutai-area" },
  { countryCode: "BR", group: "brazil" },
  { countryCode: "PE", group: "peru" },
  { countryCode: "CO", group: "americas" },
];

describe("countryGroupOf: the country group an ISO code frames", () => {
  it("walks up from the places of that country to the first country group (through areas)", () => {
    expect(countryGroupOf("BR", places, groups)).toBe("brazil");
    expect(countryGroupOf("PE", places, groups)).toBe("peru");
  });
  it("is null with no place in the country, or no country group above them", () => {
    expect(countryGroupOf("FR", places, groups)).toBeNull();
    expect(countryGroupOf("CO", places, groups)).toBeNull();
  });
  it("cannot loop on a cycle of parents", () => {
    expect(countryGroupOf("XX", [{ countryCode: "XX", group: "a" }], [{ slug: "a", kind: "area", parent: "b" }, { slug: "b", kind: "area", parent: "a" }])).toBeNull();
  });
});

describe("entryCountry", () => {
  it("names the country after its group and links the home page framed on it", () => {
    expect(entryCountry("BR", places, groups)).toEqual({ code: "BR", name: "Brazil", href: "/?country=BR" });
  });
  it("names a country with no group by its English name, with no link (nothing to frame)", () => {
    expect(entryCountry("FR", places, groups)).toEqual({ code: "FR", name: "France" });
  });
  it("is undefined without a code", () => {
    expect(entryCountry(undefined, places, groups)).toBeUndefined();
  });
});

describe("the ?country= parameter", () => {
  it("reads an ISO code, case-insensitively, and nothing else", () => {
    expect(parseCountryParam(countryPath("BR").slice(1))).toBe("BR");
    expect(parseCountryParam("?country=pe")).toBe("PE");
    for (const s of ["", "?country=", "?country=BRA", "?country=1a", "?tag=x"]) expect(parseCountryParam(s), s).toBeNull();
  });
});

describe("an entry located only by its country", () => {
  const projection: PublishedProjection = {
    ...EMPTY_PROJECTION,
    places: [{ slug: "manaus", name: "Manaus", coordinates: { lat: -3.1, lon: -60 }, labelPriority: 1, body: [], images: [], related: [], group: "brazil", countryCode: "BR" }],
    groups: [{ slug: "brazil", name: "Brazil", kind: "country", coordinates: { lat: -3.1, lon: -60 }, viewRadiusKm: 100, labelPriority: 1 }],
    photographs: [{ slug: "deck", title: "Deck", placeSlugs: [], countryCode: "BR" }],
  };
  it("carries the country in the list and the detail, and no place lists it", () => {
    expect(listEntries(projection, "photograph")[0]!.country).toEqual({ code: "BR", name: "Brazil", href: "/?country=BR" });
    const detail = getEntryDetail(projection, "photograph", "deck")!;
    expect(detail.places).toEqual([]);
    expect(detail.country?.name).toBe("Brazil");
  });
});
