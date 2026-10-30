import { readFileSync } from "node:fs";
import { CustomBlending, Scene, type ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";
import { MoonLayer } from "./moon-layer";

describe("the moon's place in the draw order", () => {
  it("is blended but not in three's transparent list, which is drawn after every opaque object whatever its renderOrder: the route lines (opaque, no depth test, order 4) are drawn over the moon, not under it", () => {
    const moon = new MoonLayer(new Scene());
    const m = moon.mesh.material as ShaderMaterial;
    expect(m.transparent).toBe(false);
    expect(m.blending).toBe(CustomBlending);
    expect(moon.mesh.renderOrder).toBeLessThan(4);
    // (the lines the moon must stay under are opaque too: if they became transparent the order would be by renderOrder again, and this would still hold)
    expect(readFileSync("app/globe/engine/route-layer.ts", "utf8")).toMatch(/line\.renderOrder = 4;/);
  });
});
