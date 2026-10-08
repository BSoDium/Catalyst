import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "~/lib/utils";

/**
 * Button of the UI system (docs/design-system.md, "Buttons"): square, mono caps, 1 px lines, no shadow; styles are `.ds-button` in
 * app.css. Variants: `primary` (filled), `secondary` (outlined), `ghost` (no line until hover), `link` (inline text action).
 * `default` and `outline` are the shadcn names this file used to export, kept as aliases of `primary` and `secondary`.
 * The minimum height is 44 px below `md` (`--control-h`), 36 px (32 for `sm`) above.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "link" | "default" | "outline";
export type ButtonSize = "default" | "sm";

const ALIAS: Record<ButtonVariant, "primary" | "secondary" | "ghost" | "link"> = {
  primary: "primary",
  default: "primary",
  secondary: "secondary",
  outline: "secondary",
  ghost: "ghost",
  link: "link",
};

export type ButtonProps = React.ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
  /** Set by `Toggle`: the pressed state is drawn inverted. */
  pressed?: boolean;
  /** Square icon button (set by `IconButton`). */
  icon?: boolean;
};

function Button({ className, variant = "primary", size = "default", asChild = false, pressed, icon, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={ALIAS[variant]}
      data-size={size}
      data-icon={icon ? "" : undefined}
      data-pressed={pressed === undefined ? undefined : String(pressed)}
      type={asChild ? undefined : (type ?? "button")}
      className={cn("ds-button", className)}
      {...props}
    />
  );
}

export { Button };
