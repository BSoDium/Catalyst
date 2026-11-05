/**
 * Whether the type over a picture is to be light or dark: from how bright the picture is where the type is (the place panel's carousel, components/place-gallery.tsx). The label has a
 * soft dome behind it that makes it readable; on a picture that is not the page's own colour it is the colour that suits the picture, black over a dark one and white over a light one.
 */
export type Tone = "dark" | "light";

/** The part of the picture that lies under the label: the bottom `fraction` of what is seen of it (`object-fit: cover` in a box of this size, centred), in the picture's own pixels. */
export function labelRegion(natural: { width: number; height: number }, box: { width: number; height: number }, fraction: number) {
  const scale = Math.max(box.width / natural.width, box.height / natural.height);
  const seenW = Math.min(natural.width, box.width / scale);
  const seenH = Math.min(natural.height, box.height / scale);
  const x = (natural.width - seenW) / 2;
  const y = (natural.height - seenH) / 2 + seenH * (1 - fraction);
  return { x, y, width: seenW, height: seenH * fraction };
}

/** The mean brightness, 0 (black) to 1 (white), of RGBA pixels (the Rec. 709 weights on the encoded values, which is what the eye is shown on a screen). */
export function brightness(pixels: ArrayLike<number>): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3]! / 255;
    if (alpha === 0) continue;
    sum += (0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!) / 255;
    n++;
  }
  return n === 0 ? 0.5 : sum / n;
}

/** Dark where the picture is darker than the middle grey. */
export const toneOf = (level: number): Tone => (level < 0.5 ? "dark" : "light");

/** The tone under the label of an image that has loaded, or null when it cannot be read (a picture from another origin taints the canvas). */
export function imageTone(img: HTMLImageElement, fraction = 0.34): Tone | null {
  if (!img.naturalWidth || !img.clientWidth || !img.clientHeight) return null;
  try {
    const r = labelRegion({ width: img.naturalWidth, height: img.naturalHeight }, { width: img.clientWidth, height: img.clientHeight }, fraction);
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 8;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height);
    return toneOf(brightness(ctx.getImageData(0, 0, canvas.width, canvas.height).data));
  } catch {
    return null;
  }
}
