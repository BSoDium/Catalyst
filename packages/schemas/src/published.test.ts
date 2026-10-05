import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildJsonSchema } from "./generate-json-schema";
import { EMPTY_PROJECTION, parsePublishedProjection, toPlaceSummary } from "./published";

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
