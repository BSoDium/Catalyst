/**
 * The satellite ground's tile reader for one street map: a worker of its own where the browser has workers and an `OffscreenCanvas` (the whole reading is then off the main
 * thread: on a phone the classification and the encoding of a screenful of tiles is what the ground costs), the main thread otherwise.
 */
import { satelliteLevels } from "../core/satellite";
import { readSatelliteTile } from "./satellite-read";
import type { ReadRequest, WorkerReply, WorkerRequest } from "./satellite-worker";

export interface SatelliteReader {
  read(url: string, signal: AbortSignal): Promise<ArrayBuffer>;
  dispose(): void;
}

export function createSatelliteReader(): SatelliteReader {
  const canWork = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
  let worker: Worker | null = null;
  let next = 0;
  const waiting = new Map<number, { ok: (d: ArrayBuffer) => void; fail: (e: Error) => void }>();

  const start = (): Worker => {
    if (worker) return worker;
    worker = new Worker(new URL("./satellite-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if ("data" in e.data) w.ok(e.data.data);
      else w.fail(new Error(e.data.error));
    };
    worker.onerror = () => {
      for (const w of waiting.values()) w.fail(new Error("satellite worker failed"));
      waiting.clear();
    };
    return worker;
  };

  return {
    read(url, signal) {
      const levels = satelliteLevels();
      if (!canWork) return readSatelliteTile(url, signal, levels);
      const id = next++;
      return new Promise<ArrayBuffer>((ok, fail) => {
        signal.throwIfAborted();
        waiting.set(id, { ok, fail });
        const cancel = () => {
          if (!waiting.delete(id)) return;
          worker?.postMessage({ type: "cancel", id } satisfies WorkerRequest);
          fail(signal.reason ?? new DOMException("aborted", "AbortError"));
        };
        signal.addEventListener("abort", cancel, { once: true });
        start().postMessage({ type: "read", id, url, levels } satisfies ReadRequest);
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      for (const w of waiting.values()) w.fail(new Error("disposed"));
      waiting.clear();
    },
  };
}
