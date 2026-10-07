import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveValidateTarget } from "./validate-target";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const committed = join(packageDir, "data/projection.json");
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "validate-cli-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("resolveValidateTarget", () => {
  it("keeps an absolute path", () => {
    expect(resolveValidateTarget("/a/b.json", { INIT_CWD: "/x" }, "/y")).toBe("/a/b.json");
  });
  it("resolves a relative path from INIT_CWD (where pnpm was invoked), not from the package directory", () => {
    expect(resolveValidateTarget("sub/p.json", { INIT_CWD: "/repo" }, "/repo/packages/published")).toBe(resolve("/repo", "sub/p.json"));
  });
  it("falls back to the process cwd without INIT_CWD", () => {
    expect(resolveValidateTarget("p.json", {}, "/here")).toBe(resolve("/here", "p.json"));
    expect(resolveValidateTarget("p.json", { INIT_CWD: "" }, "/here")).toBe(resolve("/here", "p.json"));
  });
});

describe("validate-cli", () => {
  // Same shape as `pnpm validate:published <relative path>`: cwd is the package, INIT_CWD is where the user typed it.
  const run = (arg: string | undefined, initCwd: string) =>
    spawnSync(join(packageDir, "node_modules/.bin/tsx"), ["src/validate-cli.ts", ...(arg ? [arg] : [])], {
      cwd: packageDir,
      env: { ...process.env, INIT_CWD: initCwd },
      encoding: "utf8",
    });

  it("validates the committed projection by default", () => {
    const r = run(undefined, tmp());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("ok:");
  });
  it("validates a path relative to INIT_CWD", () => {
    const dir = tmp();
    mkdirSync(join(dir, "nested"));
    copyFileSync(committed, join(dir, "nested/p.json"));
    const r = run("nested/p.json", dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(join(dir, "nested/p.json"));
  });
  it("fails on an invalid file and on a missing relative path", () => {
    const dir = tmp();
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ schemaVersion: 1, extra: true }));
    expect(run("bad.json", dir).status).toBe(1);
    expect(run("missing.json", dir).status).toBe(1);
  });
});
