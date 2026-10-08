import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, over, parseColor, type Rgba } from "./contrast";
import { ENTRY_KINDS } from "./entry-kind";

/**
 * The UI system's tokens (docs/design-system.md), read from app.css the way the map's readability tests read them: the light
 * scheme is the first root rule, the dark one the dark media rule, and the two forced-scheme rules repeat them.
 */
const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");

function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(/^\s*(--[a-z0-9-]+):\s*(.+);$/gm)) out.set(m[1]!, m[2]!.trim());
  return out;
}

/** The body of the first rule whose selector line starts with `selector`, balanced on braces. */
function ruleBody(source: string, from: number): string {
  const open = source.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("unbalanced css");
}

const light = declarations(ruleBody(css, css.indexOf(":root {")));
const dark = declarations(ruleBody(css, css.indexOf("@media (prefers-color-scheme: dark)")).replace(/^\s*:root\s*\{/, ""));
const forcedLight = declarations(ruleBody(css, css.indexOf(':root[data-scheme="light"]')));
const forcedDark = declarations(ruleBody(css, css.indexOf(':root[data-scheme="dark"]')));

const SCHEMES = { light, dark } as const;

function color(scheme: "light" | "dark", name: string): Rgba {
  const raw = SCHEMES[scheme].get(name);
  const parsed = raw ? parseColor(raw) : null;
  if (!parsed) throw new Error(`${scheme} ${name} is not a plain colour: ${raw}`);
  return parsed;
}

describe("scheme blocks", () => {
  it("the dark media rule and the forced-scheme rules carry the same colour tokens as the root rule", () => {
    const colorNames = [...light.keys()].filter((k) => /^--(background|foreground|muted-foreground|subtle-foreground|border|border-strong|ring|primary|primary-foreground|accent|accent-foreground|globe-grid|globe-limb|surface|line-faint|signal|signal-foreground|signal-wash|inverse-[a-z]+|kind-[a-z]+)$/.test(k));
    expect(colorNames.length).toBeGreaterThan(25);
    for (const name of colorNames) {
      expect(dark.has(name), `dark ${name}`).toBe(true);
      expect(forcedLight.get(name), `forced light ${name}`).toBe(light.get(name));
      expect(forcedDark.get(name), `forced dark ${name}`).toBe(dark.get(name));
    }
    // and nothing extra in the forced rules
    for (const name of forcedLight.keys()) expect(light.has(name), `forced light has stray ${name}`).toBe(true);
    for (const name of forcedDark.keys()) expect(dark.has(name), `forced dark has stray ${name}`).toBe(true);
  });

  it("the forced rules set color-scheme", () => {
    expect(css).toMatch(/:root\[data-scheme="light"\][^{]*\{\s*color-scheme: light;/);
    expect(css).toMatch(/:root\[data-scheme="dark"\][^{]*\{\s*color-scheme: dark;/);
  });
});

describe.each(["light", "dark"] as const)("contrast (%s)", (scheme) => {
  const bg = color(scheme, "--background");
  const surface = color(scheme, "--surface");
  const accentGrey = color(scheme, "--accent");

  it("text is AA (4.5:1) on the page, the surface and the hover grey where it is used there", () => {
    const fg = color(scheme, "--foreground");
    const muted = color(scheme, "--muted-foreground");
    const subtle = color(scheme, "--subtle-foreground");
    const signal = color(scheme, "--signal");
    for (const under of [bg, surface, accentGrey]) {
      expect(contrastRatio(fg, under)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(muted, under)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(signal, under)).toBeGreaterThanOrEqual(4.5);
    }
    // subtle text (the map credits) stays on the page and the surface only
    for (const under of [bg, surface]) expect(contrastRatio(subtle, under)).toBeGreaterThanOrEqual(4.5);
  });

  it("fills with their text: primary, signal and the inverse pair are AA", () => {
    expect(contrastRatio(color(scheme, "--primary-foreground"), color(scheme, "--primary"))).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(color(scheme, "--signal-foreground"), color(scheme, "--signal"))).toBeGreaterThanOrEqual(4.5);
    const inverseBg = color(scheme, "--inverse-background");
    expect(contrastRatio(color(scheme, "--inverse-foreground"), inverseBg)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(color(scheme, "--inverse-muted"), inverseBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color(scheme, "--inverse-signal"), inverseBg)).toBeGreaterThanOrEqual(4.5);
  });

  it("the inverse tokens swap the page and the ink (the map's selected label); the muted tone is the other scheme's", () => {
    const other = scheme === "light" ? dark : light;
    expect(color(scheme, "--inverse-background")).toEqual(color(scheme, "--foreground"));
    expect(color(scheme, "--inverse-foreground")).toEqual(color(scheme, "--background"));
    expect(color(scheme, "--inverse-muted")).toEqual(parseColor(other.get("--muted-foreground")!));
  });

  it("the signal wash keeps the muted text AA (the active frame's plate)", () => {
    const plate = over(color(scheme, "--signal-wash"), surface);
    expect(contrastRatio(color(scheme, "--muted-foreground"), plate)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color(scheme, "--foreground"), plate)).toBeGreaterThanOrEqual(7);
  });

  it("hairlines are quiet (1.1 to 2:1) and the strong line identifies a control (at least 2.8:1)", () => {
    expect(contrastRatio(color(scheme, "--border"), bg)).toBeGreaterThan(1.1);
    expect(contrastRatio(color(scheme, "--border"), bg)).toBeLessThan(2);
    expect(contrastRatio(color(scheme, "--border-strong"), bg)).toBeGreaterThanOrEqual(2.8);
    expect(contrastRatio(color(scheme, "--line-faint"), bg)).toBeLessThan(1.3);
  });

  it("every kind has a hue token", () => {
    for (const kind of ENTRY_KINDS) expect(SCHEMES[scheme].has(`--kind-${kind}`), `--kind-${kind}`).toBe(true);
  });
});

describe("square edges", () => {
  it("every radius token is 0", () => {
    for (const name of ["--radius-sm", "--radius-md", "--radius-lg"]) expect(light.get(name)).toBe("0");
  });

  it("no UI component rounds a corner", () => {
    const dir = new URL("../components/ui/", import.meta.url);
    for (const file of readdirSync(dir)) {
      const source = readFileSync(new URL(file, dir), "utf8");
      expect(source, file).not.toMatch(/rounded(?!-none)|border-radius/);
    }
    const ds = css.slice(css.indexOf(".ds-micro {"), css.indexOf(".nav-scrim {"));
    expect(ds).not.toMatch(/border-radius/);
  });
});

describe("type and grid", () => {
  it("micro-labels are at least 11 px", () => {
    const m = /--text-micro:\s*([\d.]+)rem/.exec(css);
    expect(Number(m?.[1]) * 16).toBeGreaterThanOrEqual(11);
  });

  it("controls meet the 44 px touch rule below md and keep the desktop heights on the 4 px grid", () => {
    expect(light.get("--control-h")).toBe("2.75rem");
    expect(light.get("--control-h-sm")).toBe("2.75rem");
    const md = /@media \(min-width: 768px\) \{\s*:root \{([^}]*)\}/.exec(css)?.[1] ?? "";
    for (const m of md.matchAll(/--control-h(?:-sm)?:\s*([\d.]+)rem/g)) expect((Number(m[1]) * 16) % 4).toBe(0);
  });

  it("the panel grid is 12 columns", () => {
    expect(css).toMatch(/\.ds-grid \{[^}]*repeat\(12, minmax\(0, 1fr\)\)/);
  });
});

describe("reduced motion", () => {
  it("the scan sweep stops under prefers-reduced-motion", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.ds-skeleton::after\s*\{\s*animation: none/);
  });
});
