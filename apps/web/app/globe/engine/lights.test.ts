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

  it("are scrambled the closer the camera is: the place read is moved by a noise (up to `warp` texels), the density has clusters (a mean of 1: a noise of two octaves between 1 - grain and 1 + grain), and the hash's cells are at most an art pixel", () => {
    expect(LIGHTS.warp).toBeGreaterThan(0.5);
    expect(LIGHTS.warp).toBeLessThan(2);
    expect(LIGHTS.grain).toBeGreaterThan(0);
    expect(LIGHTS.grain).toBeLessThan(1); // (the density never goes to nothing or negative)
    const src = lightsMaterial().fragmentShader;
    expect(src).toMatch(/vnoise\(t \* 0\.9 \+ 3\.1\)/);
    expect(src).toMatch(/exp2\(ceil\(log2\(max\(widePx, 1\.0\)\)\)\)/); // (a cell is never wider than a pixel)
    expect(src).toMatch(/1\.0 - 0\.85 \* mag \+ 1\.70 \* mag \* gr/); // (the mean of the noise is a half: 1 - g + 2 g / 2 = 1)
  });

  it("have every function they call defined in their own shader, before it is used (a shader that does not compile draws nothing: the lights were gone once, because the noise's functions had gone into another material)", () => {
    const src = lightsMaterial().fragmentShader;
    for (const fn of ["hash21", "vnoise", "dither4", "washOf"]) {
      const def = src.search(new RegExp(`float ${fn}\\(`));
      expect(def, `${fn} is defined`).toBeGreaterThan(-1);
      expect(def, `${fn} is defined before main`).toBeLessThan(src.indexOf("void main()"));
    }
    // (and the other materials of the file do not carry the noise they do not use)
    expect((readFileSync("app/globe/engine/materials.ts", "utf8").match(/float vnoise\(/g) ?? []).length).toBe(1);
  });

  it("have the size of the map they are given (the scene sets it from the picture), 2048 x 1024 until then", () => {
    expect(lightsMaterial().uniforms.uSize!.value).toEqual([2048, 1024]);
    expect(readFileSync("app/globe/engine/scene.ts", "utf8")).toMatch(/uniforms\.uSize!\.value = \[img\.width, img\.height\]/);
  });
});
