import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, luminance, over, parseColor, type Rgba } from "./contrast";
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
    const colorNames = [...light.keys()].filter((k) => /^--(background|foreground|muted-foreground|subtle-foreground|border|border-strong|ring|primary|primary-foreground|accent|accent-foreground|globe-grid|globe-limb|surface|line-faint|signal|signal-text|signal-foreground|signal-wash|signal-hover|signal-active|inverse-[a-z-]+|kind-[a-z]+|palette-[a-z]+-(text|tint)|label-plate-alpha)$/.test(k));
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
    const signalText = color(scheme, "--signal-text");
    for (const under of [bg, surface, accentGrey]) {
      expect(contrastRatio(fg, under)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(muted, under)).toBeGreaterThanOrEqual(4.5);
      // the accent as text of any size: its text variant is AA wherever muted text is
      expect(contrastRatio(signalText, under)).toBeGreaterThanOrEqual(4.5);
    }
    // subtle text (the map credits) stays on the page and the surface only
    for (const under of [bg, surface]) expect(contrastRatio(subtle, under)).toBeGreaterThanOrEqual(4.5);
  });

  it("the accent itself is for large display text and marks: 3:1 on the page and the surface (WCAG large text and graphics)", () => {
    const signal = color(scheme, "--signal");
    for (const under of [bg, surface]) expect(contrastRatio(signal, under)).toBeGreaterThanOrEqual(3);
  });

  it("the signal fill carries AA text, and the inverted frame's accent is as good against its own page", () => {
    const signal = color(scheme, "--signal");
    expect(contrastRatio(color(scheme, "--signal-foreground"), signal)).toBeGreaterThanOrEqual(4.5);
    const inverseBg = color(scheme, "--inverse-background");
    expect(contrastRatio(color(scheme, "--inverse-signal"), inverseBg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(color(scheme, "--inverse-signal-text"), inverseBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color(scheme, "--signal-foreground"), color(scheme, "--inverse-signal"))).toBeGreaterThanOrEqual(4.5);
  });

  it("fills with their text: primary (the accent's fill, hovered and pressed), signal and the inverse pair are AA", () => {
    expect(color(scheme, "--primary")).toEqual(color(scheme, "--signal"));
    for (const fill of ["--primary", "--signal-hover", "--signal-active"]) expect(contrastRatio(color(scheme, "--primary-foreground"), color(scheme, fill)), fill).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color(scheme, "--signal-foreground"), color(scheme, "--signal"))).toBeGreaterThanOrEqual(4.5);
    const inverseBg = color(scheme, "--inverse-background");
    expect(contrastRatio(color(scheme, "--inverse-foreground"), inverseBg)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(color(scheme, "--inverse-muted"), inverseBg)).toBeGreaterThanOrEqual(4.5);
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

  it("hairlines are quiet (1.1 to 2:1) and the strong line identifies a control (at least 3:1, WCAG 1.4.11)", () => {
    expect(contrastRatio(color(scheme, "--border"), bg)).toBeGreaterThan(1.1);
    expect(contrastRatio(color(scheme, "--border"), bg)).toBeLessThan(2);
    expect(contrastRatio(color(scheme, "--border-strong"), bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(color(scheme, "--line-faint"), bg)).toBeLessThan(1.3);
  });

  it("every kind has a hue token", () => {
    for (const kind of ENTRY_KINDS) expect(SCHEMES[scheme].has(`--kind-${kind}`), `--kind-${kind}`).toBe(true);
  });
});

describe("the accent is BSoD blue", () => {
  /** HSL hue in degrees and saturation (0 to 1) of an opaque colour. */
  function hueSat([r, g, b]: Rgba): { hue: number; sat: number } {
    const [R, G, B] = [r / 255, g / 255, b / 255];
    const max = Math.max(R, G, B);
    const min = Math.min(R, G, B);
    const d = max - min;
    const l = (max + min) / 2;
    const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    const h = d === 0 ? 0 : max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    return { hue: (h * 60 + 360) % 360, sat };
  }
  const TONES = ["--signal", "--signal-text", "--signal-hover", "--signal-active", "--ring", "--primary", "--paper-signal", "--paper-signal-text", "--inverse-signal", "--inverse-signal-text"] as const;

  it("is the Windows stop-screen blue (#0078d7 is 206.5 degrees, fully saturated): every tone of it, in both schemes, within 6 degrees: not cyan, not purple", () => {
    expect(hueSat(parseColor("#0078d7")!).hue).toBeCloseTo(206.5, 1);
    for (const scheme of ["light", "dark"] as const)
      for (const name of TONES) {
        const { hue, sat } = hueSat(color(scheme, name));
        expect(Math.abs(hue - 206.5), `${scheme} ${name} hue ${hue.toFixed(1)}`).toBeLessThanOrEqual(6);
        expect(sat, `${scheme} ${name} saturation`).toBeGreaterThanOrEqual(0.95);
      }
  });

  it("the fill is the same blue in both schemes; only the small-text tone changes (deeper in light, lighter in dark)", () => {
    expect(light.get("--signal")).toBe(dark.get("--signal"));
    expect(light.get("--signal-foreground")).toBe(dark.get("--signal-foreground"));
    const lum = (scheme: "light" | "dark", name: string) => luminance(color(scheme, name));
    expect(lum("light", "--signal-text")).toBeLessThan(lum("light", "--signal"));
    expect(lum("dark", "--signal-text")).toBeGreaterThan(lum("dark", "--signal"));
  });
});

describe("reading surface (paper in the light scheme, night in the dark)", () => {
  const PAPER = ["--paper", "--paper-foreground", "--paper-muted", "--paper-hover", "--paper-signal", "--paper-signal-text"] as const;

  it("is declared in the root rule, the dark media rule and both forced-scheme rules, with the same values", () => {
    for (const name of PAPER) {
      expect(light.has(name), `light ${name}`).toBe(true);
      expect(dark.has(name), `dark ${name}`).toBe(true);
      expect(forcedLight.get(name), `forced light ${name}`).toBe(light.get(name));
      expect(forcedDark.get(name), `forced dark ${name}`).toBe(dark.get(name));
    }
  });

  it("rebinds the page tokens for an entry's panel and for the list pages' root, after the root rule (unlayered, so it wins)", () => {
    const at = css.indexOf('[data-panel]:has([data-surface="reading"])');
    expect(at).toBeGreaterThan(css.indexOf(":root {"));
    const body = ruleBody(css, at);
    for (const token of ["--background", "--foreground", "--muted-foreground", "--accent", "--border", "--signal", "--signal-text"]) expect(body, token).toContain(`${token}:`);
    expect(css.slice(at, at + 200)).toContain(':root:has(main[data-surface="reading"])');
  });

  it("prints as ink on white whatever the scheme: the print rule rebinds the paper tokens too (the list pages' root rule is more specific than the page tokens)", () => {
    const at = css.indexOf("@media print {");
    expect(at).toBeGreaterThan(css.indexOf('[data-panel]:has([data-surface="reading"])'));
    const printRoot = declarations(ruleBody(css, css.indexOf(":root {", at)));
    expect(printRoot.get("--paper")).toBe("#fff");
    expect(printRoot.get("--paper-foreground")).toBe("#000");
    expect(printRoot.get("--paper-hover")).toBe("#fff");
    const white = parseColor("#fff")!;
    for (const name of ["--paper-foreground", "--paper-muted", "--paper-signal", "--paper-signal-text"]) {
      expect(contrastRatio(parseColor(printRoot.get(name)!)!, white), name).toBeGreaterThanOrEqual(7);
    }
  });

  describe.each(["light", "dark"] as const)("contrast (%s)", (scheme) => {
    const paper = color(scheme, "--paper");
    const ink = color(scheme, "--paper-foreground");
    const muted = color(scheme, "--paper-muted");
    const hover = color(scheme, "--paper-hover");

    it("the ink is body text (7:1) and the muted text is AA on the paper and on its hover grey", () => {
      expect(contrastRatio(ink, paper)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(ink, hover)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(muted, paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(muted, hover)).toBeGreaterThanOrEqual(4.5);
    });

    it("the accent as text (small) is AA, and as large text or a mark it is 3:1, on the paper", () => {
      expect(contrastRatio(color(scheme, "--paper-signal-text"), paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(color(scheme, "--paper-signal-text"), hover)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(color(scheme, "--paper-signal"), paper)).toBeGreaterThanOrEqual(3);
    });

    it("the hairlines are quiet (1.1 to 2:1) and the ink rules are the ink itself", () => {
      const hairline = over([ink[0], ink[1], ink[2], 0.18], paper);
      expect(contrastRatio(hairline, paper)).toBeGreaterThan(1.1);
      expect(contrastRatio(hairline, paper)).toBeLessThan(2);
      expect(contrastRatio(over([ink[0], ink[1], ink[2], 0.55], paper), paper)).toBeGreaterThanOrEqual(3);
    });
  });
});

describe("small-screen details", () => {
  it("the dot between tags ends the item before it, so a wrapped line never starts with one", () => {
    expect(css).toContain(".ds-tags > li:not(:last-child)::after {");
    expect(css).not.toContain(".ds-tags > li + li::before");
  });

  it("the filter toggles are 44 px targets on a phone, also the shortest word", () => {
    const body = ruleBody(css, css.indexOf("  .ds-filter {"));
    expect(body).toContain("min-height: 2.75rem;");
    expect(body).toContain("min-width: 2.75rem;");
    expect(body).toContain("padding-inline: 0.5rem;");
  });

  it("the headline's measure follows the role's size, not the size a long title is scaled to", () => {
    expect(ruleBody(css, css.indexOf("  .entry-title {"))).toContain("max-width: calc(8.95 * var(--entry-title));");
  });

  it("carries no class nothing uses (checked against the sources when this was removed)", () => {
    for (const dead of [".type-measure {", ".type-heavy {", ".ds-row,", ".ds-row {"]) expect(css, dead).not.toContain(dead);
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

describe("restraint (no decorative chrome)", () => {
  const ui = css.slice(css.indexOf(".ds-micro {"), css.indexOf(".nav-scrim {"));
  it("frames and cards have no corner brackets", () => {
    expect(ui).not.toMatch(/data-brackets|--ds-bracket|--bracket-/);
    expect(light.has("--bracket-len")).toBe(false);
  });
  it("buttons, filters, tags and statuses are plain sans: no tracked uppercase on them", () => {
    for (const rule of [".ds-button {", ".ds-filter {", ".ds-tags {", ".ds-status {"]) {
      const body = ruleBody(css, css.indexOf(rule));
      expect(body, rule).not.toMatch(/text-transform:\s*uppercase|letter-spacing/);
      expect(body, rule).not.toMatch(/font-family:\s*var\(--font-mono\)/);
    }
  });
  it("the micro-label stays the one uppercase mono unit of the UI components; the type roles add exactly one more, the metadata role", () => {
    expect([...ui.matchAll(/text-transform:\s*uppercase/g)].length).toBe(1);
    const roles = css.slice(css.indexOf("Type roles (docs/design-system.md"), css.indexOf(".ds-micro {"));
    expect([...roles.matchAll(/text-transform:\s*uppercase/g)].length).toBe(1);
    expect(ruleBody(css, css.indexOf(".type-meta {"))).toMatch(/text-transform:\s*uppercase/);
  });
  it("the component sources carry no index code, numbered section or bracketed status", () => {
    const dirs = [new URL("../components/ui/", import.meta.url), new URL("../components/entry/", import.meta.url), new URL("../components/", import.meta.url)];
    for (const dir of dirs) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
        const source = readFileSync(new URL(file, dir), "utf8");
        expect(source, file).not.toMatch(/formatIndex|entryCode|№|`\[ |"\[ "/);
      }
    }
  });
});

describe("window controls overlay", () => {
  const wco = css.slice(css.indexOf("@media (display-mode: window-controls-overlay)"));
  it("the player's corner threshold is the 1280 px rule's own sum when there are no buttons", () => {
    // the rule it stands for: the corner from 1280 px, 2 * (inset + player) + links = 80 rem
    expect(css).toMatch(/@media \(min-width: 1280px\) \{\s*\.np-root,/);
    const inset = Number(/--np-inset:\s*([\d.]+)rem/.exec(css)![1]);
    const player = Number(/--np-w:\s*([\d.]+)rem/.exec(wco)![1]);
    const links = Number(/--np-links-w:\s*([\d.]+)rem/.exec(wco)![1]);
    expect(2 * (inset + player) + links).toBe(80);
  });
  it("every clearance is 0 on a side with no buttons (the min(... * 1000) trick) and only the title bar is a handle", () => {
    expect(wco).toMatch(/--wco-left-clear:\s*calc\(var\(--wco-left\) \+ min\(var\(--wco-gap\), calc\(var\(--wco-left\) \* 1000\)\)\)/);
    expect(wco).toMatch(/--wco-right-clear:\s*calc\(var\(--wco-right\) \+ min\(var\(--wco-gap\), calc\(var\(--wco-right\) \* 1000\)\)\)/);
    expect(wco.match(/(?<!-webkit-)app-region:\s*drag/g)?.length).toBe(1);
    expect(wco).toMatch(/html::before\s*\{[^}]*app-region:\s*drag/);
  });
});

describe("the page under a phone's system bars", () => {
  it("the viewport covers the notch and the bars, and the insets are read in one place (--safe-*), which everything else uses", async () => {
    const { readFileSync } = await import("node:fs");
    const root = readFileSync(new URL("../root.tsx", import.meta.url), "utf8");
    expect(root).toMatch(/name="viewport" content="[^"]*viewport-fit=cover/);
    // the four tokens are the only `env(safe-area-inset-*)` of the stylesheet: a check can set them by hand where there is no phone
    expect(css.match(/env\(safe-area-inset-/g)?.length).toBe(4);
    for (const side of ["top", "right", "bottom", "left"]) expect(css).toContain(`--safe-${side}: env(safe-area-inset-${side}, 0px);`);
    // the header takes the status bar's height into the bar's
    expect(css).toMatch(/--navbar-height:\s*calc\(var\(--navbar-base\) \+ var\(--safe-top\)\)/);
  });
});
