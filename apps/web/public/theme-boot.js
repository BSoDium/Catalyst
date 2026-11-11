/* The visitor's colour scheme, before the first paint (lib/theme.ts): the choice kept in localStorage ("light" or "dark"; "system" or nothing is the OS's) as the root's `data-scheme`, and the browser UI's colour with it.
   An app installed on a PHONE (not a tab of a browser, not a desktop app) starts dark when the visitor has never chosen: Chrome on Android paints the app's navigation bar from the manifest, a manifest has one colour (dark),
   so a pale page sat on a black strip. A default only: every choice stays available, "system" included (docs/pwa-system-bars.md). The root says so with `data-phone-app`, which lib/theme.ts reads. */
try {
  var root = document.documentElement;
  var phoneApp = matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)").matches && matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 600;
  if (phoneApp) root.setAttribute("data-phone-app", "");
  var t = localStorage.getItem("theme");
  if (t !== "light" && t !== "dark" && t !== "system" && phoneApp) t = "dark";
  if (t === "light" || t === "dark") {
    root.setAttribute("data-scheme", t);
    var c = t === "dark" ? "#0a0a0a" : "#fbfbfb";
    var m = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < m.length; i++) m[i].setAttribute("content", c);
  }
} catch (e) {}

/* The installed app is edge to edge (a phone's status and navigation bars, a notch): `viewport-fit=cover`, which only the app gets (the page's `--safe-*` insets, app.css, keep what is pinned to an edge clear of the bars). A tab of a browser keeps the safe area: with it, an iPhone in landscape would draw the page under its notch. */
try {
  if (window.matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui), (display-mode: window-controls-overlay)").matches) {
    var v = document.querySelector('meta[name="viewport"]');
    if (v && v.getAttribute("content").indexOf("viewport-fit") < 0) v.setAttribute("content", v.getAttribute("content") + ", viewport-fit=cover");
  }
} catch (e) {}
