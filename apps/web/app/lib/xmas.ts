/**
 * The Christmas Easter egg of the activity picture (dark theme): when it shows. `?xmas` (or `?xmas=1`) always shows it, `?xmas=0` never; otherwise it shows in the
 * Christmas season (1 December to 6 January) with a probability of `XMAS_CHANCE`, rolled once per browser session (so that the picture does not change from one page to the
 * next). It is not on all the time: it makes the picture a little less readable, and a surprise is rarer than a rule.
 */
export const XMAS_CHANCE = 0.25;

/** Whether `date` is in the Christmas season: 1 December to 6 January. */
export function isChristmasSeason(date: Date): boolean {
  const month = date.getMonth();
  return month === 11 || (month === 0 && date.getDate() <= 6);
}

const KEY = "activity-xmas-roll";

/** The roll of this session, a number from 0 to 1, kept in `storage` (a new one is drawn when there is none, or it cannot be kept). */
export function sessionRoll(storage: Pick<Storage, "getItem" | "setItem"> | null, random: () => number = Math.random): number {
  try {
    const kept = storage?.getItem(KEY);
    if (kept != null && kept !== "") {
      const n = Number(kept);
      if (Number.isFinite(n) && n >= 0 && n < 1) return n;
    }
  } catch {
    /* (storage refused: a new roll each time) */
  }
  const n = random();
  try {
    storage?.setItem(KEY, String(n));
  } catch {
    /* (nothing to do) */
  }
  return n;
}

export function xmasMode(search: string, now: Date = new Date(), storage: Pick<Storage, "getItem" | "setItem"> | null = null, random: () => number = Math.random): boolean {
  const params = new URLSearchParams(search);
  if (params.has("xmas")) {
    const v = params.get("xmas");
    return v !== "0" && v !== "false" && v !== "off";
  }
  return isChristmasSeason(now) && sessionRoll(storage, random) < XMAS_CHANCE;
}

/** `xmasMode` for the page being shown (it needs the browser: the address, the date and the session's storage). */
export function xmasNow(): boolean {
  if (typeof window === "undefined") return false;
  let storage: Storage | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    /* (no storage) */
  }
  return xmasMode(window.location.search, new Date(), storage);
}
