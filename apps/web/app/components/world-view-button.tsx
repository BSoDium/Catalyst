import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { Icon } from "~/components/ui/icon";
import { TurningGlobe } from "~/components/ui/turning-globe";
import { ambient, requestWorldView } from "~/globe";

/**
 * The floating globe controls, one docked strip (`.globe-dock`, app.css) of mono caps on the player's soft plate.
 *
 * "Reset view" (#458) is the way back out: while the globe is zoomed in on somewhere and nothing is open, one click flies the camera back to the whole planet (the alternative is zooming out by hand, or pressing Escape on a
 * panel that is not there). A window event does the flight (`requestWorldView`): the control lives outside the globe's island. It is not there at the world view, nor while a place or an entry is open.
 *
 * "Auto-rotate" is ambient mode (engine/ambient.ts): the globe turns by itself, at any zoom, under the view as it is, and the hero does not come back over it. It is offered once the hero has stepped back to its small name or the view
 * is zoomed in, and never while a place or an entry is open. Its name does not change with its state: `aria-pressed` and the turning globe say it.
 *
 * The strip never stretches. When "Reset view" comes, the one beside it first glides out of its way (`layout="position"`: a move, never a scale) and the newcomer fades in once there is room; when it goes, it fades out first
 * and the other glides back (the leaving one stays in the row for its fade). Bottom centre: clear of the name's small line (left; on a narrow screen the strip is above it, and higher by the hint's line while the hint is there: `data-hint`), the credits (right), the player (top left) and the header (top).
 */
export function WorldViewButton({ showReset, showAmbient, streetLevel = false }: { showReset: boolean; showAmbient: boolean; streetLevel?: boolean }) {
  const reduced = useReducedMotion();
  const on = useSyncExternalStore(ambient.subscribe, ambient.getSnapshot, () => false);
  // On, but the street map is showing: the globe is suspended under it, so nothing turns until the visitor zooms out (the control says so).
  const paused = on && streetLevel;
  // On, but not turning at full pace yet: it waits for the idle delay (a moment after the switch, the full delay after a touch) and then eases in over 3 s, so the word says "Starting" meanwhile.
  const turning = useSyncExternalStore(ambient.subscribeTurning, ambient.getTurning, () => false);
  const state = !on ? "off" : paused ? "paused" : turning ? "on" : "starting";
  const cell = useRef<HTMLSpanElement>(null);
  // The word's cell takes the width of the word it shows, and the width glides (app.css): the strip follows the text, smoothly, instead of keeping room for the longest word ("Starting")
  // and leaving a gap after "On". Measured again when a word's own size changes (a font arriving, the narrow-screen type).
  useLayoutEffect(() => {
    const el = cell.current;
    if (!el) return;
    const fit = () => {
      const word = el.querySelector<HTMLElement>(`[data-word="${state}"]`);
      if (word) el.style.width = `${word.offsetWidth}px`;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    el.querySelectorAll("[data-word]").forEach((w) => ro.observe(w));
    return () => ro.disconnect();
  }, [state, showAmbient]);
  const hidden = reduced ? { opacity: 0 } : { opacity: 0, y: 6 };
  const glide = { duration: 0.3, ease: [0.2, 0, 0, 1] as const };
  return (
    <div className="world-view-root pointer-events-none absolute inset-x-0 z-20 flex justify-center" data-hint={!showReset}>
      <AnimatePresence>
        {(showReset || showAmbient) && (
          <motion.div
            role="group"
            aria-label="Globe view"
            className="globe-dock type-meta pointer-events-auto"
            initial={hidden}
            animate={{ opacity: 1, y: 0 }}
            exit={hidden}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
          >
            {/* (the items already in the row when the strip comes are part of its own fade: no entrance of their own) */}
            <AnimatePresence initial={false}>
              {showReset && (
                <motion.button
                  key="reset"
                  type="button"
                  className="globe-dock-item"
                  data-slot="world-view-button"
                  onClick={requestWorldView}
                  layout={reduced ? false : "position"}
                  transition={{ layout: glide }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.2, delay: reduced ? 0 : 0.22 } }}
                  exit={{ opacity: 0, transition: { duration: 0.16 } }}
                >
                  <Icon name="reset-view" size="inline" />
                  Reset view
                </motion.button>
              )}
              {showAmbient && (
                <motion.button
                  key="ambient"
                  type="button"
                  className="globe-dock-item"
                  data-slot="ambient-toggle"
                  aria-pressed={on}
                  title={
                    state === "paused"
                      ? "Paused while the street map is showing: zoom out and the globe turns"
                      : state === "starting"
                        ? "Starting: the globe waits a moment, then eases into its turn"
                        : "Keep the globe turning, at any zoom"
                  }
                  onClick={() => ambient.set(!on)}
                  layout={reduced ? false : "position"}
                  transition={{ layout: glide }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.2, delay: reduced ? 0 : 0.22 } }}
                  exit={{ opacity: 0, transition: { duration: 0.16 } }}
                >
                  <TurningGlobe turning={on && !paused && !reduced} />
                  Auto-rotate
                  {/* the state in words, for the eye (`aria-pressed` says it to the ear): the four words are laid in one cell whose width follows the word shown (and glides), so the strip is as long as its text and resizes smoothly as it changes */}
                  <span ref={cell} className="globe-dock-state" data-state={state} aria-hidden="true">
                    <span data-word="on">On</span>
                    <span data-word="starting">Starting</span>
                    <span data-word="paused">Paused</span>
                    <span data-word="off">Off</span>
                  </span>
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
