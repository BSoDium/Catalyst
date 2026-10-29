import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lightsMaterial } from "./materials";
import { LIGHTS } from "./surface";

describe("the night lights, in the interlude's close shots", () => {
  it("are read as they were while a texel is no wider than an art pixel or so, and between the texels as it grows past that (a hand-made bilinear: the map is read without smoothing)", () => {
    expect(LIGHTS.magFrom).toBeGreaterThanOrEqual(1);
    expect(LIGHTS.magTo).toBeGreaterThan(LIGHTS.magFrom);
    expect(LIGHTS.boost).toBeGreaterThan(1); // (the average of a point and its dark neighbours is dimmer than the point)
    expect(Math.log2(LIGHTS.maxSub) % 1).toBe(0); // (whole doublings)
    const src = lightsMaterial().fragmentShader;
    expect(src).toMatch(/fwidth\(t\)/);
    expect(src).toMatch(/smoothstep\(1\.50, 4\.00, widePx\)/);
    expect((src.match(/texture2D\(uLights/g) ?? []).length).toBe(5); // (the one, and the four)
  });

  it("take their derivatives before anything is discarded (they are only defined while every fragment of the quad is still there), and wrap round in longitude", () => {
    const src = lightsMaterial().fragmentShader;
    expect(src.indexOf("fwidth(t)")).toBeGreaterThan(-1);
    expect(src.indexOf("fwidth(t)")).toBeLessThan(src.lastIndexOf("discard"));
    expect(src).toMatch(/fract\(\(i\.x \+ 1\.5\) \/ uSize\.x\)/);
  });

  it("have the size of the map they are given (the scene sets it from the picture), 2048 x 1024 until then", () => {
    expect(lightsMaterial().uniforms.uSize!.value).toEqual([2048, 1024]);
    expect(readFileSync("app/globe/engine/scene.ts", "utf8")).toMatch(/uniforms\.uSize!\.value = \[img\.width, img\.height\]/);
  });
});
