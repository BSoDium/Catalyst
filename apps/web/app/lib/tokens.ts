/**
 * Motion tokens in seconds, for `motion/react`. They mirror the CSS variables
 * `--duration-*` in app.css (tokens.test.ts fails if they drift).
 */
export const duration = { fast: 0.12, base: 0.22, slow: 0.36 } as const;
export const easeStandard = [0.2, 0, 0, 1] as const;

/** Viewport below which the detail panel becomes a modal slide-over. */
export const MOBILE_QUERY = "(max-width: 767.98px)";
