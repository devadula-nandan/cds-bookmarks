/** The new tab page. Reads state from storage, renders, and asks the background worker to sync. */

import { activityActions, bindActivity, renderActivity } from "./page/activity.js";
import { bindBobMagic, bob, bobActions, closeBob, firstBobTurn, markBobTrigger, minimiseBob, resumeBob, runBob } from "./page/bob.js";
import { agoText, toast } from "./page/pieces.js";
import { go, search } from "./page/search.js";
import { applyTheme, cloneCheckDue, connect, onSettingsChange, openSettings, refreshBobStatus, renderSettings, settingsActions } from "./page/settings.js";
import { $, $$, aiOn, connected, ext, searchUrl, state } from "./page/state.js";
import { bindToday, renderToday, todayActions } from "./page/today.js";
import { checkWorker, maybeSync, placeMenu, renderMasthead, renderRepos, renderTools, requestSync, topActions } from "./page/top.js";
import { moveInList, renderWork, selectTab, snoozeFrom, updateFades, workActions } from "./page/work.js";

const { EASE, calm, expand } = DD.motion;
const { icon } = DD.icons;
const { timeAgo } = DD.util;

/** Every data-action on the page, handled by the part of the page it belongs to. */
const actions = { ...topActions, ...workActions, ...todayActions, ...activityActions, ...settingsActions, ...bobActions };

function bind() {
  document.addEventListener("click", (e) => {
    // A button showing a minimised Bob's status brings Bob back instead of doing its usual thing.
    if (e.target.closest("[data-bob-status]")) {
      e.preventDefault();
      return resumeBob();
    }
    const tab = e.target.closest("[data-tab]");
    if (tab) return selectTab(tab.dataset.tab);
    const el = e.target.closest("[data-action]");
    if (!el || el.tagName === "INPUT") return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    // A popovertarget button still needs its default action to open the popover.
    if (!el.hasAttribute("popovertarget")) e.preventDefault();
    fn(el);
  });

  document.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-form]");
    if (!form) return;
    e.preventDefault();
    if (form.dataset.form === "connect") connect(new FormData(form).get("token") || "", form);
    if (form.dataset.form === "bob-key") {
      const key = String(new FormData(form).get("key") || "").trim();
      if (!key) return;
      DD.settings.save({ bobKey: key }).then((s) => {
        state.settings = s;
        toast("Bob API key saved", "success");
        renderSettings();
        refreshBobStatus();
      });
    }
    if (form.dataset.form === "bob-follow") {
      const q = String(new FormData(form).get("q") || "").trim();
      if (q && !bob.loading) runBob(q);
    }
    if (form.dataset.form === "bob-input") {
      const text = String(new FormData(form).get("text") || "").trim();
      if (!text || !bob.spec) return;
      bob.spec.text = text;
      runBob(null);
    }
    if (form.dataset.form === "bob-query") {
      const q = String(new FormData(form).get("q") || "").trim();
      if (q) go(searchUrl(q));
    }
    if (form.dataset.form === "todo") {
      const input = form.querySelector("input");
      const text = input.value.trim();
      if (!text) return;
      const todo = { id: DD.util.uid(), text, done: false };
      state.day.todos.push(todo);
      input.value = "";
      renderToday();
      $('[data-focus="todo-input"]')?.focus();
      expand($(`[data-focus="todo-${CSS.escape(todo.id)}"]`)?.closest(".todo"));
      DD.day.update((d) => d.todos.push(todo));
    }
  });

  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.action === "todo-toggle") {
      const id = el.dataset.id;
      const t = state.day.todos.find((x) => x.id === id);
      if (t) t.done = el.checked;
      renderToday();
      // The list re-renders, so a CSS transition has no "before"; draw the strike-through here.
      const text = $(`[data-focus="todo-${CSS.escape(id)}"]`)?.nextElementSibling;
      if (text && el.checked && !calm()) text.animate([{ offset: 0, color: "var(--text)", textDecorationColor: "transparent" }], { duration: 220, easing: EASE });
      DD.day.update((d) => {
        const x = d.todos.find((y) => y.id === id);
        if (x) x.done = el.checked;
      });
      return;
    }
    if (el.closest("#settings")) onSettingsChange(el);
  });

  $("#repo-menus").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset.actionEnter) {
      e.preventDefault();
      actions[e.target.dataset.actionEnter](e.target);
    }
  });

  $("#repo-menus").addEventListener(
    "toggle",
    (e) => {
      // The menus live apart from their buttons, so CSS can't see which one is open; mark it here.
      $(`[popovertarget="${e.target.id}"]`)?.classList.toggle("is-open", e.newState === "open");
      if (e.newState !== "open") return;
      if (!CSS.supports("anchor-name: --a")) placeMenu(e.target);
      e.target.querySelector("a")?.focus({ preventScroll: true });
    },
    true
  );

  bindBobMagic();
  DD.tooltip.bind();

  $("#snooze-menu").addEventListener("toggle", (e) => {
    // Hold the row's actions open while its menu is: the menu hides along with its anchor.
    snoozeFrom?.closest(".item")?.classList.toggle("is-active", e.newState === "open");
    if (e.newState !== "open") return;
    if (!CSS.supports("anchor-name: --a")) placeMenu(e.target, snoozeFrom);
    e.target.querySelector("button")?.focus({ preventScroll: true });
  });
  $("#snooze-menu").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const opts = $$("button", e.currentTarget);
    const i = opts.indexOf(document.activeElement);
    opts[(i + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length].focus();
  });

  bindToday();

  $("#sync-error").addEventListener("toggle", (e) => {
    if (e.newState === "open" && !CSS.supports("anchor-name: --a")) placeMenu(e.target);
  });

  $("#work").addEventListener("keydown", (e) => {
    if (e.target.matches(".item__title") && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      return moveInList(e.key === "ArrowDown" ? 1 : -1);
    }
    if (!e.target.matches("[role=tab]")) return;
    const tabs = $$("[role=tab]", $("#work"));
    const i = tabs.indexOf(e.target);
    let next = null;
    if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
    if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
    if (e.key === "Home") next = tabs[0];
    if (e.key === "End") next = tabs.at(-1);
    if (!next) return;
    e.preventDefault();
    selectTab(next.dataset.tab, true);
  });

  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      return search.focus();
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey || $("#settings").open || $("#ai").open || $("#snooze-menu").matches(":popover-open")) return;
    if (e.key === "/") {
      e.preventDefault();
      search.focus();
    } else if (e.key === "?") openSettings("keys");
    else if (e.key === "j" || e.key === "J") moveInList(1);
    else if (e.key === "k" || e.key === "K") moveInList(-1);
    else if (e.key === "s" || e.key === "S") {
      document.activeElement?.closest("#work .item")?.querySelector("[data-action=snooze-menu]")?.click();
    } else if (e.key === "r" || e.key === "R") requestSync(true);
    else if (e.key === "a" || e.key === "A") actions.activity();
    else if (/^[1-5]$/.test(e.key) && connected()) selectTab(["focus", "reviews", "prs", "issues", "following"][+e.key - 1], true);
  });

  $("#settings").addEventListener("click", (e) => {
    if (e.target === $("#settings")) $("#settings").close();
  });

  // Hand edits to a draft live on its turn, so re-renders and revision requests start from them.
  $("#ai").addEventListener("input", (e) => {
    const first = firstBobTurn();
    if (first && e.target.matches('[data-focus="bob-edit"], [data-focus="bob-query"]')) first.draft = e.target.value;
  });

  $("#ai").addEventListener("click", (e) => {
    if (e.target === $("#ai")) bob.loading ? minimiseBob() : closeBob();
  });
  // Escape closes the dialog natively: minimise if Bob is still working, otherwise stop it. The event is async, so skip it if Bob was reopened meanwhile.
  $("#ai").addEventListener("close", () => {
    if ($("#ai").open || bob.minimised) return;
    bob.loading ? minimiseBob() : closeBob();
  });
  // Renders replace the buttons that open Bob; keep a minimised Bob's status on the new ones.
  new MutationObserver(() => bob.minimised && markBobTrigger()).observe(document.body, { childList: true, subtree: true });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    tick();
    maybeSync();
  });

  // Scroll events don't bubble, so listen in the capture phase for the work list.
  document.addEventListener("scroll", (e) => e.target.classList?.contains("work__panel") && updateFades(e.target), true);
  addEventListener("resize", () => updateFades($(".work__panel")));

  bindActivity();
  DD.storage.onChange(onStorage);
}

/** Another tab or the background worker changed something. */
async function onStorage(changes) {
  if ("settings" in changes) {
    const before = state.settings;
    state.settings = DD.settings.normalize(changes.settings);
    if (before.theme !== state.settings.theme) applyTheme();
    if (before.demo !== state.settings.demo) state.demo = null;
  }
  if ("cache" in changes) state.cache = changes.cache || null;
  if ("status" in changes) state.status = changes.status || {};
  if ("activity" in changes) state.activity = changes.activity || [];
  if ("activitySeenAt" in changes) state.seenAt = changes.activitySeenAt || null;
  if ("activityClearedAt" in changes) state.clearedAt = changes.activityClearedAt || null;
  if ("huntState" in changes) {
    const was = state.huntState;
    state.huntState = changes.huntState || {};
    if (was?.running && !state.huntState.running)
      toast(state.huntState.error ? `Bug hunt failed: ${state.huntState.error}` : "Bug hunt finished. See Bug of the day.", state.huntState.error ? "error" : "success");
  }
  if ("bugHunts" in changes) state.bugHunts = changes.bugHunts || [];
  if ("followHidden" in changes) state.followHidden = changes.followHidden || {};
  if ("snoozedUntilChange" in changes) state.untilChange = changes.snoozedUntilChange || {};
  if (DD.ai.CACHE_KEY in changes) state.answered = new Set(Object.keys(changes[DD.ai.CACHE_KEY] || {}));
  if (dayKey in changes) state.day = { todos: [], snoozed: {}, ...changes[DD.day.key()] };
  scheduleRender();
  if ($("#activity").matches(":popover-open") && "activity" in changes) renderActivity();
  if ($("#settings").open && "settings" in changes && !$("#settings").contains(document.activeElement)) renderSettings();
}

let frame = 0;

function scheduleRender() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(renderAll);
}

export function renderAll() {
  renderMasthead();
  renderTools();
  renderRepos();
  renderWork();
  renderToday();
}

/** Once a minute: clock, relative times and meeting states, without rebuilding the work list. */
let lastMinute = -1;

let dayKey = DD.day.key();

function tick() {
  const now = new Date();
  if (now.getMinutes() === lastMinute) return;
  lastMinute = now.getMinutes();
  if (DD.day.key(now) !== dayKey) {
    dayKey = DD.day.key(now);
    DD.day.load(now).then((day) => {
      state.day = day;
      renderAll();
    });
  }
  renderMasthead();
  $$("[data-at]").forEach((el) => (el.textContent = timeAgo(el.dataset.at)));
  $$("[data-ago]").forEach((el) => (el.textContent = agoText(el.dataset.ago)));
  if (!$("#today").contains(document.activeElement)) renderToday();
}

async function load() {
  const stored = await DD.storage.get(["settings", "cache", "status", "activity", "activitySeenAt", "activityClearedAt", "huntState", "bugHunts", "followHidden", "snoozedUntilChange", DD.ai.CACHE_KEY]);
  state.settings = DD.settings.normalize(stored.settings);
  state.cache = stored.cache || null;
  state.status = stored.status || {};
  state.activity = stored.activity || [];
  state.seenAt = stored.activitySeenAt || null;
  state.clearedAt = stored.activityClearedAt || null;
  state.huntState = stored.huntState || {};
  state.bugHunts = stored.bugHunts || [];
  state.followHidden = stored.followHidden || {};
  state.untilChange = stored.snoozedUntilChange || {};
  state.answered = new Set(Object.keys(stored[DD.ai.CACHE_KEY] || {}));
  state.day = await DD.day.load();
}

async function init() {
  $$("[data-icon]").forEach((el) => (el.innerHTML = icon(el.dataset.icon, 18)));
  await load();
  applyTheme();
  bind();
  search.bind();
  renderAll();
  document.body.classList.add("is-ready");
  setInterval(tick, 10000);
  lastMinute = new Date().getMinutes();

  if (!ext) {
    DD.sync.setNotifier(async (events) => {
      if (document.visibilityState === "visible") return events.slice(0, 3).forEach((e) => toast(e.title));
      if ("Notification" in window && Notification.permission === "granted") events.forEach((e) => new Notification(e.title, { body: e.body || "", tag: e.key }));
    });
    setInterval(() => DD.sync.tick(), 60000);
  }
  maybeSync();
  checkWorker();
  // Only start the helper on a new tab when there's something to learn: the home folder or new clones.
  if (aiOn() && (!state.settings.homeDir || cloneCheckDue())) refreshBobStatus();
}

init();
