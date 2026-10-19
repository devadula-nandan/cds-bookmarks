/* Runs before the stylesheet so a forced light/dark theme never flashes the other one. */
(function () {
  try {
    var theme = localStorage.getItem("devdash-theme");
    if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();
