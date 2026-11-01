// The Settings sheet: a Carbon modal with its sections as tabs, the open one under them.

import { bobStatus } from "../bob.js";
import { NOTIFY_LABELS, plural, saveSettings, storage, uid } from "../core.js";
import { fetchViewer } from "../github.js";
import { repos } from "../repos.js";
import { requestSync, toggleActivity } from "./header.js";
import { icon } from "./icons.js";
import { html, live, nothing, render, repeat } from "./lit.js";
import { renderAll } from "./main.js";
import { $, $$, CLASSIC_TOKEN_URL, armed, confirmed, iconChip, state, toast, toggle } from "./ui.js";

const sheet = () => $("#settings");
let openSection = "github";

const section = (id, title, body) => ({ id, title, body });

const select = (setting, label, value, options) =>
  html`<cds-select size="md" label-text=${label} data-setting=${setting} value=${String(value)}>${options.map(([v, text]) => html`<cds-select-item value=${String(v)}>${text}</cds-select-item>`)}</cds-select>`;

/** A destructive button: the first click arms it (see confirmed() in ui.js), the second does it. */
const danger = (action, label, sm = false) => html`<cds-button kind="danger" size=${sm ? "sm" : "md"} type="button" data-action=${action}>${armed.get(action) || label}</cds-button>`;

const status = (tone, text) => html`<p class="status-line">${iconChip(STATUS_ICON[tone], tone)}<span>${text}</span></p>`;
const STATUS_ICON = { success: "checkmarkFilled", warning: "warningFilled", error: "errorFilled", neutral: "circleDash" };

const classicToken = html`<cds-link inline href=${CLASSIC_TOKEN_URL}>classic token</cds-link>`;

function githubSection(s) {
  const rate = state.cache?.data?.rateLimit;
  const expires = state.cache?.data?.tokenExpires;
  const tokenInfo =
    s.tokenScopes === null
      ? "Fine-grained token — the GitHub inbox won't work and org policy may block it. A classic token is recommended."
      : s.tokenScopes !== undefined && s.token
        ? html`Classic token · scopes: <cds-code-snippet type="inline">${s.tokenScopes || "none"}</cds-code-snippet>`
        : html`Use a ${classicToken} with <cds-code-snippet type="inline">repo</cds-code-snippet>, <cds-code-snippet type="inline">notifications</cds-code-snippet> and <cds-code-snippet type="inline">read:org</cds-code-snippet>.`;
  return section(
    "github",
    "GitHub",
    html`${status(s.token ? "success" : "neutral", s.token ? html`Connected${s.login ? html` as <b>${s.login}</b>` : nothing}` : "Not connected")}
      <form class="field-row" data-form="connect">
        <cds-password-input name="token" label="GitHub token" hide-label placeholder=${s.token ? "Paste a new token to replace it" : "ghp_…"} autocomplete="off"></cds-password-input>
        <cds-button type="submit" size="md">${s.token ? "Replace" : "Connect"}</cds-button>
        ${s.token ? danger("disconnect", "Disconnect") : nothing}
      </form>
      <p class="hint">${tokenInfo}${expires ? ` · Expires ${new Date(expires).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.` : ""}${rate ? ` · API budget: ${rate.remaining}/${rate.limit} this hour.` : ""}</p>
      <div class="fields">
        ${select("pollMinutes", "Check GitHub every", s.pollMinutes, [1, 2, 3, 5, 10, 15].map((m) => [m, `${m} min`]))}
        ${select("staleReviewDays", "Reviews are overdue after", s.staleReviewDays, [1, 2, 3, 5].map((d) => [d, plural(d, "day")]))}
      </div>
      ${toggle({ data: ["setting", "includeTeamReviews"], checked: s.includeTeamReviews, label: "Include team review requests", hint: "Otherwise only reviews requested from you directly" })}`
  );
}

function bobSection(s) {
  const st = state.bobStatus || {};
  const helper = st.checking
    ? html`<cds-inline-loading status="active">Looking for the Bob helper…</cds-inline-loading>`
    : st.ok
      ? status("success", html`Helper ready · <b>Bob Shell ${st.version}</b>`)
      : status(st.code === "missing" ? "warning" : "error", st.error || "Not checked yet");
  const setup =
    st.code === "missing"
      ? html`<cds-ordered-list class="steps"><cds-list-item>Install <cds-link inline href="https://bob.ibm.com/docs/shell">Bob Shell</cds-link> (it needs Node.js).</cds-list-item><cds-list-item>In Terminal, from the extension folder, run <cds-code-snippet type="inline">sh ai-helper/install.sh</cds-code-snippet></cds-list-item><cds-list-item>Click <b>Check again</b>.</cds-list-item></cds-ordered-list>`
      : nothing;
  return section(
    "bob",
    "Bob",
    html`${toggle({ data: ["setting", "ai"], checked: s.ai, label: "Bob actions", hint: "Review briefs, CI explanations, day plans, standups and answers from IBM Bob, when you ask. Only when you click a Bob action, your question and the item's link are sent to IBM through Bob Shell on this computer" })}
      ${s.ai
        ? html`<div class="status-row">${helper}<cds-button kind="ghost" size="sm" data-action="bob-check">Check again</cds-button><cds-button kind="ghost" size="sm" data-action="bob-test" ?disabled=${!(s.bobKey && st.ok)}>Send a test prompt</cds-button></div>
            ${setup}
            <form class="field-row" data-form="bob-key">
              <cds-password-input name="key" label="Bob API key" hide-label placeholder=${s.bobKey ? "Paste a new key to replace it" : "Bob API key"} autocomplete="off"></cds-password-input>
              <cds-button type="submit" size="md">${s.bobKey ? "Replace" : "Save"}</cds-button>
              ${s.bobKey ? danger("bob-key-remove", "Remove") : nothing}
            </form>
            <p class="hint">${s.bobKey ? "Key saved. " : ""}Create an <b>Inference</b> key at <cds-link inline href="https://bob.ibm.com">bob.ibm.com</cds-link> under Settings → API keys. It stays in this browser and is only handed to Bob Shell on this computer.</p>
            <p class="hint">Nothing goes to Bob until you click a Bob action. Bob then works in agent mode, using gh, the web and your local clones, and counts toward your Bob usage.</p>
            ${toggle({ data: ["setting", "bugHunt"], checked: s.bugHunt, label: "Daily bug hunt", hint: "Bob reads one clone a day, taking turns, and reports the most obvious easy-to-fix bug it can find" })}
            <div class="fields"><cds-text-input type="time" label="Hunt at" data-setting="bugHuntTime" .value=${live(s.bugHuntTime)} ?disabled=${!s.bugHunt}></cds-text-input></div>
            <p class="hint">If the computer is asleep then, it runs when Chrome is next open. A hunt can take several minutes and uses your Bob quota.</p>`
        : nothing}`
  );
}

function reposSection(s) {
  return section(
    "repos",
    "Repositories",
    html`<p class="hint">Turned-off repos are hidden from the bar, search and your work list.</p>
      <div class="toggles">${repos.map((r) => toggle({ data: ["repo", r.id], checked: !s.disabledRepos.includes(r.id), disabled: !r.slug, label: r.name, hint: r.slug || "no GitHub repo found" }))}</div>
      <div class="field-row">
        <cds-button kind="tertiary" size="sm" data-action="repo-editor">Edit repositories${icon("edit", 16, { slot: "icon" })}</cds-button>
        <cds-button kind="ghost" size="sm" data-action="repo-export">Export JSON</cds-button>
      </div>`
  );
}

function notificationsSection(s) {
  return section(
    "notifications",
    "Notifications",
    html`${toggle({ data: ["setting", "notifications"], checked: s.notifications, label: "Desktop notifications", hint: "Shown by Chrome, even when no new tab is open" })}
      <cds-form-group legend-text="Notify me about">
        <div class="checks">${Object.entries(NOTIFY_LABELS).map(([k, text]) => html`<cds-checkbox label-text=${text} data-notify=${k} .checked=${!!s.notifyOn[k]} ?disabled=${!s.notifications}></cds-checkbox>`)}</div>
      </cds-form-group>
      <cds-button kind="tertiary" size="sm" data-action="test-notification" ?disabled=${!s.notifications}>Send a test notification</cds-button>`
  );
}

function meetingsSection(s) {
  return section(
    "meetings",
    "Meetings",
    html`<p class="hint">Recurring weekday meetings appear under Today and are reminded 5 minutes before.</p>
      <ul class="meetings">
        ${repeat(
          s.meetings,
          (m) => m.id,
          (m) => html`<li data-id=${m.id}>
            <cds-text-input type="time" size="sm" hide-label label="Start time" .value=${live(m.time)} data-meeting="time"></cds-text-input>
            <cds-text-input size="sm" hide-label label="Title" .value=${live(m.title)} data-meeting="title"></cds-text-input>
            <cds-number-input size="sm" hide-label label="Length in minutes" min="5" step="5" .value=${live(String(m.minutes))} data-meeting="minutes"></cds-number-input>
            <cds-icon-button kind="ghost" size="sm" data-action="meeting-remove" align="left" aria-label="Remove ${m.title}">${icon("trash", 16, { slot: "icon" })}<span slot="tooltip-content">Remove</span></cds-icon-button>
          </li>`
        )}
      </ul>
      <cds-button kind="tertiary" size="sm" data-action="meeting-add">Add meeting${icon("plus", 16, { slot: "icon" })}</cds-button>`
  );
}

const KEYS = [
  ["/ or ⌘ K", "Search"],
  ["1 – 4", "Switch work tabs"],
  ["J K or ↓ ↑", "Move through your work"],
  ["S", "Snooze the selected item"],
  ["B", "Ask Bob about the selected item"],
  ["E", "Run the selected item's button, such as Ready to merge or Re-run"],
  ["R", "Sync now"],
  ["A", "Activity"],
  ["?", "This list"],
];

const THEMES = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
];

export function renderSettings() {
  const s = state.settings;
  const sections = [
    githubSection(s),
    bobSection(s),
    reposSection(s),
    notificationsSection(s),
    meetingsSection(s),
    section("appearance", "Appearance", html`<cds-content-switcher class="theme-switch" size="md" value=${s.theme} aria-label="Theme">${THEMES.map(([v, t]) => html`<cds-content-switcher-item value=${v}>${t}</cds-content-switcher-item>`)}</cds-content-switcher>`),
    section(
      "keys",
      "Keyboard",
      html`<cds-structured-list condensed flush><cds-structured-list-body>${KEYS.map(([k, what]) => html`<cds-structured-list-row><cds-structured-list-cell class="keys__key mono">${k}</cds-structured-list-cell><cds-structured-list-cell>${what}</cds-structured-list-cell></cds-structured-list-row>`)}</cds-structured-list-body></cds-structured-list>`
    ),
    section("reset", "Reset", html`<p class="hint">Removes the token, settings, to-dos and activity from this browser.</p>${danger("reset", "Reset everything", true)}`),
  ];
  const open = sections.find((x) => x.id === openSection) || sections[0];
  // The open section's tab takes the modal's first focus (Carbon's data-modal-primary-focus), not the close button.
  render(
    html`
      <cds-modal-header>
        <cds-modal-close-button></cds-modal-close-button>
        <cds-modal-heading>Settings</cds-modal-heading>
      </cds-modal-header>
      <cds-modal-body class="settings">
        <div class="settings__layout">
          <cds-tabs class="settings__nav" value=${open.id} aria-label="Settings sections">
            ${sections.map((x) => html`<cds-tab id="set-${x.id}" value=${x.id} ?data-modal-primary-focus=${x === open}>${x.title}</cds-tab>`)}
          </cds-tabs>
          <section class="settings__panel" role="tabpanel" aria-labelledby="set-${open.id}">
            <h3 class="cds--type-heading-03 settings__title">${open.title}</h3>
            ${open.body}
          </section>
        </div>
      </cds-modal-body>`,
    sheet()
  );
}

export function openSettings(id) {
  if (id) openSection = id;
  if (!state.bobStatus?.ok) checkBob();
  renderSettings();
  sheet().open = true;
}

/** The section tabs, remembered across re-renders; the theme switch. */
export function bindSettings() {
  sheet().addEventListener("cds-tabs-selected", (e) => {
    if (!e.target.matches(".settings__nav")) return;
    openSection = e.detail.item.value;
    renderSettings();
  });
  sheet().addEventListener("cds-content-switcher-selected", (e) => setTheme(e.detail.item.value));
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
    sheet().open = false;
    renderAll();
    requestSync();
  } catch (err) {
    toast(`Couldn't connect: ${err.message}`, "error");
    form.querySelector("[type=submit]").disabled = false;
  }
}

export function applyTheme() {
  // theme.js reads this before the stylesheet loads, so a forced theme never flashes the other one.
  localStorage.setItem("devdash-theme", state.settings.theme);
  dispatchEvent(new Event("devdash-theme"));
}

export const isDark = () => document.documentElement.classList.contains("cds--g100");

async function setTheme(theme) {
  state.settings = await saveSettings({ theme });
  applyTheme();
  if (sheet().open) renderSettings();
}

export const toggleTheme = () => setTheme(isDark() ? "light" : "dark");

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
    toggleActivity(false);
    openSettings(el.dataset.section);
  },
  "bob-check": checkBob,
  "test-notification": async () => {
    const res = await chrome.runtime.sendMessage({ type: "test-notification" }).catch((err) => ({ ok: false, error: err.message }));
    toast(res?.ok ? "Test notification sent" : "Chrome blocked the notification — check your OS notification settings for Chrome", res?.ok ? "success" : "error");
  },
  "bob-key-remove": async (el) => {
    if (!confirmed(el.dataset.action, "Click again to remove", renderSettings)) return;
    state.settings = await saveSettings({ bobKey: "" });
    renderSettings();
  },
  disconnect: async (el) => {
    if (!confirmed(el.dataset.action, "Click again to disconnect", renderSettings)) return;
    await storage.remove(["cache", "snapshot", "status", "activity"]);
    Object.assign(state, { cache: null, status: {}, activity: [] });
    state.settings = await saveSettings({ token: "", login: "", tokenScopes: undefined });
    renderAll();
    renderSettings();
  },
  reset: async (el) => {
    if (!confirmed(el.dataset.action, "Click again to erase everything", renderSettings)) return;
    await storage.clear();
    localStorage.clear();
    location.reload();
  },
  "meeting-add": async () => {
    await saveMeetings([...state.settings.meetings, { id: uid(), title: "New meeting", time: "15:00", minutes: 30, days: [1, 2, 3, 4, 5] }]);
    $$('[data-meeting="title"]', sheet()).at(-1)?.focus();
  },
  "meeting-remove": (el) => saveMeetings(state.settings.meetings.filter((m) => m.id !== el.closest("[data-id]").dataset.id)),
};

/** A field in Settings changed (main.js routes `change` events here). */
export async function onSettingsChange(el) {
  const s = state.settings;
  if (el.dataset.repoToggle) {
    const off = new Set(s.disabledRepos);
    on ? off.delete(el.dataset.repoToggle) : off.add(el.dataset.repoToggle);
    state.settings = await saveSettings({ disabledRepos: [...off] });
    renderAll();
    return resetBaseline();
  }
  const on = el.matches("cds-toggle") ? el.toggled : el.checked;
  if (el.dataset.notify) {
    state.settings = await saveSettings({ notifyOn: { ...s.notifyOn, [el.dataset.notify]: on } });
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
  state.settings = await saveSettings({ [key]: el.matches("cds-toggle") ? on : el.matches("cds-select") ? Number(el.value) : el.value });
  if (key === "includeTeamReviews") resetBaseline();
  if (key === "ai") checkBob();
  if (["notifications", "ai", "bugHunt"].includes(key)) renderSettings();
  renderAll();
}
