// The new tab page's entry point: load state from storage, wire up events, render, and re-render
// whenever storage changes (the background worker writes sync results there).

import { ANSWERS } from "../bob.js";
import { dayKey, loadDay, normalizeSettings, saveSettings, storage } from "../core.js";
import { reposReady } from "../repos.js";
import { bindBobSheet, bobActions, hasMinimised, markTriggers, openFromTrigger, renderBob, submitBobForm } from "./bob.js";
import { activityOpen, bindActivity, headerActions, maybeSync, renderActivity, renderMasthead, renderRepos, renderTools, requestSync, toggleActivity } from "./header.js";
import { bindEditor, editorActions } from "./repo-editor.js";
import { reviewActions } from "./review.js";
import { bindSearch, focusSearch } from "./search.js";
import { applyTheme, bindSettings, checkBob, connect, onSettingsChange, openSettings, renderSettings, settingsActions } from "./settings.js";
import { renderToday, toggleTodo, todayActions, addTodos } from "./today.js";
import { $, connected, go, state, toast } from "./ui.js";
import { bindWork, moveInList, renderWork, selectTab, workActions } from "./work.js";

/** Every `data-action` on the page, by name. */
const actions = { ...headerActions, ...workActions, ...todayActions, ...settingsActions, ...bobActions, ...editorActions, ...reviewActions };

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
  const marked = e.target.closest("[data-bob-status]:not(cds-tab)");
  if (marked) return openFromTrigger(marked);
  // A Carbon button's own <button> is in its shadow DOM, outside the form: submit the form for it.
  const submit = e.target.closest("cds-button[type=submit], cds-icon-button[type=submit]");
  if (submit) {
    e.preventDefault();
    return submit.disabled || submit.closest("form")?.requestSubmit();
  }
  // Menu items that open a link (the repo menus).
  const link = e.target.closest("[data-href]");
  if (link) return go(link.dataset.href, e.metaKey || e.ctrlKey);
  const el = e.target.closest("[data-action]");
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
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
    form.querySelector("cds-text-input").value = "";
    await addTodos([value]);
  }
  if (name === "bob-key" && value) {
    state.settings = await saveSettings({ bobKey: value });
    toast("Bob API key saved", "success");
    renderSettings();
    checkBob();
  }
  if (name.startsWith("bob-")) submitBobForm(name, value);
}

/** Carbon's toggles, checkboxes and selects say they changed with their own events; text fields with `change`. */
const CHANGES = ["change", "cds-toggle-changed", "cds-checkbox-changed", "cds-select-selected"];

function onChange(e) {
  const el = e.target;
  if (e.type === "change" && !el.matches("cds-text-input, cds-number-input, cds-textarea")) return;
  if (el.dataset.action === "todo-toggle") toggleTodo(el.dataset.id, el.checked);
  else if (el.closest("#settings")) onSettingsChange(el);
}

const FIELDS = "input, textarea, select, [contenteditable], cds-text-input, cds-password-input, cds-textarea, cds-number-input, cds-search, cds-select";

/** Keyboard shortcuts (the list is in Settings → Keyboard). */
function onKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    return focusSearch();
  }
  // Enter in a Carbon field submits its form (the field's own <input> is in its shadow DOM, outside the form).
  if (e.key === "Enter" && e.target.matches("cds-text-input, cds-password-input") && e.target.closest("form[data-form]")) {
    e.preventDefault();
    return e.target.closest("form").requestSubmit();
  }
  // Arrow keys move between rows (Carbon's tabs handle their own).
  if (e.target.matches(".item__title") && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    return moveInList(e.key === "ArrowDown" ? 1 : -1);
  }
  const typing = e.target.matches(FIELDS);
  if (typing || e.metaKey || e.ctrlKey || e.altKey || $("cds-modal[open]") || $("cds-overflow-menu[open]")) return;
  const key = e.key.toLowerCase();
  if (key === "/") {
    e.preventDefault();
    focusSearch();
  } else if (key === "?") openSettings("keys");
  else if (key === "j") moveInList(1);
  else if (key === "k") moveInList(-1);
  else if (key === "s") document.activeElement.closest("#work .item")?.querySelector(".snooze")?.click();
  else if (key === "b") document.activeElement.closest("#work .item")?.querySelector("[data-action=bob-item]")?.click();
  else if (key === "e") document.activeElement.closest("#work .item")?.querySelector("cds-button.item__cta")?.click();
  else if (key === "r") requestSync(true);
  else if (key === "a") toggleActivity();
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
    if ($("#settings").open) renderSettings();
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
  if (changes.activity && activityOpen()) renderActivity();
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

/** Every 10 seconds: the clock, relative times and meetings (only what changed is redrawn). At midnight, a new day of to-dos. */
let today = dayKey();
async function tick() {
  if (dayKey() !== today) {
    today = dayKey();
    state.day = await loadDay();
  }
  renderAll();
  if (activityOpen()) renderActivity();
  if ($("#ai").open) renderBob();
}

async function start() {
  await reposReady;
  await load();
  applyTheme();

  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  CHANGES.forEach((type) => document.addEventListener(type, onChange));
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && maybeSync());
  chrome.storage.onChanged.addListener(onStorage);
  // Re-renders replace the buttons that started Bob sessions; put their status back on the new ones.
  new MutationObserver(() => hasMinimised() && markTriggers()).observe(document.body, { childList: true, subtree: true });
  bindSearch();
  bindWork();
  bindActivity();
  bindSettings();
  bindEditor();
  bindBobSheet();

  renderAll();
  document.body.classList.add("is-ready");
  setInterval(tick, 10000);
  maybeSync();
  // The helper reports the home folder, which VS Code links need.
  if (state.settings.ai && !state.settings.homeDir) checkBob();
}

start();
