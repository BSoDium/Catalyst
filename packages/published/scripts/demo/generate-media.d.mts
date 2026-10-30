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
export interface StockImage {
  name: string;
  file: string;
  size: readonly [number, number];
  alt: string;
  credit: string;
  source: string;
}
export const STOCK: readonly StockImage[];
export function renderImage(image: DemoImage): string;
export function mediaSrc(name: string): string;
export function mediaByName(name: string): DemoImage;
