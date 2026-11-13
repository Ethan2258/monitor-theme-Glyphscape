// Runs before the page is painted, so a visitor in the dark palette never sees
// a frame of the light one. The same decision src/App.tsx makes once it is up:
// the visitor's own choice ("theme", shared with the panel at /admin/), else
// the operator's default as this browser last saw it, else the system's.
(function () {
  var system = matchMedia("(prefers-color-scheme: dark)").matches;
  var dark = system;
  try {
    var saved = localStorage.getItem("theme");
    var mode = localStorage.getItem("inkpond:mode");
    dark = saved ? saved === "dark" : mode === "dark" || (mode !== "light" && system);
  } catch (e) {
    // Storage is switched off for the site: the system's answer stands.
  }
  if (dark) document.documentElement.classList.add("dark");
})();
