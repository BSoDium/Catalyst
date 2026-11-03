import { describe, expect, it } from "vitest";
import { hasIcon } from "./mode-icons";
import { MODE_ICON_NODES } from "./mode-icon-paths";
import { LEG_MODES } from "./modes";
import { legCells } from "./trail-dots";

const view = { cols: 500, rows: 500 };
const line = (n: number): Array<Array<readonly [number, number]>> => [[[10, 10], [10 + n, 10]]];

describe("legCells: the patterns written cell by cell", () => {
  it("a road has no cells here (MapLibre draws it)", () => {
    expect(legCells(line(100), "road", view)).toEqual([]);
  });
  it("a flight is a dot every `period` cells along the path, exactly one cell each", () => {
    const cells = legCells(line(100), "flight", view);
    expect(cells.map((c) => c.col)).toEqual(Array.from({ length: 21 }, (_, i) => 10 + i * 5).filter((c) => c <= 110));
    expect(new Set(cells.map((c) => c.row))).toEqual(new Set([10]));
  });
  it("a rail is solid, like a road: the line is the map's, no cells", () => {
    expect(legCells(line(60), "rail", view)).toEqual([]);
  });
  it("gives the band of the position along the leg: the tail is band 0, the head the last", () => {
    const cells = legCells(line(100), "flight", view);
    expect(cells[0]!.band).toBe(0);
    expect(cells[cells.length - 1]!.band).toBe(4);
  });
  it("skips what is off screen without moving the pattern", () => {
    const all = legCells(line(400), "flight", { cols: 600, rows: 600 });
    const some = legCells([[[10, 10], [410, 10]]], "flight", { cols: 100, rows: 100 }, 0);
    expect(some.every((c) => c.col <= 100)).toBe(true);
    expect(some.map((c) => c.col)).toEqual(all.filter((c) => c.col <= 100).map((c) => c.col));
  });
});

describe("the pictures of the modes", () => {
  it("are the vector icons of Lucide: every mode but unknown has one, with something to draw", () => {
    for (const mode of LEG_MODES) {
      if (mode === "unknown") {
        expect(hasIcon(mode)).toBe(false);
        continue;
      }
      expect(hasIcon(mode), mode).toBe(true);
      const icon = MODE_ICON_NODES[mode]!;
      expect(icon.node.length, mode).toBeGreaterThan(0);
      for (const [tag, attrs] of icon.node) expect(tag === "path" ? attrs.d : tag === "circle" ? attrs.r : "x", mode).toBeTruthy();
    }
  });
  it("are different from each other", () => {
    const seen = new Set(LEG_MODES.filter((m) => hasIcon(m)).map((m) => MODE_ICON_NODES[m]!.name));
    expect(seen.size).toBe(LEG_MODES.length - 1);
  });
});
