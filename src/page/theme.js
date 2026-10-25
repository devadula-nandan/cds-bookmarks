// Runs before the stylesheet, so a forced light or dark theme never flashes the other one.
const theme = localStorage.getItem("devdash-theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
