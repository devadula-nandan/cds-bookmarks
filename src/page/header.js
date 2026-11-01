// The top of the page: the Carbon UI shell header and its actions, the greeting and summary, the repo bar
// with its link menus, the Activity panel, and asking the background worker to sync.

import { planKey } from "../bob.js";
import { fmtTime, plural, timeAgo } from "../core.js";
import { greeting, summary } from "../insights.js";
import { EVENT_TYPES } from "../sync.js";
import { icon } from "./icons.js";
import { html, nothing, render, repeat } from "./lit.js";
import { $, CLASSIC_TOKEN_URL, activityList, agoText, aiOn, connected, data, dayLabel, emptyState, iconChip, mainTone, shownRepos, state, timeEl, tip, toast, unread, visibleTasks, vscodeUrl } from "./ui.js";

export function renderMasthead() {
  const now = new Date();
  const d = data();
  const name = (d?.viewer?.name || state.settings.login || "").split(" ")[0];
  $("#date").textContent = `${now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · ${fmtTime(now)}`;
  $("#greeting").textContent = `${greeting(now)}${name ? `, ${name}` : ""}`;
  $("#summary").textContent = !connected()
    ? "Connect GitHub to see what needs you today."
    : !d
      ? state.status.error
        ? "Couldn't reach GitHub. The details are under Your work."
        : "Loading your work…"
      : summary(visibleTasks());
  const planned = state.answered.has(planKey());
  const plan = aiOn() && d;
  render(plan ? html`<cds-button kind="tertiary" size="md" class="bob-btn ${planned ? "bob-made" : ""}" data-action="bob-plan">${planned ? "Today's plan" : "Plan my day with Bob"}${icon("sparkle", 16, { slot: "icon" })}</cds-button>` : nothing, $("#hello-ai"));
  $("#hello-ai").hidden = !plan;
}

/** The header's actions (sync, Activity, Slack, Settings) and the sync status beside the greeting. */
export function renderTools() {
  const st = state.status;
  const count = unread();
  let status = nothing;
  if (connected() && st.syncing) status = html`<cds-inline-loading status="active">Syncing…</cds-inline-loading>`;
  else if (connected() && st.error) status = html`<span class="sync sync--error">${iconChip("alert", "error")}Sync failed</span>`;
  else if (connected() && st.at) status = html`<span class="sync">${tip(`Last synced ${new Date(st.at).toLocaleString()}`, `Updated ${agoText(st.at)}`, { align: "bottom" })}</span>`;
  render(status, $("#sync"));

  $("#search-input").placeholder = aiOn() ? "Search your PRs, issues and links, or ask Bob" : "Search your PRs, issues and links";
  const action = (iconName, label, attrs) => html`<cds-header-global-action aria-label=${label} tooltip-text=${label} tooltip-alignment=${attrs.align || nothing} data-action=${attrs.action || nothing} panel-id=${attrs.panel || nothing} id=${attrs.id || nothing} class=${attrs.cls || nothing}>${icon(iconName, 20, { slot: "icon" })}${attrs.badge || nothing}</cds-header-global-action>`;
  render(
    html`
      ${connected() ? action("refresh", "Sync now (R)", { action: "sync", cls: st.syncing ? "is-syncing" : "" }) : nothing}
      ${action("bell", count ? `Activity, ${count} new (A)` : "Activity (A)", { panel: "activity", id: "activity-toggle", badge: count ? html`<cds-badge-indicator slot="badge-indicator" count=${count}></cds-badge-indicator>` : null })}
      ${aiOn() ? action("slack", "Draft a Slack reply with Bob", { action: "bob-slack", cls: "bob-btn" }) : nothing}
      ${action("gear", "Settings", { action: "settings", align: "right" })}`,
    $("#tools")
  );
}

/** The sync error, or partial-data warnings when the sync worked, with tips for fixing them: a Carbon notification at the top of the work list. */
export function syncNotice() {
  const { error, errorSso } = state.status;
  const d = data();
  const failed = !!error;
  const messages = failed ? [error] : d?.warnings || [];
  if (!connected() || !messages.length) return nothing;
  const text = messages.join(" ");
  const sso = errorSso || d?.sso;
  const classic = html`<cds-link inline href=${CLASSIC_TOKEN_URL}>classic token</cds-link>`;
  const tips = [
    (sso || /SAML|SSO/i.test(text)) && html`The organization requires SSO. On <cds-link inline href="https://github.com/settings/tokens">your tokens page</cds-link>, choose <b>Configure SSO</b> next to this token and authorize <b>carbon-design-system</b>.`,
    (/personal access token|fine-grained|not accessible/i.test(text) || state.settings.tokenScopes === null) && html`Fine-grained tokens can be blocked by org policy. A ${classic} with <cds-code-snippet type="inline">repo</cds-code-snippet>, <cds-code-snippet type="inline">notifications</cds-code-snippet> and <cds-code-snippet type="inline">read:org</cds-code-snippet> is most reliable.`,
    /401|rejected/i.test(text) && html`Create a new ${classic} on github.com and paste it in Settings.`,
    /reach api\.github\.com/i.test(text) && "On a corporate network or VPN, a proxy may be blocking api.github.com.",
  ].filter(Boolean);
  return notice({
    kind: failed ? "error" : "warning",
    title: failed ? "Couldn't sync with GitHub" : `Some data couldn't load${d?.failed?.length ? ` (${d.failed.join(", ")})` : ""}`,
    text: messages.slice(0, 2).join(" · "),
    body: tips.length ? html`<cds-unordered-list class="notice__hints">${tips.map((t) => html`<cds-list-item>${t}</cds-list-item>`)}</cds-unordered-list>` : nothing,
    action: sso ? html`<cds-actionable-notification-button slot="action" href=${sso}>Authorize SSO</cds-actionable-notification-button>` : html`<cds-actionable-notification-button slot="action" data-action="sync">Retry</cds-actionable-notification-button>`,
  });
}

/** A week before the GitHub token expires: syncing stops the day it does. */
export function tokenNotice() {
  const at = data()?.tokenExpires;
  const days = at ? (Date.parse(at) - Date.now()) / 86400000 : Infinity;
  if (!connected() || days > 7) return nothing;
  return notice({
    kind: "warning",
    title: `Your GitHub token expires ${days < 1 ? "today" : `in ${plural(Math.ceil(days), "day")}`}`,
    text: "Syncing stops when it does. Create a new classic token and paste it in Settings.",
    body: nothing,
    action: html`<cds-actionable-notification-button slot="action" href=${CLASSIC_TOKEN_URL}>Create a token</cds-actionable-notification-button>`,
  });
}

/** An inline Carbon notification with one action: its title and `text`, then `body` and a link to the token settings. */
const notice = ({ kind, title, text, body, action }) => html`
  <cds-actionable-notification class="notice" inline low-contrast hide-close-button .hasFocus=${false} kind=${kind} title=${title} subtitle=${text}>
    <div class="notice__body">${body}<cds-link href="#" data-action="settings" data-section="github">Token settings</cds-link></div>
    ${action}
  </cds-actionable-notification>`;

// ---------- the repo bar ----------

/** "Pull Requests - assigned to me" → "Pull Requests · assigned to me". */
export const prettyLabel = (label) => {
  const text = String(label).replace(/\s+-\s+/, " · ");
  return text[0].toUpperCase() + text.slice(1);
};

const STATUS = { error: "failing", warning: "running", success: "passing" };
const STATUS_ICON = { error: "errorFilled", warning: "warningFilled", success: "checkmarkFilled" };

/** A menu item that opens a link (main.js routes data-href clicks). */
const linkItem = (label, href, iconName = "", tone = "neutral") =>
  html`<cds-menu-item label=${label} data-href=${href}>${iconName ? html`<span slot="render-icon" class="status-icon tone-${tone}">${icon(iconName, 16)}</span>` : nothing}</cds-menu-item>`;

/** A repo's menu: main's checks, the latest release, VS Code, then its links by group. A link with versions opens a submenu. */
function repoMenu(repo) {
  const health = data()?.repos?.[repo.slug];
  const main = health?.main;
  const tone = mainTone(main);
  const code = vscodeUrl(repo.clone);
  const link = (l) =>
    l.versionedHref && l.version
      ? html`<cds-menu-item label=${prettyLabel(l.label)}><cds-menu-item-group slot="submenu">
          ${linkItem("Latest", l.href)}${linkItem(`Version ${l.version}`, l.versionedHref.replace("<v>", encodeURIComponent(l.version)))}
        </cds-menu-item-group></cds-menu-item>`
      : linkItem(prettyLabel(l.label), l.href);
  const status = [
    main && linkItem(`${main.branch} ${STATUS[tone] || "status unknown"} · ${main.sha} · ${timeAgo(main.committedAt)}${tone === "error" && main.failing?.length ? ` · ${main.failing.map((c) => c.name).join(", ")}` : ""}`, main.url, STATUS_ICON[tone] || "git", tone || "neutral"),
    health?.release && linkItem(`${health.release.tagName}${health.release.isPrerelease ? " pre-release" : ""} · ${timeAgo(health.release.publishedAt)}`, health.release.url, "tag"),
    code && linkItem("Open in VS Code", code, "code"),
    repo.slug && linkItem(`github.com/${repo.slug}`, `https://github.com/${repo.slug}`, "github"),
  ].filter(Boolean);
  return html`
    ${status.length ? html`<cds-menu-item-group label=${repo.name}>${status}</cds-menu-item-group><cds-menu-item-divider></cds-menu-item-divider>` : nothing}
    ${repo.groups.map((g, i) => html`${i ? html`<cds-menu-item-divider></cds-menu-item-divider>` : nothing}<cds-menu-item-group label=${g.title}>${g.links.map(link)}</cds-menu-item-group>`)}`;
}

/** The repo bar: a Carbon menu button per repo. One whose main is failing or still running says so. */
export function renderRepos() {
  render(
    repeat(
      shownRepos(),
      (r) => r.id,
      (r) => {
        const tone = mainTone(data()?.repos?.[r.slug]?.main);
        const label = tone === "error" ? `${r.short} · main failing` : tone === "warning" ? `${r.short} · main running` : r.short;
        return html`<cds-menu-button class="repo ${tone === "error" ? "is-failing" : ""}" kind="ghost" size="sm" label=${label} menu-alignment="bottom-start"><cds-menu label=${r.name}>${repoMenu(r)}</cds-menu></cds-menu-button>`;
      }
    ),
    $("#repos")
  );
}

// ---------- the Activity panel ----------

const activityRow = (a) => {
  const look = EVENT_TYPES[a.type] || { icon: "activity", tone: "neutral" };
  return html`
    <cds-contained-list-item class="item ${!state.seenAt || a.createdAt > state.seenAt ? "is-new" : ""}">
      ${iconChip(look.icon, look.tone, "icon")}
      <div class="item__row">
        <div class="item__body">
          ${a.url ? html`<cds-link class="item__title" href=${a.url}>${a.title}</cds-link>` : html`<span class="item__title">${a.title}</span>`}
          ${a.body ? html`<p class="item__meta">${a.body}</p>` : nothing}
        </div>
        <div class="item__end">${timeEl(a.createdAt)}</div>
      </div>
    </cds-contained-list-item>`;
};

/** The Activity panel: a Carbon header panel, with a contained list per day. */
export function renderActivity() {
  const list = activityList();
  const days = [];
  for (const a of list) {
    const label = dayLabel(a.createdAt);
    if (days.at(-1)?.label !== label) days.push({ label, items: [] });
    days.at(-1).items.push(a);
  }
  render(
    // The panel is layer-01; what's in it steps up to layer-02, as in the work panels.
    html`
      <cds-layer class="activity" level="1">
        <header class="activity__head">
          <h2 class="activity__title">Activity</h2>
          <div class="activity__actions">
            ${aiOn() && list.length ? html`<cds-button kind="ghost" size="sm" class="bob-btn" data-action="bob-catchup">Catch me up${icon("sparkle", 16, { slot: "icon" })}</cds-button>` : nothing}
            ${list.length ? html`<cds-button kind="ghost" size="sm" data-action="clear-activity">Clear</cds-button>` : nothing}
          </div>
        </header>
        <div class="activity__list">
          ${list.length
            ? days.map((day) => html`<cds-contained-list label=${day.label} size="lg">${repeat(day.items, (a) => a.id || a.createdAt + a.title, activityRow)}</cds-contained-list>`)
            : emptyState("notifications", "No activity yet", "Approvals, CI results, merges and releases show up here as they happen.")}
        </div>
        <footer class="activity__foot">${state.settings.notifications ? "" : "Desktop notifications are off."} <cds-button kind="ghost" size="sm" data-action="settings" data-section="notifications">Notification settings</cds-button></footer>
      </cds-layer>`,
    $("#activity")
  );
}

export const activityOpen = () => $("#activity").hasAttribute("expanded");

/** Opens or closes the Activity panel, as its header button does. */
export function toggleActivity(open = !activityOpen()) {
  $("#activity").toggleAttribute("expanded", open);
  $("#activity-toggle").active = open;
}

/** The panel is built as it opens, and everything in it counts as seen. */
export function bindActivity() {
  new MutationObserver(async () => {
    if (!activityOpen()) return renderTools();
    // Its button keeps focus, which keeps its tooltip open over the panel.
    $("#activity-toggle").openTooltip = false;
    renderActivity();
    state.lastSeenAt = state.seenAt; // for "Catch me up"
    state.seenAt = new Date().toISOString();
    await chrome.storage.local.set({ activitySeenAt: state.seenAt });
  }).observe($("#activity"), { attributes: true, attributeFilter: ["expanded"] });
}

// ---------- syncing ----------

export async function requestSync(manual = false) {
  if (!connected()) return;
  state.status = { ...state.status, syncing: true };
  renderTools();
  const result = await chrome.runtime.sendMessage({ type: "sync" }).catch((err) => ({ ok: false, error: err.message }));
  if (!manual) return;
  if (result?.ok) toast("Synced with GitHub");
  else if (result?.skipped) toast("A sync is already running");
  else toast("Sync failed", "error");
}

/** Syncs when the page opens or comes back, unless the last sync was under a minute ago. */
export function maybeSync() {
  if (Date.now() - Date.parse(state.status.at || 0) > 60000) requestSync();
}

export const headerActions = {
  sync: () => requestSync(true),
  "clear-activity": async () => {
    state.clearedAt = new Date().toISOString();
    renderActivity();
    renderTools();
    await chrome.storage.local.set({ activityClearedAt: state.clearedAt });
  },
};

