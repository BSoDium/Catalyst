# Design tokens

Source of truth: `apps/web/app/app.css`. Colors, radii, motion and layout are CSS variables on `:root`;
Tailwind 4 reads them through `@theme` / `@theme inline`. Light and dark follow `prefers-color-scheme`
(no toggle). Names match shadcn/ui's contract so selectively added components work unchanged.

Principles: monochrome, generous spacing, clear hierarchy. System fonts only (no remote font requests).
The navbar has no surface of its own: it floats over the page and a gradient scrim keeps it readable (see "Nav scrim").

## Color

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--background` | `#fbfbfb` | `#0a0a0a` | page |
| `--foreground` | `#0a0a0a` | `#f5f5f5` | text, primary fill |
| `--accent` | `#ececec` | `#1f1f1f` | hover and selected rows |
| `--muted-foreground` | `#595959` | `#a3a3a3` | secondary text (AA: 6.8:1 light, 7.9:1 dark) |
| `--border` | `rgb(0 0 0 / .14)` | `rgb(255 255 255 / .16)` | hairlines |
| `--border-strong` | `rgb(0 0 0 / .4)` | `rgb(255 255 255 / .45)` | outlined buttons, globe outline |
| `--ring` | `#0a0a0a` | `#f5f5f5` | focus ring (2px outline, 2px offset, all focusable elements) |
| `--primary` / `--primary-foreground` | `#0a0a0a` / `#fbfbfb` | `#f5f5f5` / `#0a0a0a` | default button |
| `--globe-grid`, `--globe-limb` | `rgb(0 0 0 / .12)`, `rgb(0 0 0 / .3)` | `rgb(255 255 255 / .14)`, `rgb(255 255 255 / .34)` | globe graticule and 1 px horizon line (read from CSS variables by the engine) |

The globe's ocean has no token of its own: it is `--background` (the disc and the clear colour are exactly the page colour, so the canvas never shows a seam). The detail panel uses `--background` at 85% with a backdrop blur.

Tailwind utilities: `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-accent`, etc.
There is no accent hue and no destructive color on purpose.

## Typography

- Sans: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- Mono (labels, small caps): `ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`
- `.label`: mono, `text-xs`, uppercase, `0.08em` tracking, muted color.

| Step | Size / line height | Use |
| --- | --- | --- |
| `text-xs` | 12 / 18 px | labels |
| `text-sm` | 14 / 22 px | lists, nav, buttons |
| `text-base` | 16 / 26.4 px | body |
| `text-lg` | 18 / 28 px | summaries |
| `text-xl` | 22 / 30 px | item titles |
| `text-2xl` | 28 / 34 px | panel headings |
| `text-3xl` | 36 / 40 px | page headings |

## Spacing

Tailwind's default 4px scale (`--spacing: 0.25rem`). Page gutters are 12 to 16px (navbar) and 24px (panel,
content pages). Content pages use a `max-w-2xl` reading column. Touch targets: interactive elements are
`min-h-11` (44px) on viewports below `md`.

Layout variables:

| Token | Value |
| --- | --- |
| `--navbar-height` | `3.5rem` |
| `--scrim-height` | `calc(var(--navbar-height) + 2.5rem)` |
| `--list-width` | `18rem` (the places list when revealed by keyboard focus) |

The desktop detail panel is `50vw` wide (`md:w-1/2`, from 768px) and full height; there is no panel width token.

## Radii

`--radius-sm` 0.25rem (focus outline, small elements), `--radius-md` 0.5rem (buttons, images), `--radius-lg` 0.875rem (the revealed places list).

## Motion

| Token | CSS | `motion/react` (s) | Use |
| --- | --- | --- | --- |
| `--duration-fast` | 120ms | `duration.fast` = 0.12 | hover/focus color changes |
| `--duration-base` | 220ms | `duration.base` = 0.22 | mobile slide-over |
| `--duration-slow` | 360ms | `duration.slow` = 0.36 | desktop panel slide and the globe's re-centring (`TUNING.insetMs`) |
| `--ease-standard` | `cubic-bezier(.2, 0, 0, 1)` | `easeStandard` | everything |

The seconds values live in `apps/web/app/lib/tokens.ts`; `tokens.test.ts` fails if they drift from the CSS, and if the globe's re-centring duration and easing drift from `--duration-slow` and `--ease-standard`.

Reduced motion (`prefers-reduced-motion: reduce`): the panel has no initial/exit state (instant), the globe jumps to its new centre, the global CSS
reduces all transitions/animations to ~0, `MotionConfig reducedMotion="user"` disables transform animations,
and the globe receives `reducedMotion: true`.

## Nav scrim

The navbar is fully transparent (no box, border or blur of its own). To keep its text readable over scrolling content,
a scrim dims whatever passes beneath it. It is `.nav-scrim` in `app.css`, rendered by `NavScrim`
(`components/nav-scrim.tsx`).

- Geometry: `position: fixed`, top and full width, height `--scrim-height` (navbar height + 2.5rem = 96px),
  `pointer-events: none`, `aria-hidden`, z-index 35 (content and panel 30, navbar 40).
- Colour: a 14-stop `linear-gradient` from `--background` at 96% alpha to transparent, with stops eased roughly like a
  smoothstep so there is no visible start or end line. The stops use `color-mix(in srgb, var(--background) N%,
  transparent)`, so it follows light and dark with no extra tokens.
- Blur: three child `<span>`s, each a `backdrop-filter: blur()` (1.5px, 4px, 9px) masked by its own `mask-image`
  gradient to a shorter strip (55%, 75% and 50% of the height). The blurs add up, so blur is strongest at the top and
  tapers to nothing: a progressive blur without a hard edge.
- `prefers-reduced-transparency: reduce`: the spans are hidden and the gradient stays opaque longer (solid for the
  first half, then fading), so the text stays readable without any blur.
- Where it applies: every route except the globe screen (`/` and `/locations/:slug`), where the page colour is the
  ocean and dimming the map would be a defect. The open desktop detail panel has an `absolute` copy scoped to the
  panel (the panel is its own backdrop root), which covers only the panel's width. The panel's scroll area starts
  `navbar-height + 1rem` from the top so its first line is not dimmed at rest.
- Content pages start `navbar-height + 3rem` from the top; `:target` scroll margins use `navbar-height + 1.5rem`.
- Tuning knobs for the owner: `--scrim-height`, the stop list, and the three blur radii and mask ends.
