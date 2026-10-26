import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published";
import type { PublishedCareer } from "@catalyst/schemas";
import { asOfText, careerDuration, careerIcon, careerLogo, careerJsonLd, careerPeriod, formatCareerMonth, isCurrent, languageDetail, safeLinks, safePortrait } from "./career";
import { SITE } from "./site";

const demo = loadDemoProjection().career!;

describe("formatCareerMonth", () => {
  it("names the month in fixed English, a year alone stays a year", () => {
    expect(formatCareerMonth("2026-09")).toBe("September 2026");
    expect(formatCareerMonth("2026-09", "short")).toBe("Sep 2026");
    expect(formatCareerMonth("2021")).toBe("2021");
    expect(formatCareerMonth("2021", "short")).toBe("2021");
  });
  it("refuses what is not a career date", () => {
    for (const bad of ["", "2026-13", "2026-9", "26-09", "2026-09-01", "present", "soon"]) expect(formatCareerMonth(bad), bad).toBeNull();
  });
});

describe("asOfText", () => {
  it('words the availability date as "as of Month YYYY"', () => {
    expect(asOfText("2026-10")).toBe("as of October 2026");
    expect(asOfText("nonsense")).toBe("");
  });
});

describe("careerPeriod", () => {
  it("shows a closed range with both ends as dates", () => {
    const p = careerPeriod("2023-04", "2025-08");
    expect(p.text).toBe("Apr 2023 – Aug 2025");
    expect(p.start).toEqual({ text: "Apr 2023", dateTime: "2023-04" });
    expect(p.end).toEqual({ text: "Aug 2025", dateTime: "2025-08" });
    expect(p.spoken).toBe("April 2023 to August 2025");
  });
  it('shows "present" as the word Present, with no date time', () => {
    const p = careerPeriod("2025-09", "present");
    expect(p.text).toBe("Sep 2025 – Present");
    expect(p.end).toEqual({ text: "Present" });
    expect(p.spoken).toBe("September 2025 to present");
  });
  it("shows the start alone when the document says nothing about the end", () => {
    const p = careerPeriod("2021", undefined);
    expect(p.text).toBe("2021");
    expect(p.end).toBeUndefined();
    expect(p.spoken).toBe("from 2021");
  });
  it("does not repeat a range that starts and ends in the same year-only text", () => {
    expect(careerPeriod("2019", "2019").text).toBe("2019");
    expect(careerPeriod("2016", "2021").text).toBe("2016 – 2021");
  });
});

describe("careerDuration", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  it("counts both months, in years and months", () => {
    expect(careerDuration("2023-04", "2025-08")).toBe("2y 5m");
    expect(careerDuration("2019-06", "2019-09")).toBe("4m");
    expect(careerDuration("2020-01", "2020-12")).toBe("1y");
    expect(careerDuration("2025-09", "2025-09")).toBe("1m");
  });
  it("runs an ongoing role to now", () => {
    expect(careerDuration("2025-09", "present", now)).toBe("1y 2m");
  });
  it("is null when it cannot be told", () => {
    expect(careerDuration("2021", undefined)).toBeNull();
    expect(careerDuration("2021", "2022")).toBeNull();
    expect(careerDuration("2025-09", "2024-01")).toBeNull();
  });
});

describe("careerIcon", () => {
  it("reads a role's icon from its title, a founder before a full-stack before a front-end", () => {
    expect(careerIcon("Founding Engineer, Frontend & UX", "role")).toBe("rocket");
    expect(careerIcon("Full-Stack Engineer", "role")).toBe("layers");
    expect(careerIcon("Frontend Engineer (Freelance & Internship)", "role")).toBe("code");
    expect(careerIcon("Interface Designer", "role")).toBe("palette");
    expect(careerIcon("Operations Lead", "role")).toBe("career");
  });
  it("reads an education's icon from its programme", () => {
    expect(careerIcon("Computer Graphics & Vision", "education")).toBe("cuboid");
    expect(careerIcon("Mathematics & Physics", "education")).toBe("sigma");
    expect(careerIcon("History", "education")).toBe("graduation-cap");
  });
});

describe("careerLogo", () => {
  it("finds a logo from the name the owner wrote, and none for an unknown one", () => {
    expect(careerLogo("Kanop")).toBe("/career-logos/kanop.webp");
    expect(careerLogo("Tauniqo.ai")).toBe("/career-logos/tauniqo.webp");
    expect(careerLogo("Escape Technologies")).toBe("/career-logos/escape.webp");
    expect(careerLogo("ENSEEIHT, INP Toulouse")).toBe("/career-logos/enseeiht.webp");
    expect(careerLogo("Alpen-Adria-Universität Klagenfurt")).toBe("/career-logos/aau.webp");
    expect(careerLogo("Macrodata Labs")).toBeNull();
  });
});

describe("isCurrent, languageDetail", () => {
  it("only `present` is current", () => {
    expect(isCurrent({ end: "present" })).toBe(true);
    expect(isCurrent({ end: "2025" })).toBe(false);
    expect(isCurrent({})).toBe(false);
  });
  it("joins the label and the level, never the same word twice", () => {
    expect(languageDetail({ name: "English", level: "C2", label: "Native" })).toBe("Native, C2");
    expect(languageDetail({ name: "Portuguese", level: "A2" })).toBe("A2");
    expect(languageDetail({ name: "French", level: "Native", label: "native" })).toBe("native");
  });
});

describe("safePortrait, safeLinks", () => {
  it("returns the portrait only on a safe /media/ path", () => {
    expect(safePortrait(demo)).toMatchObject({ src: "/media/demo/portrait-example.svg" });
    const { portrait: _p, ...none } = demo;
    expect(safePortrait(none as PublishedCareer)).toBeNull();
    expect(safePortrait({ ...demo, portrait: { src: "https://evil.example/x.png", alt: "x", width: 1, height: 1 } })).toBeNull();
    expect(safePortrait({ ...demo, portrait: { src: "/media/../x.png", alt: "x", width: 1, height: 1 } })).toBeNull();
  });
  it("keeps only https links without credentials", () => {
    const links = [
      { label: "ok", url: "https://example.org/a" },
      { label: "http", url: "http://example.org/b" },
      { label: "cred", url: "https://user:pw@example.org/c" },
    ];
    expect(safeLinks({ ...demo, links })).toEqual([{ label: "ok", url: "https://example.org/a" }]);
  });
});

describe("careerJsonLd", () => {
  const ld = careerJsonLd(demo, "https://v2.bsodium.fr");
  it("is a ProfilePage about a Person, with the site's own name and role", () => {
    expect(ld["@type"]).toBe("ProfilePage");
    expect(ld.url).toBe("https://v2.bsodium.fr/career");
    expect(ld.dateModified).toBe(demo.updated);
    expect(ld.mainEntity).toMatchObject({ "@type": "Person", name: SITE.name, jobTitle: SITE.role });
  });
  it("lists the profile links as sameAs and nothing else about the person", () => {
    const person = ld.mainEntity as Record<string, unknown>;
    expect(person.sameAs).toEqual(demo.links.map((l) => l.url));
    expect(Object.keys(person).sort()).toEqual(["@type", "jobTitle", "name", "sameAs", "url"]);
  });
  it("carries no employer, portrait, place or contact detail", () => {
    const text = JSON.stringify(ld);
    for (const org of demo.roles.map((r) => r.org)) expect(text).not.toContain(org);
    expect(text).not.toMatch(/portrait|worksFor|address|email|telephone|image/i);
  });
  it("has no sameAs when there is no link", () => {
    expect((careerJsonLd({ ...demo, links: [] }, "https://x.test").mainEntity as Record<string, unknown>).sameAs).toBeUndefined();
  });
});
