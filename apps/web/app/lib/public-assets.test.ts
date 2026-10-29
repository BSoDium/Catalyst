import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FACE_TILE, faceSvg } from "../../scripts/brand/mark.mjs";
import { DEFAULT_SHARE_IMAGE, SITE, SITE_DESCRIPTION, THEME_COLORS } from "./site";

const pub = (name: string) => new URL(`../../public/${name}`, import.meta.url);
const pngSize = (name: string) => {
  const buf = readFileSync(pub(name));
  expect(buf.toString("latin1", 1, 4), `${name} is a PNG`).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
};

describe("public/ brand assets", () => {
  it("has the default share image: 1200x630 PNG under 60 kB, where the head tags say it is", () => {
    expect(DEFAULT_SHARE_IMAGE.path).toBe("/og-default.png");
    expect(pngSize("og-default.png")).toEqual({ width: DEFAULT_SHARE_IMAGE.width, height: DEFAULT_SHARE_IMAGE.height });
    expect(statSync(pub("og-default.png")).size).toBeLessThan(60 * 1024);
  });
  it("has the home-screen icon at 180 px", () => {
    expect(pngSize("apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
  });
  it("has a manifest whose icons exist at their declared size and whose colours are the dark page colour", () => {
    const manifest = JSON.parse(readFileSync(pub("manifest.webmanifest"), "utf8")) as {
      name: string; short_name: string; display: string; start_url: string; theme_color: string; background_color: string;
      icons: { src: string; sizes: string; type: string; purpose?: string }[];
    };
    expect(manifest.name).toBe(SITE.name);
    expect(manifest.short_name).toBe(SITE.shortName);
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect((manifest as unknown as { description: string }).description).toBe(SITE_DESCRIPTION);
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.theme_color).toBe(THEME_COLORS.dark);
    expect(manifest.background_color).toBe(THEME_COLORS.dark);
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
      const { width, height } = pngSize(icon.src.slice(1));
      expect(`${width}x${height}`).toBe(icon.sizes);
    }
  });
  it("has a vector favicon, the blue-screen frown on its rounded blue tile, in a square 32-unit box, with a vignette", () => {
    const svg = readFileSync(pub("favicon.svg"), "utf8");
    expect(svg).toBe(faceSvg({ px: 32 }));
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toContain(FACE_TILE);
    expect(svg).toContain("<radialGradient");
    expect(svg).not.toMatch(/<script|onload|href=|<image|<linearGradient|prefers-color-scheme/i);
  });
  it("has a favicon.ico holding the three PNG sizes, 16, 32 and 48 px, each the size it declares", () => {
    const ico = readFileSync(pub("favicon.ico"));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 3]);
    expect(ico.length).toBeLessThan(8 * 1024);
    for (let i = 0; i < 3; i++) {
      const at = 6 + 16 * i;
      const declared = ico.readUInt8(at);
      const size = ico.readUInt32LE(at + 8);
      const offset = ico.readUInt32LE(at + 12);
      expect(declared).toBe([16, 32, 48][i]);
      expect(ico.toString("latin1", offset + 1, offset + 4)).toBe("PNG");
      expect([ico.readUInt32BE(offset + 16), ico.readUInt32BE(offset + 20)]).toEqual([declared, declared]);
      expect(offset + size).toBeLessThanOrEqual(ico.length);
    }
  });
  it("draws every PNG icon from the face: the maskable one keeps it inside the launcher's safe circle", () => {
    expect(pngSize("icon-maskable-512.png")).toEqual({ width: 512, height: 512 });
    // The face reaches 9 of the box's 32 units from the centre (the mouth's round cap included): 144 px of 512, the safe circle's radius is 0.4 x 512 = 205 px.
    expect((9 / 32) * 512).toBeLessThan(0.4 * 512);
  });
  it("leaves robots.txt and sitemap.xml to their resource routes (a static file would shadow them)", () => {
    expect(existsSync(pub("robots.txt"))).toBe(false);
    expect(existsSync(pub("sitemap.xml"))).toBe(false);
    const routes = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
    expect(routes).toContain('route("sitemap.xml", "routes/sitemap.ts")');
    expect(routes).toContain('route("robots.txt", "routes/robots.ts")');
  });
});
