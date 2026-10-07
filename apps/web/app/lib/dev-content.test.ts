import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PREVIEW_HINT, devArgs, resolveDevContent } from "../../scripts/dev-content.mjs";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { scripts: Record<string, string> };
const rootPkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../package.json", import.meta.url)), "utf8")) as { scripts: Record<string, string> };

describe("pnpm dev content selection", () => {
  it("uses the preview when its file exists", () => {
    expect(resolveDevContent({ env: {}, previewExists: true }).content).toBe("preview");
  });

  it("falls back to the published (empty) projection with a one-line hint when there is no preview", () => {
    const r = resolveDevContent({ env: {}, previewExists: false });
    expect(r.content).toBe("published");
    expect(r.message).toBe(PREVIEW_HINT);
    expect(r.message).toContain("pnpm export:preview");
    expect(r.message).not.toContain("\n");
  });

  it("never picks demo implicitly, whatever the environment looks like", () => {
    for (const previewExists of [true, false]) for (const env of [{}, { CATALYST_CONTENT: "" }, { CATALYST_CONTENT: "  " }]) {
      expect(resolveDevContent({ env, previewExists }).content).not.toBe("demo");
    }
  });

  it("an explicit CATALYST_CONTENT wins", () => {
    expect(resolveDevContent({ env: { CATALYST_CONTENT: "published" }, previewExists: true })).toEqual({ content: "published", message: null });
    expect(resolveDevContent({ env: { CATALYST_CONTENT: "demo" }, previewExists: true }).content).toBe("demo");
  });

  it("adds the default port unless one is given", () => {
    expect(devArgs([])).toEqual(["dev", "--port", "5173"]);
    expect(devArgs(["--port", "5199"])).toEqual(["dev", "--port", "5199"]);
    expect(devArgs(["--port=5199", "--host"])).toEqual(["dev", "--port=5199", "--host"]);
  });
});

describe("package scripts", () => {
  it("dev is the launcher; demo is an explicit script; published is unchanged", () => {
    expect(pkg.scripts.dev).toBe("node scripts/dev.mjs");
    expect(pkg.scripts["dev:demo"]).toBe("CATALYST_CONTENT=demo react-router dev --port 5173");
    expect(pkg.scripts["dev:published"]).toBe("CATALYST_CONTENT=published react-router dev --port 5173");
    expect(rootPkg.scripts.dev).toBe("pnpm --filter @catalyst/web dev");
    expect(rootPkg.scripts["dev:demo"]).toBe("pnpm --filter @catalyst/web dev:demo");
  });

  it("no script other than dev:demo selects the demo content for a long-running server by default", () => {
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      if (name !== "dev:demo") expect(cmd, name).not.toContain("CATALYST_CONTENT=demo");
    }
  });
});
