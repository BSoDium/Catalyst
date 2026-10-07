/**
 * DEV ONLY: the synthetic line-connectivity harness of the regression gate (scripts/street/lines.mjs), run against the
 * production style and pixel pass. Same availability rules as /dev/street (see routes.ts).
 */
import { useEffect, useRef } from "react";
import { data } from "react-router";

export function loader() {
  if (!(import.meta.env.DEV || process.env.CATALYST_DEV_ROUTES === "1")) throw data("Not found", { status: 404 });
  return null;
}

export default function DevStreetLines() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let api: { dispose(): void } | null = null;
    let cancelled = false;
    // Replaced by `true` in the server build: the harness (MapLibre) is never bundled for SSR.
    if (import.meta.env.SSR) return;
    void import("~/globe/street/harness/synthetic").then((m) => {
      if (cancelled) return;
      const a = m.startSynthetic(el);
      api = a;
      (window as unknown as { __synthetic: unknown }).__synthetic = a;
      document.body.dataset.synthetic = "1";
    });
    return () => {
      cancelled = true;
      api?.dispose();
      delete (window as unknown as { __synthetic?: unknown }).__synthetic;
    };
  }, []);
  return <div ref={ref} className="fixed inset-0 bg-white" />;
}
