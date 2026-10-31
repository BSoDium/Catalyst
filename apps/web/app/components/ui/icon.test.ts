import { readdirSync, readFileSync, statSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ICONS, Icon, type IconName } from "./icon";

const APP = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, APP), "utf8");

/** Every source file of the app (not tests), relative to `app/`. */
function sources(dir = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(new URL(dir, APP))) {
    const path = `${dir}${name}`;
    if (statSync(new URL(path, APP)).isDirectory()) out.push(...sources(`${path}/`));
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.ts$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

/** Source with its comments blanked (the rules below are about what the code draws or says, not what a comment explains). */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * The files allowed to hold an inline <svg>: the brand mark (a fixed 16 x 16 grid, `scripts/brand/mark.mjs` is its source) and the
 * generated cover art (a dithered grid, not an icon) a trip's small map (a data drawing: coast and legs, not an icon). Everything else that draws an icon goes through `Icon`.
 */
const SVG_ALLOWED = new Set(["components/ui/logo-mark.tsx", "components/ui/cover-art.tsx", "components/trip-map.tsx"]);

describe("icons: one library, one wrapper", () => {
  it("has no bespoke inline <svg> outside the brand mark and the generated covers", () => {
    const offenders = sources()
      .filter((f) => f.endsWith(".tsx") && !SVG_ALLOWED.has(f))
      .filter((f) => /<svg[\s>]|createElementNS\([^)]*svg/i.test(code(read(f))));
    expect(offenders).toEqual([]);
  });

  it("draws no icon in CSS (an inline SVG data URI as a background or mask)", () => {
    expect(sources().filter((f) => /svg\+xml/i.test(code(read(f))) && f.endsWith(".css"))).toEqual([]);
  });

  it("imports the icon library in one file only: components ask `Icon` for a name", () => {
    const importers = sources().filter((f) => /from "(?:lucide-react|@carbon\/icons-react)"/.test(read(f)));
    expect(importers).toEqual(["components/ui/icon.tsx"]);
  });

  it("uses no text character as an icon (arrows, the command key, a tick) in the components", () => {
    const offenders: string[] = [];
    for (const f of sources().filter((f) => f.endsWith(".tsx") && (f.startsWith("components/") || f.startsWith("routes/")))) {
      const found = /[→←↑↓↗↖↵⌘✓✕×]|\\u2[1-3][0-9a-f]{2}|&#8[0-9]{3};|&(?:rarr|larr|uarr|darr|times|crarr);/i.exec(code(read(f)));
      if (found) offenders.push(`${f}: ${found[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("gives every icon a size from the scale and never a pixel number", () => {
    const offenders: string[] = [];
    for (const f of sources().filter((f) => f.endsWith(".tsx"))) {
      for (const m of code(read(f)).matchAll(/<Icon\b[^>]*>/g)) {
        if (/size=\{\s*\d/.test(m[0]) || /size="\d/.test(m[0])) offenders.push(`${f}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("key hints are plain text", () => {
  const css = read("app.css");

  it("have no border, background or outline in CSS and no box utility in any component", () => {
    const from = css.indexOf("  .ds-kbd {");
    const block = css.slice(from, css.indexOf("\n  }", from));
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toMatch(/border|background|outline|box-shadow|padding/);
    expect(css).not.toContain("data-boxed");
    const offenders = sources()
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => /data-boxed|<kbd[^>]*(border|bg-|ring|outline)/.test(code(read(f))) || /ds-kbd[^"`]*(border|bg-|ring|outline)/.test(code(read(f))));
    expect(offenders).toEqual([]);
  });

  it("in the header the search icon and the command key are one size: both inline icons of one font size", () => {
    const palette = code(read("components/search-palette.tsx"));
    const trigger = palette.slice(palette.indexOf("export function SearchTriggers"), palette.indexOf("export function SearchPalette"));
    // the glyph is an inline icon (1.1 em), not the control size: it follows the type it sits in, as the command key does
    expect(trigger).toMatch(/<Icon name="search" size="inline" \/>/);
    expect(trigger).not.toMatch(/size="control"/);
    // and the key hint takes the row's font size there (it is 13 px elsewhere), so the command key's 1.1 em is the same number of pixels
    const rule = css.slice(css.indexOf("  .nav-search .ds-kbd {"), css.indexOf("\n  }", css.indexOf("  .nav-search .ds-kbd {")));
    expect(rule).toContain("font-size: inherit");
    expect(code(read("components/ui/key-hint.tsx"))).toMatch(/<Icon name="command" size="inline" \/>/);
  });

  it("the palette's close and its footer hint are an icon and plain words, no boxed key", () => {
    const palette = code(read("components/search-palette.tsx"));
    expect(palette).not.toMatch(/ds-micro/);
    expect(palette).toMatch(/aria-label="Close search"[\s\S]{0,400}<Icon name="close"/);
    expect(palette).not.toMatch(/border border-border/);
  });
});

describe("Icon", () => {
  const html = (props: Parameters<typeof Icon>[0]) => renderToStaticMarkup(createElement(Icon, props));

  it("is decorative: hidden from assistive technology, not focusable", () => {
    const out = html({ name: "search" });
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('focusable="false"');
    expect(out).not.toContain("role=");
  });

  it("carries its size name (the CSS maps it to the scale) and defaults to the control size", () => {
    expect(html({ name: "search" })).toContain('data-size="control"');
    expect(html({ name: "arrow-right", size: "inline" })).toContain('data-size="inline"');
    expect(html({ name: "close", size: "large" })).toContain('data-size="large"');
    // the header's three come from Carbon (filled shapes), the rest from lucide
    expect(html({ name: "search" })).toMatch(/class="ui-icon"/);
    expect(html({ name: "copy" })).toContain('class="lucide lucide-copy ui-icon"');
  });

  it("renders every name in the set", () => {
    for (const name of Object.keys(ICONS) as IconName[]) expect(html({ name }), name).toContain("<svg");
    // the five kinds of entry are all there
    for (const kind of ["article", "project", "artwork", "poem", "place"] as const) expect(ICONS[kind]).toBeTruthy();
  });
});

describe("the size scale (app.css)", () => {
  const css = read("app.css");

  it("is three sizes tied to what they sit beside: 1.1 em, 1.25 rem, 1.5 rem, one stroke", () => {
    expect(css).toMatch(/--icon-inline: 1\.1em;/);
    expect(css).toMatch(/--icon-control: 1\.25rem;/);
    expect(css).toMatch(/--icon-large: 1\.5rem;/);
    expect(css).toMatch(/--icon-stroke: 1\.75;/);
  });

  it("applies the sizes by name, with the system's square ends, and nothing is a pixel number", () => {
    const rule = (selector: string) => {
      const from = css.indexOf(`${selector} {`);
      return css.slice(from, css.indexOf("\n  }", from));
    };
    expect(rule(".ui-icon")).toContain("width: var(--icon-control)");
    expect(rule(".ui-icon")).toContain("stroke-width: var(--icon-stroke)");
    expect(rule(".ui-icon")).toContain("stroke-linecap: square");
    expect(rule('.ui-icon[data-size="inline"]')).toContain("width: var(--icon-inline)");
    expect(rule('.ui-icon[data-size="large"]')).toContain("width: var(--icon-large)");
  });
});
