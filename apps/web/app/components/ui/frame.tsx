import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "~/lib/utils";

export type FrameVariant = "plain" | "active" | "inverted";
type FramePadding = "none" | "sm" | "md" | "lg";

const PADDING: Record<FramePadding, string> = { none: "", sm: "p-3", md: "p-4", lg: "p-6" };

interface FrameProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "article" | "aside" | "header" | "footer" | "nav" | "li";
  /** `plain`: hairline on the surface. `active`: strong line, signal brackets and wash (the selected thing). `inverted`: the opposite scheme (the call-out). */
  variant?: FrameVariant;
  /** Corner brackets (default on). */
  brackets?: boolean;
  /** The frame answers the pointer and keyboard focus (cards). */
  interactive?: boolean;
  padding?: FramePadding;
  children?: ReactNode;
}

/**
 * A hairline panel with corner brackets: the container of the system (docs/design-system.md, "Frame"). No radius, no shadow.
 * `inverted` rebinds the colour tokens for its subtree, so any component inside reads correctly without knowing.
 */
export function Frame({ as: Tag = "div", variant = "plain", brackets = true, interactive, padding = "md", className, ...props }: FrameProps) {
  return (
    <Tag
      data-slot="frame"
      data-variant={variant}
      data-brackets={brackets ? "" : undefined}
      data-interactive={interactive ? "" : undefined}
      className={cn("ds-frame", PADDING[padding], className)}
      {...props}
    />
  );
}
