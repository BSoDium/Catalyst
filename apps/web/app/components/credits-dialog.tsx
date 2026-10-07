import { AnimatePresence, motion } from "motion/react";
import { useCallback, useId, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "~/components/ui/button";
import type { AttributionPart } from "~/globe/street/core/attribution";
import { duration, easeStandard } from "~/lib/tokens";

interface CreditsDialogProps {
  open: boolean;
  credits: readonly AttributionPart[];
  reducedMotion: boolean;
  onClose(): void;
  /** After the exit animation: the host returns focus to the button here. */
  onClosed(): void;
}

/**
 * The map's data credits in a native modal `<dialog>`: `showModal()` makes the rest of the page inert (the focus trap), the
 * top layer puts it above the globe and the detail panel, Escape and a click outside the panel close it. Motion fades it in
 * and out (instant under reduced motion). The links are real, with the credit wording the licences ask for.
 * Rendered in a portal on `document.body`, so no `aria-hidden` or faded ancestor of the globe reaches it.
 */
export function CreditsDialog({ open, credits, reducedMotion, onClose, onClosed }: CreditsDialogProps) {
  const headingId = useId();
  // Mounted open: the modal state is applied as the element appears (guarded: StrictMode runs ref callbacks twice).
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const show = useCallback((el: HTMLDialogElement | null) => {
    if (!el) return;
    dialogRef.current = el;
    if (!el.open) el.showModal();
  }, []);
  // The exit animation is over but the dialog is still in the DOM and modal (the page behind is inert): close it first,
  // or the button could not take the focus back.
  const exited = () => {
    dialogRef.current?.close();
    dialogRef.current = null;
    onClosed();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== "Escape") return;
    // The detail panel closes on Escape too: this one is for the dialog alone.
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose();
  };
  if (typeof document === "undefined") return null;

  const fade = { duration: reducedMotion ? 0 : duration.base, ease: easeStandard };
  return createPortal(
    <AnimatePresence onExitComplete={exited}>
      {open && (
        <motion.dialog
          key="credits"
          ref={show}
          aria-labelledby={headingId}
          data-credits-dialog=""
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reducedMotion ? undefined : { opacity: 0 }}
          transition={fade}
          onKeyDown={onKeyDown}
          onCancel={(e) => {
            e.preventDefault();
            onClose();
          }}
          onClick={onBackdrop}
          className="fixed inset-0 m-0 grid size-full max-h-none max-w-none place-items-center overflow-y-auto bg-background/75 p-4 text-foreground backdrop:bg-transparent"
        >
          <motion.div
            initial={reducedMotion ? false : { y: 8 }}
            animate={{ y: 0 }}
            exit={reducedMotion ? undefined : { y: 8 }}
            transition={fade}
            className="w-full max-w-md rounded-md border border-border-strong bg-background p-5 sm:p-6"
          >
            <h2 id={headingId} className="text-lg font-medium">
              Map credits
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">The maps are drawn from open data. Thanks to the people and projects behind it.</p>
            <ul className="mt-4 flex flex-col gap-3 text-sm">
              {credits.map((c) => (
                <li key={c.text}>
                  <a href={c.href} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4 hover:no-underline">
                    {c.text}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  <p className="text-muted-foreground">{c.note}</p>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex justify-end">
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </motion.div>
        </motion.dialog>
      )}
    </AnimatePresence>,
    document.body,
  );
}
