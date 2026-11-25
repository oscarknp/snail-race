// Runs before the app loads so the page never flashes the wrong theme.
// Keep in sync with src/lib/theme.tsx (same storage key and rules).
(function () {
  var pref = "system";
  try {
    pref = localStorage.getItem("skyrace-theme") || "system";
  } catch (_) { /* storage blocked: follow the device */ }
  var dark = pref === "dark" ||
    (pref !== "light" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
