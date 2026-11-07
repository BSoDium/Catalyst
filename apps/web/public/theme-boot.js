/* The visitor's colour scheme, before the first paint (lib/theme.ts): the choice kept in localStorage ("light" or "dark"; anything else is the system's) as the root's `data-scheme`, and the browser UI's colour with it. */
try {
  var t = localStorage.getItem("theme");
  if (t === "light" || t === "dark") {
    document.documentElement.setAttribute("data-scheme", t);
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
