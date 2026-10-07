import assert from "node:assert/strict";
import test from "node:test";
import { findPreviewLeaks, placeSignature, previewFilesInRepoListing, samplePreviewPlaces } from "./preview-leaks.mjs";

const mk = (n) => ({ places: Array.from({ length: n }, (_, i) => ({ slug: `place-${i}`, name: `Placename${i}` })) });

test("samples at most max places, evenly and deterministically", () => {
  assert.equal(samplePreviewPlaces(mk(5), 12).length, 5);
  const s = samplePreviewPlaces(mk(146), 12);
  assert.equal(s.length, 12);
  assert.deepEqual(s, samplePreviewPlaces(mk(146), 12));
  assert.equal(s[0].slug, "place-0");
  assert.ok(s[11].slug !== "place-0");
  assert.deepEqual(samplePreviewPlaces({ places: [{ slug: "x", name: "A" }] }), [], "too-short names are not probes");
  assert.deepEqual(samplePreviewPlaces({}), []);
});

test("detects an inlined record in the shapes bundlers produce, not a bare name", () => {
  const p = { slug: "warsaw-pl", name: "Warsaw" };
  const re = placeSignature(p);
  for (const text of [
    '{"slug":"warsaw-pl","name":"Warsaw","coordinates":{}}',
    '{slug:"warsaw-pl",name:"Warsaw",coordinates:{}}',
    "JSON.parse('{\\\"slug\\\":\\\"warsaw-pl\\\",\\\"name\\\":\\\"Warsaw\\\"}')",
  ]) assert.ok(re.test(text), text);
  assert.ok(!re.test('const capitals = ["Warsaw","Paris"]'));
  assert.ok(!re.test('{name:"Warsaw",population:1}'));
  assert.ok(!re.test('{slug:"warsaw-pl",name:"Warsawa"}'));
});

test("regex metacharacters in a name are escaped", () => {
  const re = placeSignature({ slug: "st-john-s", name: "St. John's (old)" });
  assert.ok(re.test('{slug:"st-john-s",name:"St. John\'s (old)"}'));
  assert.ok(!re.test('{slug:"st-john-s",name:"St, John\'s Xold)"}'));
});

test("flags bundle files that contain sampled places or the preview file itself, without printing names", () => {
  const proj = mk(20);
  const clean = { file: "apps/web/build/client/a.js", text: 'var x="hello"' };
  assert.deepEqual(findPreviewLeaks([clean], proj), []);
  const leaky = { file: "apps/web/build/server/index.js", text: `x=${JSON.stringify(proj.places)}` };
  const failures = findPreviewLeaks([clean, leaky], proj);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /12 of 12 sampled preview places found in apps\/web\/build\/server\/index\.js/);
  assert.ok(!failures.some((f) => f.includes("Placename")));
  const asset = findPreviewLeaks([{ file: "apps/web/build/client/assets/preview.projection-abc.json", text: "{}" }], proj);
  assert.match(asset[0], /preview file itself/);
});

test("repo listing: a tracked or unignored preview file is reported", () => {
  assert.deepEqual(previewFilesInRepoListing(["a.ts", "packages/published/data/projection.json"]), []);
  assert.deepEqual(previewFilesInRepoListing(["packages/published/data/preview.projection.json"]), ["packages/published/data/preview.projection.json"]);
  assert.deepEqual(previewFilesInRepoListing(["x/preview.projection.json.bak"]), ["x/preview.projection.json.bak"]);
});

test(".gitignore covers the preview file and the preview screenshots", async () => {
  const { spawnSync } = await import("node:child_process");
  const root = new URL("../../", import.meta.url).pathname;
  for (const f of ["packages/published/data/preview.projection.json", "docs/screenshots/preview-world.png"]) {
    const r = spawnSync("git", ["check-ignore", "--no-index", "-q", "--", f], { cwd: root });
    assert.equal(r.status, 0, `${f} must be git-ignored`);
  }
  const committed = spawnSync("git", ["check-ignore", "--no-index", "-q", "--", "packages/published/data/projection.json"], { cwd: root });
  assert.equal(committed.status, 1, "the real projection stays tracked");
});
