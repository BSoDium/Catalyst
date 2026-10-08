import { describe, expect, it } from "vitest";
import type { PublishedBodyBlock } from "@catalyst/schemas";
import {
  buildOutline,
  dedupeKeys,
  displayHost,
  groupBlocks,
  leadingIndent,
  MAX_VERSE_INDENT,
  safeExternalUrl,
  safeMediaSrc,
  slugifyHeading,
  splitLines,
  verseIndent,
} from "./entry-blocks";

const p = (text: string): PublishedBodyBlock => ({ type: "paragraph", text });
const h = (level: 2 | 3, text: string): PublishedBodyBlock => ({ type: "heading", level, text });
const link = (title: string): PublishedBodyBlock => ({ type: "link", title, url: "https://example.org/x" });
const hr: PublishedBodyBlock = { type: "divider" };

describe("text helpers", () => {
  it("splits hard line breaks, whatever the line ending, and keeps empty text as one line", () => {
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(splitLines("a\r\nb\rc")).toEqual(["a", "b", "c"]);
    expect(splitLines("one")).toEqual(["one"]);
  });
  it("reads the indentation of a verse line and leaves the rest alone", () => {
    expect(leadingIndent("    an indented line")).toEqual({ indent: 4, text: "an indented line" });
    expect(leadingIndent("flush")).toEqual({ indent: 0, text: "flush" });
    expect(leadingIndent("  x y ")).toEqual({ indent: 2, text: "x y " });
  });
  it("caps the indentation so a line cannot leave the column", () => {
    expect(verseIndent(4)).toBe(4);
    expect(verseIndent(290)).toBe(MAX_VERSE_INDENT);
    expect(verseIndent(-3)).toBe(0);
  });
  it("makes anchor slugs: folded accents, ASCII only, never empty", () => {
    expect(slugifyHeading("A second-level heading")).toBe("a-second-level-heading");
    expect(slugifyHeading("Éloge de l’été")).toBe("eloge-de-l-ete");
    expect(slugifyHeading("  ***  ")).toBe("section");
    expect(slugifyHeading("日本語")).toBe("section");
    expect(slugifyHeading("x".repeat(100)).length).toBeLessThanOrEqual(48);
  });
});

describe("dedupeKeys", () => {
  it("keeps the first, numbers the repeats, and is stable", () => {
    expect(dedupeKeys(["a", "b", "a", "a"])).toEqual(["a", "b", "a-2", "a-3"]);
    expect(dedupeKeys(["a", "b", "a", "a"])).toEqual(dedupeKeys(["a", "b", "a", "a"]));
  });
  it("never produces a key that a literal one already uses", () => {
    const keys = dedupeKeys(["a", "a", "a-2", "a"]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe("a");
    expect(keys[1]).toBe("a-2");
  });
  it("is empty for nothing", () => {
    expect(dedupeKeys([])).toEqual([]);
  });
});

describe("buildOutline", () => {
  it("numbers level 2 headings 1, 2 and level 3 headings 1.1, 1.2 under them", () => {
    const outline = buildOutline([p("x"), h(2, "One"), h(3, "One a"), h(3, "One b"), p("y"), h(2, "Two"), h(3, "Two a")]);
    expect(outline.map((o) => [o.level, o.number, o.text])).toEqual([
      [2, "1", "One"],
      [3, "1.1", "One a"],
      [3, "1.2", "One b"],
      [2, "2", "Two"],
      [3, "2.1", "Two a"],
    ]);
    expect(outline.map((o) => o.index)).toEqual([1, 2, 3, 5, 6]);
  });
  it("draws a level 3 before any level 2 as a level 2: the outline never skips a level under the title", () => {
    const outline = buildOutline([h(3, "Early"), h(3, "Early too"), h(2, "Then"), h(3, "Under")]);
    // the first becomes the opening level 2, the next level 3 then nests under it
    expect(outline.map((o) => [o.level, o.number])).toEqual([
      [2, "1"],
      [3, "1.1"],
      [2, "2"],
      [3, "2.1"],
    ]);
  });
  it("gives each heading a unique, prefixed id even when titles repeat", () => {
    const outline = buildOutline([h(2, "Notes"), h(2, "Notes"), h(2, "Other")], "body");
    expect(outline.map((o) => o.id)).toEqual(["body-notes", "body-notes-2", "body-other"]);
  });
  it("is empty without headings", () => {
    expect(buildOutline([p("x")])).toEqual([]);
  });
});

describe("groupBlocks", () => {
  it("groups consecutive link cards into one list and keeps everything else single", () => {
    const groups = groupBlocks([p("a"), link("1"), link("2"), p("b"), link("3")]);
    expect(groups.map((g) => [g.type, g.key])).toEqual([
      ["block", "paragraph-0"],
      ["links", "links-1"],
      ["block", "paragraph-3"],
      ["links", "links-4"],
    ]);
    expect(groups[1]).toMatchObject({ blocks: [{ title: "1" }, { title: "2" }] });
  });
  it("drops a divider that opens the body, closes it or repeats the previous one", () => {
    expect(groupBlocks([hr, p("a"), hr, hr, p("b"), hr]).map((g) => g.key)).toEqual(["paragraph-1", "divider-2", "paragraph-4"]);
    expect(groupBlocks([hr, hr])).toEqual([]);
    expect(groupBlocks([p("a"), hr, link("x")]).map((g) => g.type)).toEqual(["block", "block", "links"]);
  });
  it("gives unique, deterministic keys", () => {
    const blocks = [p("same"), p("same"), hr, p("same"), link("a"), link("a")];
    const keys = groupBlocks(blocks).map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(groupBlocks(blocks).map((g) => g.key)).toEqual(keys);
  });
  it("is empty for an empty body", () => {
    expect(groupBlocks([])).toEqual([]);
  });
});

describe("safeMediaSrc", () => {
  it("accepts /media/ paths of plain file names", () => {
    expect(safeMediaSrc("/media/demo/cover.svg")).toBe("/media/demo/cover.svg");
    expect(safeMediaSrc("/media/a-b_c/1.2.png")).toBe("/media/a-b_c/1.2.png");
  });
  it("refuses everything that could leave /media/ or change scheme", () => {
    for (const bad of ["/media/../x.png", "/media/./x.png", "//evil.test/media/x.png", "https://evil.test/media/x.png", "javascript:alert(1)", "data:image/svg+xml,<svg/>", "/media/.hidden.png", "/media//x.png", "/media/x.png?a=1", "/media/x\\y.png", "media/x.png", "/other/x.png", "/media/", "/media/x\n.png"]) {
      expect(safeMediaSrc(bad), bad).toBeNull();
    }
  });
});

describe("safeExternalUrl", () => {
  it("accepts https and returns the normalised URL", () => {
    expect(safeExternalUrl("https://example.org/a?b=1#c")).toBe("https://example.org/a?b=1#c");
    expect(safeExternalUrl("https://Example.org")).toBe("https://example.org/");
  });
  it("refuses other schemes, credentials, whitespace and control characters", () => {
    for (const bad of ["http://example.org", "javascript:alert(1)", "data:text/html,x", "mailto:a@b.c", "//example.org", "/relative", "https://user:pw@example.org", "https://user@example.org", "https://exa mple.org", "https://example.org/\u0000", "https://example.org/‮", "", "https://"]) {
      expect(safeExternalUrl(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(safeExternalUrl(`https://example.org/${"a".repeat(2000)}`)).toBeNull();
  });
  it("shows the host without www", () => {
    expect(displayHost("https://www.example.org/a/b")).toBe("example.org");
    expect(displayHost("not a url")).toBe("not a url");
  });
});
