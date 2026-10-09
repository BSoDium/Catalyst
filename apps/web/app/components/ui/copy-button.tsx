import { useEffect, useRef, useState } from "react";
import { copyText } from "~/lib/clipboard";
import { Button, type ButtonProps } from "./button";
import { Glyph, type GlyphName } from "./glyphs";

interface CopyButtonProps extends Pick<ButtonProps, "variant" | "size" | "className"> {
  /** What is copied: a string, or a function called at the click (an address that depends on the window). */
  text: string | (() => string);
  /** The visible word (`Copy`, `Copy link`). It is the accessible name too, unless `label` says more. */
  children: string;
  /** A fuller accessible name (`Copy code`); defaults to the visible word. */
  label?: string;
  /** What the assistive technology hears on success. */
  announcement?: string;
  glyph?: GlyphName;
}

/**
 * Copies text and confirms in place, without a toast: the button's word turns to `Copied` (or `Not copied` when the browser refuses)
 * for two seconds and a polite live region says it too. Drawn only after hydration: without scripts there is nothing to press.
 * The clipboard API is used where it exists, else the old `execCommand` fallback (`lib/clipboard.ts`).
 */
export function CopyButton({ text, children, label, announcement = "Copied to the clipboard", glyph, variant = "ghost", size = "sm", className }: CopyButtonProps) {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setReady(true);
    return () => clearTimeout(timer.current);
  }, []);
  if (!ready) return null;
  const word = state === "copied" ? "Copied" : state === "failed" ? "Not copied" : children;
  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        aria-label={state === "idle" ? (label ?? children) : undefined}
        data-state={state}
        onClick={async () => {
          const ok = await copyText(typeof text === "function" ? text() : text);
          setState(ok ? "copied" : "failed");
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setState("idle"), 2000);
        }}
      >
        {glyph && <Glyph name={state === "copied" ? "check" : glyph} size={16} />}
        {word}
      </Button>
      <span role="status" className="sr-only">
        {state === "copied" ? announcement : state === "failed" ? "Could not copy" : ""}
      </span>
    </>
  );
}
