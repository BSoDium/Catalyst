/** The satellite ground's tile reader, off the main thread: the fetch, the decoding, the classification and the PNG encoding all happen here (`satellite-read.ts`). */
import { readSatelliteTile } from "./satellite-read";

export interface ReadRequest {
  type: "read";
  id: number;
  url: string;
  levels: readonly number[];
}
export interface CancelRequest {
  type: "cancel";
  id: number;
}
export type WorkerRequest = ReadRequest | CancelRequest;
export type WorkerReply = { id: number; data: ArrayBuffer } | { id: number; error: string; status?: number };

const pending = new Map<number, AbortController>();
const scope = self as unknown as { postMessage(m: WorkerReply, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null };

scope.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "cancel") {
    pending.get(m.id)?.abort();
    return;
  }
  const ctl = new AbortController();
  pending.set(m.id, ctl);
  try {
    const data = await readSatelliteTile(m.url, ctl.signal, m.levels);
    scope.postMessage({ id: m.id, data }, [data]);
  } catch (err) {
    scope.postMessage({ id: m.id, error: String((err as Error)?.message ?? err), ...(typeof (err as { status?: number }).status === "number" ? { status: (err as { status: number }).status } : {}) });
  } finally {
    pending.delete(m.id);
  }
};
