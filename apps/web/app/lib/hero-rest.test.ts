import { beforeEach, describe, expect, it } from "vitest";
import { arrival, markPage, resetHeroRest } from "./hero-rest";

describe("arrival", () => {
  beforeEach(resetHeroRest);

  it("is first on a visit that begins on the home page", () => {
    markPage(true);
    expect(arrival()).toBe("first");
  });

  it("is a handover when the visit began on another page: the header link just clicked must not vanish", () => {
    markPage(false);
    markPage(false);
    expect(arrival()).toBe("handover");
  });

  it("is back once the home page was seen and left", () => {
    markPage(true);
    markPage(false);
    expect(arrival()).toBe("back");
  });

  it("is first again at the home page after a handover has been seen", () => {
    markPage(false);
    markPage(true);
    expect(arrival()).toBe("first");
    markPage(false);
    expect(arrival()).toBe("back");
  });
});
