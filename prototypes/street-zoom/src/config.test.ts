import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, parseConfig } from "./config";

describe("parseConfig", () => {
  it("has safe defaults", () => {
    const c = parseConfig("");
    expect(c.source).toBe("pm");
    expect(c.schema).toBe("protomaps");
    expect(c.compositor).toBe("copy-device");
    expect(c.view).toEqual(DEFAULT_VIEW);
    expect(c.dither).toBe(true);
    expect(c.px).toBeNull();
  });
  it("defaults to the old-LCD line rules and can still reproduce the spike's look", () => {
    const d = parseConfig("");
    expect([d.rule, d.thin, d.thinMode, d.widths, d.pattern]).toEqual(["centre", 1, "stairs", "art", "clean"]);
    expect(d.inkThreshold).toBeCloseTo(0.3675, 6);
    const l = parseConfig("?rule=legacy&widths=legacy&pattern=bayer8");
    expect([l.rule, l.thin, l.widths, l.pattern, l.inkThreshold]).toEqual(["legacy", 0, "legacy", "bayer8", 0.5]);
    expect(parseConfig("?rule=banana").rule).toBe("centre");
    expect(parseConfig("?thin=9").thin).toBe(4);
  });
  it("reads the knobs", () => {
    const c = parseConfig("?src=ofm&comp=inline&view=106.7,10.8,14&px=2&theme=dark&dither=0&ink=0.5&rm=1&reveal=on&sharp=0.4");
    expect(c.schema).toBe("openmaptiles");
    expect(c.compositor).toBe("inline");
    expect(c.view).toEqual({ lon: 106.7, lat: 10.8, zoom: 14 });
    expect(c.px).toBe(2);
    expect(c.theme).toBe("dark");
    expect(c.dither).toBe(false);
    expect(c.inkThreshold).toBe(0.5);
    expect(c.reducedMotion).toBe(true);
    expect(c.reveal).toBe("on");
    expect(c.sharpAll).toBe(0.4);
  });
  it("rejects nonsense", () => {
    const c = parseConfig("?view=a,b,c&px=99&comp=banana&ink=9&scale=0");
    expect(c.view).toEqual(DEFAULT_VIEW);
    expect(c.px).toBeNull();
    expect(c.compositor).toBe("copy-device");
    expect(c.inkThreshold).toBe(0.95);
    expect(c.scale).toBeNull();
  });
});
