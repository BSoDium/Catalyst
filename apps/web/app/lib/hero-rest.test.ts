import { beforeEach, describe, expect, it } from "vitest";
import { cameBackHome, markPage, resetHeroRest } from "./hero-rest";

describe("cameBackHome", () => {
  beforeEach(resetHeroRest);

  it("is false on a visit that begins on the home page", () => {
    markPage(true);
    expect(cameBackHome()).toBe(false);
  });

  it("is false when the first page was another one: the first arrival on the globe is a first landing", () => {
    markPage(false);
    expect(cameBackHome()).toBe(false);
    markPage(false);
    expect(cameBackHome()).toBe(false);
  });

  it("is true once the home page was seen and left", () => {
    markPage(true);
    markPage(false);
    expect(cameBackHome()).toBe(true);
  });

  it("is true on a second return after starting elsewhere", () => {
    markPage(false);
    markPage(true);
    expect(cameBackHome()).toBe(false);
    markPage(false);
    expect(cameBackHome()).toBe(true);
  });
});
