// The page's one tooltip, for every [data-tooltip]. It lives in the top layer so no scrolling list, menu or
// dialog clips it, and follows the pointer (keyboard focus anchors it to the element instead). It waits for
// the pointer to rest, less for keyboard focus; while one is showing, the next one appears at once.

export function bindTooltips() {
  const tip = document.getElementById("tooltip");
  let target = null;
  let pending = null;
  let timer = 0;
  let warmUntil = 0;
  // Where the pointer is, or null when keyboard focus opened the tooltip.
  let at = null;
  let frame = 0;

  function place() {
    const t = tip.getBoundingClientRect();
    let left;
    let top;
    if (at) {
      // Below and right of the pointer, clear of the cursor; flipped at the window's edges.
      left = at.x + 12 + t.width > innerWidth - 8 ? at.x - t.width - 8 : at.x + 12;
      top = at.y + 20 + t.height > innerHeight - 8 ? at.y - t.height - 10 : at.y + 20;
    } else {
      const r = target.getBoundingClientRect();
      top = r.top - t.height - 8 >= 8 ? r.top - t.height - 8 : r.bottom + 8;
      left = r.left + r.width / 2 - t.width / 2;
    }
    left = Math.min(Math.max(8, left), innerWidth - t.width - 8);
    tip.style.translate = `${Math.round(left)}px ${Math.round(top)}px`;
  }

  function show(el) {
    target?.removeAttribute("aria-describedby");
    target = el;
    tip.textContent = el.dataset.tooltip;
    // Re-show so it lands above anything opened since, such as a dialog.
    if (tip.matches(":popover-open")) tip.hidePopover();
    tip.showPopover();
    place();
    // Screen readers already hear the label; only describe when the tooltip adds something.
    if (el.dataset.tooltip !== (el.getAttribute("aria-label") || el.textContent).trim()) el.setAttribute("aria-describedby", "tooltip");
    requestAnimationFrame(function watch() {
      // A re-render can take the element away under a still pointer.
      if (target !== el) return;
      if (!el.isConnected) return hide();
      requestAnimationFrame(watch);
    });
  }

  function cancel() {
    clearTimeout(timer);
    pending = null;
  }

  function hide() {
    cancel();
    if (!target) return;
    target.removeAttribute("aria-describedby");
    target = null;
    warmUntil = Date.now() + 400;
    tip.hidePopover();
  }

  // Moving between a button and its icon fires pointerover again; that mustn't restart the wait.
  function schedule(el, delay) {
    if (el === target || el === pending) return;
    cancel();
    pending = el;
    timer = setTimeout(() => {
      pending = null;
      show(el);
    }, target || Date.now() < warmUntil ? 0 : delay);
  }

  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest?.("[data-tooltip]");
    if (!el || e.pointerType === "touch") return;
    at = { x: e.clientX, y: e.clientY };
    schedule(el, 500);
  });
  document.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch" || !(target || pending)?.contains(e.target)) return;
      at = { x: e.clientX, y: e.clientY };
      if (!target || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (target) place();
      });
    },
    { passive: true }
  );
  document.addEventListener("pointerout", (e) => {
    const el = e.target.closest?.("[data-tooltip]");
    if (!el || el.contains(e.relatedTarget)) return;
    cancel();
    if (el === target) hide();
  });
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest?.("[data-tooltip]");
    if (!el?.matches(":focus-visible")) return;
    at = null;
    schedule(el, 150);
  });
  document.addEventListener("focusout", (e) => {
    cancel();
    if (target?.contains(e.target)) hide();
  });
  // Anything the user does next makes the tooltip stale.
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("keydown", hide, true);
  addEventListener("scroll", hide, true);
}
