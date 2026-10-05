/**
 * Pointer controls for the canvas: drag to rotate (with inertia handled by the host), wheel and pinch to
 * zoom, tap or click to select. There is deliberately no keyboard handling: the canvas is not focusable and the
 * place list is the accessible path.
 *
 * `touch-action: none` is set on the canvas only, so a finger that starts anywhere else (list, panel, page)
 * still scrolls normally.
 */
import type { DragSample } from "./motion";

export type PointerKind = "mouse" | "touch";

export interface ControlsHost {
  /** A new gesture started: cancel flights and inertia. */
  stopMotion(): void;
  panPixels(dx: number, dy: number): void;
  /** Zoom by `dLog2` zoom levels (positive zooms in). */
  zoomBy(dLog2: number): void;
  fling(samples: readonly DragSample[], now: number): void;
  /** Place under a container-relative CSS-px point (labels first, then markers), or null. */
  pickAt(x: number, y: number, kind: PointerKind): string | null;
  select(slug: string): void;
}

const TAP_SLOP: Record<PointerKind, number> = { mouse: 4, touch: 8 };
const kindOf = (e: PointerEvent): PointerKind => (e.pointerType === "touch" ? "touch" : "mouse");

interface Drag {
  moved: number;
  samples: DragSample[];
  /** A second pointer joined at some point: never a tap, never a fling. */
  multi: boolean;
}

export function attachControls(canvas: HTMLCanvasElement, container: HTMLElement, host: ControlsHost): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: Drag | null = null;
  let pinchDist = 0;
  const cleanups: (() => void)[] = [];

  const on = <K extends keyof HTMLElementEventMap>(
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ) => {
    canvas.addEventListener(type, fn as EventListener, opts);
    cleanups.push(() => canvas.removeEventListener(type, fn as EventListener, opts));
  };

  const local = (e: MouseEvent) => {
    const r = container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pinchDistance = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  on("pointerdown", (e) => {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // The pointer may already be gone; the gesture still works without capture.
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    host.stopMotion();
    if (pointers.size === 1) drag = { moved: 0, samples: [], multi: false };
    if (pointers.size === 2) {
      pinchDist = pinchDistance();
      if (drag) drag.multi = true;
    }
    if (e.pointerType === "mouse") canvas.style.cursor = "grabbing";
  });

  on("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === "mouse") {
        const p = local(e);
        canvas.style.cursor = host.pickAt(p.x, p.y, "mouse") ? "pointer" : "grab";
      }
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const dist = pinchDistance();
      if (pinchDist > 0 && dist > 0) host.zoomBy(Math.log2(dist / pinchDist));
      pinchDist = dist;
      return;
    }
    if (!drag) return;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.samples.push({ t: e.timeStamp, dx, dy });
    if (drag.samples.length > 8) drag.samples.shift();
    host.panPixels(dx, dy);
  });

  const end = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    pinchDist = 0;
    if (e.pointerType === "mouse") canvas.style.cursor = "grab";
    // A finger lifted while another is still down: the remaining one must not start a drag from the pinch.
    if (pointers.size > 0 || !drag) return;
    const d = drag;
    drag = null;
    if (e.type !== "pointerup" || d.multi) return;
    const kind = kindOf(e);
    if (d.moved <= TAP_SLOP[kind]) {
      const p = local(e);
      const slug = host.pickAt(p.x, p.y, kind);
      if (slug) host.select(slug);
    } else {
      host.fling(d.samples, e.timeStamp);
    }
  };
  on("pointerup", end);
  on("pointercancel", end);

  on(
    "wheel",
    (e) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      // ctrlKey is how browsers report a trackpad pinch.
      host.zoomBy(-e.deltaY * unit * (e.ctrlKey ? 0.012 : 0.0016));
    },
    { passive: false },
  );

  return () => {
    for (const c of cleanups) c();
    cleanups.length = 0;
    pointers.clear();
  };
}
