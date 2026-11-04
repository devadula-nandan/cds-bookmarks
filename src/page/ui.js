// The page's state (a copy of what's in storage) and small helpers shared by every part of the page.

import { MODES, answerKey, modeFor } from "../bob.js";
import { defaultSettings, timeAgo, todayKey } from "../core.js";
import { focusQueue, isSnoozed } from "../insights.js";
import { repoLabel, repos } from "../repos.js";
import DOMPurify from "../vendor/purify.es.js";
import { icon } from "./icons.js";
import { html, live, nothing, repeat, unsafeHTML } from "./lit.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const PRIVACY_URL = "https://github.com/devadula-nandan/cds-bookmarks/blob/main/PRIVACY.md";
export const CLASSIC_TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,notifications,read:org,read:project&description=Dev%20Dashboard";

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
  untilChange: {}, // snoozed until the item has new activity
  answered: new Set(), // keys of Bob's saved answers
  bobStatus: null,
  fixing: new Map(), // a row fix that's running ("action:id") → its button's label meanwhile
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
export const searchUrl = (q) => `https://github.com/search?type=issues&q=${encodeURIComponent(q)}`;

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

export const iconChip = (name, tone = "neutral") => html`<span class="chip-icon tone-${tone}">${icon(name, 16)}</span>`;

export const timeEl = (at) => (at ? html`<time class="item__time" data-tooltip=${new Date(at).toLocaleString()}>${timeAgo(at)}</time>` : nothing);

/** "Carbon #123". */
export const ref = (item) => html`${repoLabel(item.repo)} <span class="mono">#${item.number}</span>`;

/** A repo's logo, an SVG from bookmarks.json (which anyone can edit), sanitized once. */
const logos = new Map();
export function logo(markup) {
  if (!logos.has(markup)) logos.set(markup, DOMPurify.sanitize(String(markup || ""), { USE_PROFILES: { svg: true } }));
  return unsafeHTML(logos.get(markup));
}

/** One fact in a sheet's facts strip (the review brief, the bug of the day): an icon and a few words, coloured by `tone` (success, error or warning). */
export const fact = (iconName, content, { tone = "", tooltip = "" } = {}) =>
  html`<span class="fact ${tone ? `fact--${tone}` : ""}" data-tooltip=${tooltip || nothing}>${icon(iconName, 14)}<span>${content}</span></span>`;

/** Row key → what Bob should look at for that row's ✦ button. Rebuilt on every work render. */
export const bobTargets = new Map();

/**
 * One row of a list. `bob` ({ item, kind, task }) adds Bob's button; `snooze` adds the snooze menu's.
 * `cta` ({ label, action, id, tooltip, iconName, primary }) is the row's one-click fix, always in view;
 * while it runs, `state.fixing` holds its progress label.
 */
export function row({ key, url, title, iconName, tone, meta, at, bob, snooze, cta }) {
  const buttons = [];
  if (bob && aiOn()) {
    bobTargets.set(key, bob);
    const { label, verb } = MODES[modeFor(bob.item, bob.kind)];
    // Bob already answered this version of the item: the ✦ turns blue.
    const ready = state.answered.has(answerKey(bob));
    buttons.push(html`<button class="icon-btn icon-btn--sm bob-btn ${ready ? "bob-made" : ""}" data-action="bob-item" data-key=${key} data-tooltip=${ready ? `${label} · answer ready` : verb} aria-label=${verb}>${icon("sparkle", 16)}</button>`);
  }
  if (snooze) buttons.push(html`<button class="icon-btn icon-btn--sm" data-action="snooze-menu" data-key=${snooze} popovertarget="snooze-menu" data-tooltip="Snooze" aria-label="Snooze ${title}">${icon("snooze", 16)}</button>`);
  const busy = cta && state.fixing.get(`${cta.action}:${cta.id}`);
  return html`
    <li class="item">
      ${iconChip(iconName, tone)}
      <div class="item__body">
        <a class="item__title" href=${url}>${title}</a>
        <p class="item__meta">${meta}</p>
      </div>
      ${cta
        ? html`<button class="btn btn--sm ${cta.primary ? "btn--primary" : ""} item__cta" data-action=${cta.action} data-id=${cta.id} data-tooltip=${cta.tooltip || ""} ?disabled=${!!busy}>${busy || html`${cta.iconName ? icon(cta.iconName, 14) : nothing}${cta.label}`}</button>`
        : nothing}
      <div class="item__end">${timeEl(at)}${buttons.length ? html`<span class="item__actions">${buttons}</span>` : nothing}</div>
    </li>`;
}

/** Rows keyed by `key`, so a row (and focus in it) moves with its item when the list changes. */
const rows = (items, render, key) => repeat(items, key, render);

/** A titled list whose heading pins while its rows scroll. */
export function listSection(id, title, items, render, key, hint = "") {
  if (!items.length) return nothing;
  return html`<div class="section"><h3 class="group">${title} <span>${items.length}</span>${hint ? html`<small>${hint}</small>` : nothing}</h3><ul class="items items--${id}">${rows(items, render, key)}</ul></div>`;
}

/** Folded groups the user opened, kept open when a tab switch rebuilds the list. */
export const openFolds = new Set();

/** Like listSection, but folded until opened: for what can wait, such as stale items and dependency bumps. */
export function foldSection(id, title, items, render, key, hint = "") {
  if (!items.length) return nothing;
  return html`<details class="section section--fold" data-fold=${id} ?open=${openFolds.has(id)}><summary class="group">${title} <span>${items.length}</span>${hint ? html`<small>${hint}</small>` : nothing}${icon("chevronDown", 14)}</summary><ul class="items items--${id}">${rows(items, render, key)}</ul></details>`;
}

/** A plain list of rows, keyed like listSection's. */
export const itemList = (items, render, key) => html`<ul class="items">${rows(items, render, key)}</ul>`;

const SKELETON_ROW = html`<li class="item item--skeleton"><span class="sk sk--icon"></span><div class="item__body"><span class="sk sk--line"></span><span class="sk sk--short"></span></div></li>`;
export const skeleton = () => html`<ul class="items" aria-hidden="true">${[1, 2, 3, 4, 5].map(() => SKELETON_ROW)}</ul>`;

export const emptyState = (iconName, title, text = "") => html`<div class="empty">${iconChip(iconName, "success")}<p class="empty__title">${title}</p>${text ? html`<p class="empty__text">${text}</p>` : nothing}</div>`;

/** A switch. `data` is its data-* attribute, as [name, value]. */
export const toggle = ({ data: [name, value], checked, label, hint = "", disabled = false }) => html`
  <label class="switch">
    <input type="checkbox" role="switch" data-setting=${name === "setting" ? value : nothing} data-repo-toggle=${name === "repo" ? value : nothing} .checked=${live(checked)} ?disabled=${disabled}>
    <span class="switch__track" aria-hidden="true"></span>
    <span class="switch__text">${label}${hint ? html`<small>${hint}</small>` : nothing}</span>
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

/** Buttons waiting for a second click, by key → their label meanwhile ("Click again to …"). */
export const armed = new Map();

/** Click once to arm a button that can't be taken back, again within 4 seconds to do it. `redraw` re-renders the button. */
export function confirmed(key, label, redraw) {
  if (armed.has(key)) {
    armed.delete(key);
    return true;
  }
  armed.set(key, label);
  redraw();
  setTimeout(() => armed.delete(key) && redraw(), 4000);
  return false;
}

/** Any item from the last sync, by id. */
export function findItem(id) {
  const d = data();
  if (!d) return null;
  for (const key of ["reviews", "teamReviews", "reviewedOpen", "mine", "assigned", "mentions", "mentioning", "created", "triage", "merged"]) {
    const item = d[key]?.items.find((i) => i.id === id);
    if (item) return item;
  }
  return d.following?.find((i) => i.id === id) || null;
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
