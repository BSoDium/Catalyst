/**
 * Copy text to the clipboard with a fallback: the async Clipboard API where the page may use it (secure contexts), else a hidden
 * textarea and `document.execCommand("copy")` (older browsers, an insecure local address). Resolves to whether the text was copied;
 * it never throws, so a caller shows "Copied" or a failure without a try/catch.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied or unavailable: try the fallback below.
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  const previous = document.activeElement as { focus?: (options?: FocusOptions) => void } | null;
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    previous?.focus?.({ preventScroll: true });
  }
}

/** The address of an entry to copy: the origin and the path, without `?view=full` (the container is the visitor's choice, not the entry's address). */
export function shareUrl(origin: string, pathname: string): string {
  return `${origin.replace(/\/+$/, "")}${pathname}`;
}
