import { describe, expect, it } from "vitest";
import { GLOBE_ROUTES_PATH, globeRoutesSrc } from "./globe-routes";

describe("the address the globe fetches its routes from", () => {
  it("is the file's path keyed by the first 12 characters of the content's commit", () => {
    expect(globeRoutesSrc({ commit: "8d9f9071780d36bfd6702da40a10ee5e87ae3686", date: "2026-11-16" })).toBe(`${GLOBE_ROUTES_PATH}?v=8d9f9071780d`);
  });
  it("is keyed `dev` where the projection carries no version (a local or demo one), so the address is still stable", () => {
    expect(globeRoutesSrc(undefined)).toBe(`${GLOBE_ROUTES_PATH}?v=dev`);
    expect(globeRoutesSrc(null)).toBe(`${GLOBE_ROUTES_PATH}?v=dev`);
  });
});
