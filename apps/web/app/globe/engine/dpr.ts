/**
 * Calls `onChange` whenever `devicePixelRatio` changes (browser zoom, moving the window to another display).
 * There is no DPR event; a `resolution` media query for the current value fires once when it stops matching,
 * and is re-armed each time.
 */
export function watchDevicePixelRatio(onChange: () => void): () => void {
  let query: MediaQueryList | null = null;
  const handler = () => {
    onChange();
    arm();
  };
  const arm = () => {
    query?.removeEventListener("change", handler);
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener("change", handler, { once: true });
  };
  arm();
  return () => query?.removeEventListener("change", handler);
}
