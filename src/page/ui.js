// The page's state (a copy of what's in storage) and small helpers shared by every part of the page.

import { MODES, answerKey, modeFor } from "../bob.js";
import { esc, defaultSettings, timeAgo, todayKey } from "../core.js";
import { focusQueue, isSnoozed } from "../insights.js";
import { enabledRepos, repoLabel, repos } from "../repos.js";
import { icon } from "./icons.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const PRIVACY_URL = "https://github.com/devadula-nandan/cds-bookmarks/blob/main/PRIVACY.md";
export const CLASSIC_TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,notifications,read:org&description=Dev%20Dashboard";

/** Everything the page shows. main.js loads it from storage and keeps it current as storage changes. */
export const state = {
  settings: defaultSettings(),
  cache: null, // the last sync's GitHub data
  status: {}, // sync status: syncing, at, error
  day: { todos: [], snoozed: {} },
  activity: [],
  seenAt: null, // when Activity was last opened
  clearedAt: null,
  huntState: {},
  bugHunts: [],
  followHidden: {}, // followed threads hidden until their next reply
  untilChange: {}, // snoozed until the item has new activity
  answered: new Set(), // keys of Bob's saved answers
  bobStatus: null,
};

/** The selected work tab, remembered in this browser only. */
export const view = { tab: localStorage.getItem("devdash-tab") || "focus" };
export const saveView = () => localStorage.setItem("devdash-tab", view.tab);

// ---------- derived state ----------

export const data = () => state.cache?.data || null;
export const connected = () => !!state.settings.token;
export const aiOn = () => state.settings.ai;
export const allTasks = () => focusQueue(data(), state.settings);
export const visibleTasks = () => allTasks().filter((t) => !isSnoozed(t, state.day.snoozed, state.untilChange));
export const activityList = () => state.activity.filter((a) => !state.clearedAt || a.createdAt > state.clearedAt);
export const unread = () => activityList().filter((a) => !state.seenAt || a.createdAt > state.seenAt).length;
export const shownRepos = () => repos.filter((r) => !state.settings.disabledRepos.includes(r.id));
export const repoScope = () => enabledRepos(state.settings).map((r) => `repo:${r.slug}`).join(" ");
export const searchUrl = (q) => `https://github.com/search?type=issues&q=${encodeURIComponent(q)}`;

/** Assigned issues and mentions that aren't already under Pull requests. */
export function issueItems(d) {
  const taken = new Set([...d.reviews.items, ...d.mine.items].map((i) => i.id));
  const out = [];
  for (const [list, why] of [[d.assigned.items, "assigned"], [d.mentions.items, "mention"]])
    for (const item of list)
      if (!taken.has(item.id)) {
        taken.add(item.id);
        out.push({ item, why });
      }
  return out;
}

/** "error", "warning" or "success" for a repo's main branch. */
export function mainTone(main) {
  if (["FAILURE", "ERROR"].includes(main?.state)) return "error";
  if (["PENDING", "EXPECTED"].includes(main?.state)) return "warning";
  return main?.state === "SUCCESS" ? "success" : null;
}

/** A vscode:// link to a clone, or a file and line in it. Paths are saved as "~/…"; the helper tells us the home folder. */
export function vscodeUrl(clone, file, line) {
  const home = state.settings.homeDir;
  if (!clone || (clone.startsWith("~") && !home)) return null;
  const dir = clone.replace(/^~/, home).replace(/\/$/, "");
  return `vscode://file${encodeURI(file ? `${dir}/${file}${line ? `:${line}` : ""}` : dir)}`;
}

export function go(url, newTab) {
  if (newTab) window.open(url, "_blank", "noopener");
  else location.assign(url);
}

// ---------- markup ----------

export const agoText = (at) => (timeAgo(at) === "now" ? "just now" : `${timeAgo(at)} ago`);

export const iconChip = (name, tone = "neutral") => `<span class="chip-icon tone-${tone}">${icon(name, 16)}</span>`;

export const timeEl = (at) => (at ? `<time class="item__time" data-at="${esc(at)}" data-tooltip="${esc(new Date(at).toLocaleString())}">${timeAgo(at)}</time>` : "");

/** "Carbon #123". */
export const ref = (item) => `${esc(repoLabel(item.repo))} <span class="mono">#${item.number}</span>`;

/** Row key → what Bob should look at for that row's ✦ button. Rebuilt on every work render. */
export const bobTargets = new Map();

/** One row of a list. `bob` ({ item, kind, task }) adds Bob's button; `snooze` and `unfollow` add theirs. */
export function row({ key, url, title, iconName, tone, meta, at, bob, snooze, unfollow }) {
  let buttons = "";
  if (bob && aiOn()) {
    bobTargets.set(key, bob);
    const { label, verb } = MODES[modeFor(bob.item, bob.kind)];
    // Bob already answered this version of the item: the ✦ turns blue.
    const ready = state.answered.has(answerKey(bob));
    buttons += `<button class="icon-btn icon-btn--sm bob-btn${ready ? " bob-made" : ""}" data-action="bob-item" data-key="${esc(key)}" data-tooltip="${esc(ready ? `${label} · answer ready` : verb)}" aria-label="${esc(verb)}">${icon("sparkle", 16)}</button>`;
  }
  if (snooze) buttons += `<button class="icon-btn icon-btn--sm" data-action="snooze-menu" data-key="${esc(snooze)}" popovertarget="snooze-menu" data-tooltip="Snooze" aria-label="Snooze ${esc(title)}">${icon("snooze", 16)}</button>`;
  if (unfollow) buttons += `<button class="icon-btn icon-btn--sm" data-action="unfollow" data-id="${esc(unfollow)}" data-tooltip="Hide until there's a new reply" aria-label="Hide ${esc(title)}">${icon("x", 16)}</button>`;
  return `
    <li class="item">
      ${iconChip(iconName, tone)}
      <div class="item__body">
        <a class="item__title" href="${esc(url)}" data-focus="${esc(key)}">${esc(title)}</a>
        <p class="item__meta">${meta}</p>
      </div>
      <div class="item__end">${timeEl(at)}${buttons ? `<span class="item__actions">${buttons}</span>` : ""}</div>
    </li>`;
}

/** A titled list whose heading pins while its rows scroll. */
export function listSection(id, title, items, render, hint = "") {
  if (!items.length) return "";
  return `<div class="section"><h3 class="group">${title} <span>${items.length}</span>${hint ? `<small>${hint}</small>` : ""}</h3><ul class="items items--${id}">${items.map(render).join("")}</ul></div>`;
}

export const skeleton = () => `<ul class="items" aria-hidden="true">${'<li class="item item--skeleton"><span class="sk sk--icon"></span><div class="item__body"><span class="sk sk--line"></span><span class="sk sk--short"></span></div></li>'.repeat(5)}</ul>`;

export const emptyState = (iconName, title, text = "") => `<div class="empty">${iconChip(iconName, "success")}<p class="empty__title">${title}</p>${text ? `<p class="empty__text">${text}</p>` : ""}</div>`;

export const toggle = ({ attrs, checked, label, hint = "", disabled = false }) => `
  <label class="switch">
    <input type="checkbox" role="switch" ${attrs} ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
    <span class="switch__track" aria-hidden="true"></span>
    <span class="switch__text">${label}${hint ? `<small>${hint}</small>` : ""}</span>
  </label>`;

/** "45m", "1h", "1h 20m". */
export const duration = (mins) => (mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins}m`);

/** "Today", "Yesterday", or "Earlier" — or the date, such as "Oct 20", when `dated`. */
export function dayLabel(at, dated = false) {
  const key = todayKey(new Date(at));
  if (key === todayKey()) return "Today";
  if (key === todayKey(new Date(Date.now() - 86400000))) return "Yesterday";
  return dated ? new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Earlier";
}

// ---------- rendering ----------

/** Writes markup only when it changed, so a re-render with nothing new doesn't disturb the page. */
const written = new WeakMap();
export function setHtml(el, html) {
  if (written.get(el) === html) return;
  written.set(el, html);
  el.innerHTML = html;
}

/** Re-renders a region without losing keyboard focus, or what's being typed, inside it. */
export function keepFocus(root, render) {
  const active = root.contains(document.activeElement) ? document.activeElement : null;
  const key = active?.dataset.focus;
  const typed = key && active.matches("input:not([type=checkbox]), textarea") ? [active.value, active.selectionStart, active.selectionEnd] : null;
  render();
  const next = key && root.querySelector(`[data-focus="${CSS.escape(key)}"]`);
  if (!next) return;
  if (typed) {
    next.value = typed[0];
    next.setSelectionRange?.(typed[1], typed[2]);
  }
  next.focus({ preventScroll: true });
}

// ---------- feedback ----------

/** A short message at the bottom. `action` ({ label, run }) adds a button, such as Undo. Returns the element. */
export function toast(text, tone = "neutral", action = null) {
  const el = document.createElement("div");
  el.className = `toast toast--${tone}`;
  el.setAttribute("role", tone === "error" ? "alert" : "status");
  el.textContent = text;
  if (action) {
    const btn = document.createElement("button");
    btn.className = "toast__action";
    btn.textContent = action.label;
    btn.onclick = () => {
      el.remove();
      action.run();
    };
    el.append(btn);
  }
  const host = $("#toasts");
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  // Hovering holds it, so there's time to reach the button.
  let timer = setTimeout(() => el.remove(), action ? 6000 : 3200);
  el.onpointerenter = () => clearTimeout(timer);
  el.onpointerleave = () => (timer = setTimeout(() => el.remove(), 2000));
  return el;
}

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
