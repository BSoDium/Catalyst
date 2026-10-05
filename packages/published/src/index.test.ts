import { describe, expect, it } from "vitest";
import { loadDemoProjection, loadPublishedProjection } from "./index";

describe("published package", () => {
  it("loads and validates the committed projection", () => {
    expect(loadPublishedProjection().schemaVersion).toBe(1);
  });
  it("loads and validates the demo fixture", () => {
    const demo = loadDemoProjection();
    expect(demo.places.length).toBeGreaterThan(5);
    expect(demo.routes[0]?.stops.length).toBeGreaterThan(1);
  });
});
