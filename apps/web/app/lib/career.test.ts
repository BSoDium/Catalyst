import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published/dev";
import type { PublishedCareer } from "@catalyst/schemas";
import { asOfText, careerDuration, careerIcon, careerLogo, careerLogoSrc, careerJsonLd, careerPeriod, formatCareerMonth, languageDetail, localDay, roleState, safeLinks, safePortrait, safeProjects } from "./career";
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
  it('says "Joining" for a role that has not begun: the start, no "Present", no end', () => {
    const p = careerPeriod("2026-12", undefined, true);
    expect(p.text).toBe("Joining Dec 2026");
    expect(p.status).toBe("Joining");
    expect(p.start).toEqual({ text: "Dec 2026", dateTime: "2026-12" });
    expect(p.end).toBeUndefined();
    expect(p.spoken).toBe("joining in December 2026, not started yet");
    expect(careerPeriod("2026-12", "present", true).text).toBe("Joining Dec 2026");
  });
  it("keeps a dated end after the start of a role that has not begun", () => {
    const p = careerPeriod("2026-12", "2027-05", true);
    expect(p.text).toBe("Joining Dec 2026 – May 2027");
    expect(p.end).toEqual({ text: "May 2027", dateTime: "2027-05" });
    expect(p.spoken).toBe("joining in December 2026, until May 2027, not started yet");
  });
  it("has no status word for a role that has begun", () => {
    expect(careerPeriod("2025-09", "present").status).toBeUndefined();
  });
  it("does not repeat a range that starts and ends in the same year-only text", () => {
    expect(careerPeriod("2019", "2019").text).toBe("2019");
    expect(careerPeriod("2016", "2021").text).toBe("2016 – 2021");
  });
});

describe("careerDuration", () => {
  const asOf = "2026-10";
  it("counts both months, in years and months", () => {
    expect(careerDuration("2023-04", "2025-08", asOf)).toBe("2y 5m");
    expect(careerDuration("2019-06", "2019-09", asOf)).toBe("4m");
    expect(careerDuration("2020-01", "2020-12", asOf)).toBe("1y");
    expect(careerDuration("2025-09", "2025-09", asOf)).toBe("1m");
  });
  it("runs an ongoing role to the month the document was last reviewed, never to the clock", () => {
    expect(careerDuration("2025-09", "present", "2026-10")).toBe("1y 2m");
    expect(careerDuration("2025-09", "present", "2025-12")).toBe("4m");
    expect(careerDuration("2025-09", "present", "bad")).toBeNull();
  });
  it("counts no stay for a role that has not begun", () => {
    expect(careerDuration("2026-10", "present", "2026-10", true)).toBeNull();
    expect(careerDuration("2026-10", undefined, "2026-10", true)).toBeNull();
  });
  it("is null when it cannot be told", () => {
    expect(careerDuration("2021", undefined, asOf)).toBeNull();
    expect(careerDuration("2021", "2022", asOf)).toBeNull();
    expect(careerDuration("2025-09", "2024-01", asOf)).toBeNull();
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

describe("careerLogoSrc", () => {
  it("prefers the logo the document carries, then the site's own file by name, then none", () => {
    expect(careerLogoSrc({ logo: { src: "/media/career/kanop.1a2b3c4d.webp" } }, "Kanop")).toBe("/media/career/kanop.1a2b3c4d.webp");
    expect(careerLogoSrc({}, "Kanop")).toBe("/career-logos/kanop.webp");
    expect(careerLogoSrc({}, "Nobody Inc.")).toBeNull();
  });
  it("checks the document's path again: a bad one falls back to the name", () => {
    expect(careerLogoSrc({ logo: { src: "https://evil.example/l.png" } }, "Kanop")).toBe("/career-logos/kanop.webp");
    expect(careerLogoSrc({ logo: { src: "/media/../l.png" } }, "Nobody Inc.")).toBeNull();
  });
});

describe("careerLogo", () => {
  it("finds a logo from the name the owner wrote, and none for an unknown one", () => {
    expect(careerLogo("Kanop")).toBe("/career-logos/kanop.webp");
    expect(careerLogo("Tauniqo.ai")).toBe("/career-logos/tauniqo.webp");
    expect(careerLogo("Escape Technologies")).toBe("/career-logos/escape.webp");
    expect(careerLogo("ENSEEIHT, INP Toulouse")).toBe("/career-logos/enseeiht.webp");
    expect(careerLogo("Alpen-Adria-Universität Klagenfurt")).toBe("/career-logos/aau.webp");
    expect(careerLogo("Macrodata Labs")).toBe("/career-logos/macrodata.webp");
    expect(careerLogo("Lycée Déodat de Séverac")).toBe("/career-logos/deodat.webp");
    expect(careerLogo("Some Other School")).toBeNull();
  });
});

describe("roleState, localDay, languageDetail", () => {
  it("a role with an end of `present` is the one in progress, any other end is not", () => {
    expect(roleState({ end: "present" }, null)).toEqual({ upcoming: false, end: "present", current: true });
    expect(roleState({ end: "2025" }, null)).toEqual({ upcoming: false, end: "2025", current: false });
    expect(roleState({}, "2030-01-01")).toEqual({ upcoming: false, end: undefined, current: false });
  });
  it("`upcoming: true` has not begun, whatever the day, and is never current", () => {
    for (const today of [null, "2026-11-01", "2099-01-01"]) expect(roleState({ upcoming: true }, today)).toEqual({ upcoming: true, end: undefined, current: false });
  });
  it("`upcoming: <day>` has not begun until that day, with the document as authored when the day is unknown (server, static page, hydration pass)", () => {
    const r = { upcoming: "2026-11-30" } as const;
    for (const today of [null, "2026-11-26", "2026-11-29"]) expect(roleState(r, today)).toEqual({ upcoming: true, end: undefined, current: false });
  });
  it("`upcoming: <day>` begins ON that day: the role is the one in progress, an absent end meaning `present`", () => {
    const r = { upcoming: "2026-11-30" } as const;
    for (const today of ["2026-11-30", "2026-12-01", "2027-06-15"]) expect(roleState(r, today)).toEqual({ upcoming: false, end: "present", current: true });
  });
  it("a begun `upcoming: <day>` role keeps a dated end, and is then not in progress", () => {
    expect(roleState({ upcoming: "2026-11-30", end: "2027-05" }, "2026-12-01")).toEqual({ upcoming: false, end: "2027-05", current: false });
    expect(roleState({ upcoming: "2026-11-30", end: "present" }, "2026-12-01")).toEqual({ upcoming: false, end: "present", current: true });
  });
  it("compares days as text, so a month or a year boundary is no special case", () => {
    expect(roleState({ upcoming: "2027-01-01" }, "2026-12-31").upcoming).toBe(true);
    expect(roleState({ upcoming: "2027-01-01" }, "2027-01-01").upcoming).toBe(false);
  });
  it("localDay is the visitor's calendar day, zero padded", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDay(new Date(2026, 10, 30, 0, 0))).toBe("2026-11-30");
  });
  it("joins the label and the level, never the same word twice", () => {
    expect(languageDetail({ name: "English", level: "C2", label: "Native" })).toBe("Native, C2");
    expect(languageDetail({ name: "Portuguese", level: "A2" })).toBe("A2");
    expect(languageDetail({ name: "French", level: "Native", label: "native" })).toBe("native");
  });
});

describe("safeProjects", () => {
  it("keeps the projects of a position, and drops a picture with a bad path, not the project", () => {
    const image = { src: "/media/career/p.1a2b3c4d.webp", width: 400, height: 300 };
    expect(safeProjects({ projects: [{ title: "T", summary: "S", image }] })).toEqual([{ title: "T", summary: "S", image }]);
    expect(safeProjects({ projects: [{ title: "T", summary: "S", image: { ...image, src: "https://evil.example/p.png" } }] })).toEqual([{ title: "T", summary: "S" }]);
    expect(safeProjects({})).toEqual([]);
  });
});

describe("safePortrait, safeLinks", () => {
  it("returns the portrait only on a safe /media/ path", () => {
    expect(safePortrait(demo)).toMatchObject({ src: "/media/demo/portrait-example.svg" });
    const { portrait: _p, ...none } = demo;
    expect(safePortrait(none as PublishedCareer)).toBeNull();
    // a variant with a bad path is dropped, not the portrait
    const p = demo.portrait!;
    expect(safePortrait({ ...demo, portrait: { ...p, egg: { src: "https://evil.example/e.svg", width: 1, height: 1 } } })).not.toHaveProperty("egg");
    expect(safePortrait({ ...demo, portrait: { ...p, egg: { src: "https://evil.example/e.svg", width: 1, height: 1 } } })).toHaveProperty("dark");
    expect(safePortrait(demo)).toHaveProperty("egg");
    expect(safePortrait({ ...demo, portrait: { src: "https://evil.example/x.png", alt: "x", width: 1, height: 1 } })).toBeNull();
    expect(safePortrait({ ...demo, portrait: { src: "/media/../x.png", alt: "x", width: 1, height: 1 } })).toBeNull();
    // a bad dark variant is dropped, the portrait stays
    const withDark = safePortrait({ ...demo, portrait: { src: "/media/a.png", alt: "x", width: 1, height: 1, dark: { src: "https://evil.example/d.png", width: 1, height: 1 } } });
    expect(withDark).toEqual({ src: "/media/a.png", alt: "x", width: 1, height: 1 });
    expect(safePortrait({ ...demo, portrait: { src: "/media/a.png", alt: "x", width: 1, height: 1, dark: { src: "/media/b.png", width: 1, height: 1 } } })!.dark).toEqual({ src: "/media/b.png", width: 1, height: 1 });
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
