import { Button, type ButtonProps } from "./button";
import { Glyph, type GlyphName } from "./glyphs";

type IconButtonProps = Omit<ButtonProps, "children" | "icon" | "aria-label"> & {
  /** The accessible name (required: there is no visible text). */
  label: string;
  icon: GlyphName;
};

/** A square, icon-only button. 44 px below `md`, 36 px (32 for `sm`) above. The glyph is decorative; `label` names the control. */
export function IconButton({ label, icon, variant = "secondary", ...props }: IconButtonProps) {
  return (
    <Button variant={variant} icon aria-label={label} {...props}>
      <Glyph name={icon} size={16} />
    </Button>
  );
}
