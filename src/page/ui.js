// The page's state (a copy of what's in storage) and small helpers shared by every part of the page.

import { MODES, answerKey, modeFor } from "../bob.js";
import { defaultSettings, timeAgo, todayKey } from "../core.js";
import { focusQueue, isSnoozed } from "../insights.js";
import { enabledRepos, repoLabel, repos } from "../repos.js";
import DOMPurify from "../vendor/purify.es.js";
import { icon } from "./icons.js";
import { html, nothing, repeat, unsafeHTML } from "./lit.js";

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

/** A Carbon icon in a status colour (tone: error, warning, success, info or neutral). */
export const iconChip = (name, tone = "neutral", slot = "") => html`<span class="status-icon tone-${tone}" slot=${slot || nothing}>${icon(name, 16)}</span>`;

let tips = 0;
/**
 * A Carbon tooltip on `content`. Plain text becomes focusable so keyboard users can reach the tooltip too;
 * a control (`control: true`), such as a button, is the trigger as it is.
 */
export function tip(text, content, { align = "top", control = false } = {}) {
  if (!text) return content;
  const id = `tip-${++tips}`;
  return html`<cds-tooltip class="tip" align=${align} autoalign enter-delay-ms="300">${control ? content : html`<span class="tip__trigger" tabindex="0" aria-describedby=${id}>${content}</span>`}<cds-tooltip-content id=${id}>${text}</cds-tooltip-content></cds-tooltip>`;
}

export const timeEl = (at) => (at ? tip(new Date(at).toLocaleString(), html`<time class="item__time">${timeAgo(at)}</time>`, { align: "left" }) : nothing);

/** "Carbon #123". */
export const ref = (item) => html`${repoLabel(item.repo)} <span class="mono">#${item.number}</span>`;

/** A repo's logo, an SVG from bookmarks.json (which anyone can edit), sanitized once. */
const logos = new Map();
export function logo(markup) {
  if (!logos.has(markup)) logos.set(markup, DOMPurify.sanitize(String(markup || ""), { USE_PROFILES: { svg: true } }));
  return unsafeHTML(logos.get(markup));
}

/** Carbon's status icons, for facts with a tone. */
const STATUS = { error: "errorFilled", warning: "warningFilled", success: "checkmarkFilled", info: "informationFilled" };

/** One fact in a sheet's facts strip (the review brief, the bug of the day): an icon and a few words; a `tone` (success, error or warning) shows Carbon's status icon in its colour. */
export const fact = (iconName, content, { tone = "", tooltip = "" } = {}) =>
  html`<span class="fact">${tip(tooltip, html`<span class="fact__body">${tone ? html`<span class="status-icon tone-${tone}">${icon(STATUS[tone], 16)}</span>` : icon(iconName, 16)}<span>${content}</span></span>`)}</span>`;

/** Row key → what Bob should look at for that row's Bob button. Rebuilt on every work render. */
export const bobTargets = new Map();

/**
 * One row of a list. `bob` ({ item, kind, task }) adds Bob's button; `snooze` and `unfollow` add theirs.
 * `cta` ({ label, action, id, tooltip, iconName, primary }) is the row's one-click fix, always in view;
 * while it runs, `state.fixing` holds its progress label.
 */
export function row({ key, url, title, iconName, tone, meta, at, bob, snooze, unfollow, cta }) {
  const buttons = [];
  if (bob && aiOn()) {
    bobTargets.set(key, bob);
    const { label, verb } = MODES[modeFor(bob.item, bob.kind)];
    // Bob already answered this version of the item: the button shows it's ready.
    const ready = state.answered.has(answerKey(bob));
    buttons.push(html`<cds-icon-button kind="ghost" size="sm" class="bob-btn ${ready ? "bob-made" : ""}" data-action="bob-item" data-key=${key} aria-label=${verb}>${icon("sparkle", 16, { slot: "icon" })}<span slot="tooltip-content">${ready ? `${label} · answer ready` : verb}</span></cds-icon-button>`);
  }
  if (snooze) buttons.push(snoozeMenu(snooze, title));
  if (unfollow) buttons.push(html`<cds-icon-button kind="ghost" size="sm" data-action="unfollow" data-id=${unfollow} aria-label="Hide ${title}">${icon("x", 16, { slot: "icon" })}<span slot="tooltip-content">Hide until there's a new reply</span></cds-icon-button>`);
  const busy = cta && state.fixing.get(`${cta.action}:${cta.id}`);
  const fix = !cta
    ? nothing
    : busy
      ? html`<cds-inline-loading class="item__cta" status=${busy === "Done" ? "finished" : "active"}>${busy}</cds-inline-loading>`
      : tip(cta.tooltip, html`<cds-button class="item__cta" size="sm" kind=${cta.primary ? "primary" : "tertiary"} data-action=${cta.action} data-id=${cta.id}>${cta.label}${cta.iconName ? icon(cta.iconName, 16, { slot: "icon" }) : nothing}</cds-button>`, { control: true });
  return html`
    <cds-contained-list-item class="item">
      ${iconChip(iconName, tone, "icon")}
      <div class="item__body">
        <cds-link class="item__title" href=${url}>${title}</cds-link>
        <p class="item__meta">${meta}</p>
      </div>
      <div class="item__end" slot="action">${fix}${timeEl(at)}${buttons.length ? html`<span class="item__actions">${buttons}</span>` : nothing}</div>
    </cds-contained-list-item>`;
}

/** A row's snooze button: a Carbon overflow menu with the two ways to snooze. */
const snoozeMenu = (key, title) => html`
  <cds-overflow-menu size="sm" class="snooze" aria-label="Snooze ${title}" align="left">
    ${icon("snooze", 16, { slot: "icon" })}<span slot="tooltip-content">Snooze</span>
    <cds-menu label="Snooze">
      <cds-menu-item label="Until tomorrow" data-action="snooze-for" data-key=${key} data-until="tomorrow"></cds-menu-item>
      <cds-menu-item label="Until there's new activity" data-action="snooze-for" data-key=${key} data-until="change"></cds-menu-item>
    </cds-menu>
  </cds-overflow-menu>`;

/** Rows keyed by `key`, so a row (and focus in it) moves with its item when the list changes. */
const rows = (items, render, key) => repeat(items, key, render);

const listLabel = (title, count, hint) => html`<span class="list-label" slot="label">${title}<cds-tag size="sm" type="gray">${count}</cds-tag>${hint ? html`<span class="list-label__hint">${hint}</span>` : nothing}</span>`;

/** A titled Carbon contained list; its heading pins while its rows scroll. */
export function listSection(id, title, items, render, key, hint = "") {
  if (!items.length) return nothing;
  return html`<cds-contained-list class="section items--${id}" kind="on-page" size="lg">${listLabel(title, items.length, hint)}${rows(items, render, key)}</cds-contained-list>`;
}

/** Folded groups the user opened, kept open when a tab switch rebuilds the list. */
export const openFolds = new Set();

/** Like listSection, but folded in a Carbon accordion until opened: for what can wait, such as stale items and dependency bumps. */
export function foldSection(id, title, items, render, key, hint = "") {
  if (!items.length) return nothing;
  return html`<cds-accordion class="fold" size="lg"><cds-accordion-item data-fold=${id} ?open=${openFolds.has(id)} title="${title} (${items.length})">
    ${hint ? html`<p class="fold__hint">${hint[0].toUpperCase()}${hint.slice(1)}</p>` : nothing}
    <cds-contained-list class="items--${id}" size="lg">${rows(items, render, key)}</cds-contained-list>
  </cds-accordion-item></cds-accordion>`;
}

/** A plain list of rows, keyed like listSection's. */
export const itemList = (items, render, key) => html`<cds-contained-list size="lg">${rows(items, render, key)}</cds-contained-list>`;

export const skeleton = () => html`<div class="skeleton" aria-hidden="true">${[1, 2, 3, 4, 5].map(() => html`<div class="skeleton__row"><cds-skeleton-text heading></cds-skeleton-text><cds-skeleton-text width="60%"></cds-skeleton-text></div>`)}</div>`;

export const emptyState = (iconName, title, text = "") =>
  html`<div class="empty">${iconChip(iconName, "success")}<p class="empty__title">${title}</p>${text ? html`<p class="empty__text">${text}</p>` : nothing}</div>`;

/** A Carbon toggle. `data` is its data-* attribute, as [name, value]. */
export const toggle = ({ data: [name, value], checked, label, hint = "", disabled = false }) => html`
  <cds-toggle class="setting-toggle" size="sm" label-text=${label} helper-text=${hint || nothing} label-a="On" label-b="Off" data-setting=${name === "setting" ? value : nothing} data-repo-toggle=${name === "repo" ? value : nothing} .toggled=${checked} ?disabled=${disabled}></cds-toggle>`;

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
  for (const key of ["reviews", "reviewedOpen", "mine", "assigned", "mentions", "triage", "merged"]) {
    const item = d[key]?.items.find((i) => i.id === id);
    if (item) return item;
  }
  return d.following?.find((i) => i.id === id) || null;
}

// ---------- feedback ----------

const KINDS = { neutral: "info", success: "success", error: "error", warning: "warning" };

/** A Carbon toast at the bottom. `action` ({ label, run }) makes it actionable, such as Undo. Returns the element. */
export function toast(text, tone = "neutral", action = null) {
  const el = document.createElement(action ? "cds-actionable-notification" : "cds-toast-notification");
  // An actionable toast would take focus from whatever the user is doing.
  Object.assign(el, { kind: KINDS[tone] || "info", title: text, statusIconDescription: tone, hasFocus: false });
  el.addEventListener("cds-notification-closed", () => el.remove());
  if (action) {
    const btn = document.createElement("cds-actionable-notification-button");
    btn.slot = "action";
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
