import { describe, expect, it } from "vitest";
import { EMPTY_PROJECTION } from "@catalyst/schemas";
import { GLOBE_ROUTES_ROUTE, globeRoutesFile, globeRoutesHash } from "./globe-routes-file";
import { globeRoutesJson, globeRoutesSrc } from "./globe-routes";

describe("where the globe fetches its routes from", () => {
  it("names the file by a hash of its content: the same text the same address, another text another", () => {
    expect(globeRoutesFile("[]")).toBe(`/data/globe-routes.${globeRoutesHash("[]")}.json`);
    expect(globeRoutesHash("[]")).toMatch(/^[0-9a-f]{12}$/);
    expect(globeRoutesHash("[]")).not.toBe(globeRoutesHash("[1]"));
  });
  it("is the content-named file in a build and the route itself in development", () => {
    expect(globeRoutesSrc(EMPTY_PROJECTION, true)).toBe(globeRoutesFile(globeRoutesJson(EMPTY_PROJECTION)));
    expect(globeRoutesSrc(EMPTY_PROJECTION, false)).toBe(GLOBE_ROUTES_ROUTE);
  });
  it("hashes the text the route serves (the build moves the prerendered file to the address the page names)", () => {
    expect(globeRoutesJson(EMPTY_PROJECTION)).toBe("[]");
  });
});
