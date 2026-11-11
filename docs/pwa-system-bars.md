# The installed app and a phone's system bars

**Status: a default that works around a Chrome limitation (owner decision, 2026-11-09, revised 2026-11-10). Re-check it when Chrome changes this; see "When to revisit".**

## The problem

On Android, an app installed from Chrome (a WebAPK) gets its **navigation bar** (the gesture bar at the bottom) painted by the system, not by the page:

- the **status bar** follows the page's `<meta name="theme-color">` (our two media-query metas), so it follows the scheme;
- the **navigation bar** follows the **manifest** (`theme_color` and/or `background_color`; reports disagree on which, and it varies with the Chrome version), and a manifest has **one colour**: there is no dark variant (w3c/manifest#975);
- the page does not draw under the bars: measured on the owner's phone (2026-11-09, installed app, `viewport-fit=cover` present), `innerHeight` 838 against `screen.height` 915, every `env(safe-area-inset-*)` 0. Chrome 135 made browser tabs edge to edge on Android, but an installed app did not get it there (an experimental flag, `chrome://flags/#web-app-short-edges-cutout-mode`, reportedly does; no visitor can be asked to set it).

So whatever one manifest colour we pick, the page follows the phone's scheme and shows a white or black strip under it in one of the two schemes. Neither colour fixes both.

Sources: Kareadita/Kavita#4479, arteeh/uniichat#10, spokospace/zapiszprzepis#475 (Chromium before 156 reported to paint the bar from `background_color`), the Discourse Meta thread "Android bottom navigation bar color issues in Discourse PWA", Chrome for Developers "Chrome on Android edge-to-edge migration guide".

## What we do

A **default and honesty**, not a restriction (owner decision, 2026-11-10: forcing or hiding "System theme" would be an anti-pattern; first version, which remapped System to dark, was dropped).

- The manifest's `theme_color` and `background_color` are the dark page colour (`#0a0a0a`), so the navigation bar is dark.
- In an **app installed on a phone**, a visitor who has never chosen a theme starts **dark**, so the page and the bar agree. `public/theme-boot.js` decides, before the first paint: installed display mode (`standalone`, `fullscreen` or `minimal-ui`; **not** `window-controls-overlay`, a desktop window), a touch screen (`pointer: coarse`) and a phone's size (the shorter side of `screen` under 600 px: a tablet is not one, a phone turned sideways still is). It marks the root `data-phone-app` and applies dark when no choice is kept.
- **Every choice stays available and means what it says.** The palette's System row follows the phone (there it is kept as `"system"` in localStorage `theme`, since in this app the absence of a choice means dark); Light works. The rows say what each costs (`themeSub`): Dark "Matches the app's navigation bar", Light "Navigation bar stays dark", System "Follow the phone · navigation bar stays dark".
- **Not affected:** a tab of a browser on a phone, and an app installed on a desktop or a tablet: no default change, the rows keep their ordinary words.

## When to revisit

Remove the dark default and the row notes (the `phoneApp` block of `theme-boot.js`, `isInstalledPhoneApp`, `themeSub`; the manifest colours can go back to whichever we want) when **either** is true on a real Android phone, with the app freshly installed:

1. Chrome gives an installed app the **edge-to-edge** layout without a flag (`innerHeight` equals `screen.height`, a non-zero `env(safe-area-inset-bottom)`, the page visible under the bar): the page's own background is then the bar's colour in both schemes. The page already sends `viewport-fit=cover` in an installed app and keeps what is pinned to an edge clear with the `--safe-*` tokens (`docs/design-tokens.md`, "Safe area").
2. The manifest can vary by scheme (a dark colour member, w3c/manifest#975), or Chrome paints the navigation bar from the page's `theme-color` meta.

One report says Chrome 156 changes how the bar is painted; unverified. **How to check:** open the installed app on the phone with the temporary probe (a fixed element at `bottom: 0`, `innerHeight` against `screen.height`, the insets read through an element with `padding: env(safe-area-inset-bottom)`), a few lines of script added to `theme-boot.js` for the test and not committed.
