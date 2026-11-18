import { existsSync, readFileSync, statSync } from "node:fs";
import { CAPTION_FACES, CAPTION_STYLES } from "~/globe/engine/caption";
import { describe, expect, it } from "vitest";
import { DISPLAY_FONT_URL, FONT_DIR, FONT_FILES, POSTER_FONT_FILES } from "./fonts";

const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
const publicFile = (name: string) => new URL(`../../public/${name}`, import.meta.url);
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
const prop = (block: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();

/** The Latin subset the files were cut to (fontsource's latin range): glyphs of any other script fall back per character. */
const LATIN_RANGE =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

describe("self-hosted fonts", () => {
  const webFaces = faces.filter((f) => /url\(/.test(f));
  const fallbackFaces = faces.filter((f) => /local\(/.test(f));

  it("ships exactly the woff2 files of FONT_FILES and POSTER_FONT_FILES, each a real woff2, with the OFL licences beside them", () => {
    for (const file of [...Object.values(FONT_FILES), ...Object.values(POSTER_FONT_FILES)]) {
      const url = publicFile(`fonts/${file}`);
      expect(existsSync(url), file).toBe(true);
      expect(readFileSync(url).toString("latin1", 0, 4), `${file} is woff2`).toBe("wOF2");
      // The two Newsreader files carry the optical-size axis (about 129 and 143 kB): the headline is set at opsz 72, the body at 18.
      expect(statSync(url).size, file).toBeLessThan(160 * 1024);
    }
    for (const name of ["bricolage-grotesque", "newsreader", "jetbrains-mono", "bitter", "archivo", "caveat"]) {
      const licence = readFileSync(publicFile(`fonts/LICENSE-${name}.txt`), "utf8");
      expect(licence, name).toContain("SIL Open Font License, Version 1.1");
      expect(licence, name).toMatch(/^Copyright /);
    }
  });

  it("carries the version in every file name, so the year-long immutable cache is safe", () => {
    for (const file of Object.values(FONT_FILES)) expect(file, file).toMatch(/-\d+\.\d+\.\d+-latin-/);
    expect(DISPLAY_FONT_URL).toBe(`${FONT_DIR}${FONT_FILES.display}`);
  });

  it("is declared with @font-face from this origin only, swapping, in the Latin range, and the CSS names the same files", () => {
    const all = [...Object.values(FONT_FILES), ...Object.values(POSTER_FONT_FILES)];
    expect(webFaces.length).toBe(all.length);
    const urls = webFaces.map((f) => /url\("([^"]+)"\)/.exec(f)?.[1]);
    expect(urls.sort()).toEqual(all.map((f) => `${FONT_DIR}${f}`).sort());
    for (const face of webFaces) {
      expect(prop(face, "font-display")).toBe("swap");
      expect(prop(face, "unicode-range")).toBe(LATIN_RANGE);
      expect(face).toMatch(/format\("woff2"\)/);
    }
    expect(css).not.toMatch(/url\(\s*["']?https?:/);
    expect(css).not.toMatch(/@import\s+url/);
  });

  it("has a metric-matched fallback face per family: size-adjust and ascent / descent / line-gap overrides", () => {
    expect(fallbackFaces.length).toBeGreaterThanOrEqual(4);
    for (const face of fallbackFaces) {
      const size = Number.parseFloat(prop(face, "size-adjust") ?? "");
      expect(size, face).toBeGreaterThan(80);
      expect(size, face).toBeLessThan(105);
      for (const name of ["ascent-override", "descent-override", "line-gap-override"]) expect(prop(face, name), `${name} in ${face}`).toMatch(/^[\d.]+%$/);
    }
    const families = new Set(fallbackFaces.map((f) => prop(f, "font-family")));
    expect(families).toEqual(new Set(['"Bricolage Grotesque Fallback"', '"Newsreader Fallback"']));
  });

  it("puts the system stack behind every family, so a missing file or another script is never blank", () => {
    const stack = (name: string) => new RegExp(`--font-${name}:\\s*([^;]+);`).exec(css)?.[1] ?? "";
    expect(stack("display")).toMatch(/^"Bricolage Grotesque Variable", "Bricolage Grotesque Fallback", var\(--font-sans\)$/);
    expect(stack("reading")).toMatch(/^"Newsreader Variable", "Newsreader Fallback", ui-serif, Georgia, .*serif$/);
    expect(stack("meta")).toBe('"JetBrains Mono Variable", var(--font-mono)');
  });

  it("leaves the system sans and mono stacks, and the map's labels, on the system", () => {
    expect(css).toMatch(/--font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;/);
    expect(css).toMatch(/--font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;/);
    const label = css.slice(css.indexOf(".map-label {"));
    expect(label.slice(0, label.indexOf("}"))).toMatch(/font-family: var\(--font-mono\)/);
    expect(css.slice(css.indexOf(".map-label {"))).not.toMatch(/\.map-(?:label|halo)[^{]*\{[^}]*font-(?:display|reading|meta)/);
  });

  it("preloads the display face on the home route only, as a CORS font", async () => {
    const home = readFileSync(new URL("../routes/home.tsx", import.meta.url), "utf8");
    expect(home).toMatch(/rel: "preload"[^}]*as: "font"[^}]*type: "font\/woff2"[^}]*crossOrigin: "anonymous"/);
    expect(home).toContain("DISPLAY_FONT_URL");
    const root = readFileSync(new URL("../root.tsx", import.meta.url), "utf8");
    expect(root).not.toMatch(/preload/);
  });
});

describe("type roles", () => {
  const px = (name: string) => {
    const m = new RegExp(`--${name}:\\s*([\\d.]+)rem;`).exec(css);
    return m ? Number(m[1]) * 16 : null;
  };
  const clampMin = (name: string) => {
    const m = new RegExp(`--${name}:\\s*clamp\\(([\\d.]+)rem,`).exec(css);
    return m ? Number(m[1]) * 16 : null;
  };

  it("defines the weight pair and the reading weight", () => {
    expect(css).toMatch(/--weight-thin: 200;/);
    expect(css).toMatch(/--weight-heavy: 800;/);
    expect(css).toMatch(/--weight-reading: 400;/);
  });

  it("keeps display sizes fluid with a floor, the wordmark's at 3.5 rem", () => {
    expect(clampMin("text-display-xl")).toBe(56);
    expect(css).toMatch(/--text-display-xl:\s*clamp\(3\.5rem, 11vw, 10rem\);/);
    expect(clampMin("text-display-lg")).toBeGreaterThanOrEqual(32);
    expect(clampMin("text-display-md")).toBeGreaterThanOrEqual(24);
    for (const role of ["display-xl", "display-lg", "display-md"]) {
      expect(Number(new RegExp(`--text-${role}--line-height:\\s*([\\d.]+);`).exec(css)?.[1]), role).toBeLessThanOrEqual(1.1);
      expect(Number.parseFloat(new RegExp(`--text-${role}--letter-spacing:\\s*(-[\\d.]+)em;`).exec(css)?.[1] ?? "0"), role).toBeLessThan(0);
    }
  });

  it("sets reading at 18 to 20 px with 1.6 to 1.7 leading, the standfirst at 24 to 30 px, the metadata at 11 px or more", () => {
    expect(clampMin("text-reading")).toBe(18);
    expect(css).toMatch(/--text-reading:\s*clamp\(1\.125rem, [^)]*, 1\.25rem\);/);
    const lh = Number(/--text-reading--line-height:\s*([\d.]+);/.exec(css)?.[1]);
    expect(lh).toBeGreaterThanOrEqual(1.6);
    expect(lh).toBeLessThanOrEqual(1.7);
    expect(clampMin("text-standfirst")).toBe(24);
    expect(css).toMatch(/--text-standfirst:\s*clamp\(1\.5rem, [^)]*, 1\.9rem\);/);
    expect(px("text-meta")).toBeGreaterThanOrEqual(11);
    expect(px("text-meta")).toBeLessThanOrEqual(12);
  });

  it("holds the reading column to about 62 to 68 characters (28.5 em of Newsreader, whose average advance is 0.43 em)", () => {
    expect(css).toMatch(/--measure-reading:\s*calc\(var\(--text-reading\) \* 28\.5\);/);
    const characters = 28.5 / 0.4313;
    expect(characters).toBeGreaterThan(62);
    expect(characters).toBeLessThan(68);
  });

  it("wraps headlines to balance and body text to pretty, and never synthesises a Bricolage italic", () => {
    const display = css.slice(css.indexOf(".type-display-xl,"), css.indexOf(".type-display-xl {"));
    expect(display).toMatch(/text-wrap: balance/);
    expect(display).toMatch(/font-synthesis: none/);
    expect(display).toMatch(/font-optical-sizing: auto/);
    expect(css.slice(css.indexOf(".type-reading {"))).toMatch(/text-wrap: pretty/);
  });

  it("exposes the roles as utilities through the theme (font-display, font-reading, font-meta; text-display-xl ...)", () => {
    expect(css).toMatch(/@theme static \{[^@]*--font-display:[^@]*--font-reading:[^@]*--font-meta:/);
    for (const role of ["display-xl", "display-lg", "display-md", "standfirst", "reading", "meta"]) expect(css, role).toMatch(new RegExp(`--text-${role}:`));
  });
});

describe("the caption's one extra face (loaded by the globe only when the page's caption has a word in it, not declared in the stylesheet)", () => {
  it("is a real woff2 subset of Basic Latin next to its OFL licence, versioned in the name (the year-long immutable cache), small", () => {
    const url = CAPTION_FACES.script.url;
    expect(url).toMatch(/^\/fonts\/imperial-script-\d+\.\d+-latin-400\.woff2$/);
    const file = publicFile(url.slice(1));
    expect(existsSync(file), url).toBe(true);
    expect(readFileSync(file).toString("latin1", 0, 4), url).toBe("wOF2");
    expect(statSync(file).size, url).toBeLessThan(30 * 1024);
    const text = readFileSync(publicFile("fonts/LICENSE-imperial-script.txt"), "utf8");
    expect(text).toContain("SIL Open Font License, Version 1.1");
    expect(text).toMatch(/^Copyright /);
  });

  it("has a classic serif of its own, Old Standard TT (SIL OFL 1.1), a kern-only woff2 subset a weight next to its licence, small, versioned in the name", () => {
    for (const style of ["plain", "heavy"] as const) {
      const url = CAPTION_STYLES[style].url!;
      expect(url).toMatch(/^\/fonts\/old-standard-tt-\d+\.\d+-latin-(400|700)\.woff2$/);
      const file = publicFile(url.slice(1));
      expect(existsSync(file), url).toBe(true);
      expect(readFileSync(file).toString("latin1", 0, 4), url).toBe("wOF2");
      expect(statSync(file).size, url).toBeLessThan(16 * 1024);
    }
    const text = readFileSync(publicFile("fonts/LICENSE-old-standard-tt.txt"), "utf8");
    expect(text).toContain("SIL Open Font License, Version 1.1");
    expect(text).toMatch(/^Copyright /);
    expect(css).not.toMatch(/old.standard/i);
  });

  it("is not in the stylesheet: no page pays for it, and the caption's mono is the page's own (JetBrains Mono)", () => {
    expect(css).not.toMatch(/imperial/i);
    expect(CAPTION_FACES.serif.url).toBeNull(); // (a file per style)
    expect(CAPTION_FACES.mono.url).toBeNull();
    expect(css).toContain('font-family: "JetBrains Mono Variable"');
    expect(css).toContain('font-family: "Newsreader Variable"'); // (the page's reading face; the caption no longer draws with it)
  });
});
