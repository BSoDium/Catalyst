import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { EntryCard } from "./entry-card";
import { SensitiveImage, SensitiveMedia, SensitiveMediaScope } from "./sensitive-media";

const img = createElement("img", { src: "/media/demo/c.svg", alt: "An authored alt text" });
const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const media = (props: { revealed?: boolean; onRevealedChange?: () => void }) => createElement(SensitiveMedia, { ...props, children: img });
const image = (key?: number) => createElement(SensitiveImage, { key, children: img });
const scope = (sensitive: boolean, children: ReturnType<typeof image>[]) => createElement(SensitiveMediaScope, { sensitive, children });

describe("SensitiveMedia", () => {
  it("is hidden in the server render: a data attribute (no script needed) over the blurred picture, labelled 'Mature content'", () => {
    const out = html(media({ revealed: false, onRevealedChange: () => {} }));
    expect(out).toContain('data-slot="sensitive-media"');
    expect(out).toContain('data-state="hidden"');
    expect(out).toContain('class="sensitive-media-content"><img');
    // (the words lie straight on the picture: no plate; where there is no control yet they say it is hidden)
    expect(out).toContain('data-slot="sensitive-media-label"');
    expect(out).toContain("Image hidden");
    expect(out).not.toContain("sensitive-media-plate");
    // the alt text stays as authored
    expect(out).toContain('alt="An authored alt text"');
  });
  it("says the image is hidden where there is nothing to press yet (server render, no scripts) and draws no button then", () => {
    const out = html(media({ onRevealedChange: () => {} }));
    expect(out).toContain("Image hidden");
    expect(out).not.toContain("<button");
    expect(out).not.toContain("Show image");
    // and the live status is not drawn before the control is
    expect(out).not.toContain('role="status"');
  });
  it("a card (no control) is blurred for good: the label only, not interactive, never a button or a note", () => {
    const out = html(media({}));
    expect(out).toContain('data-state="hidden"');
    expect(out).not.toContain("data-interactive");
    expect(out).not.toContain("<button");
    expect(out).not.toContain("sensitive-media-note");
    expect(out).toContain("Mature content");
  });
  it("shows the same markup, revealed, only by the attribute (the picture is never swapped)", () => {
    const hidden = html(media({ revealed: false, onRevealedChange: () => {} }));
    const shown = html(media({ revealed: true, onRevealedChange: () => {} }));
    // (revealed, the veil is gone: the picture's own markup is the same, and nothing swapped it)
    const content = (out: string) => out.slice(out.indexOf('<div class="sensitive-media-content">'), out.indexOf("</div>", out.indexOf('<div class="sensitive-media-content">')));
    expect(content(shown)).toBe(content(hidden));
    expect(shown).not.toContain("sensitive-media-veil");
  });
});

describe("SensitiveMediaScope and SensitiveImage", () => {
  it("blurs the images of a sensitive entry, each with its own control, and nothing outside the scope", () => {
    const out = html(scope(true, [image(0), image(1)]));
    expect((out.match(/data-slot="sensitive-media"/g) ?? []).length).toBe(2);
    expect((out.match(/data-state="hidden"/g) ?? []).length).toBe(2);
    const bare = html(image());
    expect(bare).toBe(html(img));
  });
  it("draws the images as they are when the entry is not sensitive", () => {
    const out = html(scope(false, [image()]));
    expect(out).toBe(html(img));
  });
});

describe("EntryCard with a sensitive image", () => {
  const card = (sensitive: boolean, orientation: "vertical" | "horizontal" = "vertical") =>
    html(
      createElement(
        StaticRouter,
        { location: "/" },
        createElement(EntryCard, { kind: "artwork", title: "T", href: "/artworks/t", image: { src: "/media/demo/c.svg", alt: "Alt" }, sensitive, orientation }),
      ),
    );

  it("blurs the cover and labels it, with no control: the visitor opens the entry to reveal", () => {
    const out = card(true);
    expect(out).toContain('data-state="hidden"');
    expect(out).toContain("Mature content");
    expect(out).not.toContain("<button");
    expect(out).not.toContain("data-interactive");
    // still one link, the title
    expect((out.match(/<a /g) ?? []).length).toBe(1);
    expect(out).toContain('alt="Alt"');
  });
  it("blurs the horizontal card of the place panel as well, and keeps its `@md` rule outside the frame (the frame is a size container)", () => {
    const out = card(true, "horizontal");
    expect(out).toContain('data-state="hidden"');
    expect(out).toMatch(/class="sensitive-media @md:h-full"/);
    // the picture inside the frame has no container variant of its own: it would query the frame
    const inner = out.slice(out.indexOf('class="sensitive-media-content"'), out.indexOf("</div>", out.indexOf('class="sensitive-media-content"')));
    expect(inner).not.toContain("@md:");
  });
  it("is unchanged for an ordinary card", () => {
    const out = card(false);
    expect(out).not.toContain("sensitive-media");
    expect(out).not.toContain("Mature content");
  });
});
