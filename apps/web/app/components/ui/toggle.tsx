import { Button, type ButtonProps } from "./button";
import { Glyph } from "./glyphs";
import { cn } from "~/lib/utils";

type ToggleProps = Omit<ButtonProps, "pressed" | "onClick"> & {
  pressed: boolean;
  onPressedChange(pressed: boolean): void;
};

/** A two-state button (`aria-pressed`). Its name does not change with the state; the inverted fill and `aria-pressed` carry it. */
export function Toggle({ pressed, onPressedChange, variant = "secondary", ...props }: ToggleProps) {
  return <Button variant={variant} pressed={pressed} aria-pressed={pressed} onClick={() => onPressedChange(!pressed)} {...props} />;
}

interface ExpandToggleProps {
  expanded: boolean;
  onExpandedChange(expanded: boolean): void;
  /** The accessible name, constant across states. */
  label?: string;
  /** Show the label beside the glyph (the panel footer) instead of the glyph alone (the panel header). */
  showLabel?: boolean;
  size?: "default" | "sm";
  className?: string;
}

/**
 * The panel / full-screen toggle: `aria-pressed` is "the view is full screen". The glyph swaps between four outward corners
 * and four inward corners. Same control in the panel header (icon) and footer (icon and label).
 */
export function ExpandToggle({ expanded, onExpandedChange, label = "Full screen", showLabel, size = "default", className }: ExpandToggleProps) {
  return (
    <Toggle pressed={expanded} onPressedChange={onExpandedChange} size={size} icon={!showLabel} aria-label={showLabel ? undefined : label} className={className}>
      <Glyph name={expanded ? "collapse" : "expand"} size={16} />
      {showLabel && label}
    </Toggle>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  /** The group's accessible name. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onValueChange(value: T): void;
  size?: "default" | "sm";
  className?: string;
}

/** One choice out of a few (scheme, kind filter): toggle buttons butted together, the chosen one inverted. */
export function SegmentedControl<T extends string>({ label, options, value, onValueChange, size = "sm", className }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className={cn("ds-segmented", className)}>
      {options.map((option) => (
        <Toggle key={option.value} size={size} pressed={option.value === value} onPressedChange={() => onValueChange(option.value)}>
          {option.label}
        </Toggle>
      ))}
    </div>
  );
}
