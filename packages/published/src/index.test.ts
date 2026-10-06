import { describe, expect, it } from "vitest";
import { loadDemoProjection, loadPublishedProjection } from "./index";

describe("published package", () => {
  it("loads and validates the committed projection", () => {
    expect(loadPublishedProjection().schemaVersion).toBe(1);
  });
  it("loads and validates the demo fixture", () => {
    const demo = loadDemoProjection();
    expect(demo.places.length).toBeGreaterThan(5);
    expect(demo.groups.length).toBeGreaterThan(0);
    expect(demo.routes[0]?.stops.length).toBeGreaterThan(1);
  });
  it("the demo hierarchy exercises every group kind, with collapsed levels and an ungrouped place", () => {
    const demo = loadDemoProjection();
    expect(new Set(demo.groups.map((g) => g.kind))).toEqual(new Set(["continent", "subregion", "region", "country", "area"]));
    // Every group has at least two children (collapse rule), so no square repeats its only child.
    const children = new Map<string, number>();
    for (const g of demo.groups) if (g.parent) children.set(g.parent, (children.get(g.parent) ?? 0) + 1);
    for (const p of demo.places) if (p.group) children.set(p.group, (children.get(p.group) ?? 0) + 1);
    for (const g of demo.groups) expect(children.get(g.slug) ?? 0, g.slug).toBeGreaterThanOrEqual(2);
    expect(demo.places.filter((p) => p.group === undefined).map((p) => p.slug)).toEqual(["cape-town", "wellington"]);
  });
  it("the committed (empty) projection has no groups", () => {
    expect(loadPublishedProjection().groups).toEqual([]);
  });
});
