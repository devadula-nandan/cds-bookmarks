// The top of the page: greeting and summary, the tool buttons, the repo bar with its link menus,
// the Activity drawer, and asking the background worker to sync.

import { planKey } from "../bob.js";
import { connectedHosts, esc, fmtTime, repoShort, timeAgo, tokenUrl } from "../core.js";
import { greeting, summary } from "../insights.js";
import { EVENT_TYPES } from "../sync.js";
import { icon } from "./icons.js";
import { $, activityList, agoText, aiOn, connected, data, dayLabel, go, iconChip, mainTone, setHtml, shownRepos, state, timeEl, toast, unread, visibleTasks, vscodeUrl } from "./ui.js";

export function renderMasthead() {
  const now = new Date();
  const d = data();
  const name = (d?.viewer?.name || state.settings.accounts[connectedHosts(state.settings)[0]]?.login || "").split(" ")[0];
  $("#date").textContent = `${now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · ${fmtTime(now)}`;
  $("#greeting").textContent = `${greeting(now)}${name ? `, ${name}` : ""}`;
  $("#summary").textContent = !connected()
    ? "Connect GitHub to see what needs you today."
    : !d
      ? state.status.error
        ? "Couldn't reach GitHub. Click “Sync failed” above for details."
        : "Loading your work…"
      : summary(visibleTasks());
  const planned = state.answered.has(planKey());
  const plan = aiOn() && d ? `<button class="btn btn--ghost btn--sm bob-btn${planned ? " bob-made" : ""}" data-action="bob-plan">${icon("sparkle", 14)}${planned ? "Today's plan" : "Plan my day with Bob"}</button>` : "";
  setHtml($("#hello-ai"), plan);
  $("#hello-ai").hidden = !plan;
}

export function renderTools() {
  const st = state.status;
  const count = unread();
  let status = "";
  if (connected() && st.syncing) status = `<span class="sync">Syncing…</span>`;
  else if (connected() && st.error) status = `<button class="sync sync--error" popovertarget="sync-error" style="anchor-name: --sync" data-tooltip="See what went wrong">${icon("alert", 14)}${st.partial ? "Partly synced" : "Sync failed"}</button>`;
  else if (connected() && st.at) status = `<span class="sync" data-tooltip="Last synced ${esc(new Date(st.at).toLocaleString())}">Updated <span data-ago="${esc(st.at)}">${agoText(st.at)}</span></span>`;

  $("#search-input").placeholder = aiOn() ? "Search your PRs, issues and links, or ask Bob" : "Search your PRs, issues and links";
  $("#tools").innerHTML = `
    ${status}
    ${connected() ? `<button class="icon-btn ${st.syncing ? "is-spinning" : ""}" data-action="sync" data-tooltip="Sync now (R)" aria-label="Sync now">${icon("refresh", 18)}</button>` : ""}
    <button class="icon-btn" popovertarget="activity" data-tooltip="Activity (A)" aria-label="Activity${count ? `, ${count} new` : ""}">${icon("bell", 18)}${count ? `<span class="badge-dot"></span>` : ""}</button>
    ${aiOn() ? `<button class="icon-btn bob-btn" data-action="bob-slack" data-tooltip="Draft a Slack reply with Bob" aria-label="Draft a Slack reply with Bob">${icon("slack", 18)}</button>` : ""}
    <button class="icon-btn" data-action="settings" data-tooltip="Settings" aria-label="Settings">${icon("gear", 18)}</button>`;
  // The error popup lives outside #tools, so re-rendering the header doesn't close it.
  setHtml($("#sync-error"), st.error ? syncNotice(true) : "");
}

/** The sync error (`failed`), or partial-data warnings when the sync worked, with tips for fixing them. */
export function syncNotice(failed = false) {
  const { error, errorSso } = state.status;
  const d = data();
  const messages = failed ? [error] : error ? [] : d?.warnings || [];
  if (!connected() || !messages.length) return "";
  const text = messages.join(" ");
  const sso = errorSso || d?.sso;
  // The host the message names (every error from github.js does), else github.com.
  const host = connectedHosts(state.settings).find((h) => text.includes(h)) || "github.com";
  const tips = [
    (sso || /SAML|SSO/i.test(text)) && `The organization requires SSO. On <a href="https://${esc(host)}/settings/tokens">your tokens page</a>, choose <b>Configure SSO</b> next to this token and authorize <b>carbon-design-system</b>.`,
    (/personal access token|fine-grained|not accessible/i.test(text) || state.settings.accounts[host]?.scopes === null) && `Fine-grained tokens can be blocked by org policy. A <a href="${esc(tokenUrl(host))}">classic token</a> with <code>repo</code>, <code>notifications</code> and <code>read:org</code> is most reliable.`,
    /401|rejected/i.test(text) && `Create a new <a href="${esc(tokenUrl(host))}">classic token</a> on ${esc(host)} and paste it in Settings.`,
    /Couldn't reach/i.test(text) && `On a corporate network or VPN, a proxy may be blocking ${esc(host)}${host === "github.com" ? "" : ", or you may need to be on the VPN"}.`,
  ].filter(Boolean);
  return `
    <div class="notice notice--${failed ? "error" : "warning"}">
      ${icon("alert", 16)}
      <div class="notice__body">
        <p class="notice__title">${failed ? (state.status.partial ? "Couldn't sync some of your GitHub hosts" : "Couldn't sync with GitHub") : `Some data couldn't load${d?.failed?.length ? ` (${esc(d.failed.join(", "))})` : ""}`}</p>
        <p class="notice__text">${esc(messages.slice(0, 2).join(" · "))}</p>
        ${tips.length ? `<ul class="notice__hints">${tips.map((t) => `<li>${t}</li>`).join("")}</ul>` : ""}
        <div class="notice__actions">
          ${sso ? `<a class="btn btn--primary btn--sm" href="${esc(sso)}">Authorize SSO</a>` : ""}
          <button class="btn btn--sm" data-action="sync">Retry</button>
          <button class="btn btn--ghost btn--sm" data-action="settings" data-section="github">Token settings</button>
        </div>
      </div>
    </div>`;
}

// ---------- the repo bar ----------

/** "Pull Requests - assigned to me" → "Pull Requests · assigned to me". */
export const prettyLabel = (label) => {
  const text = String(label).replace(/\s+-\s+/, " · ");
  return text[0].toUpperCase() + text.slice(1);
};

function repoMenu(repo) {
  const health = data()?.repos?.[repo.slug];
  const main = health?.main;
  const tone = mainTone(main);
  const code = vscodeUrl(repo.clone);
  const link = (l) =>
    l.versionedHref
      ? `<div class="menu__versioned" data-versioned="${esc(l.versionedHref)}">
           <a class="menu__link" href="${esc(l.href)}">${esc(prettyLabel(l.label))}</a>
           <input class="menu__version" value="${esc(l.version || "")}" placeholder="version" aria-label="${esc(l.label)} version">
           <button class="icon-btn icon-btn--sm" data-action="open-version" data-tooltip="Open this version" aria-label="Open this version">${icon("arrowRight", 14)}</button>
         </div>`
      : `<a class="menu__link" href="${esc(l.href)}">${esc(prettyLabel(l.label))}</a>`;
  return `
    <header class="menu__head">
      <span class="menu__logo">${repo.logo}</span>
      <div>
        <p class="menu__title">${esc(repo.name)}</p>
        ${repo.slug ? `<a class="menu__slug mono" href="${esc(repo.url)}">${esc(repoShort(repo.slug))}</a>` : ""}
      </div>
    </header>
    ${main ? `<a class="menu__status" href="${esc(main.url)}" data-tooltip="${esc(main.message || "")}"><span class="dot dot--${tone || "neutral"}"></span><span><b>${esc(main.branch)}</b> ${{ error: "failing", warning: "running", success: "passing" }[tone] || "status unknown"}</span><span class="menu__status-meta mono">${esc(main.sha)} · ${timeAgo(main.committedAt)}</span></a>` : ""}
    ${health?.release ? `<a class="menu__status" href="${esc(health.release.url)}">${icon("tag", 14)}<span><b>${esc(health.release.tagName)}</b>${health.release.isPrerelease ? " pre-release" : ""}</span><span class="menu__status-meta">${timeAgo(health.release.publishedAt)}</span></a>` : ""}
    ${code ? `<a class="menu__status" href="${esc(code)}">${icon("code", 14)}<span><b>Open in VS Code</b></span><span class="menu__status-meta mono">${esc(repo.clone)}</span></a>` : ""}
    ${repo.groups.map((g) => `<div class="menu__group"><p class="menu__label">${esc(g.title)}</p>${g.links.map(link).join("")}</div>`).join("")}`;
}

export function renderRepos() {
  // Don't rebuild while a menu is open: it would close.
  if ($("#repo-menus :popover-open")) return;
  const list = shownRepos();
  $("#repos").innerHTML = list
    .map((r) => {
      const tone = mainTone(data()?.repos?.[r.slug]?.main);
      const dot = tone === "error" || tone === "warning" ? `<span class="dot dot--${tone}" data-tooltip="main ${tone === "error" ? "is failing" : "checks running"}"></span>` : "";
      return `<button class="repo" popovertarget="menu-${esc(r.id)}" style="anchor-name: --repo-${esc(r.id)}"><span class="repo__logo">${r.logo}</span><span>${esc(r.short)}</span>${dot}${icon("chevronDown", 14)}</button>`;
    })
    .join("");
  $("#repo-menus").innerHTML = list.map((r) => `<div class="menu" id="menu-${esc(r.id)}" popover style="position-anchor: --repo-${esc(r.id)}">${repoMenu(r)}</div>`).join("");
}

function openVersion(el) {
  const group = el.closest("[data-versioned]");
  const version = $("input", group).value.trim().replace(/^v/i, "");
  go(version ? group.dataset.versioned.replace("<v>", encodeURIComponent(version)) : $("a", group).href);
}

// ---------- the Activity drawer ----------

export function renderActivity() {
  const list = activityList();
  let day = "";
  const items = list
    .map((a) => {
      const look = EVENT_TYPES[a.type] || { icon: "activity", tone: "neutral" };
      const label = dayLabel(a.createdAt);
      const heading = label !== day ? `<li class="drawer__day">${(day = label)}</li>` : "";
      return `${heading}
        <li class="item ${!state.seenAt || a.createdAt > state.seenAt ? "is-new" : ""}">
          ${iconChip(look.icon, look.tone)}
          <div class="item__body">
            ${a.url ? `<a class="item__title" href="${esc(a.url)}">${esc(a.title)}</a>` : `<span class="item__title">${esc(a.title)}</span>`}
            ${a.body ? `<p class="item__meta">${esc(a.body)}</p>` : ""}
          </div>
          <div class="item__end">${timeEl(a.createdAt)}</div>
        </li>`;
    })
    .join("");
  $("#activity").innerHTML = `
    <header class="drawer__head">
      <h2>Activity</h2>
      <div class="drawer__actions">
        ${aiOn() && list.length ? `<button class="btn btn--ghost btn--sm bob-btn" data-action="bob-catchup">${icon("sparkle", 14)}Catch me up</button>` : ""}
        ${list.length ? `<button class="btn btn--ghost btn--sm" data-action="clear-activity">Clear</button>` : ""}
        <button class="icon-btn icon-btn--sm" popovertarget="activity" popovertargetaction="hide" aria-label="Close">${icon("x", 16)}</button>
      </div>
    </header>
    ${list.length ? `<ul class="items drawer__list">${items}</ul>` : `<div class="empty">${iconChip("bell")}<p class="empty__title">No activity yet</p><p class="empty__text">Approvals, CI results, merges and releases show up here as they happen.</p></div>`}
    <footer class="drawer__foot">${state.settings.notifications ? "" : "Desktop notifications are off."} <button class="btn btn--ghost btn--sm" data-action="settings" data-section="notifications">Notification settings</button></footer>`;
}

/** The drawer is built as it opens, and everything in it counts as seen. */
export function bindActivity() {
  $("#activity").addEventListener("beforetoggle", (e) => e.newState === "open" && renderActivity());
  $("#activity").addEventListener("toggle", async (e) => {
    if (e.newState !== "open") return renderTools();
    state.lastSeenAt = state.seenAt; // for "Catch me up"
    state.seenAt = new Date().toISOString();
    await chrome.storage.local.set({ activitySeenAt: state.seenAt });
  });
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
  "open-version": openVersion,
  "clear-activity": async () => {
    state.clearedAt = new Date().toISOString();
    renderActivity();
    renderTools();
    await chrome.storage.local.set({ activityClearedAt: state.clearedAt });
  },
};

