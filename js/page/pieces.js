/** Small view helpers shared by every part of the page: markup pieces, focus-safe rendering, toasts, copying. */

import { $, aiOn, aiTargets, state } from "./state.js";

const { esc, timeAgo } = DD.util;
const { icon } = DD.icons;

export function agoText(at) {
  const t = timeAgo(at);
  return t === "now" ? "just now" : `${t} ago`;
}

export function iconChip(name, tone) {
  return `<span class="chip-icon tone-${tone || "neutral"}">${icon(name, 16)}</span>`;
}

export function timeEl(at) {
  return at ? `<time class="item__time" data-at="${esc(at)}" datetime="${esc(at)}" data-tooltip="${esc(new Date(at).toLocaleString())}">${timeAgo(at)}</time>` : "";
}

export function ref(item) {
  return `${esc(DD.repos.label(item.repo))} <span class="mono">#${item.number}</span>`;
}

/** `ai` is what Bob gets for this row ({ item, kind, task }); the button only shows when Bob is on. */
export function row({ key, url, title, iconName, tone, meta, at, snooze, ai, dismiss }) {
  const mode = ai && aiOn() ? DD.ai.modeFor(ai.item || {}, ai.kind) : null;
  if (mode) aiTargets.set(key, ai);
  // Bob already answered this version of the item: the ✦ turns blue and its tooltip says so.
  const ready = mode && state.answered.has(DD.ai.answerKey(ai));
  const label = mode && DD.ai.MODES[mode].label;
  const verb = mode && (ready ? `Open Bob's answer: ${label}` : DD.ai.MODES[mode].verb);
  const buttons = [
    mode
      ? `<button class="icon-btn icon-btn--sm bob-btn${ready ? " bob-made" : ""}" data-action="ai-item" data-key="${esc(key)}" data-tooltip="${esc(ready ? `${label} · answer ready` : verb)}" aria-label="${esc(verb)}: ${esc(title)}">${icon("sparkle", 16)}</button>`
      : "",
    snooze ? `<button class="icon-btn icon-btn--sm" data-action="snooze-menu" data-key="${esc(snooze)}" popovertarget="snooze-menu" data-tooltip="Snooze" aria-label="Snooze ${esc(title)}">${icon("snooze", 16)}</button>` : "",
    dismiss ? `<button class="icon-btn icon-btn--sm" data-action="unfollow" data-id="${esc(dismiss)}" data-tooltip="Hide until there's a new reply" aria-label="Hide ${esc(title)} until there's a new reply">${icon("x", 16)}</button>` : "",
  ].join("");
  return `
    <li class="item">
      ${iconChip(iconName, tone)}
      <div class="item__body">
        <a class="item__title" href="${esc(url)}" data-focus="${esc(key)}">${esc(title)}</a>
        <p class="item__meta">${meta}</p>
      </div>
      <div class="item__end">
        ${timeEl(at)}
        ${buttons ? `<span class="item__actions">${buttons}</span>` : ""}
      </div>
    </li>`;
}

export function skeleton(lines = 5) {
  return `<ul class="items" aria-hidden="true">${Array.from({ length: lines }, () => `<li class="item item--skeleton"><span class="sk sk--icon"></span><div class="item__body"><span class="sk sk--line"></span><span class="sk sk--short"></span></div></li>`).join("")}</ul>`;
}

export function emptyState(iconName, title, text = "") {
  return `<div class="empty">${iconChip(iconName, "success")}<p class="empty__title">${title}</p>${text ? `<p class="empty__text">${text}</p>` : ""}</div>`;
}

export function toggle({ attrs, checked, label, hint = "", disabled = false }) {
  return `
    <label class="switch">
      <input type="checkbox" role="switch" ${attrs} ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
      <span class="switch__track" aria-hidden="true"></span>
      <span class="switch__text">${label}${hint ? `<small>${hint}</small>` : ""}</span>
    </label>`;
}

/** Writes markup only when it changed, so a re-render with nothing new doesn't cut short a running animation. */
const written = new WeakMap();

export function setHtml(el, html) {
  if (written.get(el) === html) return;
  written.set(el, html);
  el.innerHTML = html;
}

/** Re-render a region without losing keyboard focus inside it. */
export function keepFocus(root, render) {
  const active = document.activeElement;
  const inside = active && root.contains(active);
  const key = inside ? active.dataset.focus : null;
  const typed = key && active.matches("input:not([type=checkbox]), textarea") ? active.value : null;
  const caret = typed != null ? [active.selectionStart, active.selectionEnd] : null;
  render();
  if (!key) return;
  const next = root.querySelector(`[data-focus="${CSS.escape(key)}"]`);
  if (!next) return;
  if (typed != null) next.value = typed;
  next.focus({ preventScroll: true });
  if (caret && "setSelectionRange" in next) {
    try {
      next.setSelectionRange(...caret);
    } catch {}
  }
}

/** "45m", "1h", "1h 20m". */
export function duration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

export function dayLabel(at) {
  const key = DD.util.todayKey(new Date(at));
  if (key === DD.util.todayKey()) return "Today";
  if (key === DD.util.todayKey(new Date(Date.now() - 86400000))) return "Yesterday";
  return "Earlier";
}

/** Copies `text` and says so in a toast (`done`, or nothing when null). True when it worked. */
export async function copyText(text, done = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    if (done) toast(done, "success");
    return true;
  } catch {
    toast("Couldn't copy to the clipboard", "error");
    return false;
  }
}

/** `action` ({ label, run }) adds a button, such as Undo. */
export function toast(text, tone = "neutral", action = null) {
  const host = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast toast--${tone}`;
  el.setAttribute("role", tone === "error" ? "alert" : "status");
  el.textContent = text;
  let timer = 0;
  const leave = () => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 200);
  };
  const arm = () => (timer = setTimeout(leave, action ? 6000 : 3200));
  if (action) {
    const btn = document.createElement("button");
    btn.className = "toast__action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      clearTimeout(timer);
      el.remove();
      action.run();
    });
    el.append(btn);
    // Give people time to reach the button: pointing at or focusing the toast holds it.
    el.addEventListener("pointerenter", () => clearTimeout(timer));
    el.addEventListener("pointerleave", arm);
    el.addEventListener("focusin", () => clearTimeout(timer));
    el.addEventListener("focusout", arm);
  }
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  arm();
}
