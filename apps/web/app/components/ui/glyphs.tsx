import type { SVGProps } from "react";

/**
 * The glyph set of the UI system: square, 1 px strokes with butt caps and mitred joins, drawn on a 12 x 12 grid. The five kind
 * glyphs are the primary coding of an entry's kind (the faint hue is only a redundant accent). All are decorative:
 * the control or tag that holds one carries the accessible name, so they are `aria-hidden`.
 */
const STROKE = {
  article: "M2 3h6M2 5.5h8M2 8h8M2 10.5h5",
  project: "M2 3.5l3 2.5-3 2.5M6.5 9.5H10",
  poem: "M4 3h4M3 5.5h6M4.5 8h3M3.5 10.5h5",
  place: "M6 1v3M6 8v3M1 6h3M8 6h3",
  close: "M2.5 2.5l7 7M9.5 2.5l-7 7",
  expand: "M7 2.5h2.5V5M5 9.5H2.5V7M9.5 2.5L6.6 5.4M2.5 9.5l2.9-2.9",
  collapse: "M9.5 5H7V2.5M2.5 7H5v2.5M7 5l2.5-2.5M5 7L2.5 9.5",
  "arrow-right": "M2 6h8M7 3l3 3-3 3",
  "arrow-left": "M10 6H2M5 3L2 6l3 3",
  "arrow-up-right": "M3 9l6-6M4 3h5v5",
} as const;

/** Solid parts, filled with the current colour. */
const FILL = {
  artwork: "M2 2h4v4H2zM6 6h4v4H6z",
  place: "M5.25 5.25h1.5v1.5h-1.5z",
} as const;

/** Outlines that are not strokes of the simple kind (closed shapes). */
const OUTLINE = {
  artwork: "M2.5 2.5h7v7h-7z",
} as const;

export type GlyphName = keyof typeof STROKE | keyof typeof FILL | keyof typeof OUTLINE;

interface GlyphProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: GlyphName;
  /** Rendered size in CSS px (default 12; buttons use 16). The 1 px stroke does not scale with it. */
  size?: number;
}

export function Glyph({ name, size = 12, ...rest }: GlyphProps) {
  const stroke = (STROKE as Record<string, string>)[name];
  const fill = (FILL as Record<string, string>)[name];
  const outline = (OUTLINE as Record<string, string>)[name];
  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      {...rest}
    >
      {stroke && <path d={stroke} vectorEffect="non-scaling-stroke" />}
      {outline && <path d={outline} vectorEffect="non-scaling-stroke" />}
      {fill && <path d={fill} fill="currentColor" stroke="none" />}
    </svg>
  );
}

/** A registration mark: a crosshair with a centre gap. Pure decoration for corners and edges of frames and covers. */
export function RegMark({ size = 11, className, ...rest }: Omit<SVGProps<SVGSVGElement>, "name"> & { size?: number }) {
  return (
    <svg viewBox="0 0 11 11" width={size} height={size} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={1} className={className} {...rest}>
      <path d="M5.5 0v4M5.5 7v4M0 5.5h4M7 5.5h4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
