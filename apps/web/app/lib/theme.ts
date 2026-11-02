import { useSyncExternalStore } from "react";
import { SCHEME_EVENT, currentScheme, onSchemeChange } from "~/globe";
import { THEME_COLORS } from "~/lib/site";

export { currentScheme, onSchemeChange, SCHEME_EVENT };

/**
 * The colour scheme the visitor chose (#507): `light`, `dark`, or `system` (the OS's, which the page followed alone until then). A forced scheme is the root's
 * `data-scheme` attribute, which the stylesheet already honours (the token blocks `:root[data-scheme=...]`, and the few component rules that were media queries);
 * `system` has no attribute. The choice is kept in localStorage and put on the root before the first paint by `public/theme-boot.js`; a change is announced on `window`
 * (`SCHEME_EVENT`) so that what draws its own colours (the globe, the street map) reads them again, as it does when the OS changes.
 */
export type ThemeChoice = "light" | "dark" | "system";

export const THEME_KEY = "theme";
export const THEME_CHOICES: readonly ThemeChoice[] = ["light", "dark", "system"];

export const THEME_LABELS: Record<ThemeChoice, { title: string; sub: string }> = {
  light: { title: "Light theme", sub: "Dark ink on a pale page" },
  dark: { title: "Dark theme", sub: "Pale ink on a dark page" },
  system: { title: "System theme", sub: "Follow the device's setting" },
};

/** The words that bring the theme rows up in the palette (they are also listed while nothing is typed). */
const THEME_WORDS = ["theme", "dark", "light", "system", "mode", "appearance", "night", "day", "color", "colour", "scheme", "contrast", "auto", "device"];

/** Whether a query asks for the theme: a word of it starts with one of the theme's words, or one of them starts with it (at least two letters: "li" for "light"). Pure. */
export function matchesTheme(query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  return words.every((w) => w.length >= 2 && THEME_WORDS.some((t) => t.startsWith(w) || w.startsWith(t)));
}

/** What each choice is called besides its name: the palette lists first the one a query is about ("dark" puts the dark theme first, "auto" the system's). */
const THEME_KEYWORDS: Record<ThemeChoice, readonly string[]> = {
  light: ["light", "day", "bright", "white"],
  dark: ["dark", "night", "black"],
  system: ["system", "auto", "automatic", "device", "os"],
};

/** The three choices, those a query is about first (the order light, dark, system otherwise). Pure. */
export function rankThemes(query: string): ThemeChoice[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  const about = (c: ThemeChoice) => words.some((w) => THEME_KEYWORDS[c].some((k) => k.startsWith(w) || w.startsWith(k)));
  return [...THEME_CHOICES].sort((a, b) => Number(about(b)) - Number(about(a)));
}

/** The choice kept on this device; `system` where there is none or no storage. */
export function readThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/**
 * Take the choice: the root's attribute, the browser UI's colour, the storage, and the event. `system` removes the attribute and the kept choice. Returns whether the
 * page's scheme changed (what the click sound is for).
 */
export function setThemeChoice(choice: ThemeChoice): boolean {
  const before = currentScheme();
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-scheme");
  else root.setAttribute("data-scheme", choice);
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* not kept */
  }
  const after = currentScheme();
  // the browser's own UI: the page colour of the scheme in force (with `system`, the two media metas of the document decide again)
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  metas.forEach((m, i) => {
    if (choice === "system") m.setAttribute("content", i === 0 ? THEME_COLORS.light : THEME_COLORS.dark);
    else m.setAttribute("content", THEME_COLORS[choice]);
  });
  window.dispatchEvent(new Event(SCHEME_EVENT));
  return before !== after;
}

const forcedNow = (): ThemeChoice => {
  const v = typeof document !== "undefined" ? document.documentElement.getAttribute("data-scheme") : null;
  return v === "light" || v === "dark" ? v : "system";
};

/**
 * The scheme the visitor forced (`light` or `dark`), or `system`: for what a media query cannot decide, a picture that has a dark variant (the portrait of the career page). The server and
 * the first render of the client say `system` (the markup is the same for everyone); the choice comes in at once after.
 */
export function useForcedScheme(): ThemeChoice {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener(SCHEME_EVENT, fn);
      return () => window.removeEventListener(SCHEME_EVENT, fn);
    },
    forcedNow,
    () => "system",
  );
}
