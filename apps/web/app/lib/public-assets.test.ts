import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SHARE_IMAGE, THEME_COLORS } from "./site";

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
    expect(manifest.name).toBe("Catalyst");
    expect(manifest.short_name).toBeTruthy();
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
  it("has a vector favicon that follows the colour scheme, and a favicon.ico holding a PNG", () => {
    const svg = readFileSync(pub("favicon.svg"), "utf8");
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain("prefers-color-scheme: dark");
    expect(svg).not.toMatch(/<script|onload|href=/i);
    const ico = readFileSync(pub("favicon.ico"));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 1]);
    expect(ico.toString("latin1", 23, 26)).toBe("PNG");
  });
  it("leaves robots.txt and sitemap.xml to their resource routes (a static file would shadow them)", () => {
    expect(existsSync(pub("robots.txt"))).toBe(false);
    expect(existsSync(pub("sitemap.xml"))).toBe(false);
    const routes = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
    expect(routes).toContain('route("sitemap.xml", "routes/sitemap.ts")');
    expect(routes).toContain('route("robots.txt", "routes/robots.ts")');
  });
});
