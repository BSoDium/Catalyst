/**
 * One satellite tile, read: fetched, drawn at `SATELLITE_READ_SIZE`, classified pixel by pixel into the palette's fill encoding (core/satellite.ts) and encoded as a PNG.
 * Pure of the map and of the page, so it runs in a worker (`satellite-worker.ts`) or, where there is none, on the main thread (`satellite-source.ts`).
 */
import { SATELLITE_READ_SIZE, classifySatellite } from "../core/satellite";

export class SatelliteHttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
    this.name = "SatelliteHttpError";
  }
}

export async function readSatelliteTile(url: string, signal: AbortSignal, levels: readonly number[]): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new SatelliteHttpError(res.status);
  const bitmap = await createImageBitmap(await res.blob());
  const size = SATELLITE_READ_SIZE;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, size, size);
  bitmap.close();
  const img = ctx.getImageData(0, 0, size, size);
  classifySatellite(img.data, levels);
  ctx.putImageData(img, 0, 0);
  return (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
}
