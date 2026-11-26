import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published/dev";
import type { PublishedCareer } from "@catalyst/schemas";
import { CareerPage } from "./career-page";

const demo = loadDemoProjection().career!;
const render = (career: PublishedCareer, places: string[] = ["paris"], projects: string[] = [], today?: string | null) =>
  renderToStaticMarkup(createElement(StaticRouter, { location: "/career" }, createElement(CareerPage, { career, places, projects, ...(today !== undefined ? { today } : {}) })));
const without = <K extends keyof PublishedCareer>(c: PublishedCareer, ...keys: K[]): PublishedCareer => {
  const copy = { ...c };
  for (const k of keys) delete copy[k];
  return copy;
};

describe("CareerPage", () => {
  const html = render(demo);

  it("is one main landmark with the owner's name as the only h1", () => {
    expect(html.match(/<main /g)).toHaveLength(1);
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    // (the handle over the name is decoration, `aria-hidden`: the heading's name is the aria-label's and the text without it)
    expect(html.match(/<h1[^>]*>(.*?)<\/h1>/)![1]!.replace(/<span aria-hidden="true".*?<\/span><\/span>/, "").replace(/<[^>]+>/g, "")).toBe("Elliot Négrel-Jerzy");
    expect(html).toMatch(/<span class="career-name-family">Négrel-Jerzy<\/span>/);
  });

  it("orders the blocks: head, languages, experience, education, skills, links", () => {
    const at = (s: string) => html.indexOf(s);
    const order = ['data-slot="career-head"', 'data-slot="career-languages"', 'id="experience"', 'id="education"', 'id="skills"', 'data-slot="career-links"'].map(at);
    expect(order.every((n) => n > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("sets the headings in order: h1, then h2 blocks, h3 per organisation", () => {
    const levels = [...html.matchAll(/<h([1-4])[ >]/g)].map((m) => Number(m[1]));
    expect(levels[0]).toBe(1);
    expect(levels.every((l, i) => i === 0 || l - levels[i - 1]! <= 1)).toBe(true);
    expect(levels.filter((l) => l === 3)).toHaveLength(demo.roles.length + demo.education.length);
  });

  it("renders the roles as an ordered list, newest first, each period with <time>", () => {
    const experience = html.slice(html.indexOf('id="experience"'), html.indexOf('id="education"'));
    expect(experience).toContain("<ol");
    const orgs = [...experience.matchAll(/class="career-org"[^>]*>(?:<a[^>]*>)?([^<]+)</g)].map((m) => m[1]);
    expect(orgs).toEqual(demo.roles.map((r) => r.org).map((o) => o.replace("&", "&amp;")));
    expect(experience.match(/<time /g)!.length).toBeGreaterThanOrEqual(demo.roles.length);
    expect(experience).toContain('dateTime="2025-09"');
    expect(experience).toContain("Sep 2025");
  });

  it('shows an ongoing role as "Present" and the role in progress is marked', () => {
    expect(html).toContain("Present");
    expect(html.match(/data-current="true"/g)).toHaveLength(1);
  });

  it('shows a role that has not begun as "Joining", not as the role in progress', () => {
    const { end: _end, ...open } = { ...demo.roles[0]!, id: "joining-co", org: "Joining Co", start: "2026-11", upcoming: true as const };
    const page = render({ ...demo, roles: [open, ...demo.roles] });
    const item = page.slice(page.indexOf('id="joining-co"'));
    const li = item.slice(0, item.indexOf("</li>"));
    expect(li).toContain('data-upcoming="true"');
    expect(li).not.toContain("data-current");
    expect(li).toContain('<span class="career-status">Joining</span> <time dateTime="2026-11">Nov 2026</time>');
    expect(li).toContain("joining in November 2026, not started yet"); // what a screen reader hears
    expect(li).not.toMatch(/Present|career-duration/);
    // the role that was in progress is the one still marked
    expect(page.match(/data-current="true"/g)).toHaveLength(1);
    expect(page.match(/data-upcoming="true"/g)).toHaveLength(1);
    expect(html).not.toContain("data-upcoming");
  });

  describe("a position that begins on a given day (`upcoming: YYYY-MM-DD`)", () => {
    const { end: _end, ...open } = { ...demo.roles[0]!, id: "joining-co", org: "Joining Co", start: "2026-11", upcoming: "2026-11-30" as const };
    const career = { ...demo, updated: "2026-11", roles: [open, ...demo.roles] };
    const item = (page: string) => {
      const from = page.slice(page.indexOf('id="joining-co"'));
      return from.slice(0, from.indexOf("</li>"));
    };

    it("is prerendered as it is authored: the server has no clock, and the first client render must equal it", () => {
      // no `today` given: the hook says "not hydrated" in a server render, as in the hydration pass
      for (const li of [item(render(career)), item(render(career, ["paris"], [], null))]) {
        expect(li).toContain('data-upcoming="true"');
        expect(li).toContain('<span class="career-status">Joining</span>');
        expect(li).not.toMatch(/data-current|Present|career-duration/);
      }
    });
    it("still says Joining on the days before", () => {
      expect(item(render(career, ["paris"], [], "2026-11-29"))).toContain('data-upcoming="true"');
    });
    it("is the position in progress from that day, with no end meaning Present and a stay counted to the review month", () => {
      const li = item(render(career, ["paris"], [], "2026-11-30"));
      expect(li).toContain('data-current="true"');
      expect(li).not.toContain("data-upcoming");
      expect(li).not.toContain("career-status");
      expect(li).toContain("Present");
      expect(li).toContain("November 2026 to present");
      expect(li).toContain(">1m<"); // Nov 2026 to the review month, Nov 2026, both counted
    });
  });

  it("reads the clock in one place: the career page has no other `Date` in it (the server and the static page have none)", () => {
    const here = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
    expect(here("./career-page.tsx")).not.toMatch(/new Date|Date\.now|performance\.now/);
    const lib = here("../lib/career.ts");
    expect(lib.match(/new Date|Date\.now/g)).toEqual(["new Date"]); // `localDay`'s default, nothing else
    expect(here("../lib/career-meta.ts")).not.toMatch(/new Date|Date\.now/);
    expect(here("../lib/llm-text.ts")).not.toMatch(/new Date|Date\.now/);
  });

  it("shows a year-only start with no end as the year alone", () => {
    const item = html.slice(html.indexOf('id="interface-designer-placeholder-co"'));
    expect(item.slice(0, item.indexOf("</li>"))).toMatch(/<time dateTime="2021">2021<\/time>/);
  });

  it("links a location to its page only when the place exists", () => {
    expect(html).toContain('href="/locations/paris"');
    expect(html).not.toContain('href="/locations/lisbon"');
    expect(render(demo, [])).not.toContain('href="/locations/paris"');
  });

  it("puts the languages in one compact line with their detail", () => {
    const line = html.slice(html.indexOf('data-slot="career-languages"'), html.indexOf('id="experience"'));
    expect(line).toContain("English");
    expect(line).toContain("Native, C2");
    expect(line).toContain("A2");
  });

  it("shows the availability with its date as `as of Month YYYY`", () => {
    expect(html).toContain("Open to example opportunities");
    expect(html).toContain('<time dateTime="2026-09">as of September 2026</time>');
  });

  it("draws the portrait with its size, eager, high priority and its alt text", () => {
    expect(html).toMatch(/<img [^>]*src="\/media\/demo\/portrait-example\.svg"/);
    expect(html).toContain('width="940"');
    expect(html).toContain('height="640"');
    expect(html).toContain('loading="eager"');
    expect(html).toMatch(/fetchPriority="high"|fetchpriority="high"/);
    expect(html).toContain(`alt="${demo.portrait!.alt}"`);
  });

  it("offers a dark variant of the portrait to the dark colour scheme (a picture), and a plain image without one", () => {
    expect(render({ ...demo, portrait: { ...demo.portrait!, dark: undefined } })).not.toContain("<picture");
    expect(html).toContain("<picture");
    const h = render({ ...demo, portrait: { ...demo.portrait!, dark: { src: "/media/demo/portrait-example-dark.svg", width: 800, height: 1000 } } });
    expect(h).toContain('<source media="(prefers-color-scheme: dark)" srcSet="/media/demo/portrait-example-dark.svg"');
    // the picture and its bleed both follow the scheme; only the picture has the alt text
    expect(h.match(/<picture>/g)).toHaveLength(2);
    expect(h.match(new RegExp(`alt="${demo.portrait!.alt}"`, "g"))).toHaveLength(1);
  });

  it("draws the logo the document carries as the marker of its item, else the site's own file by name, else an icon", () => {
    const h = render({ ...demo, roles: [{ ...demo.roles[0]!, org: "Kanop", logo: { src: "/media/career/kanop.1a2b3c4d.webp", width: 200, height: 200 } }, { ...demo.roles[1]!, org: "Escape Technologies" }, ...demo.roles.slice(2)] });
    expect(h).toContain('src="/media/career/kanop.1a2b3c4d.webp"');
    expect(h).toContain('src="/career-logos/escape.webp"');
    // a marker without a logo is an icon (an svg), one with a logo is a decorative image
    expect(h).toMatch(/class="career-icon"[^>]*><svg/);
    expect(h).toMatch(/class="career-icon" data-logo="true" aria-hidden="true"><img [^>]*alt=""/);
  });

  it("sends the plain portrait: the Easter egg's picture is never in the server's page (it is drawn in the browser, by chance)", () => {
    expect(demo.portrait!.egg).toBeDefined();
    expect(html).not.toContain(demo.portrait!.egg!.src);
    expect(html).not.toContain("data-egg");
  });

  it("draws the projects of a position in a row of their own: a picture (decorative), a title and a line; a project with an entry the site has is a link to it, the whole of it", () => {
    const withProjects = render(demo, ["paris"], ["label-collision-engine"]);
    const role = withProjects.slice(withProjects.indexOf('id="lead-frontend-example-studio"'), withProjects.indexOf('id="frontend-engineer-sample-works"'));
    expect(role).toContain('data-slot="career-projects"');
    expect(role).toContain(">Selected work</h4>");
    expect(role).toMatch(/<img src="\/media\/demo\/project-example-a\.svg" alt="" width="400" height="300"/);
    const link = role.match(/<a [^>]*class="career-project-head"[^>]*>[\s\S]*?<\/a>/)![0];
    expect(link).toMatch(/href="\/software\/label-collision-engine"/);
    expect(link).toContain('<span class="career-project-name">Example Atlas</span>');
    expect(link).toContain("project-example-a.svg");
    // a project without an entry is the card alone: no link
    expect(role).toMatch(/<div class="career-project-head"><span class="career-project-text"><span class="career-project-name">Placeholder Console/);
    // the entry the site does not have: no link either
    expect(render(demo, ["paris"], [])).not.toContain("/software/label-collision-engine");
    // the head is before the projects, which come after the detail in the document (the stylesheet puts them under both)
    expect(role.indexOf('class="career-head"')).toBeLessThan(role.indexOf('data-slot="career-projects"'));
  });

  it("draws no projects block for a position without projects", () => {
    const h = render({ ...demo, roles: demo.roles.map((r) => ({ ...r, projects: undefined })) });
    expect(h).not.toContain("career-projects");
  });

  it("without a portrait draws no frame and no image, the name block alone", () => {
    const h = render(without(demo, "portrait"));
    expect(h).not.toContain("<figure");
    expect(h).not.toContain("career-portrait");
    expect(h).toContain('data-portrait="false"');
  });

  it("without an availability draws no availability line", () => {
    const h = render(without(demo, "availability"));
    expect(h).not.toContain("career-availability");
    expect(h).not.toContain("as of ");
  });

  it("with no skills, no languages, no education and no links draws none of those blocks and no empty headings", () => {
    const h = render({ ...demo, skills: [], languages: [], education: [], links: [] });
    for (const s of ["id=\"skills\"", "id=\"education\"", "career-languages", "career-links"]) expect(h).not.toContain(s);
    expect(h).toContain('id="experience"');
    expect(h).not.toContain("<h2></h2>");
  });

  it("holds the longest texts the contract allows without markup problems", () => {
    const x = (n: number) => "Wide ".repeat(Math.ceil(n / 5)).slice(0, n);
    const role = { ...demo.roles[0]!, title: x(60), org: x(50), location: x(40), employment: x(30), highlights: Array.from({ length: 5 }, () => x(180)), skills: Array.from({ length: 8 }, (_, i) => `${x(28)}${i}`) };
    const h = render({ ...demo, summary: x(500), roles: [role] });
    expect(h.match(/<li/g)!.length).toBeGreaterThan(5);
    expect(h).toContain(x(180));
  });

  it("offers the contact form: a head button that links to it, the form after the socials (so wrapped, the socials come first)", () => {
    expect(html).toMatch(/<a [^>]*href="#contact"[^>]*>\s*Get in touch/);
    const form = html.indexOf('id="contact"');
    expect(form).toBeGreaterThan(html.indexOf('data-slot="career-skills"'));
    expect(form).toBeGreaterThan(html.indexOf('data-slot="career-links"'));
    for (const label of ["What should I call you?", "Your email address, to answer you", "What would you like to talk about?"]) expect(html).toContain(`>${label}</label>`);
    expect(html).toContain('name="botcheck"');
    // Without the script it is a plain HTML post to the relay: the key and the subject travel as hidden fields, the browser validates.
    expect(html).toMatch(/<form [^>]*action="https:\/\/api\.web3forms\.com\/submit" method="post"/);
    expect(html).toMatch(/<input type="hidden" name="access_key" value="[0-9a-f-]{36}"/);
    expect(html).not.toMatch(/<form[^>]* novalidate/i);
    expect(html).toMatch(/<button[^>]*>Send message/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Send message/);
  });

  it("makes the institution of an education item a link when it has a site, a plain name when it has none", () => {
    const edu = { ...demo.education[0]!, institution: "Example University", institutionUrl: "https://example.org/uni" };
    const h = render({ ...demo, education: [edu, { ...edu, id: "other", institution: "Plain School", institutionUrl: undefined }] });
    expect(h).toMatch(/<a [^>]*href="https:\/\/example\.org\/uni"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*class="career-org-link"[^>]*>Example University</);
    expect(h).toContain("(opens in a new tab)");
    expect(h).toMatch(/<h3 class="career-org">Plain School<\/h3>/);
  });

  it("sets each field as a search line: the input first (a placeholder of one space), then its label, which moves up in CSS", () => {
    for (const [name, label] of [["name", "What should I call you?"], ["email", "Your email address, to answer you"], ["message", "What would you like to talk about?"]] as const) {
      const input = html.search(new RegExp(`<(input|textarea)[^>]*name="${name}"`));
      const tag = html.slice(input, html.indexOf(">", input));
      expect(tag).toContain('placeholder=" "');
      expect(html.indexOf(`>${label}</label>`)).toBeGreaterThan(input);
    }
  });

  it("has no address to write to: no mailto, tel, address or e-mail text (the form is the way)", () => {
    expect(html).not.toMatch(/mailto:|tel:|sms:/i);
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(/@/);
  });

  it("escapes text: markup in a field is displayed, never interpreted", () => {
    const h = render({ ...demo, summary: "<script>alert(1)</script> & more" });
    expect(h).not.toContain("<script>alert");
    expect(h).toContain("&lt;script&gt;");
  });

  it("opens external links with rel noopener and only https", () => {
    const externals = [...html.matchAll(/<a [^>]*href="(https?:[^"]+)"[^>]*>/g)];
    expect(externals.length).toBeGreaterThan(2);
    for (const m of externals) {
      expect(m[1]).toMatch(/^https:/);
      expect(m[0]).toContain("noopener");
    }
  });
});

describe("a position's highlights", () => {
  it("lose their dash and indent when there is only one (it reads as a sentence, not a list)", () => {
    const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.career-highlights li:only-child\s*\{[^}]*padding-left:\s*0/);
    expect(css).toMatch(/\.career-highlights li:only-child::before\s*\{[^}]*content:\s*none/);
  });
});
