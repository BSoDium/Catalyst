import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Pins the layering of `app/globe` (docs/web-architecture.md, "Layering"):
 *
 *   engine/    framework-free Three.js globe: imports neither handover/ nor street/
 *   street/    the MapLibre pass: imports engine/ but not handover/
 *   handover/  owns both renderers: may import engine/ and street/
 *   globe/     imports nothing from the rest of the app (the app hands in UI through props, e.g. `attribution`)
 *
 * It scans import specifiers, so a new upward import fails here instead of silently creating a cycle between layers.
 * Test files are exempt from the first two rules (a test may reach for another layer's constants) but not from the last.
 */
const appDir = fileURLToPath(new URL("..", import.meta.url));

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield p;
  }
}

/** Module specifiers of `from "x"`, `import "x"` and `import("x")`, ignoring whole-line comments and block comments. */
function specifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)) out.push(m[1]!);
  return out;
}

interface Edge {
  from: string;
  /** Path of the importing file relative to `app/`, with `/` separators. */
  to: string;
  /** Resolved target relative to `app/`, or the bare specifier for packages. */
  spec: string;
  external: boolean;
  test: boolean;
}

function edges(): Edge[] {
  const out: Edge[] = [];
  for (const file of walk(join(appDir, "globe"))) {
    const from = relative(appDir, file).split("\\").join("/");
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      const test = /\.test\.tsx?$/.test(from);
      if (spec.startsWith(".")) out.push({ from, to: posix.normalize(posix.join(dirname(from), spec)), spec, external: false, test });
      else if (spec.startsWith("~/")) out.push({ from, to: spec.slice(2), spec, external: false, test });
      else out.push({ from, to: spec, spec, external: true, test });
    }
  }
  return out;
}

const all = edges();
const inside = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);
const offenders = (pick: (e: Edge) => boolean) => all.filter(pick).map((e) => `${e.from} -> ${e.spec}`);

describe("globe layering", () => {
  it("scans the real tree (guards against a vacuous pass)", () => {
    expect(new Set(all.map((e) => e.from)).size).toBeGreaterThan(80);
    expect(all.some((e) => e.from === "globe/globe-canvas.tsx" && e.to === "globe/handover/controller")).toBe(true);
    expect(all.some((e) => e.from === "globe/handover/controller.ts" && inside(e.to, "globe/street"))).toBe(true);
  });

  it("engine/ imports neither handover/ nor street/", () => {
    expect(offenders((e) => !e.external && !e.test && inside(e.from, "globe/engine") && (inside(e.to, "globe/handover") || inside(e.to, "globe/street")))).toEqual([]);
  });

  it("street/ does not import handover/", () => {
    expect(offenders((e) => !e.external && !e.test && inside(e.from, "globe/street") && inside(e.to, "globe/handover"))).toEqual([]);
  });

  it("nothing under globe/ imports the rest of the app (components, routes, lib, hooks, ...)", () => {
    // Allowed: other files of globe/ (relative or `~/globe/...`) and packages. Anything else resolves outside app/globe.
    expect(offenders((e) => !e.external && !inside(e.to, "globe"))).toEqual([]);
  });

  it("the app reaches the globe through its seam or its documented exceptions only", () => {
    // Informational pin, not a rule: these are the app files that reach past `globe/index.tsx` today (docs/web-architecture.md,
    // "Layering"). A new entry here is a decision, not an accident.
    const seam = new Set(["globe", "globe/index", "globe/types", "globe/street", "globe/street/index"]);
    const reaching: string[] = [];
    for (const file of walk(appDir)) {
      const from = relative(appDir, file).split("\\").join("/");
      if (inside(from, "globe") || /\.test\.tsx?$/.test(from)) continue;
      for (const spec of specifiers(readFileSync(file, "utf8"))) {
        if (spec.startsWith("~/globe/") && !seam.has(spec.slice(2))) reaching.push(`${from} -> ${spec}`);
      }
    }
    expect(reaching.sort()).toEqual([
      "components/attribution-button.tsx -> ~/globe/street/core/attribution",
      "components/credits-dialog.tsx -> ~/globe/street/core/attribution",
      "lib/projection.ts -> ~/globe/engine/framing",
      "routes/dev-street-lines.tsx -> ~/globe/street/harness/synthetic",
      "routes/dev-street.tsx -> ~/globe/engine/geo",
      "lib/tiles-config.server.ts -> ~/globe/street/types",
    ].sort());
  });
});
