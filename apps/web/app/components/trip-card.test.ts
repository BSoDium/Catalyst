import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Trip } from "~/lib/journeys";
import { TripCard } from "./trip-card";
import { wordSize } from "./trip-map";

const visit = (position: number) => ({ position, previous: null, next: null, earlier: 0, later: 0 });
const trip: Trip = {
  id: "t",
  title: "A loop",
  stops: 4,
  km: 100,
  from: "A",
  to: "A",
  dates: null,
  word: "loop",
  countries: 2,
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

describe("TripCard poster (#510)", () => {
  const html = renderToStaticMarkup(createElement(TripCard, { trip, here: "a" }));
  it("sets the trip's word in giant capitals in the poster and names the places on it", () => {
    expect(html).toContain("LOOP");
    expect(html).toContain('data-slot="trip-poster"');
  });
  it("says the distance, the stops and the countries as figures (the value first, its unit after it) and the dates under the title", () => {
    expect(html).toContain('data-slot="trip-figures"');
    expect(html).toContain(">100</span><span");
    expect(html).toContain(">4</span><span");
    expect(html).toContain(">stops<");
    expect(html).toContain(">countries<");
  });
});

describe("wordSize: the giant word fits the poster and never outgrows it", () => {
  it("fits a long word in the width and keeps a short one to a third of the height", () => {
    expect(wordSize(13, 360, 299)).toBeLessThanOrEqual(Math.floor((360 * 0.96) / (0.62 * 13)) + 1);
    expect(wordSize(4, 360, 299)).toBeLessThanOrEqual(Math.round(299 * 0.34));
  });
  it("does not grow with the width of a wide panel (the height is capped)", () => {
    expect(wordSize(6, 1150, 320)).toBe(wordSize(6, 2400, 320));
    expect(wordSize(6, 1150, 320)).toBeLessThanOrEqual(109);
  });
});
