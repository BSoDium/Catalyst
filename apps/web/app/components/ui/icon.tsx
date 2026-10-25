import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Briefcase,
  Check,
  ChevronLeft,
  ChevronRight,
  Command,
  Copy,
  CornerDownLeft,
  Eye,
  EyeOff,
  Feather,
  FileText,
  Hash,
  Image as ImageIcon,
  Info,
  Link2,
  Maximize2,
  MapPin,
  Minimize2,
  Search,
  Terminal,
  X,
  type LucideIcon,
  type LucideProps,
  Sparkles,
} from "lucide-react";
import { cn } from "~/lib/utils";

/**
 * The icon set of the UI system: ONE library (lucide-react, already a dependency), each icon under the name the interface uses for it.
 * Nothing is drawn by hand: a test (`icon.test.ts`) fails on an inline `<svg>` anywhere in the components outside the brand mark and
 * the generated cover art. To add an icon, add it here; to change one, change it here, and every use follows.
 *
 * The kind icons are the primary coding of an entry's kind (the faint hue is only a redundant accent): article, a page of text;
 * project, a terminal prompt; artwork, an image; poem, a feather; place, a map pin.
 */
export const ICONS = {
  article: FileText,
  project: Terminal,
  artwork: ImageIcon,
  poem: Feather,
  place: MapPin,
  career: Briefcase,
  close: X,
  expand: Maximize2,
  collapse: Minimize2,
  "arrow-right": ArrowRight,
  "arrow-left": ArrowLeft,
  "arrow-up": ArrowUp,
  "arrow-down": ArrowDown,
  "arrow-up-right": ArrowUpRight,
  "arrow-up-left": ArrowUpLeft,
  enter: CornerDownLeft,
  command: Command,
  check: Check,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  copy: Copy,
  link: Link2,
  hash: Hash,
  search: Search,
  eye: Eye,
  "eye-off": EyeOff,
  info: Info,
  sparkles: Sparkles,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/**
 * The size scale (docs/design-system.md, "Icons"). A size says what the icon sits next to, not a number of pixels; the values are the
 * `--icon-*` tokens in app.css, applied by `.ui-icon[data-size]`.
 *
 *   inline   1.1em      beside running text or a label: it takes that text's size (a button's word, "Back to ...", the arrow of a row)
 *   control  1.25rem    inside a control or at the head of a row: icon buttons, the search field and trigger, a result's kind
 *   large    1.5rem     alone and prominent, with no text to follow (an empty state's mark)
 */
export type IconSize = "inline" | "control" | "large";

export interface IconProps extends Omit<LucideProps, "size" | "name" | "ref"> {
  name: IconName;
  size?: IconSize;
}

/** Decorative by default (`aria-hidden`): the control or the text that holds an icon carries the accessible name. */
export function Icon({ name, size = "control", className, ...rest }: IconProps) {
  const Component = ICONS[name];
  return <Component aria-hidden="true" focusable="false" data-size={size} className={cn("ui-icon", className)} {...rest} />;
}
