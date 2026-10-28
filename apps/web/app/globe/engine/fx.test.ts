import { describe, expect, it } from "vitest";
import { resolveFx } from "./fx";

describe("visual effect tiers", () => {
  it("is full on a capable device and when nothing is known", () => {
    expect(resolveFx({ search: "" }).tier).toBe("full");
    expect(resolveFx({ search: "", memory: 8, cores: 8 }).on).toEqual({ iris: true, ringBlend: true, flare: true, sunHalo: true });
  });
  it("steps down with the device", () => {
    expect(resolveFx({ search: "", memory: 4, cores: 8 }).tier).toBe("reduced");
    expect(resolveFx({ search: "", memory: 8, cores: 2 }).tier).toBe("minimal");
    expect(resolveFx({ search: "", saveData: true }).tier).toBe("minimal");
  });
  it("lets the page decide: ?fx wins over the device, ?no-fx drops single effects", () => {
    expect(resolveFx({ search: "?fx=full", memory: 1 }).tier).toBe("full");
    const r = resolveFx({ search: "?fx=reduced&no-fx=flare" });
    expect(r.on).toEqual({ iris: false, ringBlend: false, flare: false, sunHalo: true });
    expect(resolveFx({ search: "", stored: "minimal" }).on.flare).toBe(false);
  });
});
