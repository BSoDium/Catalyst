export const MAX_SVG_BYTES: number;
export const MEDIA_DIR: string;
export interface DemoImage {
  name: string;
  size: readonly [number, number];
  motif: string;
  plate: "dark" | "light";
  opts: Record<string, unknown>;
  alt: string;
}
export const MEDIA: readonly DemoImage[];
export function renderImage(image: DemoImage): string;
export function mediaSrc(name: string): string;
export function mediaByName(name: string): DemoImage;
