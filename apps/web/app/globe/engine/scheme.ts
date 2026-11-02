/**
 * The colour scheme in force, for what draws its own colours (the globe, the street map): the root's forced `data-scheme` (the visitor's choice, `lib/theme.ts`), else the OS's
 * `prefers-color-scheme`. Both can change while the page is open: `onSchemeChange` says when. Pure DOM reads, no app code (the globe never imports the app).
 */
export const SCHEME_EVENT = "site:scheme";

export function currentScheme(): "light" | "dark" {
  const forced = typeof document !== "undefined" ? document.documentElement.getAttribute("data-scheme") : null;
  if (forced === "light" || forced === "dark") return forced;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Call `fn` when the scheme may have changed: the OS's setting, or a choice announced on `window` (`SCHEME_EVENT`). Returns the way to stop. */
export function onSchemeChange(fn: () => void): () => void {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", fn);
  window.addEventListener(SCHEME_EVENT, fn);
  return () => {
    mq.removeEventListener("change", fn);
    window.removeEventListener(SCHEME_EVENT, fn);
  };
}
