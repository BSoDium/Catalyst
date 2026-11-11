import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_COLORS } from "~/lib/site";
import { THEME_KEY, isInstalledPhoneApp, matchesTheme, rankThemes, readThemeChoice, setThemeChoice, themeSub } from "./theme";
import { voice } from "./theme-click";

describe("the theme words of the palette (#507)", () => {
  it("are found by the words for it, by a start of one, and by none else", () => {
    for (const q of ["theme", "dark", "light", "system", "mode", "dark mode", "appear", "li", "Dark Theme"]) expect(matchesTheme(q), q).toBe(true);
    for (const q of ["", "  ", "paris", "d", "darkness of the sea", "toulouse"]) expect(matchesTheme(q), q).toBe(false);
  });
});

describe("the order of the three rows", () => {
  it("is light, dark, system, and the one a query is about comes first", () => {
    expect(rankThemes("")).toEqual(["light", "dark", "system"]);
    expect(rankThemes("theme")).toEqual(["light", "dark", "system"]);
    expect(rankThemes("dark")).toEqual(["dark", "light", "system"]);
    expect(rankThemes("night mode")).toEqual(["dark", "light", "system"]);
    expect(rankThemes("auto")).toEqual(["system", "light", "dark"]);
  });
});

describe("the choice of the scheme", () => {
  const store = new Map<string, string>();
  const attrs = new Map<string, string>();
  const metas = [{ v: "x", setAttribute(_: string, v: string) { this.v = v; } }, { v: "y", setAttribute(_: string, v: string) { this.v = v; } }];
  const events: string[] = [];
  let osDark = false;
  beforeEach(() => {
    store.clear();
    attrs.clear();
    events.length = 0;
    osDark = false;
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    vi.stubGlobal("document", {
      documentElement: { getAttribute: (k: string) => attrs.get(k) ?? null, setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) },
      querySelectorAll: () => ({ forEach: (f: (m: (typeof metas)[number], i: number) => void) => metas.forEach(f) }),
    });
    vi.stubGlobal("matchMedia", () => ({ matches: osDark }));
    vi.stubGlobal("window", { dispatchEvent: (e: Event) => void events.push(e.type) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("forces the scheme on the root, keeps it, tells the page, and says whether the scheme changed", () => {
    expect(readThemeChoice()).toBe("system");
    expect(setThemeChoice("dark")).toBe(true);
    expect(attrs.get("data-scheme")).toBe("dark");
    expect(store.get(THEME_KEY)).toBe("dark");
    expect(readThemeChoice()).toBe("dark");
    expect(events).toEqual(["site:scheme"]);
    expect(metas.map((m) => m.v)).toEqual([THEME_COLORS.dark, THEME_COLORS.dark]);
    expect(setThemeChoice("dark")).toBe(false); // (the same again: no change, so no click)
  });

  it("system takes the attribute and the kept choice away, and the browser's colours go back to their two media", () => {
    setThemeChoice("light");
    expect(setThemeChoice("system")).toBe(false); // (light by the OS too: the page does not change)
    expect(attrs.has("data-scheme")).toBe(false);
    expect(store.has(THEME_KEY)).toBe(false);
    expect(metas.map((m) => m.v)).toEqual([THEME_COLORS.light, THEME_COLORS.dark]);
    osDark = true;
    setThemeChoice("light");
    expect(setThemeChoice("system")).toBe(true); // (the OS is dark: it does change)
  });
});

describe("an app installed on a phone", () => {
  const store = new Map<string, string>();
  const attrs = new Map<string, string>();
  const metas = [{ v: "x", setAttribute(_: string, v: string) { this.v = v; } }, { v: "y", setAttribute(_: string, v: string) { this.v = v; } }];
  beforeEach(() => {
    store.clear();
    attrs.clear();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    vi.stubGlobal("document", {
      documentElement: { getAttribute: (k: string) => attrs.get(k) ?? null, setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) },
      querySelectorAll: () => ({ forEach: (f: (m: (typeof metas)[number], i: number) => void) => metas.forEach(f) }),
    });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("window", { dispatchEvent: () => true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts dark by default but constrains nothing: the three rows keep their meaning, and system is kept as a choice there", () => {
    expect(isInstalledPhoneApp()).toBe(false);
    expect(readThemeChoice()).toBe("system");
    expect(themeSub("system")).toBe("Follow the device's setting");
    attrs.set("data-phone-app", "");
    expect(isInstalledPhoneApp()).toBe(true);
    expect(readThemeChoice()).toBe("dark"); // (nothing chosen yet: the default)
    expect(themeSub("dark")).toMatch(/navigation bar/);
    setThemeChoice("system");
    expect(attrs.has("data-scheme")).toBe(false); // (the phone's own scheme, as ever)
    expect(store.get(THEME_KEY)).toBe("system");
    expect(readThemeChoice()).toBe("system");
    expect(metas.map((m) => m.v)).toEqual([THEME_COLORS.light, THEME_COLORS.dark]);
    setThemeChoice("light");
    expect(readThemeChoice()).toBe("light");
  });
});

describe("the click", () => {
  it("is a little higher on the light page and lower on the dark one, and always soft and short", () => {
    const light = voice("light");
    const dark = voice("dark");
    expect(light.thunk.hz).toBeGreaterThan(dark.thunk.hz);
    expect(light.modes[1]!.hz).toBeGreaterThan(dark.modes[1]!.hz);
    for (const v of [light, dark]) {
      // (all the parts at once, plus the release, stay well under full scale: peaks add at most)
      const loud = v.transient.gain + v.modes.reduce((n, m) => n + m.gain, 0) + v.thunk.gain;
      expect(loud * (1 + v.release.scale)).toBeLessThan(0.45);
      expect(Math.max(...v.modes.map((m) => m.sec), v.thunk.sec) + v.release.delay).toBeLessThan(0.15);
    }
  });
});

describe("public/theme-boot.js", () => {
  const boot = readFileSync(new URL("../../public/theme-boot.js", import.meta.url), "utf8");
  it("reads the key of the theme module and paints the browser UI in the page colours of the site", () => {
    expect(boot).toContain(`localStorage.getItem("${THEME_KEY}")`);
    expect(boot).toContain(THEME_COLORS.dark);
    expect(boot).toContain(THEME_COLORS.light);
  });
  it("makes an app installed on a phone dark unless the visitor chose: installed display mode, a touch screen, a phone's size, and not a tab or a desktop app", () => {
    expect(boot).toContain('root.setAttribute("data-phone-app", "")');
    expect(boot).toMatch(/\(display-mode: standalone\), \(display-mode: fullscreen\), \(display-mode: minimal-ui\)/);
    expect(boot).not.toMatch(/phoneApp =[^;]*window-controls-overlay/);
    expect(boot).toContain('(pointer: coarse)');
    expect(boot).toMatch(/Math\.min\(screen\.width, screen\.height\) < 600/);
    expect(boot).toMatch(/t !== "light" && t !== "dark" && t !== "system" && phoneApp\) t = "dark"/); // (a default: a kept "system" is respected)
  });
});
