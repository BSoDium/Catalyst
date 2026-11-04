import { describe, expect, it } from "vitest";
import { placeCover } from "./place-cover";

const cover = (src: string) => ({ src, alt: src, width: 800, height: 600 });
const entry = (kind: string, slug: string, extra: object = {}) => ({ kind, slug, href: `/${kind}/${slug}`, title: slug, cover: cover(`/media/${slug}.jpg`), ...extra }) as never;
const group = (kind: string, ...entries: unknown[]) => ({ kind, label: kind, entries }) as never;

describe("placeCover", () => {
  it("is the place's own first image before any entry's", () => {
    const c = placeCover({ images: [cover("/media/own.jpg")], entries: [group("photograph", entry("photograph", "p"))] });
    expect(c).toMatchObject({ src: "/media/own.jpg", width: 800, height: 600 });
    expect(c?.own).toBe(true);
  });
  it("else a photograph's cover, then a poem's, an article's, an artwork's and last a project's", () => {
    const entries = [group("project", entry("project", "proj")), group("artwork", entry("artwork", "art")), group("photograph", entry("photograph", "photo"))];
    expect(placeCover({ images: [], entries })).toMatchObject({ src: "/media/photo.jpg", own: false });
    expect(placeCover({ images: [], entries: entries.slice(0, 2) })).toMatchObject({ src: "/media/art.jpg" });
    expect(placeCover({ images: [], entries: entries.slice(0, 1) })).toMatchObject({ src: "/media/proj.jpg" });
  });
  it("skips a sensitive entry and an entry with no cover, and is null when nothing is left", () => {
    const entries = [group("photograph", entry("photograph", "s", { sensitive: true }), entry("photograph", "none", { cover: undefined }))];
    expect(placeCover({ images: [], entries })).toBeNull();
    expect(placeCover({ images: [], entries: [] })).toBeNull();
  });
});
