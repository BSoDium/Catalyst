/**
 * What this browser remembers about visits, for the home screen's rare easter egg (engine/cinematic.ts): a one-bit note on the device, never sent
 * anywhere. Kept apart from the rest of the engine so the root route can note a visit without pulling the globe into the main chunk.
 */

const SEEN_KEY = "site-seen";
const VISIT_KEY = "site-visit";
const PLAYED_KEY = "site-egg";
/** The seed of this session's draw (`sessionStorage`), and when the egg last played (`localStorage`, a time in ms). */
const SEED_KEY = "site-egg-seed";
const LAST_KEY = "site-egg-last";

/** How long the egg rests on a device after it has played: a visitor who has seen it is not shown it again by chance for this long. */
export const EGG_REST_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether this browser has been here in an EARLIER session, whether the egg already played in this one, and whether it has rested (not played
 * on this device for `EGG_REST_DAYS`). A one-bit note kept on the device and
 * never sent anywhere (`localStorage`: it was seen; `sessionStorage`: what this session found, so that a reload does not turn a first visit into a
 * return). Idempotent within a session, so any page may call it first. Storage that is refused or throws: not a returning visitor (no proof, no egg).
 */
export function visitState(
  local: Pick<Storage, "getItem" | "setItem"> | null,
  session: Pick<Storage, "getItem" | "setItem"> | null,
  now: number = Date.now(),
): { returning: boolean; played: boolean; rested: boolean } {
  try {
    if (!local || !session) return { returning: false, played: false, rested: false };
    let found = session.getItem(VISIT_KEY);
    if (found === null) {
      found = local.getItem(SEEN_KEY) !== null ? "returning" : "new";
      session.setItem(VISIT_KEY, found);
    }
    // (noted on every visit, whichever page it lands on: the next session is a return)
    if (local.getItem(SEEN_KEY) === null) local.setItem(SEEN_KEY, "1");
    const last = Number(local.getItem(LAST_KEY));
    // (a time in the future, or one that is not a number, is a damaged note: it counts as rested, never as a lock for good)
    const rested = !(last > 0 && last <= now && now - last < EGG_REST_DAYS * DAY_MS);
    return { returning: found === "returning", played: session.getItem(PLAYED_KEY) === "1", rested };
  } catch {
    return { returning: false, played: false, rested: false };
  }
}

/**
 * The seed of this session's draw: made once and kept for the session, so that a reload, a new tab of the session or a hot reload asks the
 * same question again, and does not roll the dice anew. Null without storage (and then there is no draw: no proof of a return either).
 */
export function sessionSeed(session: Pick<Storage, "getItem" | "setItem"> | null, fresh: () => number = () => (Math.random() * 0x7fffffff) | 0): number | null {
  try {
    if (!session) return null;
    const kept = Number(session.getItem(SEED_KEY));
    if (session.getItem(SEED_KEY) !== null && Number.isInteger(kept)) return kept;
    const seed = fresh();
    session.setItem(SEED_KEY, String(seed));
    return seed;
  } catch {
    return null;
  }
}

/** Note that the egg played in this browser session (it does not play again until a new one), and on this device (it rests for `EGG_REST_DAYS`). */
export function markPlayed(session: Pick<Storage, "setItem"> | null, local: Pick<Storage, "setItem"> | null = null, now: number = Date.now()): void {
  try {
    session?.setItem(PLAYED_KEY, "1");
    local?.setItem(LAST_KEY, String(now));
  } catch {
    // no storage: it may play again on a reload, which is rare enough
  }
}

export function sessionStores(): { local: Storage | null; session: Storage | null } {
  try {
    return { local: window.localStorage, session: window.sessionStorage };
  } catch {
    return { local: null, session: null };
  }
}

/** Note the visit (any page calls this once it is up: see `root.tsx`). */
export function noteVisit(): void {
  const { local, session } = sessionStores();
  visitState(local, session);
}
