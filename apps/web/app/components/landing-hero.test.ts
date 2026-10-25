import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider, type StaticHandlerContext } from "react-router";
import { describe, expect, it } from "vitest";
import { createHeroMachine } from "~/lib/hero-machine";
import { SITE_FOCUS, SITE_IDENTITY, SITE_NAME, SITE_TAGLINE } from "~/lib/site";
import { LandingHero, NAME_TRAVEL_EASE, NAME_TRAVEL_MS } from "./landing-hero";

async function render(props: { away?: boolean; empty?: boolean; orbit?: boolean | null; hasCareer?: boolean } = {}, machine = createHeroMachine()): Promise<string> {
  const routes = [{ id: "routes/shell", path: "*", Component: () => createElement(LandingHero, { machine, away: props.away ?? false, empty: props.empty ?? false, orbit: props.orbit ?? null, hasCareer: props.hasCareer ?? false }) }];
  const handler = createStaticHandler(routes);
  const context = (await handler.query(new Request("http://localhost/"))) as StaticHandlerContext;
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToStaticMarkup(createElement(StaticRouterProvider, { router, context, hydrate: false }));
}

describe("LandingHero", () => {
  it("is the resting hero in the server's HTML, whatever the machine's state on the client (no flash of another state)", async () => {
    const machine = createHeroMachine();
    machine.interact();
    // `renderToStaticMarkup` reads the server snapshot, which is always the resting hero
    const html = await render({}, machine);
    expect(html).toContain('data-hero="rest"');
    expect(html).toContain('data-world="true"');
    machine.stop();
  });

  it("is the page's h1: the owner's name, the given name at the heavy end of the weight axis (800) and the family name at the thin end (200)", async () => {
    const html = await render();
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toMatch(
      /<h1 class="hero-name type-display-xl"><span class="hero-given">Elliot<\/span> <span class="hero-family type-thin"><span>Négrel<\/span><span><span class="hero-hyphen">-<\/span>Jerzy<\/span><\/span><\/h1>/,
    );
    const heading = /<h1[^>]*>(.*?)<\/h1>/.exec(html)?.[1]?.replace(/<[^>]+>/g, "");
    expect(heading).toBe(SITE_NAME);
    expect(SITE_NAME).toBe("Elliot Négrel-Jerzy");
  });

  it("says who the owner is from the published facts only, then how to use the page; with no place a line that does not point at an empty globe", async () => {
    const html = await render();
    // who the owner is, then what they work on: the second sentence is its own span, the first all that stays of the line in a very short window
    expect(html).toContain(`<p class="hero-intro">${SITE_IDENTITY}<span class="hero-intro-more"> ${SITE_FOCUS}</span></p>`);
    expect(`${SITE_IDENTITY} ${SITE_FOCUS}`).toBe(SITE_TAGLINE);
    expect(SITE_TAGLINE).toBe(
      "Front-end and UX software engineer based in Warsaw. Data visualisation, geospatial and cartography interfaces, design systems, computer graphics.",
    );
    // the how-to line: the globe is a script, so the part about it is marked and a no-script variant stands beside it
    expect(html).toContain('<p class="hero-hint"><span data-needs-script="">Drag the globe to explore and pick a place, or start</span><noscript>Start</noscript> from a list.</p>');
    const empty = await render({ empty: true });
    expect(empty).toContain('<p class="hero-hint">No place is published yet: start from a list.</p>');
    expect(empty).not.toContain("Drag the globe");
  });

  it("is the home page's primary navigation: the four lists in a nav landmark, with an icon each that is decoration", async () => {
    const html = await render();
    const nav = html.slice(html.indexOf('<nav aria-label="Primary" class="hero-list">'), html.indexOf("</nav>"));
    expect(nav).toContain("<ul>");
    expect(nav.match(/<svg/g)).toHaveLength(4);
    expect(nav.match(/aria-hidden="true"/g)?.length).toBe(4);
  });

  it("has a fifth row, \"Career\", after Poetry when the projection has a career document, in the same row style", async () => {
    const html = await render({ hasCareer: true });
    const nav = html.slice(html.indexOf('<nav aria-label="Primary" class="hero-list">'), html.indexOf("</nav>"));
    const rows = [...nav.matchAll(/<a [^>]*class="hero-row"[^>]*href="([^"]+)"[^>]*><span>([^<]+)<\/span>|<a [^>]*href="([^"]+)"[^>]*class="hero-row"[^>]*><span>([^<]+)<\/span>/g)].map((m) => [m[1] ?? m[3], m[2] ?? m[4]]);
    expect(rows).toEqual([["/software", "Software"], ["/articles", "Articles"], ["/artworks", "Artworks"], ["/poetry", "Poetry"], ["/career", "Career"]]);
    expect(nav.match(/<svg/g)).toHaveLength(5);
    expect(html).toContain('data-rows="5"');
    // still ONE primary navigation, and no count anywhere in the row
    expect(html.match(/aria-label="Primary"/g)).toHaveLength(1);
    expect(nav.replace(/<[^>]+>/g, "")).not.toMatch(/\d/);
  });

  it("has only the four rows, and no link to /career, when there is no career document", async () => {
    const html = await render();
    expect(html).not.toContain("/career");
    expect(html).toContain('data-rows="4"');
  });

  it("has a labelled search button that names the shortcut, then the four lists as links in order", async () => {
    const html = await render();
    const search = html.indexOf('data-slot="hero-search"');
    expect(search).toBeGreaterThan(0);
    const button = html.slice(html.lastIndexOf("<button", search), html.indexOf("</button>", search));
    expect(button).toContain("Search places and entries");
    // the search icon of the icon set, at the control size: not the old square bullet
    expect(button).toContain("<svg");
    expect(button).toContain('data-size="control"');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-keyshortcuts="Control+K Meta+K"');
    expect(button).toContain('type="button"');
    const links = [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>(?:<span>)?([^<]*)</g)].map((m) => [m[1], m[2]]);
    expect(links).toEqual([
      ["/software", "Software"],
      ["/articles", "Articles"],
      ["/artworks", "Artworks"],
      ["/poetry", "Poetry"],
    ]);
    // reading order: name, intro, search, the lists
    expect(html.indexOf("hero-name")).toBeLessThan(html.indexOf("hero-intro"));
    expect(html.indexOf("hero-intro")).toBeLessThan(search);
    expect(search).toBeLessThan(html.indexOf('href="/software"'));
  });

  it("shows no count, no number, no employer and no code name", async () => {
    const html = await render();
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/\d/);
    expect(html).not.toMatch(/catalyst/i);
  });

  it("is away, hidden from assistive technology and no second heading, while a place or entry is open", async () => {
    const html = await render({ away: true });
    expect(html).toContain('data-hero="away"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/<h1[ >]/);
    expect(html).toMatch(/<p class="hero-name type-display-xl">/);
  });

  it("keeps the small line (name and hint) as decoration: aria-hidden, a second name is not a second heading", async () => {
    const html = await render();
    const mini = html.slice(html.indexOf('<p aria-hidden="true" class="hero-mini">'));
    expect(mini).toContain("Drag to explore. Pause, and the page comes back.");
    // the same weights as the name: the given name heavy (the line's own 800), the family name at the thin end
    expect(mini).toMatch(/<span class="hero-mini-name"><span class="hero-mini-given">Elliot<\/span> <span class="hero-mini-family type-thin"><span>Négrel<\/span>/);
    expect(html.match(/<h[1-6][ >]/g)).toHaveLength(1);
  });
});

describe("the orbiting caption and the hero's how-to line", () => {
  it("keeps the line in the markup whatever the globe says (visually hidden by CSS while the caption says it): pending on the server, true with the type, false without it", async () => {
    for (const [orbit, attr] of [
      [null, "pending"],
      [true, "true"],
      [false, "false"],
    ] as const) {
      const html = await render({ orbit });
      expect(html).toContain(`data-orbit="${attr}"`);
      expect(html).toContain('<p class="hero-hint">');
    }
    // the empty archive has no globe to point at: never the caption
    expect(await render({ empty: true, orbit: true })).toContain('data-orbit="false"');
  });
});

describe("the name's travel and the collapsed name (owner, round 3, item 3)", () => {
  const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
  const src = readFileSync(new URL("./landing-hero.tsx", import.meta.url), "utf8");

  it("runs the CSS custom properties' duration and ease: 300 to 360 ms, a fast start and a soft landing", () => {
    expect(css).toMatch(/--hero-travel:\s*320ms;/);
    expect(css).toContain("--hero-travel-ease: cubic-bezier(0.2, 0.9, 0.1, 1);");
    expect(NAME_TRAVEL_MS).toBe(320);
    expect(NAME_TRAVEL_EASE).toBe("cubic-bezier(0.2, 0.9, 0.1, 1)");
  });

  it("is a transform animation of the two halves: no font-size, layout or per-frame script", () => {
    expect(src).toContain("el.animate(");
    expect(src).not.toMatch(/requestAnimationFrame|setInterval/);
    // the keyframes: the start and the end, transform only
    expect([...src.matchAll(/\{ transform(?:: [^}]*)? \}/g)]).toHaveLength(2); // the start and the end of the travel, whichever way it goes (`lib/name-travel.test.ts` tests the choreography)
    expect(src).not.toContain('direction: "reverse"');
    expect(css).toMatch(/\.hero-given,\s*\.hero-family \{\s*display: inline-block;\s*transform-origin: 0 0;/);
  });

  it("has no second copy of the name to hand over to: the ghost line is never painted, and the h1 is not faded out when collapsed", () => {
    const ghost = css.slice(css.indexOf("  .hero-mini-name {"), css.indexOf("  .hero-mini-hint {"));
    expect(ghost).toContain("visibility: hidden;");
    // the pinned optical size: the ghost is the big name's drawing at another size, so a width ratio is a scale
    expect(ghost).toContain('font-variation-settings: "opsz" 96;');
    expect(css).not.toMatch(/\.landing-hero\[data-hero="collapsed"\] \.hero-name \{/);
    // the collapsed name is the halves held at the ghost's boxes
    expect(src).toContain("holdName(");
    expect(src).toContain("el.style.transform = transform");
    // born collapsed (back home from another page): held at the corner in the layout effect, before the first paint, not after it by the observer
    expect(src).toMatch(/first && state === "collapsed"\) holdName\(root, true\)/);
  });

  it("makes the collapsed name 40 to 48 px on a wide screen, and no smaller than 28 px on a phone", () => {
    expect(css).toContain("--hero-mini-size: clamp(1.75rem, 9.5vw, 2.75rem);");
  });

  it("is instant under reduced motion", () => {
    expect(src).toContain("prefers-reduced-motion: reduce");
  });
});

describe("coming back from away (a panel closed): nothing of the hero fades out of its resting look", () => {
  const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");

  it("has the collapsed styles on the parts that fade while the hero is away, so there is nothing to transition when it is shown again", () => {
    for (const part of [".hero-intro", ".hero-hint", ".hero-search", ".hero-list"]) {
      expect(css, part).toContain(`.landing-hero:is([data-hero="collapsed"], [data-hero="away"]) ${part}`);
    }
    expect(css).toContain('.landing-hero:is([data-hero="collapsed"], [data-hero="away"])::before');
  });
});

describe("the hero's CSS (app.css, 'Landing hero')", () => {
  const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf("Landing hero and the header's type"));
  const rule = (selector: string) => {
    const from = block.indexOf(`${selector} {`);
    return from < 0 ? "" : block.slice(from, block.indexOf("\n  }", from));
  };

  it("sits at the end of the file, after the other styles", () => {
    expect(css.indexOf("Landing hero and the header's type")).toBeGreaterThan(css.indexOf(".places-nav {"));
    expect(css.indexOf("Landing hero and the header's type")).toBeGreaterThan(css.indexOf(".nav-progress {"));
  });

  it("ignores the pointer except the search line and the rows, and lets the globe's credits (z 20) and the header (z 40) sit above it", () => {
    expect(rule(".landing-hero")).toContain("pointer-events: none");
    expect(rule(".landing-hero")).toMatch(/z-index: 10;/);
    expect(rule(".hero-search")).toContain("pointer-events: auto");
    expect(rule(".hero-row")).toContain("pointer-events: auto");
  });

  it("moves nothing but opacity and transform (and visibility, which follows the fade), with the token duration", () => {
    expect(block).toMatch(/transition-property: opacity, transform, visibility;/);
    expect(block).toContain("transition-duration: var(--duration-base), var(--duration-base), 0s;");
    expect(block).not.toMatch(/transition[^;]*\b(width|height|top|left|margin|padding|font-size)\b/);
    expect(block).not.toMatch(/@keyframes|animation:/);
  });

  it("turns every transition off under reduced motion", () => {
    expect(block).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.landing-hero \*,\s*\.landing-hero::before \{\s*transition: none !important;/);
  });

  it("uses the tokens: the accent only on the row's hover, the display and reading faces", () => {
    const uses = block.split("\n").filter((l) => l.includes("var(--signal)") && !l.includes("--signal-"));
    expect(uses).toHaveLength(1);
    expect(block).not.toContain("hero-bullet");
    expect(block).toMatch(/\.hero-row:hover,\s*\.hero-row:focus-visible \{\s*color: var\(--signal\);/);
    expect(rule(".hero-name")).not.toContain("--signal");
    expect(rule(".hero-intro")).toContain("font-family: var(--font-reading)");
    expect(rule(".hero-row")).toContain("font-family: var(--font-display)");
    expect(rule(".hero-search")).toContain("font-family: var(--font-meta)");
  });

  it("sets the name's heavy half on the given name and does not span the width: a share of it (--hero-span), the phone's family name fills it", () => {
    expect(rule(".hero-name")).not.toContain("type-thin");
    expect(css).toMatch(/--hero-span: 0\.7[0-5];/);
    expect(css).toMatch(/--hero-size: min\(calc\(100vw \* var\(--hero-span\) \/ var\(--hero-fit\)\), 33vh, 30rem\);/);
    // the phone's rule is the gutter-to-gutter fill
    expect(css).toMatch(/max-width: 47\.99rem\) \{\s*\.landing-hero \{[^}]*calc\(\(100vw - 2 \* var\(--hero-gutter\)\) \/ var\(--hero-fit\)\),\s*24vh,/);
    expect(rule(".hero-mini-name")).toContain("font-weight: var(--weight-heavy)");
  });

  it("fits the whole block in a short window: the stacked name's size takes the height that is left, and each short tier drops what it can", () => {
    // the stacked name is also capped by what the window leaves after the rest of the block (the figure per tier is in `--hero-fixed`)
    expect(css).toMatch(/--hero-fixed: 26\.5rem;/);
    // a fifth row (the career page) is one more 44 px target that the name gives up
    expect(css).toMatch(/\.landing-hero\[data-rows="5"\] \{\s*--hero-extra: 3\.5rem;/);
    expect(css).toMatch(/calc\(\(100dvh - var\(--hero-fixed\) - var\(--hero-extra, 0rem\) - var\(--hero-clear\) - env\(safe-area-inset-bottom, 0px\) - 1rem\) \/ 1\.9\)/);
    // up to 40 rem tall: no how-to line; up to 36 rem: the rows in two columns; a phone on its side: the wide layout in small
    expect(css).toMatch(/\(max-width: 47\.99rem\) and \(max-height: 40rem\) \{[^@]*--hero-fixed: 24\.5rem;[^@]*\.hero-hint \{\s*display: none;/);
    expect(css).toMatch(/\(max-width: 47\.99rem\) and \(max-height: 36rem\) \{[^@]*--hero-fixed: 17rem;[^@]*grid-template-columns: 1fr 1fr;/);
    expect(css).toMatch(/\(min-width: 30rem\) and \(max-width: 47\.99rem\) and \(max-height: 34rem\) \{[^@]*grid-template-areas:\s*"lead list"\s*"name name";/);
    // the very short ones keep who the owner is and drop what they work on
    expect(css).toMatch(/\.hero-intro-more \{\s*display: none;/);
  });

  it("draws the plate and the header's backdrop as solid canvas colour in forced colours (gradients and masks are dropped there)", () => {
    expect(css).toMatch(/@media \(forced-colors: active\) \{\s*\.landing-hero::before \{\s*background: Canvas;\s*background-image: none;\s*-webkit-mask-image: none;\s*mask-image: none;/);
    expect(css).toMatch(/\.nav-fade \{[^}]*background: Canvas;[^}]*mask-image: none;/);
  });

  it("hides what needs a script when there is none (`scripting: none`), and marks the search lines", async () => {
    expect(css).toMatch(/@media \(scripting: none\) \{\s*\[data-needs-script\] \{\s*display: none !important;/);
    expect(await render()).toMatch(/<button[^>]*data-needs-script=""[^>]*class="hero-search"|<button[^>]*class="hero-search"[^>]*data-needs-script=""/);
  });

  it("keeps the header's accent state at the text-safe token (these are under 24 px)", () => {
    expect(block).toMatch(/\.nav-link:hover,\s*\.nav-link:focus-visible \{\s*color: var\(--signal-text\);/);
  });
});
