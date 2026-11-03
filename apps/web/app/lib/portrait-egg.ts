/**
 * The portrait's Easter egg (owner, 2026-11-03): now and then, the career page's portrait has a blue screen of death for a face (`career.portrait.egg`, docs/career-page.md). The draw is made at every load of the page (a
 * reload rolls again), in the browser only (the server's page is always the plain portrait, so that it is the same for every visitor and for the cache), and a moment after the page is in, so that the plain portrait is seen first.
 */
export const PORTRAIT_EGG = {
  /** The odds at each load (about one in thirty-three). */
  chance: 0.03,
  /** How long the plain portrait is seen before it crashes, ms. */
  delayMs: 1400,
  /** The query that forces it (a visitor, or the owner on a phone: `/career?bsod`). */
  param: "bsod",
  /** The alt text of the egg's picture. */
  alt: "The same portrait, with a Windows blue screen of death where the face is: a joke",
} as const;

/** Whether this load has the egg: by the page's query when it asks (`?bsod`, `?bsod=0` never), else by chance (`roll`: a number in [0, 1), the browser's own by default). */
export function portraitEggDrawn(search: string, roll: number = Math.random()): boolean {
  const asked = new URLSearchParams(search).get(PORTRAIT_EGG.param);
  if (asked !== null) return asked !== "0" && asked !== "false";
  return roll < PORTRAIT_EGG.chance;
}
