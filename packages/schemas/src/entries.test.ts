import { describe, expect, it } from "vitest";
import { buildJsonSchema } from "./generate-json-schema";
import {
  EMPTY_PROJECTION,
  MAX_BODY_BLOCKS,
  MAX_BODY_CHARS,
  bodyBlockSchema,
  parsePublishedProjection,
  publishedContentItemSchema,
  publishedImageSchema,
  toContentSummary,
} from "./published";

const place = { slug: "a", name: "A", coordinates: { lat: 1, lon: 2 }, labelPriority: 0, body: [], images: [], related: [] };
const item = (extra: object = {}) => ({ slug: "x", title: "X", placeSlugs: [], ...extra });
const parseItem = (extra: object = {}) => parsePublishedProjection({ ...EMPTY_PROJECTION, poems: [item(extra)] }).poems[0]!;
const block = (b: object) => bodyBlockSchema.safeParse(b);
const okBlock = (b: object) => expect(block(b).success, JSON.stringify(b)).toBe(true);
const badBlock = (b: object) => expect(block(b).success, JSON.stringify(b)).toBe(false);

const RLO = String.fromCharCode(0x202e);
const LRI = String.fromCharCode(0x2066);
const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const CR = String.fromCharCode(13);

const image = { src: "/media/demo/a.svg", alt: "Alt text", width: 10, height: 20 };

describe("poems and the additive entry fields", () => {
  it("poems default to [] (old projections stay valid) and are part of the empty projection", () => {
    const { poems: _omit, ...legacy } = EMPTY_PROJECTION;
    expect(parsePublishedProjection(legacy).poems).toEqual([]);
    expect(EMPTY_PROJECTION.poems).toEqual([]);
  });

  it("an entry without any of the new fields is still valid, and the keys stay absent", () => {
    const parsed = parseItem();
    for (const key of ["cover", "tags", "meta", "body", "summary", "url"]) expect(parsed).not.toHaveProperty(key);
  });

  it("cross-references: poems are a kind of their own", () => {
    const withPlace = (related: object[], poems: object[]) => parsePublishedProjection({ ...EMPTY_PROJECTION, places: [{ ...place, related }], poems });
    expect(withPlace([{ kind: "poem", slug: "x" }], [item({ placeSlugs: ["a"] })]).places[0]!.related).toEqual([{ kind: "poem", slug: "x" }]);
    expect(() => withPlace([{ kind: "poem", slug: "x" }], [])).toThrow(/unknown poem "x"/);
    expect(() => withPlace([], [item({ placeSlugs: ["ghost"] })])).toThrow(/unknown place "ghost"/);
    expect(() => withPlace([], [item(), item()])).toThrow(/duplicate poem slug "x"/);
    // The same slug may exist in two kinds.
    expect(() => parsePublishedProjection({ ...EMPTY_PROJECTION, articles: [item()], poems: [item()] })).not.toThrow();
    // A poem is not an article: related refs are per kind.
    expect(() => parsePublishedProjection({ ...EMPTY_PROJECTION, places: [{ ...place, related: [{ kind: "article", slug: "x" }] }], poems: [item()] })).toThrow(/unknown article/);
  });

  it("every object is strict: unknown keys are rejected on entries, covers, meta and every block", () => {
    expect(() => parseItem({ leaked: 1 })).toThrow();
    expect(() => parseItem({ cover: { ...image, leaked: 1 } })).toThrow();
    expect(() => parseItem({ meta: [{ label: "a", value: "b", leaked: 1 }] })).toThrow();
    for (const b of [
      { type: "paragraph", text: "t" },
      { type: "heading", level: 2, text: "t" },
      { type: "list", ordered: true, items: ["a"] },
      { type: "quote", text: "t" },
      { type: "image", ...image },
      { type: "verse", stanzas: [["a"]] },
      { type: "code", code: "x" },
      { type: "link", title: "t", url: "https://example.org" },
      { type: "divider" },
    ]) {
      okBlock(b);
      badBlock({ ...b, leaked: 1 });
    }
    badBlock({ type: "html", html: "<b>x</b>" });
    badBlock({ type: "paragraph" });
    badBlock({ text: "no type" });
  });

  describe("cover", () => {
    it("needs a /media/ path and alt text; width and height go together", () => {
      expect(parseItem({ cover: image }).cover).toEqual(image);
      expect(parseItem({ cover: { src: image.src, alt: "A" } }).cover).toEqual({ src: image.src, alt: "A" });
      for (const cover of [
        { src: image.src },
        { src: image.src, alt: "  " },
        { src: "https://example.org/a.png", alt: "A" },
        { src: "/other/a.png", alt: "A" },
        { src: "/media/a.png", alt: "A", width: 10 },
        { src: "/media/a.png", alt: "A", height: 10 },
        { src: "/media/a.png", alt: "A", width: 0, height: 10 },
        { src: "/media/a.png", alt: "A", width: 1.5, height: 10 },
        { src: "/media/a.png", alt: "A", caption: "not a cover field" },
      ]) {
        expect(() => parseItem({ cover }), JSON.stringify(cover)).toThrow();
      }
    });
  });

  describe("media paths (covers, image blocks and place images share the rule)", () => {
    const bad = ["/media/", "/media", "/media/../etc/passwd", "/media/a/../b.png", "/media/./a.png", "/media//a.png", "/media/a//b.png", "/media/.hidden", "/media/a/.hidden.png", "/media/a.png/", "/media/a b.png", "/media/a.png?x=1", "/media/a%2e%2e/b", "/media/é.png", "//media/a.png", "media/a.png", "/media/" + "a".repeat(300)];
    const good = ["/media/a.png", "/media/lisbon/a.jpg", "/media/article/my-slug/stem.9f2c1a7e.webp", "/media/_x/a-b_c.d.e.svg"];
    it("accepts plain file names under /media/", () => {
      for (const src of good) {
        expect(publishedImageSchema.safeParse({ src, alt: "A" }).success, src).toBe(true);
        expect(() => parseItem({ cover: { src, alt: "A" } }), src).not.toThrow();
        okBlock({ type: "image", src, alt: "A" });
      }
    });
    it("rejects traversal, empty or hidden segments, other characters and other places", () => {
      for (const src of bad) {
        expect(publishedImageSchema.safeParse({ src, alt: "A" }).success, src).toBe(false);
        expect(() => parseItem({ cover: { src, alt: "A" } }), src).toThrow();
        badBlock({ type: "image", src, alt: "A" });
      }
    });
  });

  describe("tags", () => {
    it("accepts up to 12 unique lowercase kebab-case tags", () => {
      expect(parseItem({ tags: ["open-source", "a1", "x"] }).tags).toEqual(["open-source", "a1", "x"]);
      expect(parseItem({ tags: [] }).tags).toEqual([]);
      expect(() => parseItem({ tags: Array.from({ length: 12 }, (_, i) => `t${i}`) })).not.toThrow();
    });
    it("rejects more, duplicates, other spellings and over-long tags", () => {
      for (const tags of [Array.from({ length: 13 }, (_, i) => `t${i}`), ["a", "a"], ["Open"], ["open source"], ["-a"], ["a-"], ["a--b"], [""], ["a".repeat(41)], "a", [1]]) {
        expect(() => parseItem({ tags }), JSON.stringify(tags)).toThrow();
      }
    });
  });

  describe("meta", () => {
    it("accepts up to 10 label/value pairs of plain text", () => {
      const meta = [{ label: "Stack", value: "TypeScript, WebGL" }, { label: "Year", value: "2023" }];
      expect(parseItem({ meta }).meta).toEqual(meta);
      expect(() => parseItem({ meta: Array.from({ length: 10 }, (_, i) => ({ label: `L${i}`, value: "v" })) })).not.toThrow();
    });
    it("rejects more, empty or long values, control characters and duplicate labels (any case)", () => {
      const one = (label: string, value: string) => [{ label, value }];
      for (const meta of [
        Array.from({ length: 11 }, (_, i) => ({ label: `L${i}`, value: "v" })),
        one("", "v"),
        one("l", ""),
        one("l", " "),
        one("l".repeat(41), "v"),
        one("l", "v".repeat(201)),
        one("l", "two\nlines"),
        one("l", `bell${BEL}`),
        one("l", `${RLO}reversed`),
        [{ label: "Year", value: "1" }, { label: "year", value: "2" }],
        [{ label: "l" }],
        [["l", "v"]],
      ]) {
        expect(() => parseItem({ meta }), JSON.stringify(meta)).toThrow();
      }
    });
  });

  describe("body blocks", () => {
    it("paragraph: plain text, up to 5000 characters, a line feed is a hard break", () => {
      okBlock({ type: "paragraph", text: "one\ntwo" });
      okBlock({ type: "paragraph", text: "<b>not html</b> *not markdown*: shown verbatim" });
      okBlock({ type: "paragraph", text: "t".repeat(5000) });
      badBlock({ type: "paragraph", text: "t".repeat(5001) });
      badBlock({ type: "paragraph", text: "" });
      badBlock({ type: "paragraph", text: "   " });
      badBlock({ type: "paragraph", text: `a${NUL}b` });
      badBlock({ type: "paragraph", text: `a${BEL}b` });
      badBlock({ type: "paragraph", text: `a${CR}b` });
      badBlock({ type: "paragraph", text: `a${RLO}b` });
      badBlock({ type: "paragraph", text: `a${LRI}b` });
    });
    it("heading: level 2 or 3, one line", () => {
      okBlock({ type: "heading", level: 2, text: "H" });
      okBlock({ type: "heading", level: 3, text: "H" });
      for (const level of [1, 4, 0, "2", 2.5, null]) badBlock({ type: "heading", level, text: "H" });
      badBlock({ type: "heading", level: 2, text: "two\nlines" });
      badBlock({ type: "heading", level: 2, text: "h".repeat(161) });
      badBlock({ type: "heading", level: 2 });
    });
    it("list: an ordered flag and 1 to 50 non-empty items", () => {
      okBlock({ type: "list", ordered: false, items: ["a"] });
      okBlock({ type: "list", ordered: true, items: Array.from({ length: 50 }, () => "a") });
      badBlock({ type: "list", ordered: true, items: [] });
      badBlock({ type: "list", ordered: true, items: Array.from({ length: 51 }, () => "a") });
      badBlock({ type: "list", ordered: true, items: [""] });
      badBlock({ type: "list", ordered: true, items: [["nested"]] });
      badBlock({ type: "list", items: ["a"] });
      badBlock({ type: "list", ordered: "yes", items: ["a"] });
      badBlock({ type: "list", ordered: false, items: ["a".repeat(1001)] });
    });
    it("quote: text and an optional one-line cite", () => {
      okBlock({ type: "quote", text: "q", cite: "Someone" });
      badBlock({ type: "quote", text: "" });
      badBlock({ type: "quote", text: "q", cite: "" });
      badBlock({ type: "quote", text: "q", cite: "two\nlines" });
      badBlock({ type: "quote", text: "q".repeat(2001) });
    });
    it("image: a /media/ path, alt required, optional caption, width and height together", () => {
      okBlock({ type: "image", src: "/media/a.png", alt: "A", caption: "C" });
      badBlock({ type: "image", src: "/media/a.png" });
      badBlock({ type: "image", src: "/media/a.png", alt: "" });
      badBlock({ type: "image", alt: "A" });
      badBlock({ type: "image", src: "https://example.org/a.png", alt: "A" });
      badBlock({ type: "image", src: "/media/a.png", alt: "A", width: 5 });
      badBlock({ type: "image", src: "/media/a.png", alt: "A", caption: "" });
    });
    it("verse: stanzas of lines, line breaks and indentation preserved", () => {
      const parsed = bodyBlockSchema.parse({ type: "verse", stanzas: [["a", "    indented"], ["b"]] });
      expect(parsed).toEqual({ type: "verse", stanzas: [["a", "    indented"], ["b"]] });
      badBlock({ type: "verse", stanzas: [] });
      badBlock({ type: "verse", stanzas: [[]] });
      badBlock({ type: "verse", stanzas: [[""]] });
      badBlock({ type: "verse", stanzas: [["   "]] });
      badBlock({ type: "verse", stanzas: [["two\nlines"]] });
      badBlock({ type: "verse", stanzas: [["tab\tinside"]] });
      badBlock({ type: "verse", stanzas: [[`a${RLO}`]] });
      badBlock({ type: "verse", stanzas: [["a".repeat(301)]] });
      badBlock({ type: "verse", stanzas: [Array.from({ length: 61 }, () => "a")] });
      badBlock({ type: "verse", stanzas: Array.from({ length: 61 }, () => ["a"]) });
      badBlock({ type: "verse", stanzas: ["a line is not a stanza"] });
      badBlock({ type: "verse", lines: ["a"] });
    });
    it("code: verbatim, indentation and tabs kept, up to 10000 characters, optional lowercase language", () => {
      const code = "  indented\n\tand tabbed\n";
      expect(bodyBlockSchema.parse({ type: "code", language: "ts", code })).toEqual({ type: "code", language: "ts", code });
      okBlock({ type: "code", code: "x" });
      for (const language of ["c++", "c#", "objective-c", "x86"]) okBlock({ type: "code", language, code: "x" });
      for (const language of ["", "TS", "type script", "a".repeat(21), "<script>"]) badBlock({ type: "code", language, code: "x" });
      badBlock({ type: "code", code: "" });
      okBlock({ type: "code", code: "c".repeat(10000) });
      badBlock({ type: "code", code: "c".repeat(10001) });
      badBlock({ type: "code", code: `a${NUL}b` });
      badBlock({ type: "code", code: `a${CR}b` });
      badBlock({ type: "code", code: `a${RLO}b` });
    });
    it("link: https only, no credentials, whitespace or script schemes", () => {
      okBlock({ type: "link", title: "T", url: "https://example.org/a?b=c#d", description: "D" });
      for (const url of [
        "http://example.org",
        "javascript:alert(1)",
        "data:text/html,<b>x</b>",
        "mailto:a@example.org",
        "ftp://example.org",
        "//example.org",
        "/relative",
        "example.org",
        "https://user:pass@example.org/",
        "https://user@example.org/",
        "https://exa mple.org/",
        "https://example.org/a b",
        "https://example.org/\n",
        `https://example.org/${RLO}`,
        "https://",
        "HTTPS://example.org",
        `https://example.org/${"a".repeat(2000)}`,
        "",
      ]) {
        badBlock({ type: "link", title: "T", url });
      }
      badBlock({ type: "link", url: "https://example.org" });
      badBlock({ type: "link", title: "T" });
      badBlock({ type: "link", title: "", url: "https://example.org" });
      badBlock({ type: "link", title: "T", url: "https://example.org", description: "" });
    });
    it("divider carries no data", () => {
      okBlock({ type: "divider" });
    });
  });

  describe("entry url", () => {
    it("stays https only, and now also refuses credentials and whitespace", () => {
      expect(parseItem({ url: "https://example.org/x" }).url).toBe("https://example.org/x");
      for (const url of ["http://example.org", "javascript:alert(1)", "https://u:p@example.org", "https://example.org/a b", "/relative"]) {
        expect(() => parseItem({ url }), url).toThrow();
      }
    });
  });

  describe("body size", () => {
    const paragraphs = (n: number, len = 10) => Array.from({ length: n }, () => ({ type: "paragraph", text: "p".repeat(len) }));
    it("allows up to 200 blocks and refuses the 201st", () => {
      expect(MAX_BODY_BLOCKS).toBe(200);
      expect(parseItem({ body: paragraphs(200) }).body).toHaveLength(200);
      expect(() => parseItem({ body: paragraphs(201) })).toThrow();
      expect(parseItem({ body: [] }).body).toEqual([]);
    });
    it("limits the text of a whole body to 60000 characters, whatever the block types", () => {
      expect(MAX_BODY_CHARS).toBe(60000);
      expect(() => parseItem({ body: paragraphs(12, 5000) })).not.toThrow();
      expect(() => parseItem({ body: paragraphs(12, 5000).concat(paragraphs(1, 1)) })).toThrow(/60000 characters/);
      const code = { type: "code", code: "c".repeat(10000) };
      expect(() => parseItem({ body: [code, code, code, code, code, code] })).not.toThrow();
      expect(() => parseItem({ body: [code, code, code, code, code, code, { type: "paragraph", text: "p" }] })).toThrow(/60000 characters/);
      const verse = { type: "verse", stanzas: [Array.from({ length: 60 }, () => "v".repeat(300))] };
      expect(() => parseItem({ body: [verse, verse, verse, verse] })).toThrow(/60000 characters/);
    });
  });

  describe("summaries", () => {
    it("toContentSummary drops the body and nothing else", () => {
      const full = publishedContentItemSchema.parse(
        item({ summary: "S", date: "2024", url: "https://example.org", cover: image, tags: ["t"], meta: [{ label: "l", value: "v" }], body: [{ type: "divider" }], placeSlugs: ["a"] }),
      );
      const summary = toContentSummary(full);
      expect(summary).not.toHaveProperty("body");
      expect(JSON.parse(JSON.stringify(summary))).toEqual({ ...JSON.parse(JSON.stringify(full)), body: undefined });
      expect(JSON.stringify(toContentSummary(publishedContentItemSchema.parse(item())))).toBe('{"slug":"x","title":"X","placeSlugs":[]}');
    });
  });

  it("the committed JSON Schema describes poems, the optional fields and the blocks", () => {
    type Obj = { properties: Record<string, unknown>; required: string[] };
    const schema = JSON.parse(buildJsonSchema()) as { required: string[]; properties: Record<string, { items: { $ref: string } }>; $defs: Record<string, Obj> };
    expect(schema.required).not.toContain("poems");
    expect(schema.required).not.toContain("groups");
    // The four collections share one definition of an entry.
    for (const key of ["projects", "articles", "artworks", "poems"]) expect(schema.properties[key]!.items.$ref).toBe("#/$defs/PublishedContentItem");
    const entry = schema.$defs.PublishedContentItem!;
    expect(Object.keys(entry.properties)).toEqual(["slug", "title", "summary", "date", "url", "cover", "tags", "meta", "body", "placeSlugs"]);
    expect(entry.required).toEqual(["slug", "title", "placeSlugs"]);
    expect(JSON.stringify(schema)).toContain('"const":"verse"');
  });
});
