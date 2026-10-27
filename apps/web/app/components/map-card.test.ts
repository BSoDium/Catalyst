import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MAP_CARD } from "~/lib/map-card";
import { AttributionButton } from "./attribution-button";
import { DevContentBadge } from "./dev-content-badge";

const OFM = { primaryUrl: "https://tiles.openfreemap.org/planet", fallbackPmtilesUrl: null };
const credits = (props: Partial<Parameters<typeof AttributionButton>[0]> = {}) =>
  renderToStaticMarkup(createElement(AttributionButton, { tiles: OFM, insetRight: 0, reducedMotion: false, ...props }));

describe("map card and credits", () => {
  it("the dev badge carries every class of the shared card (border, plate, padding, radius, mono type)", () => {
    const badge = renderToStaticMarkup(createElement(DevContentBadge, { mode: "preview" }));
    for (const cls of MAP_CARD.split(" ")) expect(badge, cls).toContain(cls);
    expect(MAP_CARD).toMatch(/font-mono/);
    expect(MAP_CARD).toMatch(/border-border(?!-)/);
  });
  it("the credits are not a card: the mono type of one, on a map label's own ground (`.map-credits`), with no border and no blur of its own", () => {
    const card = /<div[^>]*data-attribution="card"[^>]*>/.exec(credits())![0];
    for (const cls of ["map-credits", "font-mono", "text-[10px]", "leading-4", "tracking-wide", "rounded-sm", "px-1.5", "py-px"]) expect(card, cls).toContain(cls);
    expect(card).not.toMatch(/\bborder\b|border-border|bg-background|backdrop-blur/);
  });
});

describe("credits line", () => {
  it("is one line of real text with the main contributors, from the same list as the dialog (the licence's 'contributors' is drawn on a screen from 480 px below md, where the line has room for it)", () => {
    const html = credits();
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toBe("© OpenStreetMap contributors · OpenFreeMap · Natural Earth·See more");
    expect(html).toContain("select-text");
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("whitespace-nowrap");
  });
  it("has one more middle dot, between the last credit and the button, outside the clipped text and hidden from assistive technology", () => {
    const html = credits();
    expect(html).toMatch(/<\/p><span aria-hidden="true" class="[^"]*shrink-0[^"]*">·<\/span><button/);
    expect(html.split("·").length - 1).toBe(3); // two between the three credits, one before "See more"
    // the line itself keeps clipping rather than wrapping: the dot is not inside it
    const line = /<p[^>]*>.*?<\/p>/.exec(html)![0];
    expect(line).toContain("overflow-hidden");
    expect(line.split("·").length - 1).toBe(2);
  });
  it("follows the tile configuration", () => {
    expect(credits({ tiles: null }).replace(/<[^>]+>/g, "")).toBe("Natural Earth·See more");
    expect(credits({ tiles: { primaryUrl: "https://t.example/x.pmtiles", fallbackPmtilesUrl: null } }).replace(/<[^>]+>/g, "")).toBe("© OpenStreetMap contributors · Protomaps · Natural Earth·See more");
  });
  it("sits bottom right, left of the detail panel, never wider than the room that leaves", () => {
    const html = credits({ insetRight: 720 });
    expect(html).toContain("--credits-inset:720px");
    expect(html).toContain("right-[calc(var(--credits-inset)+0.5rem)]");
    expect(html).toContain("max-w-[calc(100%-var(--credits-inset)-1rem)]");
    expect(html).toContain("env(safe-area-inset-bottom)");
  });
  it("the button has a name that contains its visible label, opens a dialog, has the up-right arrow", () => {
    const html = credits();
    const button = /<button[^>]*>.*?<\/button>/.exec(html)![0];
    expect(button).toContain('aria-label="See more credits"');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain("See more");
    expect(button).toContain("lucide-arrow-up-right");
    expect(button).toContain('aria-hidden="true"');
  });
  it("is drawn on a phone too, the full width, left-aligned and still ONE line: clipped, never wrapped", () => {
    const html = credits();
    const card = /<div[^>]*data-attribution="card"[^>]*>/.exec(html)![0];
    expect(card).not.toContain("max-md:hidden");
    for (const cls of ["max-md:left-2", "max-md:right-2", "max-md:max-w-none"]) expect(card, cls).toContain(cls);
    expect(card).not.toContain("max-md:block");
    expect(card).toContain("env(safe-area-inset-bottom)");
    expect(card).toContain("z-20");
    const line = /<p[^>]*>/.exec(html)![0];
    expect(line).toContain("h-4");
    expect(line).toContain("overflow-hidden");
    expect(line).not.toContain("max-md:");
    expect(/<button[^>]*>/.exec(html)![0]).toContain("after:-inset-y-3");
    expect(html).toContain('<span class="max-[479px]:hidden md:hidden"> contributors</span>');
  });
  it("keeps the dim colour at full opacity and raises it on hover and keyboard focus", () => {
    const html = credits();
    expect(html).toContain("text-subtle-foreground");
    expect(html).toContain("hover:text-foreground");
    expect(html).toContain("focus-visible:text-foreground");
    expect(html).not.toMatch(/class="[^"]*\bopacity-/);
  });
});

it("has one dialog and one button wired to it (no second control for the phone)", () => {
  const src = readFileSync(new URL("./attribution-button.tsx", import.meta.url), "utf8");
  expect(src.match(/<CreditsDialog/g)).toHaveLength(1);
  expect(src.match(/onClick=\{\(\) => setOpen\(true\)\}/g)).toHaveLength(1);
  expect(credits()).not.toContain('data-attribution="compact"');
});
