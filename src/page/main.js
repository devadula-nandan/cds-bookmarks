// The new tab page's entry point: load state from storage, wire up events, render, and re-render
// whenever storage changes (the background worker writes sync results there).

import { ANSWERS } from "../bob.js";
import { dayKey, loadDay, normalizeSettings, saveSettings, storage, timeAgo } from "../core.js";
import { reposReady } from "../repos.js";
import { bindBobEffects, bindBobSheet, bobActions, hasMinimised, markTriggers, openFromTrigger, submitBobForm } from "./bob.js";
import { bindActivity, headerActions, maybeSync, renderActivity, renderMasthead, renderRepos, renderTools, requestSync } from "./header.js";
import { icon } from "./icons.js";
import { bindEditor, editorActions } from "./repo-editor.js";
import { bindSearch, focusSearch } from "./search.js";
import { applyTheme, bindSettings, checkBob, connect, onSettingsChange, openSettings, renderSettings, settingsActions } from "./settings.js";
import { renderToday, toggleTodo, todayActions, addTodos } from "./today.js";
import { $, $$, agoText, connected, state, toast } from "./ui.js";
import { moveInList, renderWork, selectTab, workActions } from "./work.js";

/** Every `data-action` on the page, by name. */
const actions = { ...headerActions, ...workActions, ...todayActions, ...settingsActions, ...bobActions, ...editorActions };

export function renderAll() {
  renderMasthead();
  renderTools();
  renderRepos();
  renderWork();
  renderToday();
}

// ---------- events ----------

function onClick(e) {
  // A button showing a minimised Bob's status opens that session instead (tabs still switch, though).
  const marked = e.target.closest("[data-bob-status]:not([data-tab])");
  if (marked) return openFromTrigger(marked);
  const tab = e.target.closest("[data-tab]");
  if (tab) return selectTab(tab.dataset.tab);
  const el = e.target.closest("[data-action]");
  if (!el || el.type === "checkbox" || !actions[el.dataset.action]) return;
  // Buttons with popovertarget still need their default action to open the popover.
  if (!el.hasAttribute("popovertarget")) e.preventDefault();
  actions[el.dataset.action](el);
}

async function onSubmit(e) {
  const form = e.target.closest("[data-form]");
  if (!form) return;
  e.preventDefault();
  const name = form.dataset.form;
  const value = String(new FormData(form).values().next().value || "").trim();
  if (name === "connect") connect(value, form);
  if (name === "todo" && value) {
    form.reset();
    await addTodos([value]);
    $('[data-focus="todo-input"]').focus();
  }
  if (name === "bob-key" && value) {
    state.settings = await saveSettings({ bobKey: value });
    toast("Bob API key saved", "success");
    renderSettings();
    checkBob();
  }
  if (name.startsWith("bob-")) submitBobForm(name, value);
}

function onChange(e) {
  const el = e.target;
  if (el.dataset.action === "todo-toggle") toggleTodo(el.dataset.id, el.checked);
  else if (el.closest("#settings")) onSettingsChange(el);
}

/** Keyboard shortcuts (the list is in Settings → Keyboard). */
function onKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    return focusSearch();
  }
  // Enter in a repo menu's version field opens that version.
  if (e.key === "Enter" && e.target.matches(".menu__version")) return actions["open-version"](e.target);
  // Arrow keys move between work tabs, and between rows.
  if (e.target.matches("[role=tab]") && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
    const tabs = $$("[role=tab]");
    const next = tabs[(tabs.indexOf(e.target) + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    return selectTab(next.dataset.tab, true);
  }
  if (e.target.matches(".item__title") && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    return moveInList(e.key === "ArrowDown" ? 1 : -1);
  }
  const typing = e.target.matches("input, textarea, select, [contenteditable]");
  if (typing || e.metaKey || e.ctrlKey || e.altKey || $("dialog[open]") || $("#snooze-menu:popover-open")) return;
  const key = e.key.toLowerCase();
  if (key === "/") {
    e.preventDefault();
    focusSearch();
  } else if (key === "?") openSettings("keys");
  else if (key === "j") moveInList(1);
  else if (key === "k") moveInList(-1);
  else if (key === "s") document.activeElement.closest("#work .item")?.querySelector("[data-action=snooze-menu]")?.click();
  else if (key === "r") requestSync(true);
  else if (key === "a") $("#activity").togglePopover();
  else if (/^[1-4]$/.test(key) && connected()) selectTab(["focus", "issues", "prs", "following"][key - 1], true);
}

// ---------- state from storage ----------

/** Another tab or the background worker changed something in storage. */
function onStorage(changes) {
  // The repo list was edited: reload, so everything is built from the new list.
  if (changes.repoData) return location.reload();
  const value = (key, fallback) => changes[key].newValue ?? fallback;
  if (changes.settings) {
    const theme = state.settings.theme;
    state.settings = normalizeSettings(value("settings", {}));
    if (state.settings.theme !== theme) applyTheme();
    if ($("#settings").open && !$("#settings").contains(document.activeElement)) renderSettings();
  }
  if (changes.cache) state.cache = value("cache", null);
  if (changes.status) state.status = value("status", {});
  if (changes.activity) state.activity = value("activity", []);
  if (changes.activitySeenAt) state.seenAt = value("activitySeenAt", null);
  if (changes.activityClearedAt) state.clearedAt = value("activityClearedAt", null);
  if (changes.bugHunts) state.bugHunts = value("bugHunts", []);
  if (changes.followHidden) state.followHidden = value("followHidden", {});
  if (changes.snoozedUntilChange) state.untilChange = value("snoozedUntilChange", {});
  if (changes[ANSWERS]) state.answered = new Set(Object.keys(value(ANSWERS, {})));
  if (changes[dayKey()]) state.day = { todos: [], snoozed: {}, ...value(dayKey(), {}) };
  if (changes.huntState) {
    const was = state.huntState;
    state.huntState = value("huntState", {});
    if (was.running && !state.huntState.running) toast(state.huntState.error ? `Bug hunt failed: ${state.huntState.error}` : "Bug hunt finished. See Bug of the day.", state.huntState.error ? "error" : "success");
  }
  if (changes.activity && $("#activity:popover-open")) renderActivity();
  requestAnimationFrame(renderAll);
}

async function load() {
  const saved = await storage.get(null);
  Object.assign(state, {
    settings: normalizeSettings(saved.settings),
    cache: saved.cache || null,
    status: saved.status || {},
    activity: saved.activity || [],
    seenAt: saved.activitySeenAt || null,
    clearedAt: saved.activityClearedAt || null,
    huntState: saved.huntState || {},
    bugHunts: saved.bugHunts || [],
    followHidden: saved.followHidden || {},
    untilChange: saved.snoozedUntilChange || {},
    answered: new Set(Object.keys(saved[ANSWERS] || {})),
    day: await loadDay(),
  });
}

/** Every 10 seconds: the clock, relative times and meetings. At midnight, a new day of to-dos. */
let today = dayKey();
async function tick() {
  if (dayKey() !== today) {
    today = dayKey();
    state.day = await loadDay();
    return renderAll();
  }
  renderMasthead();
  $$("[data-at]").forEach((el) => (el.textContent = timeAgo(el.dataset.at)));
  $$("[data-ago]").forEach((el) => (el.textContent = agoText(el.dataset.ago)));
  if (!$("#today").contains(document.activeElement)) renderToday();
}

async function start() {
  $$("[data-icon]").forEach((el) => (el.innerHTML = icon(el.dataset.icon, 18)));
  await reposReady;
  await load();
  applyTheme();

  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("change", onChange);
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && maybeSync());
  chrome.storage.onChanged.addListener(onStorage);
  // Re-renders replace the buttons that started Bob sessions; put their status back on the new ones.
  new MutationObserver(() => hasMinimised() && markTriggers()).observe(document.body, { childList: true, subtree: true });
  // Repo menus live apart from their buttons, so mark the button whose menu is open (its chevron turns).
  $("#repo-menus").addEventListener("toggle", (e) => $(`[popovertarget="${e.target.id}"]`)?.classList.toggle("is-open", e.newState === "open"), true);
  bindSearch();
  bindActivity();
  bindSettings();
  bindEditor();
  bindBobSheet();
  bindBobEffects();

  renderAll();
  document.body.classList.add("is-ready");
  setInterval(tick, 10000);
  maybeSync();
  // The helper reports the home folder, which VS Code links need.
  if (state.settings.ai && !state.settings.homeDir) checkBob();
}

start();
