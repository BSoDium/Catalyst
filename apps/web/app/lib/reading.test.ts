import { describe, expect, it } from "vitest";
import type { PublishedBodyBlock } from "@catalyst/schemas";
import { activeSection, bodyWordCount, countWords, formatReadingTime, oneLine, readingMinutes, tocItems, WORDS_PER_MINUTE } from "./reading";

const p = (text: string): PublishedBodyBlock => ({ type: "paragraph", text });
const h = (text: string, level: 2 | 3 = 2): PublishedBodyBlock => ({ type: "heading", level, text });
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("countWords", () => {
  it("counts words, not spaces or punctuation", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  ,, -- ")).toBe(0);
    expect(countWords("One, two; three.")).toBe(3);
    expect(countWords("It's a well-known thing")).toBe(4);
    expect(countWords("Ljubljana — Zagreb: 21:40")).toBe(4);
    expect(countWords("Hué, São Paulo, Ōsaka")).toBe(4);
  });
});

describe("readingMinutes", () => {
  it("is zero without text and at least one minute with any", () => {
    expect(readingMinutes([])).toBe(0);
    expect(readingMinutes([{ type: "divider" }])).toBe(0);
    expect(readingMinutes([p("Short.")])).toBe(1);
  });
  it("rounds words / WORDS_PER_MINUTE", () => {
    expect(readingMinutes([p(words(WORDS_PER_MINUTE * 6))])).toBe(6);
    expect(readingMinutes([p(words(WORDS_PER_MINUTE * 3 + 40))])).toBe(3);
    expect(readingMinutes([p(words(WORDS_PER_MINUTE * 3 + 120))])).toBe(4);
    expect(readingMinutes([p(words(100))], 100)).toBe(1);
  });
  it("counts paragraphs, headings, lists and quotes, not code, verse, images or links", () => {
    const blocks: PublishedBodyBlock[] = [
      h("Two words"),
      p("a b c"),
      { type: "list", ordered: false, items: ["d e", "f"] },
      { type: "quote", text: "g h", cite: "i j k" },
      { type: "code", code: "let a = 1; let b = 2; let c = 3;" },
      { type: "verse", stanzas: [["one two three four five"]] },
      { type: "image", src: "/media/a.png", alt: "an image of many words" },
      { type: "link", url: "https://example.org", title: "A link title" },
    ];
    expect(bodyWordCount(blocks)).toBe(2 + 3 + 3 + 2 + 3);
  });
});

describe("formatReadingTime", () => {
  it("formats whole minutes", () => {
    expect(formatReadingTime(6)).toBe("6 min read");
    expect(formatReadingTime(1)).toBe("1 min read");
    expect(formatReadingTime(0)).toBeNull();
    expect(formatReadingTime(Number.NaN)).toBeNull();
  });
});

describe("tocItems", () => {
  it("lists the numbered headings when there are enough of them", () => {
    const blocks = [h("One"), p("x"), h("Sub", 3), h("Two"), h("Three")];
    expect(tocItems(blocks).map((i) => [i.number, i.text, i.level])).toEqual([
      ["1", "One", 2],
      ["1.1", "Sub", 3],
      ["2", "Two", 2],
      ["3", "Three", 2],
    ]);
    expect(tocItems(blocks)[0]!.id).toBe("body-one");
  });
  it("gives nothing for a short text", () => {
    expect(tocItems([h("One"), h("Two"), p("x")])).toEqual([]);
    expect(tocItems([p("x")])).toEqual([]);
    expect(tocItems([h("One"), h("Two")], "body", 2)).toHaveLength(2);
  });
  it("keeps ids unique for repeated headings", () => {
    const ids = tocItems([h("Notes"), h("Notes"), h("Notes")]).map((i) => i.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("activeSection", () => {
  const tops = [
    { id: "a", top: 300 },
    { id: "b", top: 900 },
    { id: "c", top: 1500 },
  ];
  it("is the first section before any heading reaches the line", () => {
    expect(activeSection(tops, 96)).toBe("a");
  });
  it("is the last heading above the reading line", () => {
    expect(activeSection([{ id: "a", top: -400 }, { id: "b", top: 50 }, { id: "c", top: 700 }], 96)).toBe("b");
    expect(activeSection([{ id: "a", top: -1400 }, { id: "b", top: -600 }, { id: "c", top: -20 }], 96)).toBe("c");
  });
  it("is null without headings", () => {
    expect(activeSection([], 96)).toBeNull();
  });
});

describe("oneLine", () => {
  it("flattens hard breaks and runs of spaces", () => {
    expect(oneLine("a\nb\r\n  c   d ")).toBe("a b c d");
  });
});
