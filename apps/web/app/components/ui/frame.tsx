import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "~/lib/utils";

export type FrameVariant = "plain" | "active" | "inverted";
type FramePadding = "none" | "sm" | "md" | "lg";

const PADDING: Record<FramePadding, string> = { none: "", sm: "p-3", md: "p-4", lg: "p-6" };

interface FrameProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "article" | "aside" | "header" | "footer" | "nav" | "li";
  /** `plain`: a hairline on the surface. `active`: strong line and a faint signal wash (the selected thing). `inverted`: the opposite scheme (the call-out). */
  variant?: FrameVariant;
  padding?: FramePadding;
  children?: ReactNode;
}

/**
 * A hairline box on the surface (docs/design-system.md, "Frame"): the container for the few things that really are a box (a code
 * block, the search dialog, an error). Use it sparingly: spacing separates most things. No radius, no shadow, no
 * decoration. `inverted` rebinds the colour tokens for its subtree, so any component inside reads correctly without knowing.
 */
export function Frame({ as: Tag = "div", variant = "plain", padding = "md", className, ...props }: FrameProps) {
  return <Tag data-slot="frame" data-variant={variant} className={cn("ds-frame", PADDING[padding], className)} {...props} />;
}
