import { describe, expect, it } from "vitest";
import { buildJsonSchema } from "./generate-json-schema";
import { CAREER_LIMITS, CAREER_TEXT, EMPTY_PROJECTION, contactTextProblem, contactUrlProblem, parsePublishedProjection, publishedCareerSchema, type PublishedCareer } from "./published";

const place = { slug: "paris", name: "Paris", coordinates: { lat: 48.85, lon: 2.35 }, labelPriority: 50, body: [], images: [], related: [] };

const role = (extra: object = {}) => ({
  id: "studio-lead",
  title: "Lead engineer",
  org: "Example Studio",
  location: "Paris, France",
  start: "2024-03",
  highlights: ["Built the thing."],
  skills: ["React", "TypeScript"],
  ...extra,
});

const career = (extra: object = {}) => ({
  title: "Career",
  summary: "A profile statement of one paragraph.",
  updated: "2026-10",
  roles: [role()],
  education: [],
  languages: [],
  skills: [],
  links: [],
  ...extra,
});

const parse = (c: unknown, places: object[] = [place]) => parsePublishedProjection({ ...EMPTY_PROJECTION, places, career: c });
const ok = (c: unknown, places?: object[]) => expect(() => parse(c, places), JSON.stringify(c).slice(0, 160)).not.toThrow();
const bad = (c: unknown, re?: RegExp, places?: object[]) =>
  re ? expect(() => parse(c, places), JSON.stringify(c).slice(0, 160)).toThrow(re) : expect(() => parse(c, places), JSON.stringify(c).slice(0, 160)).toThrow();

describe("career (an optional singleton document, additive in schema version 1)", () => {
  it("old projections without it stay valid, and the key stays absent", () => {
    const legacy = { schemaVersion: 1, places: [], routes: [], projects: [], articles: [], artworks: [] };
    const parsed = parsePublishedProjection(legacy);
    expect(parsed).not.toHaveProperty("career");
    expect(parsePublishedProjection(EMPTY_PROJECTION)).not.toHaveProperty("career");
    expect(EMPTY_PROJECTION).not.toHaveProperty("career");
  });

  it("accepts a complete career and keeps it as given", () => {
    const full = career({
      roles: [
        role({ id: "now", start: "2026", orgUrl: "https://example.org", place: "paris", employment: "Permanent" }),
        role({ id: "before", start: "2022-06", end: "2023-09" }),
      ],
      education: [{ id: "school", institution: "Example University", programme: "Computer Science", level: "MSc", start: "2020", end: "2023", location: "Toulouse, France", place: "paris", note: "Exchange year." }],
      languages: [{ name: "French", level: "C2", label: "Native" }, { name: "English", level: "C1" }],
      skills: [{ group: "Primary", items: ["React", "TypeScript"] }],
      links: [{ label: "GitHub", url: "https://github.com/example" }],
    });
    expect(parse(full).career).toEqual(full);
  });

  it("an optional career in the empty projection validates as a bare minimum", () => {
    ok(career());
  });

  it("every object is strict: no email, phone or address can be served", () => {
    for (const leaked of [{ email: "a@b.c" }, { phone: "+33 1" }, { address: "1 rue X" }, { location: "x" }, { openToWork: true }]) {
      bad(career(leaked));
    }
    bad(career({ roles: [role({ email: "a@b.c" })] }));
    bad(career({ roles: [role({ phone: "0102030405" })] }));
    bad(career({ education: [{ id: "e", institution: "I", programme: "P", start: "2020", end: "2021", address: "x" }] }));
    bad(career({ languages: [{ name: "French", level: "C2", certificate: "x" }] }));
    bad(career({ skills: [{ group: "G", items: ["a"], note: "x" }] }));
    bad(career({ links: [{ label: "L", url: "https://example.org", email: "x" }] }));
  });

  it("the schema has no field named after an email, a phone number or an address (guard on the generated JSON Schema)", () => {
    const names: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "properties" && v && typeof v === "object") names.push(...Object.keys(v));
          walk(v);
        }
      }
    };
    walk(JSON.parse(buildJsonSchema()).properties.career);
    expect(names.length).toBeGreaterThan(20);
    expect(names.filter((n) => /mail|phone|^tel|mobile|contact|fax|whatsapp|skype|street|address|residen|^home|zip|postcode|postal|^dob$|birth|^age$|gender|^ssn$|passport|nationality|photo|salary/i.test(n))).toEqual([]);
  });

  describe("availability (a dated, optional statement)", () => {
    const avail = (extra: object = {}) => ({ text: "Open to opportunities", asOf: "2026-10", ...extra });

    it("is optional: a career without it is valid and the key stays absent", () => {
      expect(parse(career()).career).not.toHaveProperty("availability");
    });
    it("accepts exactly { text, asOf }, kept as given", () => {
      expect(parse(career({ availability: avail() })).career!.availability).toEqual({ text: "Open to opportunities", asOf: "2026-10" });
      ok(career({ availability: avail({ text: "x".repeat(120) }) }));
    });
    it("needs both fields, a month, plain text of 1 to 120 characters and nothing else", () => {
      bad(career({ availability: { text: "Open" } }));
      bad(career({ availability: { asOf: "2026-10" } }));
      bad(career({ availability: avail({ text: "" }) }));
      bad(career({ availability: avail({ text: "   " }) }));
      bad(career({ availability: avail({ text: "x".repeat(121) }) }));
      bad(career({ availability: avail({ text: "line\nbreak" }) }));
      for (const asOf of ["2026", "2026-10-01", "2026-13", "soon", ""]) bad(career({ availability: avail({ asOf }) }));
      for (const extra of [{ email: "a@b.c" }, { phone: "+33 1" }, { until: "2027-01" }, { open: true }]) bad(career({ availability: avail(extra) }));
      bad(career({ availability: "Open to opportunities" }));
    });
    it("is described by the generated JSON Schema as an optional strict object with these two properties only", () => {
      const a = JSON.parse(buildJsonSchema()).properties.career.properties.availability;
      expect(Object.keys(a.properties).sort()).toEqual(["asOf", "text"]);
      expect(a.required.sort()).toEqual(["asOf", "text"]);
      expect(a.additionalProperties).toBe(false);
      expect(a.properties.text.maxLength).toBe(120);
    });
  });

  describe("logo and the portrait's dark variant (optional pictures, additive in schema version 1)", () => {
    const image = (extra: object = {}) => ({ src: "/media/career/logo.1a2b3c4d.webp", width: 200, height: 200, ...extra });
    const portrait = (extra: object = {}) => ({ src: "/media/career/portrait.1a2b3c4d.webp", alt: "A smiling person in a grey jumper", width: 800, height: 800, ...extra });

    it("a role and an education may carry a logo; without one the key stays absent", () => {
      expect(parse(career()).career!.roles[0]).not.toHaveProperty("logo");
      const withLogo = career({
        roles: [role({ logo: image() })],
        education: [{ id: "school", institution: "Example University", programme: "Computer Science", start: "2020", end: "2023", logo: image({ src: "/media/career/school.99887766.webp" }) }],
      });
      expect(parse(withLogo).career).toEqual(withLogo);
    });

    it("a logo is a /media/ file with its pixel size, and nothing else (no alt, no URL of another host)", () => {
      for (const src of ["https://example.org/l.webp", "/media/../x.webp", "/img/l.webp", ""]) bad(career({ roles: [role({ logo: image({ src }) })] }));
      const { width: _w, ...noWidth } = image();
      bad(career({ roles: [role({ logo: noWidth })] }));
      bad(career({ roles: [role({ logo: image({ width: 0 }) })] }));
      bad(career({ roles: [role({ logo: image({ alt: "x" }) })] }));
    });

    it("the portrait may carry a dark variant, with the same rules", () => {
      expect(parse(career({ portrait: portrait({ dark: image({ src: "/media/career/portrait-dark.55443322.webp", width: 800, height: 800 }) }) })).career!.portrait!.dark).toEqual(image({ src: "/media/career/portrait-dark.55443322.webp", width: 800, height: 800 }));
      bad(career({ portrait: portrait({ dark: image({ src: "https://example.org/d.webp" }) }) }));
      bad(career({ portrait: portrait({ dark: { src: "/media/career/d.webp" } }) }));
    });
  });

  describe("portrait (an optional picture, additive in schema version 1)", () => {
    const portrait = (extra: object = {}) => ({ src: "/media/career/portrait.1a2b3c4d.webp", alt: "A smiling person in a grey jumper, outdoors", width: 800, height: 1000, ...extra });

    it("is optional: a career without it is valid and the key stays absent", () => {
      expect(parse(career()).career).not.toHaveProperty("portrait");
    });
    it("accepts exactly { src, alt, width, height }, kept as given", () => {
      expect(parse(career({ portrait: portrait() })).career!.portrait).toEqual(portrait());
    });
    it("needs a /media/ path, alt text and both dimensions", () => {
      for (const src of ["https://example.org/p.webp", "/media/../x.webp", "/media//x.webp", "/img/p.webp", "media/p.webp", ""]) bad(career({ portrait: portrait({ src }) }));
      for (const alt of ["", "   ", "x".repeat(CAREER_TEXT.portraitAlt + 1), "two\nlines"]) bad(career({ portrait: portrait({ alt }) }));
      ok(career({ portrait: portrait({ alt: "x".repeat(CAREER_TEXT.portraitAlt) }) }));
      const { width: _w, ...noWidth } = portrait();
      const { height: _h, ...noHeight } = portrait();
      bad(career({ portrait: noWidth }));
      bad(career({ portrait: noHeight }));
      const { alt: _a, ...noAlt } = portrait();
      bad(career({ portrait: noAlt }));
      for (const width of [0, -1, 1.5, "800"]) bad(career({ portrait: portrait({ width }) }));
    });
    it("is strict, and its alt text is not a place for a contact detail", () => {
      for (const extra of [{ caption: "x" }, { email: "a@b.c" }, { credit: "x" }, { exif: {} }]) bad(career({ portrait: portrait(extra) }));
      bad(career({ portrait: portrait({ alt: "Write to me at someone@example.org" }) }), /e-mail/);
      bad(career({ portrait: "/media/career/portrait.webp" }));
    });
    it("is described by the generated JSON Schema as an optional strict object with these properties (alt, height, src, width, and an optional dark variant)", () => {
      const p = JSON.parse(buildJsonSchema()).properties.career.properties.portrait;
      expect(Object.keys(p.properties).sort()).toEqual(["alt", "dark", "height", "src", "width"]);
      expect(p.required.sort()).toEqual(["alt", "height", "src", "width"]);
      expect(p.additionalProperties).toBe(false);
      expect(JSON.parse(buildJsonSchema()).properties.career.required).not.toContain("portrait");
    });
  });

  describe("dates", () => {
    it("accept YYYY and YYYY-MM for a start, and `present` or nothing for an end", () => {
      for (const start of ["2026", "2025-02", "1999-12"]) ok(career({ roles: [role({ start })] }));
      for (const end of [undefined, "present", "2026", "2026-12"]) ok(career({ roles: [role({ start: "2026", ...(end ? { end } : {}) })] }));
    });
    it("refuse a day, an impossible month, a year out of range, `present` as a start and free text", () => {
      for (const start of ["2026-01-05", "2026-13", "2026-00", "1899", "2100", "26", "present", "Spring 2026", " 2026", ""]) bad(career({ roles: [role({ start })] }));
      for (const end of ["tomorrow", "2026-1", "ongoing", "now"]) bad(career({ roles: [role({ end })] }));
      bad(career({ updated: "2026" }));
      bad(career({ updated: "2026-10-01" }));
    });
    it("an end is never before its start (a year alone is the whole year)", () => {
      bad(career({ roles: [role({ start: "2025-06", end: "2025-05" })] }), /end must not be before start/);
      bad(career({ roles: [role({ start: "2025", end: "2024-12" })] }));
      ok(career({ roles: [role({ start: "2025-06", end: "2025-06" })] }));
      ok(career({ roles: [role({ start: "2025-06", end: "2025" })] }));
      ok(career({ roles: [role({ start: "2025", end: "2025-01" })] }));
      bad(career({ education: [{ id: "e", institution: "I", programme: "P", start: "2023", end: "2020" }] }), /end must not be before start/);
    });
  });

  describe("order and identity", () => {
    it("roles are most recent first, by start", () => {
      ok(career({ roles: [role({ id: "a", start: "2026" }), role({ id: "b", start: "2025-02" }), role({ id: "c", start: "2025-02" })] }));
      bad(career({ roles: [role({ id: "a", start: "2023" }), role({ id: "b", start: "2024-01" })] }), /most recent first/);
      bad(career({ roles: [role({ id: "a", start: "2025-02" }), role({ id: "b", start: "2025-03" })] }), /most recent first/);
    });
    it("ids are unique across roles and education", () => {
      bad(career({ roles: [role({ id: "a" }), role({ id: "a", start: "2020" })] }), /duplicate id "a"/);
      bad(career({ education: [{ id: "studio-lead", institution: "I", programme: "P", start: "2020", end: "2021" }] }), /duplicate id "studio-lead"/);
    });
    it("ids are kebab-case slugs", () => {
      bad(career({ roles: [role({ id: "Studio Lead" })] }));
    });
    it("names, groups, addresses and skills are unique", () => {
      bad(career({ languages: [{ name: "French", level: "C2" }, { name: "french", level: "C1" }] }), /unique/);
      bad(career({ skills: [{ group: "A", items: ["x"] }, { group: "a", items: ["y"] }] }), /unique/);
      bad(career({ skills: [{ group: "A", items: ["x", "X"] }] }), /unique/);
      bad(career({ roles: [role({ skills: ["React", "react"] })] }), /unique/);
      bad(career({ links: [{ label: "A", url: "https://example.org" }, { label: "B", url: "https://example.org" }] }), /unique/);
    });
  });

  describe("places", () => {
    it("a role or an education item may name a place of the projection, and it must resolve", () => {
      ok(career({ roles: [role({ place: "paris" })] }));
      bad(career({ roles: [role({ place: "atlantis" })] }), /unknown place "atlantis"/);
      bad(career({ education: [{ id: "e", institution: "I", programme: "P", start: "2020", end: "2021", place: "atlantis" }] }), /unknown place "atlantis"/);
      ok(career({ education: [{ id: "e", institution: "I", programme: "P", start: "2020", end: "2021", place: "paris" }] }));
    });
  });

  describe("text and links", () => {
    it("refuse control characters, line feeds and bidirectional overrides in every text", () => {
      const RLO = String.fromCharCode(0x202e);
      const LF = String.fromCharCode(10);
      const BEL = String.fromCharCode(7);
      for (const v of [`a${LF}b`, `a${BEL}b`, `a${RLO}b`]) {
        bad(career({ summary: v }));
        bad(career({ title: v }));
        bad(career({ roles: [role({ title: v })] }));
        bad(career({ roles: [role({ highlights: [v] })] }));
        bad(career({ skills: [{ group: "G", items: [v] }] }));
        bad(career({ languages: [{ name: "French", level: v }] }));
      }
    });
    it("texts are trimmed and must not be empty", () => {
      expect(parse(career({ summary: "  padded  " })).career!.summary).toBe("padded");
      bad(career({ summary: "   " }));
      bad(career({ roles: [role({ org: "" })] }));
      bad(career({ roles: [role()], skills: [{ group: "G", items: [] }] }));
    });
    it("urls are https only, without credentials or whitespace", () => {
      for (const url of ["http://example.org", "mailto:a@example.org", "javascript:alert(1)", "https://user:pw@example.org", "https://exa mple.org", "/relative", "tel:+33123456789"]) {
        bad(career({ links: [{ label: "L", url }] }));
        bad(career({ roles: [role({ orgUrl: url })] }));
      }
    });
    it("has no HTML interpretation: markup is data, displayed as written", () => {
      expect(parse(career({ summary: "Uses <b>bold</b> text." })).career!.summary).toBe("Uses <b>bold</b> text.");
    });
  });

  describe("limits", () => {
    it("bound the size of every collection", () => {
      const many = <T,>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));
      const roles = (n: number) => many(n, (i) => role({ id: `r-${i}`, start: "2000" }));
      ok(career({ roles: roles(CAREER_LIMITS.roles) }));
      bad(career({ roles: roles(CAREER_LIMITS.roles + 1) }));
      bad(career({ roles: [] }));
      ok(career({ roles: [role({ highlights: many(CAREER_LIMITS.highlights, (i) => `h${i}`) })] }));
      bad(career({ roles: [role({ highlights: many(CAREER_LIMITS.highlights + 1, (i) => `h${i}`) })] }));
      bad(career({ roles: [role({ skills: many(CAREER_LIMITS.roleSkills + 1, (i) => `s${i}`) })] }));
      bad(career({ education: many(CAREER_LIMITS.education + 1, (i) => ({ id: `e-${i}`, institution: "I", programme: "P", start: "2020", end: "2021" })) }));
      bad(career({ languages: many(CAREER_LIMITS.languages + 1, (i) => ({ name: `L${i}`, level: "B1" })) }));
      bad(career({ skills: many(CAREER_LIMITS.skillGroups + 1, (i) => ({ group: `G${i}`, items: ["a"] })) }));
      bad(career({ skills: [{ group: "G", items: many(CAREER_LIMITS.skillItems + 1, (i) => `i${i}`) }] }));
      bad(career({ links: many(CAREER_LIMITS.links + 1, (i) => ({ label: `L${i}`, url: `https://example.org/${i}` })) }));
    });
    it("bound the length of every text", () => {
      const x = (n: number) => "x".repeat(n);
      ok(career({ summary: x(CAREER_TEXT.summary) }));
      bad(career({ summary: x(CAREER_TEXT.summary + 1) }));
      bad(career({ title: x(CAREER_TEXT.title + 1) }));
      bad(career({ roles: [role({ highlights: [x(CAREER_TEXT.highlight + 1)] })] }));
      ok(career({ roles: [role({ highlights: [x(CAREER_TEXT.highlight)] })] }));
      bad(career({ roles: [role({ employment: x(CAREER_TEXT.employment + 1) })] }));
      bad(career({ roles: [role({ orgUrl: `https://example.org/${x(CAREER_TEXT.url)}` })] }));
      bad(career({ roles: [role({ id: x(CAREER_TEXT.id + 1) })] }));
      bad(career({ availability: { text: x(CAREER_TEXT.availability + 1), asOf: "2026-10" } }));
      bad(career({ links: [{ label: x(CAREER_TEXT.linkLabel + 1), url: "https://example.org" }] }));
    });

    // The TRUE maximum: every list at its limit, every optional field present, every text at its limit and made of a 3-byte
    // character (the worst UTF-8 width the schema accepts), every URL at its limit. It must stay under about 60 KB: the size of
    // one entry's body cap, which is what the projection budget ("Payload size and cost") assumes.
    const WIDE = "\u20ac";
    const fill = (n: number, tag = "") => `${tag}${WIDE.repeat(Math.max(0, n - tag.length))}`;
    const trueMaximum = (wide = true): PublishedCareer => {
      const f = (n: number, tag = "") => (wide ? fill(n, tag) : `${tag}${"x".repeat(Math.max(0, n - tag.length))}`);
      const url = (tag: string) => `https://example.org/${f(CAREER_TEXT.url - "https://example.org/".length, tag)}`;
      const n = (count: number) => Array.from({ length: count }, (_, i) => i);
      return {
        title: f(CAREER_TEXT.title),
        summary: f(CAREER_TEXT.summary),
        updated: "2026-10",
        availability: { text: f(CAREER_TEXT.availability), asOf: "2026-10" },
        portrait: { src: `/media/career/${"p".repeat(260)}.1a2b3c4d.webp`, alt: f(CAREER_TEXT.portraitAlt), width: 4000, height: 5000 },
        roles: n(CAREER_LIMITS.roles).map((i) => ({
          id: `${"r".repeat(CAREER_TEXT.id - 2)}${String(i).padStart(2, "0")}`,
          title: f(CAREER_TEXT.roleTitle),
          org: f(CAREER_TEXT.org),
          orgUrl: url(`o${i}`),
          location: f(CAREER_TEXT.location),
          place: "p".repeat(80),
          employment: f(CAREER_TEXT.employment),
          start: "2000-01",
          end: "2001-12",
          highlights: n(CAREER_LIMITS.highlights).map((j) => f(CAREER_TEXT.highlight, `h${j}`)),
          skills: n(CAREER_LIMITS.roleSkills).map((j) => f(CAREER_TEXT.roleSkill, `s${j}`)),
        })),
        education: n(CAREER_LIMITS.education).map((i) => ({
          id: `${"e".repeat(CAREER_TEXT.id - 2)}${String(i).padStart(2, "0")}`,
          institution: f(CAREER_TEXT.institution),
          programme: f(CAREER_TEXT.programme),
          level: f(CAREER_TEXT.level),
          start: "2000-01",
          end: "2001-12",
          location: f(CAREER_TEXT.location),
          place: "p".repeat(80),
          note: f(CAREER_TEXT.note),
        })),
        languages: n(CAREER_LIMITS.languages).map((i) => ({ name: f(CAREER_TEXT.languageName, `l${i}`), level: f(CAREER_TEXT.languageLevel), label: f(CAREER_TEXT.languageLabel) })),
        skills: n(CAREER_LIMITS.skillGroups).map((i) => ({
          group: f(CAREER_TEXT.group, `g${i}`),
          items: n(CAREER_LIMITS.skillItems).map((j) => f(CAREER_TEXT.item, `i${j}`)),
        })),
        links: n(CAREER_LIMITS.links).map((i) => ({ label: f(CAREER_TEXT.linkLabel), url: url(`k${i}`) })),
      };
    };
    it("the true maximum validates and stays under 60 KB of UTF-8, 3-byte characters everywhere", () => {
      const max = trueMaximum();
      const parsed = publishedCareerSchema.safeParse(max);
      if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 3)));
      const bytes = Buffer.byteLength(JSON.stringify(max));
      expect(bytes).toBeLessThan(60_000);
      // and in plain ASCII it is a third of that
      expect(Buffer.byteLength(JSON.stringify(trueMaximum(false)))).toBeLessThan(25_000);
    });
    it("covers every limit: no list or text of the schema is missing from the maximum", () => {
      const max = trueMaximum();
      expect(max.roles).toHaveLength(CAREER_LIMITS.roles);
      expect(max.roles[0]!.highlights).toHaveLength(CAREER_LIMITS.highlights);
      expect(max.roles[0]!.skills).toHaveLength(CAREER_LIMITS.roleSkills);
      expect(max.education).toHaveLength(CAREER_LIMITS.education);
      expect(max.languages).toHaveLength(CAREER_LIMITS.languages);
      expect(max.skills).toHaveLength(CAREER_LIMITS.skillGroups);
      expect(max.skills[0]!.items).toHaveLength(CAREER_LIMITS.skillItems);
      expect(max.links).toHaveLength(CAREER_LIMITS.links);
      // every optional key of every object is there
      const shape = (o: object) => Object.keys(o).sort();
      expect(shape(max.roles[0]!)).toEqual(["end", "employment", "highlights", "id", "location", "org", "orgUrl", "place", "skills", "start", "title"].sort());
      expect(shape(max.education[0]!)).toEqual(["end", "id", "institution", "level", "location", "note", "place", "programme", "start"].sort());
      expect(shape(max)).toEqual(["availability", "education", "languages", "links", "portrait", "roles", "skills", "summary", "title", "updated"]);
    });
  });

  describe("contact details are not published (values, not only property names)", () => {
    const texts: Array<[string, string]> = [
      ["e-mail", "Reach me at x@y.tld"],
      ["e-mail, bare", "someone.name+cv@example.org"],
      ["e-mail, [at]", "name [at] example [dot] org"],
      ["e-mail, (at)", "name (at) example.org"],
      ["e-mail, spelled", "name at example dot org"],
      ["phone, international", "+33 6 12 34 56 78"],
      ["phone, international, dotted", "+1.415.555.2671"],
      ["phone, 00 prefix", "0033 6 12 34 56 78"],
      ["phone, national", "06 12 34 56 78"],
      ["phone, national, dotted", "06.12.34.56.78"],
      ["phone, national, plain", "0612345678"],
      ["phone, 3-3-4", "415 555 2671"],
      ["phone, 3-3-3", "123-456-789"],
      ["phone, parenthesised", "(415) 555-2671"],
      ["phone, local", "call 555-1234"],
    ];
    it("rejects them in every free-text field, with a message that names the problem", () => {
      for (const [what, text] of texts) {
        const fields: Array<[string, object]> = [
          ["summary", career({ summary: text })],
          ["title", career({ title: text })],
          ["availability", career({ availability: { text, asOf: "2026-10" } })],
          ["highlight", career({ roles: [role({ highlights: [text] })] })],
          ["role title", career({ roles: [role({ title: text })] })],
          ["org", career({ roles: [role({ org: text })] })],
          ["location", career({ roles: [role({ location: text })] })],
          ["role skill", career({ roles: [role({ skills: [text] })] })],
          ["note", career({ education: [{ id: "e", institution: "I", programme: "P", start: "2020", end: "2021", note: text }] })],
          ["language", career({ languages: [{ name: "French", level: "C2", label: text }] })],
          ["group", career({ skills: [{ group: text, items: ["a"] }] })],
          ["item", career({ skills: [{ group: "G", items: [text] }] })],
          ["link label", career({ links: [{ label: text, url: "https://example.org" }] })],
        ];
        for (const [, c] of fields) bad(c, /contact details are never published/, undefined);
        void what;
      }
    });
    it("rejects contact-channel addresses in links and org URLs", () => {
      for (const url of [
        "mailto:a@example.org",
        "tel:+33612345678",
        "sms:+33612345678",
        "skype:live:someone",
        "https://wa.me/33612345678",
        "https://api.whatsapp.com/send?phone=33612345678",
        "https://t.me/someone",
        "https://signal.me/#p/+33612345678",
        "https://example.org/contact?mail=a@example.org",
      ]) {
        bad(career({ links: [{ label: "L", url }] }));
        bad(career({ roles: [role({ orgUrl: url })] }));
      }
      for (const url of ["https://github.com/BSoDium", "https://linkedin.com/in/bsodium", "https://artstation.com/bsodium", "https://example.org/a-b/12345678901"]) ok(career({ links: [{ label: "L", url }] }));
    });
    it("does not mistake dates, ranges, percentages, versions and counts for contact details", () => {
      for (const text of [
        "2024-07",
        "2022 to 2023",
        "2022-2023",
        "2019 2020 2021 2022",
        "2022-06-2023-09",
        "2022 - 2023 (6 months, 4 people)",
        "Increased conversion by 20% and traffic by 30%, onboarding time down 70%",
        "Next.js 14.2.3 and Node 22.11.0",
        "Handled 12,000 requests per second across 3 regions",
        "Array<T> and a<b and c>d",
        "C++17, ES2022, WCAG 2.2, ISO 27001",
        "Founded in 2019, 120 people, 4 offices",
      ]) {
        ok(career({ summary: text, roles: [role({ highlights: [text] })] }));
      }
    });
    it("the real document's texts are not flagged (no false positive)", () => {
      const real = [
        "Design engineer with an MSc in Computer Graphics & Vision and several years of production experience building React/TypeScript interfaces for geospatial and data-heavy platforms.",
        "Built the frontend and design of Macrodata Labs' data observability platform, enabling AI teams to process, understand, and scale multimodal datasets",
        "De facto UI/UX lead: owned frontend architecture, design language, and product experience across the platform",
        "Engineered geospatial dashboards for carbon monitoring at scale; built a production LLM-powered chat interface with real-time streaming Markdown and full PWA support",
        "Sole frontend lead: rewrote the entire platform in React/Redux/i18n, delivering significant performance gains",
        "Containerised backend services using Docker, reducing developer onboarding time by 70%",
        "Researched and implemented a contrast-aware palette generation algorithm using oklab/oklch colourspaces, significantly improving aesthetics and WCAG compliance",
        "Redesigned the company website, driving a 30% increase in traffic and 20% increase in conversion",
        "Automated frontend/backend type synchronisation via RTK Query codegen; led major website overhauls improving navigation and SEO",
        "ENSEEIHT, INP Toulouse", "Computer Science & Applied Mathematics", "CPGE PCSI/PSI*", "Alpen-Adria-Universität Klagenfurt",
        "colour science (oklab/oklch)", "GitLab CI/CD", "Agile/Scrum", "Open to opportunities", "Upper-intermediate",
      ];
      for (const text of real) expect(contactTextProblem(text), text).toBeNull();
      for (const url of ["https://github.com/BSoDium", "https://linkedin.com/in/bsodium", "https://artstation.com/bsodium"]) expect(contactUrlProblem(url), url).toBeNull();
    });
  });

  describe("generated JSON Schema", () => {
    const schema = JSON.parse(buildJsonSchema());
    it("describes career as an optional strict object (zod-only rules: order, ends, uniqueness, place references)", () => {
      expect(schema.properties.career.type).toBe("object");
      expect(schema.properties.career.additionalProperties).toBe(false);
      expect(schema.required).not.toContain("career");
      expect(schema.properties.career.required).toEqual(expect.arrayContaining(["title", "summary", "updated", "roles", "education", "languages", "skills", "links"]));
      expect(schema.properties.career.properties.roles.minItems).toBe(1);
      expect(schema.properties.career.properties.roles.items.additionalProperties).toBe(false);
    });
  });
});
