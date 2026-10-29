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
    expect(src).toMatch(/dFdx\(t\)/);
    expect(src).toMatch(/smoothstep\(1\.50, 4\.00, widePx\)/);
    expect((src.match(/texture2D\(uLights/g) ?? []).length).toBe(5); // (the one, and the four)
  });

  it("take their derivatives before anything is discarded (they are only defined while every fragment of the quad is still there), and wrap round in longitude", () => {
    const src = lightsMaterial().fragmentShader;
    expect(src.indexOf("dFdx(t)")).toBeGreaterThan(-1);
    expect(src.indexOf("dFdx(t)")).toBeLessThan(src.lastIndexOf("discard"));
    expect(src).toMatch(/fract\(\(i\.x \+ 1\.5\) \/ uSize\.x\)/);
  });

  it("are scrambled the closer the camera is: the place read is moved by a noise (up to `warp` texels), the density has clusters (a mean of 1: a noise of two octaves between 1 - grain and 1 + grain), and the hash's cells are at most an art pixel", () => {
    expect(LIGHTS.warp).toBeGreaterThan(0.5);
    expect(LIGHTS.warp).toBeLessThan(2);
    expect(LIGHTS.clump).toBeGreaterThan(0);
    expect(LIGHTS.clump).toBeLessThanOrEqual(1); // (the density never goes negative)
    const src = lightsMaterial().fragmentShader;
    expect(src).toMatch(/vnoise\(t \* 0\.9 \+ 3\.1\)/);
    expect(src).toMatch(/exp2\(ceil\(log2\(max\(widePx, 1\.0\)\)\)\)/); // (a cell is never wider than a pixel)
    expect(src).toMatch(/1\.0 - 1\.00 \* mag \+ 1\.00 \* mag \* cf/); // (the mean of the clumps' factor is 1: 1 - c + c * 1)
    expect(src).toMatch(/2\.0 \* smoothstep\(0\.5 - 0\.14, 0\.5 \+ 0\.14, clumps\(t, widePx\)\)/);
    expect(src).toMatch(/widePx \/ f\) \* amp/); // (an octave is there only while its wavelength is wide enough in pixels)
    expect(src).toMatch(/min\(length\(dFdx\(t\)\), length\(dFdy\(t\)\)\)/); // (the least squeezed axis: at a grazing angle too)
  });

  it("split into single dots in close shots: one pixel at most in each square of the screen may be a light, so a place is never more than a quarter lit, however dense it is", () => {
    expect(LIGHTS.block).toBeGreaterThanOrEqual(2); // (a dot has a dark pixel next to it)
    const src = lightsMaterial().fragmentShader;
    expect(src).toMatch(/float pick = floor\(hash21\(blk \+ 17\.0\) \* blockPx \* blockPx\)/);
    expect(src).toMatch(/float blockPx = clamp\(floor\(sqrt\(widePx \* 0\.45\) \+ 0\.5\), 2\.0, 5\.0\)/); // (the square grows with the texel)
    expect(src).toMatch(/cover \*= \(me == pick\) \? 1\.0 : 1\.0 - mag/);
    expect(src.indexOf("cover *= (me == pick)")).toBeLessThan(src.lastIndexOf("discard"));
  });

  it("have each dot its own brightness in close shots (a hash of the place, towards the page's colour by up to `vary`), a few of them going to the core's colour; and the page's colour is given to the shader", () => {
    expect(LIGHTS.vary).toBeGreaterThan(0.3);
    expect(LIGHTS.vary).toBeLessThan(1); // (a dot is never quite gone: it was picked to be a light)
    expect(LIGHTS.sparkle).toBeGreaterThan(0);
    expect(LIGHTS.sparkle).toBeLessThan(0.2);
    const mat = lightsMaterial();
    expect(mat.uniforms.uBg).toBeDefined();
    expect(mat.fragmentShader).toMatch(/float bright = mix\(1\.0 - 0\.70, 1\.0, own \* own\)/);
    expect(mat.fragmentShader).toMatch(/gl_FragColor = vec4\(mix\(light, uBg,/);
    expect(readFileSync("app/globe/engine/scene.ts", "utf8")).toMatch(/lights\.uniforms\.uBg!\.value\.setRGB\(\.\.\.bg\)/);
  });

  it("have every function they call defined in their own shader, before it is used (a shader that does not compile draws nothing: the lights were gone once, because the noise's functions had gone into another material)", () => {
    const src = lightsMaterial().fragmentShader;
    for (const fn of ["hash21", "vnoise", "clumps", "dither4", "washOf"]) {
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
