/**
 * Motion the page drives from script. All of it steps aside when the system asks for reduced motion; the CSS
 * shortens its own animations under the same setting. Page only.
 */
DD.motion = (() => {
  // Matches --ease in app.css.
  const EASE = "cubic-bezier(0.2, 0, 0, 1)";
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FOLDED = { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px" };

  /** Folds a row shut before it leaves, so the rows below slide up instead of jumping. */
  function collapse(el) {
    if (!el || calm()) return Promise.resolve();
    el.style.overflow = "hidden";
    return el
      .animate([{ height: `${el.offsetHeight}px`, opacity: 1 }, FOLDED], { duration: 180, easing: EASE, fill: "forwards" })
      .finished.catch(() => {});
  }

  /** The reverse, for a row that comes back. */
  function expand(el) {
    if (!el || calm()) return;
    el.style.overflow = "hidden";
    el.animate([FOLDED, { height: `${el.offsetHeight}px`, opacity: 1 }], { duration: 220, easing: EASE }).finished.then(
      () => (el.style.overflow = ""),
      () => {}
    );
  }

  /** Rows arriving one after another, from `from` (a transform); only the first ten, so long lists don't drag. */
  function stagger(els, from, { duration = 220, delay = 0 } = {}) {
    if (calm()) return;
    els.slice(0, 10).forEach((el, i) => el.animate({ opacity: [0, 1], transform: [from, "none"] }, { duration, delay: delay + i * 25, easing: EASE, fill: "backwards" }));
  }

  return { EASE, calm, collapse, expand, stagger };
})();
