import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useSyncExternalStore } from "react";
import { Icon } from "~/components/ui/icon";
import { ambient, requestWorldView } from "~/globe";

/**
 * The floating globe controls, one docked strip (`.globe-dock`, app.css) of mono caps on the player's soft plate.
 *
 * "Reset view" (#458) is the way back out: while the globe is zoomed in on somewhere and nothing is open, one click flies the camera back to the whole planet (the alternative is zooming out by hand, or pressing Escape on a
 * panel that is not there). A window event does the flight (`requestWorldView`): the control lives outside the globe's island. It is not there at the world view, nor while a place or an entry is open.
 *
 * "Auto-rotate" is ambient mode (engine/ambient.ts): the globe turns by itself, at any zoom, under the view as it is, and the hero does not come back over it. It is offered once the hero has stepped back to its small name or the view
 * is zoomed in, and never while a place or an entry is open. Its name does not change with its state: `aria-pressed` and the lit meter say it.
 *
 * Bottom centre: clear of the name's small line (left), the credits (right), the player (top left) and the header (top).
 */
export function WorldViewButton({ showReset, showAmbient }: { showReset: boolean; showAmbient: boolean }) {
  const reduced = useReducedMotion();
  const on = useSyncExternalStore(ambient.subscribe, ambient.getSnapshot, () => false);
  const hidden = reduced ? { opacity: 0 } : { opacity: 0, y: 6 };
  return (
    <div className="world-view-root pointer-events-none absolute inset-x-0 z-20 flex justify-center">
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
            layout={!reduced}
          >
            {showReset && (
              <button type="button" className="globe-dock-item" data-slot="world-view-button" onClick={requestWorldView}>
                <Icon name="reset-view" size="inline" />
                Reset view
              </button>
            )}
            {showAmbient && (
              <button type="button" className="globe-dock-item" data-slot="ambient-toggle" aria-pressed={on} title="Keep the globe turning, at any zoom" onClick={() => ambient.set(!on)}>
                <span className="globe-dock-meter" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                Auto-rotate
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
