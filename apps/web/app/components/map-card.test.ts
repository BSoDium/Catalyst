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

describe("map card: the dev badge and the credits line are one object", () => {
  it("both carry every class of the shared card (border, plate, padding, radius, mono type)", () => {
    const badge = renderToStaticMarkup(createElement(DevContentBadge, { mode: "preview" }));
    const line = credits();
    for (const cls of MAP_CARD.split(" ")) {
      expect(badge, cls).toContain(cls);
      expect(line, cls).toContain(cls);
    }
    expect(MAP_CARD).toMatch(/font-mono/);
    expect(MAP_CARD).toMatch(/border-border(?!-)/);
  });
});

describe("credits line", () => {
  it("is one line of real text with the main contributors, from the same list as the dialog", () => {
    const html = credits();
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toBe("© OpenStreetMap · OpenFreeMap · Natural Earth·See more");
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
    expect(credits({ tiles: { primaryUrl: "https://t.example/x.pmtiles", fallbackPmtilesUrl: null } }).replace(/<[^>]+>/g, "")).toBe("© OpenStreetMap · Protomaps · Natural Earth·See more");
  });
  it("sits bottom right, left of the detail panel, never wider than the room that leaves", () => {
    const html = credits({ insetRight: 720 });
    expect(html).toContain("right:calc(720px + 0.5rem)");
    expect(html).toContain("max-width:calc(100% - 720px - 1rem)");
    expect(html).toContain("env(safe-area-inset-bottom)");
  });
  it("the button has a name that contains its visible label, opens a dialog, has the up-left arrow and a 44 px target on phones", () => {
    const html = credits();
    const button = /<button[^>]*>.*?<\/button>/.exec(html)![0];
    expect(button).toContain('aria-label="See more credits"');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain("See more");
    expect(button).toContain("lucide-arrow-up-left");
    expect(button).toContain('aria-hidden="true"');
    // 16 px of text plus 2 x 14 px of invisible extension is 44 px, only below md
    expect(button).toContain("max-md:after:-inset-y-3.5");
  });
  it("keeps the dim colour at full opacity and raises it on hover and keyboard focus", () => {
    const html = credits();
    expect(html).toContain("text-subtle-foreground");
    expect(html).toContain("hover:text-foreground");
    expect(html).toContain("focus-visible:text-foreground");
    expect(html).not.toMatch(/class="[^"]*\bopacity-/);
  });
});

describe("credits dialog", () => {
  it("uses the soft hairline of the card, not the strong border of outlined buttons", () => {
    const src = readFileSync(new URL("./credits-dialog.tsx", import.meta.url), "utf8");
    expect(src).not.toContain("border-border-strong");
    expect(src).toMatch(/rounded-md border border-border bg-background/);
    expect(src).toMatch(/variant="outline"[^>]*className="border-border"/);
  });
});
