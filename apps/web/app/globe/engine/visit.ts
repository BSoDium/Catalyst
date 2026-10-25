/**
 * What this browser remembers about visits, for the home screen's rare easter egg (engine/cinematic.ts): a one-bit note on the device, never sent
 * anywhere. Kept apart from the rest of the engine so the root route can note a visit without pulling the globe into the main chunk.
 */

const SEEN_KEY = "site-seen";
const VISIT_KEY = "site-visit";
const PLAYED_KEY = "site-egg";

/**
 * Whether this browser has been here in an EARLIER session, and whether the egg already played in this one. A one-bit note kept on the device and
 * never sent anywhere (`localStorage`: it was seen; `sessionStorage`: what this session found, so that a reload does not turn a first visit into a
 * return). Idempotent within a session, so any page may call it first. Storage that is refused or throws: not a returning visitor (no proof, no egg).
 */
export function visitState(local: Pick<Storage, "getItem" | "setItem"> | null, session: Pick<Storage, "getItem" | "setItem"> | null): { returning: boolean; played: boolean } {
  try {
    if (!local || !session) return { returning: false, played: false };
    let found = session.getItem(VISIT_KEY);
    if (found === null) {
      found = local.getItem(SEEN_KEY) !== null ? "returning" : "new";
      session.setItem(VISIT_KEY, found);
    }
    // (noted on every visit, whichever page it lands on: the next session is a return)
    if (local.getItem(SEEN_KEY) === null) local.setItem(SEEN_KEY, "1");
    return { returning: found === "returning", played: session.getItem(PLAYED_KEY) === "1" };
  } catch {
    return { returning: false, played: false };
  }
}

/** Note that the egg played in this browser session (it does not play again until a new one). */
export function markPlayed(session: Pick<Storage, "setItem"> | null): void {
  try {
    session?.setItem(PLAYED_KEY, "1");
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
