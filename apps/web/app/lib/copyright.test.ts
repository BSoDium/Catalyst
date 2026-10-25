import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published";
import { copyrightNotice, yearOf } from "./copyright";
import { CONTENT_KINDS, getEntryDetail } from "./entries";
import { SITE } from "./site";

describe("yearOf", () => {
  it("reads the year of a partial ISO date, and nothing else", () => {
    expect(yearOf("2026")).toBe(2026);
    expect(yearOf("2026-03")).toBe(2026);
    expect(yearOf("2026-03-14")).toBe(2026);
    expect(yearOf(undefined)).toBeUndefined();
    expect(yearOf("")).toBeUndefined();
    expect(yearOf("spring 2026")).toBeUndefined();
  });
});

describe("copyrightNotice", () => {
  it("says the English line with the entry's date year, the holder from the site constant and the kind's noun", () => {
    expect(copyrightNotice({ kind: "poem", date: "2024-06-19" })?.text).toBe(
      `© 2024 ${SITE.name}. All rights reserved. Please do not reproduce this poem without permission; short quotations with attribution are welcome.`,
    );
    expect(copyrightNotice({ kind: "article", date: "2023" })?.text).toContain("reproduce this article without");
    expect(copyrightNotice({ kind: "artwork", date: "2022-01" })?.text).toContain("reproduce this artwork without");
  });
  it("says it in French for an entry whose language is French (ce poème, ce texte, cette œuvre)", () => {
    const meta = [{ label: "Language", value: "French" }];
    expect(copyrightNotice({ kind: "poem", date: "2021-03", meta })?.text).toBe(
      `© 2021 ${SITE.name}. Tous droits réservés. Merci de ne pas reproduire ce poème sans autorisation ; de courtes citations avec mention de l'auteur sont bienvenues.`,
    );
    expect(copyrightNotice({ kind: "article", date: "2021", meta })?.text).toContain("ce texte sans autorisation");
    expect(copyrightNotice({ kind: "artwork", date: "2021", meta: [{ label: "Language", value: "Français" }] })?.text).toContain("reproduire cette œuvre sans autorisation");
    expect(copyrightNotice({ kind: "poem", date: "2021", meta })?.language).toBe("fr");
  });
  it("stays English for another language (Spanish) and for an entry that names none", () => {
    expect(copyrightNotice({ kind: "poem", date: "2023", meta: [{ label: "Language", value: "Spanish" }] })?.language).toBe("en");
    expect(copyrightNotice({ kind: "poem", date: "2023" })?.language).toBe("en");
  });
  it("takes the year from the date, else from the updated stamp, else leaves it out", () => {
    expect(copyrightNotice({ kind: "poem", date: "2020-05", updated: "2026-01" })?.year).toBe(2020);
    const stamped = copyrightNotice({ kind: "poem", updated: "2026-01" });
    expect(stamped?.year).toBe(2026);
    expect(stamped?.text.startsWith(`© 2026 ${SITE.name}.`)).toBe(true);
    const bare = copyrightNotice({ kind: "poem" });
    expect(bare?.year).toBeUndefined();
    expect(bare?.text.startsWith(`© ${SITE.name}. All rights reserved.`)).toBe(true);
    expect(bare?.text).not.toMatch(/\d{4}/);
  });
  it("has no notice for software (code: the repository's licence)", () => {
    expect(copyrightNotice({ kind: "project", date: "2025" })).toBeNull();
  });
  it("gives every demo poem, article and artwork a notice and no project one", () => {
    const demo = loadDemoProjection();
    for (const kind of CONTENT_KINDS) {
      const items = { article: demo.articles, project: demo.projects, artwork: demo.artworks, poem: demo.poems, photograph: demo.photographs }[kind];
      for (const item of items) {
        const notice = copyrightNotice(getEntryDetail(demo, kind, item.slug)!);
        expect(notice === null, `${kind}/${item.slug}`).toBe(kind === "project");
      }
    }
  });
});
