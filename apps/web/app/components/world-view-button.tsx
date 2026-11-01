import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import { requestWorldView } from "~/globe";

/**
 * The way back out (#458): while the globe is zoomed in on somewhere and nothing is open, a floating control flies the camera back to the whole planet in one click (the alternative is zooming out by hand, which
 * is a long gesture, or pressing Escape on a panel that is not there). It is not there at the world view, nor while a place or an entry is open (the panel has its own way back). A window event does the flight
 * (`requestWorldView`): the control lives outside the globe's island. Bottom centre: clear of the name's small line (left), the credits (right), the player (top left) and the header (top).
 */
export function WorldViewButton({ show }: { show: boolean }) {
  const reduced = useReducedMotion();
  return (
    <div className="world-view-root pointer-events-none absolute inset-x-0 z-20 flex justify-center">
      <AnimatePresence>
        {show && (
          <motion.div
            className="pointer-events-auto"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
          >
            <Button variant="secondary" data-slot="world-view-button" onClick={requestWorldView}>
              <Icon name="reset-view" size="inline" />
              Reset view
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
