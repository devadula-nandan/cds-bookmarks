// The Settings sheet. Sections fold like an accordion: opening one closes the others.

import { bobStatus } from "../bob.js";
import { NOTIFY_LABELS, esc, plural, saveSettings, storage, uid } from "../core.js";
import { fetchViewer } from "../github.js";
import { repos } from "../repos.js";
import { requestSync } from "./header.js";
import { icon } from "./icons.js";
import { renderAll } from "./main.js";
import { $, $$, CLASSIC_TOKEN_URL, state, toast, toggle } from "./ui.js";

const sheet = () => $("#settings");
let openSection = "github";

const section = (id, title, body) =>
  `<details class="setting-section" id="set-${id}" name="settings" ${openSection === id ? "open" : ""}><summary><h3>${title}</h3>${icon("chevronDown", 16)}</summary>${body}</details>`;

const select = (setting, value, options) => `<select class="input input--select" data-setting="${setting}">${options.map(([v, text]) => `<option value="${v}" ${+value === v ? "selected" : ""}>${text}</option>`).join("")}</select>`;

function githubSection(s) {
  const rate = state.cache?.data?.rateLimit;
  const tokenInfo =
    s.tokenScopes === null
      ? "Fine-grained token — the GitHub inbox won't work and org policy may block it. A classic token is recommended."
      : s.tokenScopes !== undefined && s.token
        ? `Classic token · scopes: <code>${esc(s.tokenScopes || "none")}</code>`
        : `Use a <a href="${CLASSIC_TOKEN_URL}">classic token</a> with <code>repo</code>, <code>notifications</code> and <code>read:org</code>.`;
  return section(
    "github",
    "GitHub",
    `<p class="status-line"><span class="dot dot--${s.token ? "success" : "neutral"}"></span>${s.token ? `Connected${s.login ? ` as <b>${esc(s.login)}</b>` : ""}` : "Not connected"}</p>
     <form class="field-row" data-form="connect">
       <input class="input" type="password" name="token" placeholder="${s.token ? "Paste a new token to replace it" : "ghp_…"}" autocomplete="off" aria-label="GitHub token">
       <button class="btn btn--primary" type="submit">${s.token ? "Replace" : "Connect"}</button>
       ${s.token ? `<button class="btn btn--danger" type="button" data-action="disconnect">Disconnect</button>` : ""}
     </form>
     <p class="hint">${tokenInfo}${rate ? ` · API budget: ${rate.remaining}/${rate.limit} this hour.` : ""}</p>
     <div class="fields">
       <label class="field"><span>Check GitHub every</span>${select("pollMinutes", s.pollMinutes, [1, 2, 3, 5, 10, 15].map((m) => [m, `${m} min`]))}</label>
       <label class="field"><span>Reviews are overdue after</span>${select("staleReviewDays", s.staleReviewDays, [1, 2, 3, 5].map((d) => [d, plural(d, "day")]))}</label>
     </div>
     ${toggle({ attrs: 'data-setting="includeTeamReviews"', checked: s.includeTeamReviews, label: "Include team review requests", hint: "Otherwise only reviews requested from you directly" })}`
  );
}

function bobSection(s) {
  const st = state.bobStatus || {};
  const helper = st.checking
    ? `<span class="dot dot--neutral"></span>Looking for the Bob helper…`
    : st.ok
      ? `<span class="dot dot--success"></span><span>Helper ready · <b>Bob Shell ${esc(st.version)}</b></span>`
      : `<span class="dot dot--${st.code === "missing" ? "warning" : "error"}"></span><span>${esc(st.error || "Not checked yet")}</span>`;
  const setup =
    st.code === "missing"
      ? `<ol class="steps"><li>Install <a href="https://bob.ibm.com/docs/shell">Bob Shell</a> (it needs Node.js).</li><li>In Terminal, from the extension folder, run <code>sh ai-helper/install.sh</code></li><li>Click <b>Check again</b>.</li></ol>`
      : "";
  return section(
    "bob",
    "Bob",
    `${toggle({ attrs: 'data-setting="ai"', checked: s.ai, label: "Bob actions", hint: "Review briefs, CI explanations, day plans, standups and answers from IBM Bob, when you ask" })}
     ${
       s.ai
         ? `<p class="status-line">${helper}<button class="btn btn--ghost btn--sm" data-action="bob-check">Check again</button><button class="btn btn--ghost btn--sm" data-action="bob-test" ${s.bobKey && st.ok ? "" : "disabled"}>Send a test prompt</button></p>
            ${setup}
            <form class="field-row" data-form="bob-key">
              <input class="input" type="password" name="key" placeholder="${s.bobKey ? "Paste a new key to replace it" : "Bob API key"}" autocomplete="off" aria-label="Bob API key">
              <button class="btn btn--primary" type="submit">${s.bobKey ? "Replace" : "Save"}</button>
              ${s.bobKey ? `<button class="btn btn--danger" type="button" data-action="bob-key-remove">Remove</button>` : ""}
            </form>
            <p class="hint">${s.bobKey ? "Key saved. " : ""}Create an <b>Inference</b> key at <a href="https://bob.ibm.com">bob.ibm.com</a> under Settings → API keys. It stays in this browser and is only handed to Bob Shell on this computer.</p>
            <p class="hint">Nothing goes to Bob until you click a Bob action. Bob then works in agent mode, using gh, the web and your local clones, and counts toward your Bob usage.</p>
            ${toggle({ attrs: 'data-setting="bugHunt"', checked: s.bugHunt, label: "Daily bug hunt", hint: "Bob reads one clone a day, taking turns, and reports the most obvious easy-to-fix bug it can find" })}
            <div class="fields"><label class="field"><span>Hunt at</span><input class="input" type="time" data-setting="bugHuntTime" value="${esc(s.bugHuntTime)}" ${s.bugHunt ? "" : "disabled"}></label></div>
            <p class="hint">If the computer is asleep then, it runs when Chrome is next open. A hunt can take several minutes and uses your Bob quota.</p>`
         : ""
     }`
  );
}

function reposSection(s) {
  return section(
    "repos",
    "Repositories",
    `<p class="hint">Turned-off repos are hidden from the bar, search and your work list.</p>
     ${repos.map((r) => toggle({ attrs: `data-repo-toggle="${esc(r.id)}"`, checked: !s.disabledRepos.includes(r.id), disabled: !r.slug, label: esc(r.name), hint: `<span class="mono">${esc(r.slug || "no GitHub repo found")}</span>` })).join("")}
     <p class="field-row schema-actions">
       <button class="btn btn--sm" data-action="repo-editor">${icon("edit", 14)}Edit repositories</button>
       <button class="btn btn--ghost btn--sm" data-action="repo-export">Export JSON</button>
     </p>`
  );
}

function notificationsSection(s) {
  return section(
    "notifications",
    "Notifications",
    `${toggle({ attrs: 'data-setting="notifications"', checked: s.notifications, label: "Desktop notifications", hint: "Shown by Chrome, even when no new tab is open" })}
     <fieldset class="checks" ${s.notifications ? "" : "disabled"}>
       <legend>Notify me about</legend>
       ${Object.entries(NOTIFY_LABELS).map(([k, text]) => `<label class="check"><input type="checkbox" data-notify="${k}" ${s.notifyOn[k] ? "checked" : ""}><span>${text}</span></label>`).join("")}
     </fieldset>
     <button class="btn btn--sm" data-action="test-notification" ${s.notifications ? "" : "disabled"}>Send a test notification</button>`
  );
}

function meetingsSection(s) {
  return section(
    "meetings",
    "Meetings",
    `<p class="hint">Recurring weekday meetings appear under Today and are reminded 5 minutes before.</p>
     <ul class="meetings">
       ${s.meetings
         .map(
           (m) => `<li data-id="${esc(m.id)}">
             <input class="input input--sm" type="time" value="${esc(m.time)}" data-meeting="time" aria-label="Start time">
             <input class="input input--sm" value="${esc(m.title)}" data-meeting="title" aria-label="Title">
             <label class="minutes"><input class="input input--sm" type="number" min="5" step="5" value="${m.minutes}" data-meeting="minutes" aria-label="Length in minutes"><span>min</span></label>
             <button class="icon-btn icon-btn--sm" data-action="meeting-remove" aria-label="Remove ${esc(m.title)}">${icon("trash", 16)}</button>
           </li>`
         )
         .join("")}
     </ul>
     <button class="btn btn--sm" data-action="meeting-add">${icon("plus", 14)}Add meeting</button>`
  );
}

const KEYS = [
  [`<kbd>/</kbd> or <kbd>⌘</kbd><kbd>K</kbd>`, "Search"],
  ["<kbd>1</kbd>–<kbd>4</kbd>", "Switch work tabs"],
  ["<kbd>J</kbd><kbd>K</kbd> or <kbd>↓</kbd><kbd>↑</kbd>", "Move through your work"],
  ["<kbd>S</kbd>", "Snooze the selected item"],
  ["<kbd>R</kbd>", "Sync now"],
  ["<kbd>A</kbd>", "Activity"],
  ["<kbd>?</kbd>", "This list"],
];

export function renderSettings() {
  const s = state.settings;
  const scroll = $(".sheet__body", sheet())?.scrollTop || 0;
  sheet().innerHTML = `
    <header class="sheet__head">
      <h2>Settings</h2>
      <button class="icon-btn" data-action="close-settings" aria-label="Close settings">${icon("x", 18)}</button>
    </header>
    <div class="sheet__body">
      ${githubSection(s)}
      ${bobSection(s)}
      ${reposSection(s)}
      ${notificationsSection(s)}
      ${meetingsSection(s)}
      ${section("appearance", "Appearance", `<div class="segmented" role="radiogroup" aria-label="Theme">${[["system", "System"], ["light", "Light"], ["dark", "Dark"]].map(([v, t]) => `<button class="segmented__opt" role="radio" aria-checked="${s.theme === v}" data-action="theme" data-theme="${v}">${t}</button>`).join("")}</div>`)}
      ${section("keys", "Keyboard", `<dl class="keys">${KEYS.map(([k, what]) => `<div><dt>${k}</dt><dd>${what}</dd></div>`).join("")}</dl>`)}
      ${section("reset", "Reset", `<p class="hint">Removes the token, settings, to-dos and activity from this browser.</p><button class="btn btn--danger btn--sm" data-action="reset">Reset everything</button>`)}
    </div>`;
  $(".sheet__body", sheet()).scrollTop = scroll;
}

export function openSettings(id) {
  if (id) openSection = id;
  if (!state.bobStatus?.ok) checkBob();
  renderSettings();
  if (!sheet().open) sheet().showModal();
  if (id) $(`#set-${id}`)?.scrollIntoView({ block: "start" });
}

/** Remembers which section is open across re-renders. */
export function bindSettings() {
  sheet().addEventListener("toggle", (e) => e.target.matches(".setting-section") && e.target.open && (openSection = e.target.id.slice(4)), true);
  sheet().addEventListener("click", (e) => e.target === sheet() && sheet().close());
}

/** Asks the Bob helper whether it's installed; also learns the home folder for VS Code links. */
export async function checkBob() {
  if (!state.settings.ai) return;
  state.bobStatus = { checking: true };
  if (sheet().open) renderSettings();
  state.bobStatus = await bobStatus();
  if (state.bobStatus.home && state.bobStatus.home !== state.settings.homeDir) state.settings = await saveSettings({ homeDir: state.bobStatus.home });
  if (sheet().open) renderSettings();
}

export async function connect(token, form) {
  token = token.trim();
  if (!token) return;
  form.querySelector("[type=submit]").disabled = true;
  try {
    const viewer = await fetchViewer(token);
    // A different account starts fresh.
    await storage.remove(["cache", "snapshot", "status", "activity", "activitySeenAt", "activityClearedAt"]);
    Object.assign(state, { cache: null, status: {}, activity: [], seenAt: null, clearedAt: null });
    state.settings = await saveSettings({ token, login: viewer.login, tokenScopes: viewer.scopes });
    toast(`Connected as ${viewer.login}`, "success");
    sheet().close();
    renderAll();
    requestSync();
  } catch (err) {
    toast(`Couldn't connect: ${err.message}`, "error");
    form.querySelector("[type=submit]").disabled = false;
  }
}

export function applyTheme() {
  const t = state.settings.theme;
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  // theme.js reads this before the stylesheet loads, so a forced theme never flashes the other one.
  localStorage.setItem("devdash-theme", t);
}

async function setTheme(theme) {
  state.settings = await saveSettings({ theme });
  applyTheme();
  if (sheet().open) renderSettings();
}

export function toggleTheme() {
  const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  setTheme(dark ? "light" : "dark");
}

/** Click once to arm a destructive button, again within 4 seconds to do it. */
function confirmed(el, label) {
  if (el.dataset.armed) return true;
  el.dataset.armed = "1";
  const original = el.textContent;
  el.textContent = label;
  setTimeout(() => {
    delete el.dataset.armed;
    el.textContent = original;
  }, 4000);
  return false;
}

/** Changing what's tracked resets the comparison baseline, so the next sync doesn't announce everything as new. */
async function resetBaseline() {
  await storage.remove("snapshot");
  requestSync();
}

async function saveMeetings(meetings) {
  state.settings = await saveSettings({ meetings });
  renderSettings();
  renderAll();
}

export const settingsActions = {
  settings: (el) => {
    $("#activity").hidePopover();
    $("#sync-error").hidePopover();
    openSettings(el.dataset.section);
  },
  "close-settings": () => sheet().close(),
  theme: (el) => setTheme(el.dataset.theme),
  "bob-check": checkBob,
  "test-notification": async () => {
    const res = await chrome.runtime.sendMessage({ type: "test-notification" }).catch((err) => ({ ok: false, error: err.message }));
    toast(res?.ok ? "Test notification sent" : "Chrome blocked the notification — check your OS notification settings for Chrome", res?.ok ? "success" : "error");
  },
  "bob-key-remove": async (el) => {
    if (!confirmed(el, "Click again to remove")) return;
    state.settings = await saveSettings({ bobKey: "" });
    renderSettings();
  },
  disconnect: async (el) => {
    if (!confirmed(el, "Click again to disconnect")) return;
    await storage.remove(["cache", "snapshot", "status", "activity"]);
    Object.assign(state, { cache: null, status: {}, activity: [] });
    state.settings = await saveSettings({ token: "", login: "", tokenScopes: undefined });
    renderAll();
    renderSettings();
  },
  reset: async (el) => {
    if (!confirmed(el, "Click again to erase everything")) return;
    await storage.clear();
    localStorage.clear();
    location.reload();
  },
  "meeting-add": async () => {
    await saveMeetings([...state.settings.meetings, { id: uid(), title: "New meeting", time: "15:00", minutes: 30, days: [1, 2, 3, 4, 5] }]);
    $$('[data-meeting="title"]', sheet()).at(-1)?.select();
  },
  "meeting-remove": (el) => saveMeetings(state.settings.meetings.filter((m) => m.id !== el.closest("[data-id]").dataset.id)),
};

/** A field in Settings changed (main.js routes `change` events here). */
export async function onSettingsChange(el) {
  const s = state.settings;
  if (el.dataset.repoToggle) {
    const off = new Set(s.disabledRepos);
    el.checked ? off.delete(el.dataset.repoToggle) : off.add(el.dataset.repoToggle);
    state.settings = await saveSettings({ disabledRepos: [...off] });
    renderAll();
    return resetBaseline();
  }
  if (el.dataset.notify) {
    state.settings = await saveSettings({ notifyOn: { ...s.notifyOn, [el.dataset.notify]: el.checked } });
    return;
  }
  if (el.dataset.meeting) {
    const id = el.closest("[data-id]").dataset.id;
    const value = el.dataset.meeting === "minutes" ? Math.max(5, Number(el.value) || 15) : el.value;
    state.settings = await saveSettings({ meetings: s.meetings.map((m) => (m.id === id ? { ...m, [el.dataset.meeting]: value } : m)) });
    return renderAll();
  }
  const key = el.dataset.setting;
  if (!key) return;
  state.settings = await saveSettings({ [key]: el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? Number(el.value) : el.value });
  if (key === "includeTeamReviews") resetBaseline();
  if (key === "ai") checkBob();
  if (["notifications", "ai", "bugHunt"].includes(key)) renderSettings();
  renderAll();
}
