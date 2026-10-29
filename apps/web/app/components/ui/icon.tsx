import { ArrowLeft as CarbonArrowLeft, ChevronDown as CarbonChevronDown, Search as CarbonSearch, type CarbonIconType } from "@carbon/icons-react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Briefcase,
  Code,
  Cuboid,
  GraduationCap,
  Layers,
  Palette,
  Rocket,
  Server,
  Sigma,
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
  Camera,
  Image as ImageIcon,
  Info,
  Link2,
  Maximize2,
  MapPin,
  Minimize2,
  Terminal,
  X,
  type LucideIcon,
  type LucideProps,
  Moon,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "~/lib/utils";

/**
 * The icon set of the UI system: lucide-react, each icon under the name the interface uses for it, with the header's three (the way back's
 * arrow, the selector's chevron, the search) from IBM's Carbon (`@carbon/icons-react`, Apache-2.0): square-ended, drawn on a pixel grid, they sit
 * beside the header's mono type as lucide's rounder shapes did not (2026-10-28, owner). Carbon's are filled shapes, so the stroke tokens do not apply.
 * This is the only file that imports either library.
 * Nothing is drawn by hand: a test (`icon.test.ts`) fails on an inline `<svg>` anywhere in the components outside the brand mark and
 * the generated cover art. To add an icon, add it here; to change one, change it here, and every use follows.
 *
 * The kind icons are the primary coding of an entry's kind (the faint hue is only a redundant accent): article, a page of text;
 * project, a terminal prompt; artwork, an image; poem, a feather; photograph, a camera; place, a map pin.
 */
export const ICONS = {
  article: FileText,
  project: Terminal,
  artwork: ImageIcon,
  poem: Feather,
  photograph: Camera,
  place: MapPin,
  career: Briefcase,
  code: Code,
  cuboid: Cuboid,
  "graduation-cap": GraduationCap,
  layers: Layers,
  palette: Palette,
  rocket: Rocket,
  server: Server,
  sigma: Sigma,
  close: X,
  expand: Maximize2,
  collapse: Minimize2,
  "arrow-right": ArrowRight,
  "arrow-left": CarbonArrowLeft,
  "arrow-up": ArrowUp,
  "arrow-down": ArrowDown,
  "arrow-up-right": ArrowUpRight,
  "arrow-up-left": ArrowUpLeft,
  enter: CornerDownLeft,
  command: Command,
  check: Check,
  "chevron-down": CarbonChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  copy: Copy,
  link: Link2,
  hash: Hash,
  search: CarbonSearch,
  eye: Eye,
  "eye-off": EyeOff,
  info: Info,
  sparkles: Sparkles,
  moon: Moon,
  sound: Volume2,
  "sound-off": VolumeX,
} as const satisfies Record<string, LucideIcon | CarbonIconType>;

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
  const Component = ICONS[name] as ComponentType<Record<string, unknown>>;
  return <Component aria-hidden="true" focusable="false" data-size={size} className={cn("ui-icon", className)} {...rest} />;
}
