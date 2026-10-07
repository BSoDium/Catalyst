import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildJsonSchema } from "./generate-json-schema";
import { EMPTY_PROJECTION, parsePublishedProjection, publishedGroupSchema, toPlaceSummary } from "./published";

const place = {
  slug: "a",
  name: "A",
  coordinates: { lat: 1, lon: 2 },
  labelPriority: 0,
  body: [],
  images: [],
  related: [],
};

describe("published projection", () => {
  it("accepts the empty projection", () => {
    expect(parsePublishedProjection(EMPTY_PROJECTION)).toEqual(EMPTY_PROJECTION);
  });

  it("rejects unknown fields so private data cannot leak through", () => {
    const bad = { ...EMPTY_PROJECTION, places: [{ ...place, sourceStepId: 123 }] };
    expect(() => parsePublishedProjection(bad)).toThrow(/sourceStepId|Unrecognized/);
  });

  describe("viewRadiusKm (optional framing radius)", () => {
    const parse = (extra: object) => parsePublishedProjection({ ...EMPTY_PROJECTION, places: [{ ...place, ...extra }] });

    it("is optional: projections without it stay valid", () => {
      expect(parse({}).places[0]).not.toHaveProperty("viewRadiusKm");
    });
    it("accepts 0.5 to 500 km, fractional values included", () => {
      for (const v of [0.5, 12, 14.5, 500]) expect(parse({ viewRadiusKm: v }).places[0]!.viewRadiusKm).toBe(v);
    });
    it("rejects out-of-range and non-numeric values", () => {
      for (const v of [0, 0.49, 500.1, -3, "12", null, Number.NaN, Infinity]) expect(() => parse({ viewRadiusKm: v }), String(v)).toThrow();
    });
    it("is kept on the place summary only when set", () => {
      expect(toPlaceSummary(parse({ viewRadiusKm: 10 }).places[0]!).viewRadiusKm).toBe(10);
      expect(JSON.stringify(toPlaceSummary(parse({}).places[0]!))).not.toContain("viewRadiusKm");
    });
  });

  describe("bbox (optional extent of the area a place names)", () => {
    const parse = (extra: object) => parsePublishedProjection({ ...EMPTY_PROJECTION, places: [{ ...place, ...extra }] });
    // Houston as given by OpenStreetMap, while the place's own point sits in the north of the city.
    const houston = [-95.91, 29.54, -95.01, 30.11];

    it("is optional: projections without it stay valid and the key stays absent", () => {
      expect(parse({}).places[0]).not.toHaveProperty("bbox");
    });
    it("accepts [west, south, east, north] in WGS84 degrees, kept as given", () => {
      expect(parse({ bbox: houston }).places[0]!.bbox).toEqual(houston);
      expect(parse({ bbox: [-180, -90, 180, 90] }).places[0]!.bbox).toEqual([-180, -90, 180, 90]);
    });
    it("does not require the box to contain the place's coordinates", () => {
      expect(() => parse({ bbox: [10, 10, 11, 11] })).not.toThrow();
    });
    it("rejects the wrong length, non-numbers and out-of-range values", () => {
      const bad: unknown[] = [
        [1, 2, 3],
        [1, 2, 3, 4, 5],
        ["1", 2, 3, 4],
        [null, 2, 3, 4],
        [Number.NaN, 2, 3, 4],
        [-180.1, 0, 1, 1],
        [0, 0, 180.1, 1],
        [0, -90.1, 1, 1],
        [0, 0, 1, 90.1],
        { west: 0, south: 0, east: 1, north: 1 },
        "0,0,1,1",
      ];
      for (const v of bad) expect(() => parse({ bbox: v }), JSON.stringify(v)).toThrow();
    });
    it("requires west < east and south < north (no antimeridian crossing, no empty box)", () => {
      for (const v of [[2, 0, 1, 1], [1, 0, 1, 1], [0, 2, 1, 1], [0, 1, 1, 1], [179, 0, -179, 1]]) {
        expect(() => parse({ bbox: v }), JSON.stringify(v)).toThrow();
      }
    });
    it("is kept on the place summary only when set", () => {
      expect(toPlaceSummary(parse({ bbox: houston }).places[0]!).bbox).toEqual(houston);
      expect(JSON.stringify(toPlaceSummary(parse({}).places[0]!))).not.toContain("bbox");
    });
    it("is described by the generated JSON Schema as a 4-number array (ordering rules are zod-only)", () => {
      const schema = JSON.parse(buildJsonSchema());
      const bbox = schema.properties.places.items.properties.bbox;
      expect(bbox.type).toBe("array");
      expect(bbox.prefixItems).toHaveLength(4);
      expect(bbox.minItems).toBe(4);
      expect(bbox.maxItems).toBe(4);
      expect(schema.properties.places.items.required).not.toContain("bbox");
    });
  });

  describe("countryCode (derived country of a place)", () => {
    const parse = (extra: object) => parsePublishedProjection({ ...EMPTY_PROJECTION, places: [{ ...place, ...extra }] });

    it("is optional: projections without it stay valid and the key stays absent", () => {
      expect(parse({}).places[0]).not.toHaveProperty("countryCode");
    });
    it("accepts uppercase ISO 3166-1 alpha-2 codes, XK (Kosovo) included", () => {
      for (const v of ["FR", "XK", "NZ"]) expect(parse({ countryCode: v }).places[0]!.countryCode).toBe(v);
    });
    it("rejects anything else", () => {
      for (const v of ["fr", "F", "FRA", "F1", "", " FR", null, 33]) expect(() => parse({ countryCode: v }), String(v)).toThrow();
    });
    it("is kept on the place summary only when set", () => {
      expect(toPlaceSummary(parse({ countryCode: "FR" }).places[0]!).countryCode).toBe("FR");
      expect(JSON.stringify(toPlaceSummary(parse({}).places[0]!))).not.toContain("countryCode");
    });
  });

  describe("groups (automatic place hierarchy)", () => {
    const group = (slug: string, extra: object = {}) => ({
      slug,
      name: `Group ${slug}`,
      kind: "country",
      coordinates: { lat: 1, lon: 2 },
      viewRadiusKm: 50,
      labelPriority: 70,
      ...extra,
    });
    const parse = (groups: object[], places: object[] = [{ ...place, group: "g" }]) =>
      parsePublishedProjection({ ...EMPTY_PROJECTION, groups, places });

    it("old projections without `groups` stay valid and get an empty list", () => {
      const { groups: _omit, ...legacy } = EMPTY_PROJECTION;
      expect(parsePublishedProjection(legacy).groups).toEqual([]);
      expect(parsePublishedProjection({ ...legacy, places: [place] }).places[0]).not.toHaveProperty("group");
    });

    it("accepts a valid tree and keeps schemaVersion 1", () => {
      const p = parse([group("g", { parent: "root" }), group("root", { kind: "continent" })]);
      expect(p.schemaVersion).toBe(1);
      expect(p.groups.map((g) => g.slug)).toEqual(["g", "root"]);
      expect(p.places[0]!.group).toBe("g");
    });

    it("is strict: unknown keys, kinds and out-of-range numbers are rejected", () => {
      const bad = (extra: object) => expect(() => parse([group("g", extra)]), JSON.stringify(extra)).toThrow();
      bad({ leaked: 1 });
      bad({ kind: "planet" });
      for (const v of [0.49, 20000.1, -1, "5", Number.NaN]) bad({ viewRadiusKm: v });
      for (const v of [-1, 101, 1.5]) bad({ labelPriority: v });
      bad({ name: "" });
      bad({ name: "x".repeat(121) });
      bad({ slug: "Not Kebab" });
      bad({ coordinates: { lat: 91, lon: 0 } });
      for (const v of [0.5, 20000]) expect(publishedGroupSchema.safeParse(group("g", { viewRadiusKm: v })).success).toBe(true);
      for (const k of ["continent", "subregion", "region", "country", "area"]) expect(publishedGroupSchema.safeParse(group("g", { kind: k })).success).toBe(true);
    });

    it("rejects duplicate group slugs and a group slug that is also a place slug", () => {
      expect(() => parse([group("g"), group("g")])).toThrow(/duplicate group slug "g"/);
      expect(() => parse([group("a")], [{ ...place, slug: "a", group: "a" }])).toThrow(/also a place slug/);
    });

    it("rejects an unknown parent, a parent cycle and a self-parent", () => {
      expect(() => parse([group("g", { parent: "ghost" })])).toThrow(/unknown group "ghost"/);
      expect(() => parse([group("g", { parent: "h" }), group("h", { parent: "g" })])).toThrow(/cycle/);
      expect(() => parse([group("g", { parent: "g" })])).toThrow(/cycle/);
      // A group that merely leads into a cycle is reported too (and validation still terminates).
      expect(() => parse([group("g", { parent: "h" }), group("h", { parent: "i" }), group("i", { parent: "h" })])).toThrow(/cycle/);
    });

    it("rejects a place whose group does not exist", () => {
      expect(() => parse([], [{ ...place, group: "ghost" }])).toThrow(/unknown group "ghost"/);
    });

    it("rejects empty groups: every group needs a descendant place", () => {
      expect(() => parse([group("g"), group("empty")])).toThrow(/group "empty" contains no place/);
      // A parent whose only child group is itself empty is empty too.
      expect(() => parse([group("g"), group("p"), group("c", { parent: "p" })])).toThrow(/group "p" contains no place/);
      // A parent is populated through its descendants, not only directly.
      expect(() => parse([group("g", { parent: "p" }), group("p")])).not.toThrow();
    });

    it("keeps `group` on the place summary only when set", () => {
      const withGroup = parse([group("g")]).places[0]!;
      expect(toPlaceSummary(withGroup).group).toBe("g");
      expect(JSON.stringify(toPlaceSummary(parse([group("g")], [{ ...place, group: "g" }, { ...place, slug: "b" }]).places[1]!))).not.toContain("group");
    });
  });

  it("rejects dangling references", () => {
    const bad = {
      ...EMPTY_PROJECTION,
      places: [{ ...place, related: [{ kind: "article", slug: "nope" }] }],
      routes: [{ id: "r", title: "R", stops: ["a", "missing"] }],
    };
    expect(() => parsePublishedProjection(bad)).toThrow(/unknown/);
  });

  it("requires alt text on images", () => {
    const bad = {
      ...EMPTY_PROJECTION,
      places: [{ ...place, images: [{ src: "/media/x.jpg", alt: " " }] }],
    };
    expect(() => parsePublishedProjection(bad)).toThrow();
  });

  it("keeps the committed JSON Schema in sync (run `pnpm --filter @catalyst/schemas build:contract`)", () => {
    const committed = readFileSync(new URL("../published.schema.json", import.meta.url), "utf8");
    expect(committed).toBe(buildJsonSchema());
  });
});
