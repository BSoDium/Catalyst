import { describe, expect, it } from "vitest";
import { splitExposure } from "./exposure";

const m = (label: string, value: string) => ({ label, value });

describe("splitExposure", () => {
  it("says the settings in a fixed order and keeps the camera and the lens on their own", () => {
    const { exposure, rest } = splitExposure([m("Licence", "All rights reserved"), m("ISO", "200"), m("Shutter", "1/250"), m("Aperture", "2.8"), m("Focal length", "35"), m("Lens", "FE 35mm F1.8"), m("Camera", "Sony A7 IV")]);
    expect(exposure).toEqual({ gear: ["Sony A7 IV", "FE 35mm F1.8"], settings: ["35 mm", "f/2.8", "1/250 s", "ISO 200"] });
    expect(rest).toEqual([m("Licence", "All rights reserved")]);
  });

  it("normalises what the export or the author wrote, and leaves what it cannot read as it is", () => {
    const { exposure } = splitExposure([m("Focal length", "35.0 mm"), m("Aperture", "F/2.80"), m("Shutter", "1/60s"), m("ISO", "ISO 1600")]);
    expect(exposure?.settings).toEqual(["35 mm", "f/2.8", "1/60 s", "ISO 1600"]);
    expect(splitExposure([m("Shutter", "bulb"), m("Aperture", "wide open")]).exposure?.settings).toEqual(["wide open", "bulb"]);
    expect(splitExposure([m("Shutter", "0.5"), m("Shutter", "2")]).exposure?.settings).toEqual(["0.5 s"]); // (the first of a label wins)
  });

  it("skips a missing or empty value (no dashes), and an entry with none has no exposure", () => {
    expect(splitExposure([m("Camera", "  "), m("Lens", "Zuiko 50")]).exposure).toEqual({ gear: ["Zuiko 50"], settings: [] });
    expect(splitExposure([m("Camera", "")]).exposure).toBeNull();
    expect(splitExposure([m("Medium", "Charcoal")])).toEqual({ exposure: null, rest: [m("Medium", "Charcoal")] });
    expect(splitExposure([])).toEqual({ exposure: null, rest: [] });
  });

  it("matches the labels without regard to case", () => {
    expect(splitExposure([m("camera", "Fujifilm X100V"), m("iso", "400")]).exposure).toEqual({ gear: ["Fujifilm X100V"], settings: ["ISO 400"] });
  });
});
