import { describe, expect, it } from "vitest";
import { publishedCoverSchema } from "@catalyst/schemas";
import { coverImageProps } from "./cover-image";

const full = { src: "/media/a/full.webp", width: 1280, height: 853 };
const small = { src: "/media/a/small.webp", width: 640, height: 427 };

describe("coverImageProps", () => {
  it("is the plain src without a small copy", () => {
    expect(coverImageProps(full, "100vw")).toEqual({ src: full.src });
  });
  it("offers both files with their widths when there is a small copy", () => {
    expect(coverImageProps({ ...full, small }, "50vw")).toEqual({
      src: full.src,
      srcSet: "/media/a/small.webp 640w, /media/a/full.webp 1280w",
      sizes: "50vw",
    });
  });
  it("ignores a small copy that is not a safe media path", () => {
    expect(coverImageProps({ ...full, small: { ...small, src: "https://x.test/a.webp" } }, "50vw")).toEqual({ src: full.src });
  });
});

describe("publishedCoverSchema small", () => {
  const base = { alt: "A picture" };
  it("accepts a small copy next to the cover's own size", () => {
    expect(publishedCoverSchema.safeParse({ ...base, ...full, small }).success).toBe(true);
  });
  it("rejects a small copy without the cover's size, or with extra keys", () => {
    expect(publishedCoverSchema.safeParse({ ...base, src: full.src, small }).success).toBe(false);
    expect(publishedCoverSchema.safeParse({ ...base, ...full, small: { ...small, alt: "x" } }).success).toBe(false);
    expect(publishedCoverSchema.safeParse({ ...base, ...full, small: { src: small.src } }).success).toBe(false);
  });
});
