/**
 * The small mono card that sits over the map: the dev-only content badge (bottom left) and the credits line (bottom right) are the
 * same object, so they share its border, plate, padding, radius and type. Colour is the user's: muted for the badge, the dim
 * `--subtle-foreground` for the credits. Documented in docs/design-tokens.md ("Map card").
 */
export const MAP_CARD = "rounded-sm border border-border bg-background/80 px-1.5 py-0.5 font-mono text-[10px] leading-4 tracking-wide backdrop-blur-sm";
