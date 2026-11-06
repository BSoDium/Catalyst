import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Trip } from "~/lib/journeys";
import { TripCard } from "./trip-card";

const visit = (position: number) => ({ position, previous: null, next: null, earlier: 0, later: 0 });
const trip: Trip = {
  id: "t",
  title: "A loop",
  stops: 4,
  km: 100,
  from: "A",
  to: "A",
  dates: null,
  stopPoints: [
    { slug: "a", name: "A", lon: 1, lat: 43 },
    { slug: "b", name: "B", lon: 2, lat: 44 },
  ],
  legPaths: [{ mode: "rail", points: [1, 43, 2, 44] }],
  visits: [visit(1), visit(4)],
};

describe("TripCard visits (#584)", () => {
  it("counts the visits to a place the trip passes twice", () => {
    expect(renderToStaticMarkup(createElement(TripCard, { trip, here: "a" }))).toContain("Visited 2 times");
  });
  it("does not count them for a place the owner lived in", () => {
    const html = renderToStaticMarkup(createElement(TripCard, { trip, here: "a", lived: true }));
    expect(html).not.toContain("Visited");
    expect(html).toContain("Home base on this trip");
  });
});
