/** The settings sheet, and the account, theme and notification changes it makes. */

import { renderAll } from "../app.js";
import { closeBob, openBob } from "./bob.js";
import { toast, toggle } from "./pieces.js";
import { $, $$, CLASSIC_TOKEN_URL, UI_KEY, ext, state } from "./state.js";
import { renderToday } from "./today.js";
import { maybeSync, renderRepos, requestSync } from "./top.js";

const { EASE, calm } = DD.motion;
const { esc, plural } = DD.util;
const { icon } = DD.icons;

const NOTIFY_LABELS = {
  reviewRequested: "Review requests",
  ciFailed: "CI fails on my PR",
  ciPassed: "CI passes on my PR",
  changesRequested: "Changes requested",
  approved: "My PR is approved",
  merged: "My PR is merged",
  conflict: "Merge conflicts",
  mentioned: "Mentions",
  assigned: "Assignments",
  mainBroken: "main breaks or recovers",
  release: "New releases",
  githubInbox: "Other GitHub inbox activity",
  meetings: "Meeting reminders",
  replies: "Replies on threads I follow",
  recheck: "New commits on PRs I reviewed",
  bugHunt: "Bug of the day",
};

function select(setting, value, options) {
  return `<select class="input input--select" data-setting="${setting}">${options.map(([v, t]) => `<option value="${v}" ${+value === v ? "selected" : ""}>${t}</option>`).join("")}</select>`;
}

/** Settings re-render whole, so a switch's own transition never runs; this replays the slide for any that flipped. */
function switchKey(input) {
  return JSON.stringify(input.dataset);
}

export function renderSettings() {
  const flipped = new Map($$("#settings .switch input").map((i) => [switchKey(i), i.checked]));
  const s = state.settings;
  const rl = state.cache?.data?.rateLimit;
  const tokenInfo = !s.token
    ? ""
    : s.tokenScopes === null
      ? "Fine-grained token — the GitHub inbox won't work and org policy may block it. A classic token is recommended."
      : s.tokenScopes !== undefined
        ? `Classic token · scopes: <code>${esc(s.tokenScopes || "none")}</code>${/notifications|repo/.test(s.tokenScopes || "") ? "" : " — add <code>notifications</code> for inbox activity"}`
        : "";

  const body = $(".sheet__body", $("#settings"));
  const scroll = body?.scrollTop || 0;
  $("#settings").innerHTML = `
    <header class="sheet__head">
      <h2>Settings</h2>
      <button class="icon-btn" data-action="close-settings" aria-label="Close settings">${icon("x", 18)}</button>
    </header>
    <div class="sheet__body">
      <section class="setting-section" id="set-github">
        <h3>GitHub</h3>
        <p class="status-line">
          <span class="dot dot--${s.token ? "success" : "neutral"}"></span>
          ${s.token ? `Connected${s.login ? ` as <b>${esc(s.login)}</b>` : ""}` : "Not connected"}
        </p>
        <form class="field-row" data-form="connect">
          <input class="input" type="password" name="token" placeholder="${s.token ? "Paste a new token to replace it" : "ghp_…"}" autocomplete="off" aria-label="GitHub token" data-focus="settings-token">
          <button class="btn btn--primary" type="submit">${s.token ? "Replace" : "Connect"}</button>
          ${s.token ? `<button class="btn btn--danger" type="button" data-action="disconnect">Disconnect</button>` : ""}
        </form>
        <p class="hint">${tokenInfo || `Use a <a href="${CLASSIC_TOKEN_URL}">classic token</a> with <code>repo</code>, <code>notifications</code> and <code>read:org</code>.`}${rl ? ` API budget: ${rl.remaining}/${rl.limit} this hour.` : ""}</p>
        <div class="fields">
          <label class="field"><span>Check GitHub every</span>${select("pollMinutes", s.pollMinutes, [1, 2, 3, 5, 10, 15].map((m) => [m, `${m} min`]))}</label>
          <label class="field"><span>Reviews are overdue after</span>${select("staleReviewDays", s.staleReviewDays, [1, 2, 3, 5].map((d) => [d, plural(d, "day")]))}</label>
        </div>
        ${toggle({ attrs: 'data-setting="includeTeamReviews"', checked: s.includeTeamReviews, label: "Include team review requests", hint: "Otherwise only reviews requested from you directly" })}
        ${toggle({ attrs: 'data-setting="demo"', checked: s.demo, label: "Sample data", hint: "Explore with realistic fake data" })}
      </section>

      ${bobSettings()}

      <section class="setting-section" id="set-repos">
        <h3>Repositories</h3>
        <p class="hint">Turned-off repos are hidden from the bar, search and your work list. Edit the list in <code>bookmarks-data.js</code>.</p>
        ${DD.repos.all
          .map((r) =>
            toggle({
              attrs: `data-repo-toggle="${esc(r.id)}"`,
              checked: !s.disabledRepos.includes(r.id),
              disabled: !r.slug,
              label: esc(r.name),
              hint: `<span class="mono">${esc(r.slug || "no GitHub repo found")}</span>`,
            })
          )
          .join("")}
      </section>

      <section class="setting-section" id="set-notifications">
        <h3>Notifications</h3>
        ${toggle({ attrs: 'data-setting="notifications"', checked: s.notifications, label: "Desktop notifications", hint: ext ? "Shown by Chrome, even when no new tab is open" : "Shown while this page is open in the background" })}
        <fieldset class="checks" ${s.notifications ? "" : "disabled"}>
          <legend>Notify me about</legend>
          ${Object.entries(NOTIFY_LABELS)
            .map(([k, text]) => `<label class="check"><input type="checkbox" data-notify="${k}" ${s.notifyOn[k] ? "checked" : ""}><span>${text}</span></label>`)
            .join("")}
        </fieldset>
        <button class="btn btn--sm" data-action="test-notification" ${s.notifications ? "" : "disabled"}>Send a test notification</button>
      </section>

      <section class="setting-section" id="set-schedule">
        <h3>Meetings</h3>
        <p class="hint">Recurring weekday meetings appear under Today and are reminded 5 minutes before.</p>
        <ul class="meetings">
          ${s.meetings
            .map(
              (m) => `
            <li data-id="${esc(m.id)}">
              <input class="input input--sm" type="time" value="${esc(m.time)}" data-meeting="time" aria-label="Start time">
              <input class="input input--sm" value="${esc(m.title)}" data-meeting="title" aria-label="Title">
              <label class="minutes"><input class="input input--sm" type="number" min="5" step="5" value="${m.minutes}" data-meeting="minutes" aria-label="Length in minutes"><span>min</span></label>
              <button class="icon-btn icon-btn--sm" data-action="meeting-remove" aria-label="Remove ${esc(m.title)}">${icon("trash", 16)}</button>
            </li>`
            )
            .join("")}
        </ul>
        <button class="btn btn--sm" data-action="meeting-add">${icon("plus", 14)}Add meeting</button>
      </section>

      <section class="setting-section" id="set-appearance">
        <h3>Appearance</h3>
        <div class="segmented" role="radiogroup" aria-label="Theme">
          ${[
            ["system", "System"],
            ["light", "Light"],
            ["dark", "Dark"],
          ]
            .map(([v, t]) => `<button class="segmented__opt" role="radio" aria-checked="${s.theme === v}" data-action="theme" data-theme="${v}">${t}</button>`)
            .join("")}
        </div>
      </section>

      <section class="setting-section" id="set-keys">
        <h3>Keyboard</h3>
        <dl class="keys">
          <div><dt><kbd>/</kbd> or <kbd>${/Mac/.test(navigator.platform) ? "⌘" : "Ctrl"}</kbd><kbd>K</kbd></dt><dd>Search</dd></div>
          <div><dt><kbd>1</kbd>–<kbd>4</kbd></dt><dd>Switch work tabs</dd></div>
          <div><dt><kbd>J</kbd><kbd>K</kbd> or <kbd>↓</kbd><kbd>↑</kbd></dt><dd>Move through your work</dd></div>
          <div><dt><kbd>S</kbd></dt><dd>Snooze the selected item</dd></div>
          <div><dt><kbd>R</kbd></dt><dd>Sync now</dd></div>
          <div><dt><kbd>A</kbd></dt><dd>Activity</dd></div>
          <div><dt><kbd>?</kbd></dt><dd>This list</dd></div>
        </dl>
      </section>

      <section class="setting-section">
        <h3>Reset</h3>
        <p class="hint">Removes the token, settings, to-dos and activity from this browser.</p>
        <button class="btn btn--danger btn--sm" data-action="reset">Reset everything</button>
      </section>
    </div>`;
  const next = $(".sheet__body", $("#settings"));
  if (next) next.scrollTop = scroll;
  if (calm()) return;
  $$("#settings .switch input").forEach((input) => {
    const was = flipped.get(switchKey(input));
    if (was === undefined || was === input.checked) return;
    const track = input.nextElementSibling;
    track.animate({ transform: [input.checked ? "none" : "translateX(14px)", input.checked ? "translateX(14px)" : "none"] }, { duration: 150, easing: EASE, pseudoElement: "::after" });
    track.animate({ backgroundColor: [input.checked ? "var(--border-strong)" : "var(--accent)", getComputedStyle(track).backgroundColor] }, { duration: 150, easing: EASE });
  });
}

function bobSettings() {
  const s = state.settings;
  if (!ext || !DD.ai.supported)
    return `<section class="setting-section" id="set-bob"><h3>Bob</h3><p class="hint">Bob actions run through Bob Shell on your computer, so they need the Chrome extension rather than the web version.</p></section>`;
  const st = state.bobStatus || {};
  const helper = st.checking
    ? `<span class="dot dot--neutral"></span>Looking for the Bob helper…`
    : st.ok
      ? `<span class="dot dot--success"></span><span>Helper ready · <b>Bob Shell ${esc(st.version)}</b></span>`
      : `<span class="dot dot--${st.code === "missing" ? "warning" : "error"}"></span><span>${esc(st.error || "Not checked yet")}</span>`;
  const setup =
    st.code === "missing"
      ? `<ol class="steps">
           <li>Install <a href="https://bob.ibm.com/docs/shell">Bob Shell</a> (it needs Node.js).</li>
           <li>In Terminal, from the <code>dev-dashboard</code> folder, run <code>sh ai-helper/install.sh</code></li>
           <li>Click <b>Check again</b>.</li>
         </ol>`
      : "";
  return `
    <section class="setting-section" id="set-bob">
      <h3>Bob</h3>
      ${toggle({ attrs: 'data-setting="ai"', checked: s.ai, label: "Bob actions", hint: "Review briefs, CI explanations, day plans, standups and answers from IBM Bob, when you ask" })}
      ${
        s.ai
          ? `<p class="status-line">${helper}<button class="btn btn--ghost btn--sm" data-action="bob-check">Check again</button></p>
             ${setup}
             <form class="field-row" data-form="bob-key">
               <input class="input" type="password" name="key" placeholder="${s.bobKey ? "Paste a new key to replace it" : "Bob API key"}" autocomplete="off" aria-label="Bob API key" data-focus="bob-key">
               <button class="btn btn--primary" type="submit">${s.bobKey ? "Replace" : "Save"}</button>
               ${s.bobKey ? `<button class="btn btn--danger" type="button" data-action="bob-key-remove">Remove</button>` : ""}
             </form>
             <p class="hint">${s.bobKey ? "Key saved. " : ""}Create an <b>Inference</b> key at <a href="https://bob.ibm.com">bob.ibm.com</a> under Settings → API keys. It stays in this browser and is only handed to Bob Shell on this computer.</p>
             <div class="fields">
               <label class="field"><span>Team ID, for General keys only</span><input class="input" data-setting="bobTeamId" value="${esc(s.bobTeamId)}" placeholder="Optional" autocomplete="off"></label>
             </div>
             <p class="hint">Nothing goes to Bob until you click a Bob action. Then that item's title, description, comments, diff or CI log is sent through Bob Shell and counts toward your Bob usage.</p>
             <button class="btn btn--sm" data-action="bob-test" ${s.bobKey && st.ok ? "" : "disabled"}>Send a test prompt</button>

             <h4 class="setting-sub">Local clones</h4>
             <p class="hint">Bob reads these for bug hunts and code questions, in ask mode, which doesn't change files. Leave a repo blank to skip it.</p>
             <div class="clones">
               ${DD.repos
                 .enabled(s)
                 .map(
                   (r) => `<label class="field"><span>${esc(r.name)}</span><input class="input mono" data-clone="${esc(r.slug)}" value="${esc(s.clones[r.slug] || "")}" placeholder="~/Source/${esc(DD.util.repoShort(r.slug))}" autocomplete="off" spellcheck="false"></label>`
                 )
                 .join("")}
             </div>
             <button class="btn btn--sm" data-action="bob-detect" ${st.ok ? "" : "disabled"}>Find clones on this computer</button>

             <h4 class="setting-sub">Bug of the day</h4>
             ${toggle({ attrs: 'data-setting="bugHunt"', checked: s.bugHunt, label: "Daily bug hunt", hint: "Bob reads one clone a day, taking turns, and reports the most obvious easy-to-fix bug it can find" })}
             <div class="fields">
               <label class="field"><span>Hunt at</span><input class="input" type="time" data-setting="bugHuntTime" value="${esc(s.bugHuntTime)}" ${s.bugHunt ? "" : "disabled"}></label>
             </div>
             <p class="hint">If the computer is asleep then, it runs when Chrome is next open. A hunt can take several minutes and uses your Bob quota.</p>`
          : ""
      }
    </section>`;
}

export async function refreshBobStatus() {
  if (!ext || !DD.ai.supported || !state.settings.ai) return;
  state.bobStatus = { checking: true };
  if ($("#settings").open) renderSettings();
  state.bobStatus = await DD.ai.status();
  if (state.bobStatus.home && state.bobStatus.home !== state.settings.homeDir) {
    state.settings = await DD.settings.save({ homeDir: state.bobStatus.home });
    renderRepos();
  }
  if ($("#settings").open) renderSettings();
  if (state.bobStatus.ok) autoFindClones();
}

/**
 * Fills in clones for repos that don't have one yet, at most once a day.
 * Paths the user typed are never replaced.
 */
function missingClones() {
  return DD.repos.enabled(state.settings).filter((r) => r.slug && !state.settings.clones[r.slug]);
}

export function cloneCheckDue() {
  const at = state.settings.clonesCheckedAt;
  return missingClones().length > 0 && (!at || Date.now() - Date.parse(at) > 86400000);
}

async function autoFindClones({ force = false } = {}) {
  const missing = missingClones();
  if (!missing.length || (!force && !cloneCheckDue())) return 0;
  let found = {};
  try {
    found = await DD.ai.findClones(missing.map((r) => r.slug));
  } catch {
    return 0;
  }
  const added = Object.keys(found).filter((slug) => !state.settings.clones[slug]);
  state.settings = await DD.settings.save({ clones: { ...found, ...state.settings.clones }, clonesCheckedAt: new Date().toISOString() });
  if (added.length) {
    toast(`Linked ${plural(added.length, "local clone")}: ${added.map((slug) => DD.util.repoShort(slug)).join(", ")}`, "success");
    renderRepos();
    renderToday();
    if ($("#settings").open) renderSettings();
  }
  return added.length;
}

export function openSettings(section) {
  const dialog = $("#settings");
  if (!state.bobStatus?.ok) refreshBobStatus();
  renderSettings();
  if (!dialog.open) dialog.showModal();
  if (section) $(`#set-${section}`)?.scrollIntoView({ block: "start" });
}

/** Two-step confirm for destructive buttons, instead of a blocking browser dialog. */
function confirmed(el, label) {
  if (el.dataset.armed) return true;
  el.dataset.armed = "1";
  const original = el.innerHTML;
  el.textContent = label;
  setTimeout(() => {
    if (!el.isConnected) return;
    delete el.dataset.armed;
    el.innerHTML = original;
  }, 4000);
  return false;
}

export async function connect(token, form) {
  token = token.trim();
  if (!token) return;
  const btn = form?.querySelector("[type=submit]");
  if (btn) btn.disabled = true;
  try {
    const viewer = await DD.github.fetchViewer(token);
    await DD.storage.remove(["cache", "snapshot", "status", "activity", "activitySeenAt", "activityClearedAt"]);
    Object.assign(state, { cache: null, status: {}, activity: [], seenAt: null, clearedAt: null, demo: null });
    state.settings = await DD.settings.save({ token, login: viewer.login, tokenScopes: viewer.scopes, demo: false });
    toast(`Connected as ${viewer.login}`, "success");
    if ($("#settings").open) $("#settings").close();
    renderAll();
    requestSync();
  } catch (err) {
    toast(`Couldn't connect: ${err.message}`, "error");
    if (btn) btn.disabled = false;
  }
}

export async function setDemo(on) {
  state.demo = null;
  state.settings = await DD.settings.save({ demo: on });
  renderAll();
  if ($("#settings").open) renderSettings();
  if (!on) maybeSync();
}

export function applyTheme() {
  const t = state.settings.theme;
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem("devdash-theme", t);
  } catch {}
}

async function setTheme(theme) {
  state.settings = await DD.settings.save({ theme });
  swapTheme(applyTheme);
  if ($("#settings").open) renderSettings();
}

/** One crossfade for the whole page, instead of every element changing colour on its own clock. */
function swapTheme(apply) {
  const root = document.documentElement;
  root.classList.add("is-theming");
  const done = () => requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("is-theming")));
  if (!document.startViewTransition || calm()) {
    apply();
    return done();
  }
  document.startViewTransition(apply).finished.finally(done);
}

export function toggleTheme() {
  const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  setTheme(dark ? "light" : "dark");
}

/** Changing what's tracked invalidates the diff baseline, so the next sync doesn't announce everything as new. */
async function resetBaseline() {
  await DD.storage.remove("snapshot");
  requestSync();
}

async function sendTestNotification() {
  if (ext) {
    const res = await chrome.runtime.sendMessage({ type: "test-notification" }).catch((err) => ({ ok: false, error: err.message }));
    toast(res?.ok ? "Test notification sent" : "Chrome blocked the notification — check your OS notification settings for Chrome", res?.ok ? "success" : "error");
    return;
  }
  if (!("Notification" in window)) return toast("This browser doesn't support notifications", "error");
  const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (perm !== "granted") return toast("The browser blocked notifications", "error");
  new Notification("Notifications are working", { body: "Reviews, CI failures and mentions will show up like this.", icon: "icons/icon-128.png" });
}

export const settingsActions = {
  settings: (el) => {
    $("#activity").matches(":popover-open") && $("#activity").hidePopover();
    $("#sync-error").matches(":popover-open") && $("#sync-error").hidePopover();
    if ($("#ai").open) closeBob();
    openSettings(el.dataset.section);
  },
  "close-settings": () => $("#settings").close(),
  "demo-on": () => setDemo(true),
  "demo-off": () => setDemo(false),
  theme: (el) => setTheme(el.dataset.theme),
  "test-notification": sendTestNotification,
  "bob-check": refreshBobStatus,
  "bob-test": () => {
    $("#settings").close();
    openBob({ title: "Test prompt", subtitle: "Checks that Bob Shell can answer", trigger: '[data-action="bob-test"]', build: async () => ({ prompt: "Reply with one short sentence confirming you can read this, and name the model you are if you know it." }) });
  },
  "bob-detect": async (el) => {
    el.disabled = true;
    const added = await autoFindClones({ force: true });
    if (!added) toast("No new clones found in your usual code folders");
    renderSettings();
  },
  "bob-key-remove": async (el) => {
    if (!confirmed(el, "Click again to remove")) return;
    state.settings = await DD.settings.save({ bobKey: "" });
    renderSettings();
  },
  disconnect: async (el) => {
    if (!confirmed(el, "Click again to disconnect")) return;
    await DD.storage.remove(["cache", "snapshot", "status", "activity"]);
    Object.assign(state, { cache: null, status: {}, activity: [] });
    state.settings = await DD.settings.save({ token: "", login: "", tokenScopes: undefined });
    renderAll();
    renderSettings();
  },
  reset: async (el) => {
    if (!confirmed(el, "Click again to erase everything")) return;
    await DD.storage.clear();
    ["devdash-theme", UI_KEY].forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {}
    });
    location.reload();
  },
  "meeting-add": async () => {
    const meetings = [...state.settings.meetings, { id: DD.util.uid(), title: "New meeting", time: "15:00", minutes: 30, days: [1, 2, 3, 4, 5] }];
    state.settings = await DD.settings.save({ meetings });
    renderSettings();
    renderToday();
    const titles = $$('[data-meeting="title"]', $("#settings"));
    titles.at(-1)?.select();
  },
  "meeting-remove": async (el) => {
    const id = el.closest("[data-id]").dataset.id;
    state.settings = await DD.settings.save({ meetings: state.settings.meetings.filter((m) => m.id !== id) });
    renderSettings();
    renderToday();
  },
};

export async function onSettingsChange(el) {
  const s = state.settings;
  if (el.dataset.repoToggle) {
    const disabled = new Set(s.disabledRepos);
    el.checked ? disabled.delete(el.dataset.repoToggle) : disabled.add(el.dataset.repoToggle);
    state.settings = await DD.settings.save({ disabledRepos: [...disabled] });
    renderAll();
    return resetBaseline();
  }
  if (el.dataset.notify) {
    state.settings = await DD.settings.save({ notifyOn: { ...s.notifyOn, [el.dataset.notify]: el.checked } });
    return;
  }
  if (el.dataset.clone) {
    const clones = { ...s.clones, [el.dataset.clone]: el.value.trim() };
    if (!clones[el.dataset.clone]) delete clones[el.dataset.clone];
    state.settings = await DD.settings.save({ clones });
    renderRepos();
    return renderToday();
  }
  if (el.dataset.meeting) {
    const id = el.closest("[data-id]").dataset.id;
    const field = el.dataset.meeting;
    const value = field === "minutes" ? Math.max(5, Number(el.value) || 15) : el.value;
    state.settings = await DD.settings.save({ meetings: s.meetings.map((m) => (m.id === id ? { ...m, [field]: value } : m)) });
    return renderToday();
  }
  const key = el.dataset.setting;
  if (!key) return;
  const value = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? Number(el.value) : el.value;
  if (key === "demo") return setDemo(value);
  if (key === "notifications" && value && !ext && "Notification" in window && Notification.permission !== "granted") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      el.checked = false;
      return toast("The browser blocked notifications", "error");
    }
  }
  state.settings = await DD.settings.save({ [key]: value });
  if (key === "notifications") renderSettings();
  if (key === "includeTeamReviews") resetBaseline();
  if (key === "staleReviewDays") renderAll();
  if (key === "ai") {
    renderAll();
    renderSettings();
    refreshBobStatus();
  }
  if (key === "bugHunt") {
    renderSettings();
    renderToday();
  }
}
