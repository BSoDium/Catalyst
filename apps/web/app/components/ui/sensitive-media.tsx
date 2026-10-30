import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SENSITIVE_COPY } from "~/lib/sensitive";
import { cn } from "~/lib/utils";
import { Icon } from "./icon";

interface SensitiveMediaProps {
  /** The image (an `<img>`, or anything that shows a picture). It is drawn blurred while the frame is hidden. */
  children: ReactNode;
  /** `true` once the visitor asked to see it. A frame is hidden by default and on the server: nothing sharp is ever in the first paint. */
  revealed?: boolean;
  /**
   * Present: the frame offers the control that shows and hides the picture (the entry's own images). Absent: a card, which is blurred
   * for good and only says why; the visitor opens the entry to reveal.
   */
  onRevealedChange?: (revealed: boolean) => void;
  /** On the frame: size it like the image it holds (`size-full`, `@md:h-full`). */
  className?: string;
}

/**
 * An image of mature content (docs/design-system.md, "Sensitive media"). The picture sits in `overflow: hidden` and is blurred and
 * enlarged by CSS (`.sensitive-media`, app.css) from the first byte of HTML: the state is an attribute (`data-state="hidden"`), so the
 * server render, a browser without scripts and print all show it blurred. The words "Mature content" lie straight on the blurred picture
 * (dimmed on the dark page and lightened on the light one, by the page's own colour laid over it): no plate, no box. With `onRevealedChange` the
 * whole picture is the control, once hydrated (a button named "View mature content": pressing anywhere on it shows the image); a small icon
 * button in its corner hides it again. Without scripts there is nothing to press, and the words say the image is hidden.
 *
 * The state is the caller's and is never stored (no storage, no URL): a reload hides the image again.
 */
export function SensitiveMedia({ children, revealed = false, onRevealedChange, className }: SensitiveMediaProps) {
  const interactive = onRevealedChange !== undefined;
  const [ready, setReady] = useState(false);
  // The polite announcement starts empty: a status that is filled when it mounts would be read for nothing.
  const [changed, setChanged] = useState(false);
  useEffect(() => setReady(true), []);
  const change = (next: boolean) => {
    setChanged(true);
    onRevealedChange?.(next);
  };
  return (
    <div data-slot="sensitive-media" data-state={revealed ? "revealed" : "hidden"} data-interactive={interactive ? "" : undefined} className={cn("sensitive-media", className)}>
      <div className="sensitive-media-content">{children}</div>
      {!revealed &&
        (interactive && ready ? (
          <button type="button" data-slot="sensitive-media-toggle" onClick={() => change(true)} className="sensitive-media-veil print:pointer-events-none">
            <span data-slot="sensitive-media-label" className="sensitive-media-label type-meta">
              <Icon name="eye-off" size="inline" />
              <span>{SENSITIVE_COPY.view}</span>
            </span>
          </button>
        ) : (
          <div className="sensitive-media-veil">
            <p data-slot="sensitive-media-label" className="sensitive-media-label type-meta m-0">
              <Icon name="eye-off" size="inline" />
              <span>{interactive ? SENSITIVE_COPY.hidden : SENSITIVE_COPY.label}</span>
            </p>
          </div>
        ))}
      {revealed && interactive && ready && (
        <button type="button" data-slot="sensitive-media-toggle" aria-label={SENSITIVE_COPY.hide} onClick={() => change(false)} className="sensitive-media-hide print:hidden">
          <Icon name="eye-off" size="inline" />
        </button>
      )}
      {interactive && ready && (
        <span role="status" className="sr-only">
          {changed ? (revealed ? SENSITIVE_COPY.announceShown : SENSITIVE_COPY.announceHidden) : ""}
        </span>
      )}
    </div>
  );
}

// --- The scope of an entry --------------------------------------------------------------------------------------------------------

interface Scope {
  revealed: boolean;
  setRevealed: (revealed: boolean) => void;
}

const ScopeContext = createContext<Scope | null>(null);

/**
 * One reveal state for all the images of one entry (its cover and its image blocks): asking to see one shows them all, and nothing else
 * (the cards of other entries stay blurred). Mount it with the entry as its key so that another entry starts hidden. The state lives
 * in memory for the page view only: a reload, or leaving and coming back, hides the images again. Without `sensitive` it is inert and
 * `SensitiveImage` draws its children as they are.
 */
export function SensitiveMediaScope({ sensitive, children }: { sensitive: boolean; children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  const value = useMemo<Scope | null>(() => (sensitive ? { revealed, setRevealed } : null), [sensitive, revealed]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

/** Whether the images of the current entry are blurred right now (a sensitive entry whose visitor has not asked to see them): what is hidden must not be opened larger. */
export function useSensitiveHidden(): boolean {
  const scope = useContext(ScopeContext);
  return scope !== null && !scope.revealed;
}

/** An image of the current entry: blurred, with the reveal control, inside a sensitive entry's scope; otherwise just the image. */
export function SensitiveImage({ children, className }: { children: ReactNode; className?: string }) {
  const scope = useContext(ScopeContext);
  if (!scope) return <>{children}</>;
  return (
    <SensitiveMedia revealed={scope.revealed} onRevealedChange={scope.setRevealed} className={className}>
      {children}
    </SensitiveMedia>
  );
}
