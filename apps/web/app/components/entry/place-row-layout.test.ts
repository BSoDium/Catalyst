import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * The phone layout of the place panel's rows (the cover full width, the title on its foot) is for a NARROW PANEL, not a narrow cell: a poem's cell in a wide panel's two columns is under 28 rem and was
 * drawn as on a phone (owner, 2026-11-05). So the rows' phone variants are keyed to the panel's group of entries (`@container/group`), never to the row's own cell (an unnamed `@max-md:` would match the nearest
 * container, which for a poem is its own cell).
 */
describe("the place panel's rows: the phone layout follows the panel, not the cell", () => {
  const row = read("./entry-list-card.tsx");
  const detail = read("../place-detail.tsx");
  const css = read("../../app.css");
  it("every phone variant of a compact row is on the group's container", () => {
    expect(row).not.toMatch(/@max-md:/);
    expect(row).toMatch(/@max-md\/group:/);
  });
  it("the group of entries is that container, and its mask is keyed to it too", () => {
    expect(detail).toMatch(/@container\/group flex flex-col/);
    expect(css).toMatch(/@container group \(max-width: 27\.999rem\)\s*\{\s*\.place-row-cover/);
    expect(css).not.toMatch(/@container \(max-width: 27\.999rem\)\s*\{\s*\.place-row-cover/);
  });
  it("a narrow cell of a wide panel keeps a stacked cover with its own proportions", () => {
    expect(row).toMatch(/place-row-cover relative min-w-0 aspect-\[16\/10\]/);
  });
});
