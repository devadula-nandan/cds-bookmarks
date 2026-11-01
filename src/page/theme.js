// Puts a Carbon theme on <html> before the stylesheet loads, so the page never flashes the other one: Gray 100
// when dark, White when light. "System" follows the OS as it changes. Settings saves the choice and fires
// "devdash-theme" to repaint.
const dark = matchMedia("(prefers-color-scheme: dark)");
function paintTheme() {
  const choice = localStorage.getItem("devdash-theme");
  const isDark = choice === "dark" || (choice !== "light" && dark.matches);
  document.documentElement.classList.toggle("cds--g100", isDark);
  document.documentElement.classList.toggle("cds--white", !isDark);
}
paintTheme();
dark.addEventListener("change", paintTheme);
addEventListener("devdash-theme", paintTheme);
