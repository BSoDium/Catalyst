import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";
import { CreditsDialog } from "~/components/credits-dialog";
import { INFO_CELLS, INFO_REST, drawInfoButton, infoTones, type InfoState } from "~/components/info-button-art";
import { readTheme, type GlobeTheme } from "~/globe/engine/colors";
import { PixelOverlay } from "~/globe/engine/pixel-labels";
import { TUNING } from "~/globe/engine/tuning";
import { attributionFor, type AttributionTiles } from "~/globe/street/core/attribution";

/** Touch target (CSS px): the picture is smaller, the button is not. */
const TARGET = 44;

interface AttributionButtonProps {
  /** The street map's tile configuration (decides which sources are credited), or null for the globe alone. */
  tiles: AttributionTiles | null;
  /** CSS px of the right edge covered by the detail panel: the button stays left of it. */
  insetRight: number;
  reducedMotion: boolean;
}

/**
 * The map's attribution as a pixel-art "i" button that opens the credits dialog (`CreditsDialog`). The picture is drawn on
 * the art-pixel grid of the maps (the same cell size and pixel font as their labels, `info-button-art.ts`); the element is a
 * real `<button>` of at least 44 CSS px, so it has the keyboard, the name and the touch target of one. Its states (hover,
 * pressed, focus) are drawn in art pixels too. Place it in a positioned container that fills the map.
 */
export function AttributionButton({ tiles, insetRight, reducedMotion }: AttributionButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const artRef = useRef<HTMLSpanElement>(null);
  const overlayRef = useRef<PixelOverlay | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<InfoState>(INFO_REST);
  const [cell, setCell] = useState<number | null>(null);
  const [theme, setTheme] = useState<GlobeTheme | null>(null);
  const tilesKey = tiles ? `${tiles.primaryUrl}|${tiles.fallbackPmtilesUrl ?? ""}` : "";
  // `tiles` is compared by value, through `tilesKey`
  const credits = useMemo(() => attributionFor(tiles), [tilesKey]);

  // The map's cell for its container (the parent): the art pixel of the labels around this button.
  useEffect(() => {
    const parent = buttonRef.current?.parentElement;
    if (!parent) return;
    const measure = () => setCell(TUNING.pixelSize(Math.min(parent.clientWidth, parent.clientHeight), window.devicePixelRatio || 1));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  // The theme (page colour and ink), re-read when the colour scheme changes.
  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    const read = () => setTheme(readTheme(button));
    read();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);

  useEffect(() => {
    const art = artRef.current;
    if (!art) return;
    const overlay = new PixelOverlay(art);
    overlayRef.current = overlay;
    return () => {
      overlay.dispose();
      overlayRef.current = null;
    };
  }, []);

  const size = cell ? Math.max(TARGET, INFO_CELLS.cols * cell, INFO_CELLS.rows * cell) : TARGET;
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !cell || !theme) return;
    const dpr = window.devicePixelRatio || 1;
    const snap = (v: number) => Math.round(v * dpr) / dpr;
    overlay.layout(INFO_CELLS.cols, INFO_CELLS.rows, cell, snap((size - INFO_CELLS.cols * cell) / 2), snap((size - INFO_CELLS.rows * cell) / 2));
    overlay.setRamp(theme.ramp as readonly (readonly [number, number, number])[]);
    const tones = infoTones(theme.ramp.length);
    overlay.frame(1 + Number(state.hover) + 2 * Number(state.pressed) + 4 * Number(state.focus), (buf) => drawInfoButton(buf, state, tones));
  }, [cell, size, theme, state]);

  const patch = useCallback((p: Partial<InfoState>) => setState((s) => ({ ...s, ...p })), []);
  // Hover is a mouse state: a touch would leave the button inverted until the next tap elsewhere.
  const hoverable = (e: PointerEvent) => e.pointerType !== "touch";
  const key = (e: KeyboardEvent) => e.key === " " || e.key === "Enter";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Map credits"
        aria-haspopup="dialog"
        data-attribution=""
        style={{
          width: size,
          height: size,
          right: `calc(${insetRight}px + 0.25rem)`,
          bottom: "max(0.25rem, env(safe-area-inset-bottom))",
        }}
        className="absolute z-20 cursor-pointer touch-manipulation appearance-none border-0 bg-transparent p-0 outline-none select-none"
        onClick={() => setOpen(true)}
        onPointerEnter={(e) => hoverable(e) && patch({ hover: true })}
        onPointerLeave={() => patch({ hover: false, pressed: false })}
        onPointerDown={(e) => e.button === 0 && patch({ pressed: true })}
        onPointerUp={() => patch({ pressed: false })}
        onPointerCancel={() => patch({ pressed: false })}
        onKeyDown={(e) => key(e) && patch({ pressed: true })}
        onKeyUp={(e) => key(e) && patch({ pressed: false })}
        onFocus={(e: FocusEvent<HTMLButtonElement>) => patch({ focus: e.currentTarget.matches(":focus-visible") })}
        onBlur={() => patch({ focus: false, pressed: false })}
      >
        <span ref={artRef} aria-hidden="true" className="pointer-events-none absolute inset-0" />
      </button>
      <CreditsDialog
        open={open}
        credits={credits}
        reducedMotion={reducedMotion}
        onClose={() => setOpen(false)}
        onClosed={() => buttonRef.current?.focus()}
      />
    </>
  );
}
