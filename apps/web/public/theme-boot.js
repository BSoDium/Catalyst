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
