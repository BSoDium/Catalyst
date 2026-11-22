import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useSyncExternalStore } from "react";
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
export function WorldViewButton({ showReset, showAmbient }: { showReset: boolean; showAmbient: boolean }) {
  const reduced = useReducedMotion();
  const on = useSyncExternalStore(ambient.subscribe, ambient.getSnapshot, () => false);
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
                  title="Keep the globe turning, at any zoom"
                  onClick={() => ambient.set(!on)}
                  layout={reduced ? false : "position"}
                  transition={{ layout: glide }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.2, delay: reduced ? 0 : 0.22 } }}
                  exit={{ opacity: 0, transition: { duration: 0.16 } }}
                >
                  <TurningGlobe turning={on && !reduced} />
                  Auto-rotate
                  {/* the state in words, for the eye (`aria-pressed` says it to the ear): both words are laid in the same cell so that the strip does not change width when it flips */}
                  <span className="globe-dock-state" data-on={on} aria-hidden="true">
                    <span>On</span>
                    <span>Off</span>
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
