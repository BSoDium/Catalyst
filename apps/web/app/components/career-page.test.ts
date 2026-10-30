import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published";
import type { PublishedCareer } from "@catalyst/schemas";
import { CareerPage } from "./career-page";

const demo = loadDemoProjection().career!;
const render = (career: PublishedCareer, places: string[] = ["paris"]) =>
  renderToStaticMarkup(createElement(StaticRouter, { location: "/career" }, createElement(CareerPage, { career, places })));
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
    expect(html).toMatch(/<h1[^>]*>Elliot Négrel-Jerzy<\/h1>/);
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

  it("offers the contact form: a head button that links to it, the form before the socials", () => {
    expect(html).toMatch(/<a [^>]*href="#contact"[^>]*>\s*Get in touch/);
    const form = html.indexOf('id="contact"');
    expect(form).toBeGreaterThan(html.indexOf('data-slot="career-skills"'));
    expect(form).toBeLessThan(html.indexOf('data-slot="career-links"'));
    for (const label of ["Name", "Email", "Message"]) expect(html).toMatch(new RegExp(`<label[^>]*>${label}</label>`));
    expect(html).toContain('name="botcheck"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Send message/); // until the page is hydrated
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
