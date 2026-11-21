/**
 * The size of the render, in device pixels: the container's size times the pixel ratio (up to `maxPixelRatio`, 1 on a `lite` device), scaled down if the picture would have more than `maxPixels` pixels or a side longer than
 * `maxSize` (what the graphics card can make a texture of). Pure.
 */
export function renderSize(input: { cssWidth: number; cssHeight: number; devicePixelRatio: number; lite: boolean; maxPixelRatio?: number; maxPixels?: number; maxSize?: number }): { width: number; height: number; ratio: number } {
  const { cssWidth, cssHeight, lite, maxPixelRatio = 2, maxPixels = 8_000_000, maxSize = 8192 } = input;
  let ratio = lite ? 1 : Math.min(input.devicePixelRatio || 1, maxPixelRatio);
  const area = Math.max(1, cssWidth) * Math.max(1, cssHeight);
  ratio = Math.min(ratio, Math.sqrt(maxPixels / area), maxSize / Math.max(1, cssWidth, cssHeight));
  return { width: Math.max(1, Math.round(cssWidth * ratio)), height: Math.max(1, Math.round(cssHeight * ratio)), ratio };
}
