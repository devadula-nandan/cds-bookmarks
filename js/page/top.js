/** The header (greeting, sync status, tool buttons), the repo bar and its link menus, and asking for a sync. */

import { renderAll } from "../app.js";
import { todaysAnswer } from "./bob.js";
import { agoText, setHtml, toast } from "./pieces.js";
import { go } from "./search.js";
import { $, aiOn, connected, data, ext, mainTone, shownRepos, state, unread, visibleTasks, vscodeUrl } from "./state.js";
import { syncNotice } from "./work.js";

const { esc, timeAgo } = DD.util;
const { icon } = DD.icons;
const ins = DD.insights;

export function renderMasthead() {
  const now = new Date();
  const d = data();
  const name = (d?.viewer?.name || state.settings.login || "").split(" ")[0];
  $("#date").textContent = `${now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · ${DD.util.fmtTime(now)}`;
  $("#greeting").textContent = `${ins.greeting(now)}${name ? `, ${name}` : ""}`;
  let summary;
  if (!connected()) summary = "Connect GitHub to see what needs you today.";
  else if (!d) summary = state.status.error ? "Couldn't reach GitHub. Click “Sync failed” above for details." : "Loading your work…";
  else summary = ins.summary(d, visibleTasks());
  $("#summary").textContent = summary;
  // Rebuilt every minute by tick(), so only touch it when it changes (keeps focus on the button).
  const planned = state.answered.has(todaysAnswer("plan"));
  const plan =
    aiOn() && d
      ? planned
        ? `<button class="btn btn--ghost btn--sm bob-btn bob-made" data-action="ai-plan" data-tooltip="Open the plan Bob made today">${icon("sparkle", 14)}Today's plan</button>`
        : `<button class="btn btn--ghost btn--sm bob-btn" data-action="ai-plan">${icon("sparkle", 14)}Plan my day with Bob</button>`
      : "";
  setHtml($("#hello-ai"), plan);
  $("#hello-ai").hidden = !plan;
}

export function renderTools() {
  const s = state.settings;
  const st = state.status;
  const count = unread();
  let status = "";
  if (state.staleWorker) status = `<button class="pill-btn" data-action="reload-extension" data-tooltip="The background worker is running older code than this page">Update ready <span class="pill-btn__sep">·</span> Reload extension</button>`;
  else if (s.demo) status = `<button class="pill-btn" data-action="demo-off" data-tooltip="You're looking at sample data">Sample data <span class="pill-btn__sep">·</span> Exit</button>`;
  else if (s.token && st.syncing) status = `<span class="sync">Syncing…</span>`;
  else if (s.token && st.error) status = `<button class="sync sync--error" popovertarget="sync-error" style="anchor-name: --sync" data-tooltip="See what went wrong">${icon("alert", 14)}Sync failed</button>`;
  else if (s.token && st.at) status = `<span class="sync" data-tooltip="Last synced ${esc(new Date(st.at).toLocaleString())}">Updated <span data-ago="${esc(st.at)}">${agoText(st.at)}</span></span>`;

  const field = $("#search-input");
  const ask = aiOn() ? "Search your PRs, issues and links, or ask Bob" : "Search your PRs, issues and links";
  if (field.placeholder !== ask) field.placeholder = ask;
  const hadDot = !!$("#tools .badge-dot");
  const hadTools = !!$("#tools").childElementCount;
  $("#tools").innerHTML = `
    ${status}
    ${connected() ? `<button class="icon-btn ${st.syncing ? "is-spinning" : ""}" data-action="sync" data-tooltip="Sync now (R)" aria-label="Sync now">${icon("refresh", 18)}</button>` : ""}
    <button class="icon-btn" popovertarget="activity" data-tooltip="Activity (A)" aria-label="Activity${count ? `, ${count} new` : ""}">
      ${icon("bell", 18)}${count ? `<span class="badge-dot" aria-hidden="true"></span>` : ""}
    </button>
    ${aiOn() ? `<button class="icon-btn bob-btn" data-action="ai-slack" data-tooltip="Draft a Slack reply with Bob" aria-label="Draft a Slack reply with Bob">${icon("slack", 18)}</button>` : ""}
    <button class="icon-btn" data-action="settings" data-tooltip="Settings" aria-label="Settings">${icon("gear", 18)}</button>`;
  if (hadTools && !hadDot) $("#tools .badge-dot")?.classList.add("is-entering");

  // The popup lives outside #tools so re-rendering the header doesn't close it; only touch it when the error changes.
  const pop = $("#sync-error");
  const notice = status.includes('popovertarget="sync-error"') ? syncNotice(true) : "";
  setHtml(pop, notice);
  if (!notice && pop.matches(":popover-open")) pop.hidePopover();
}

export function prettyLabel(label) {
  const text = String(label).replace(/\s+-\s+/, " · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function repoMenu(repo) {
  const d = data();
  const clone = state.settings.clones[repo.slug];
  const code = vscodeUrl(clone);
  const health = d?.repos?.[repo.slug];
  const main = health?.main;
  const tone = mainTone(main);
  const stateText = { error: "failing", warning: "running", success: "passing" }[tone] || "status unknown";
  const groups = repo.groups
    .map(
      (g) => `
      <div class="menu__group">
        <p class="menu__label">${esc(g.title)}</p>
        ${g.links
          .map((l) =>
            l.versionedHref
              ? `<div class="menu__versioned" data-versioned="${esc(l.versionedHref)}">
                   <a class="menu__link" href="${esc(l.href)}">${esc(prettyLabel(l.label))}</a>
                   <input class="menu__version" value="${esc(l.version || "")}" placeholder="version" aria-label="${esc(l.label)} version" data-action-enter="open-version">
                   <button class="icon-btn icon-btn--sm" data-action="open-version" data-tooltip="Open this version" aria-label="Open this version">${icon("arrowRight", 14)}</button>
                 </div>`
              : `<a class="menu__link" href="${esc(l.href)}">${esc(prettyLabel(l.label))}</a>`
          )
          .join("")}
      </div>`
    )
    .join("");

  return `
    <header class="menu__head">
      <span class="menu__logo">${repo.logo}</span>
      <div>
        <p class="menu__title">${esc(repo.name)}</p>
        ${repo.slug ? `<a class="menu__slug mono" href="https://github.com/${esc(repo.slug)}" data-tooltip="${esc(repo.slug)}">${esc(DD.util.repoShort(repo.slug))}</a>` : ""}
      </div>
    </header>
    ${
      main
        ? `<a class="menu__status" href="${esc(main.url)}" data-tooltip="${esc(main.message || "")}">
             <span class="dot dot--${tone || "neutral"}"></span>
             <span><b>${esc(main.branch)}</b> ${stateText}</span>
             <span class="menu__status-meta mono">${esc(main.sha)} · ${timeAgo(main.committedAt)}</span>
           </a>`
        : ""
    }
    ${health?.release ? `<a class="menu__status" href="${esc(health.release.url)}">${icon("tag", 14)}<span><b>${esc(health.release.tagName)}</b>${health.release.isPrerelease ? " pre-release" : ""}</span><span class="menu__status-meta">${timeAgo(health.release.publishedAt)}</span></a>` : ""}
    ${clone && code ? `<a class="menu__status" href="${esc(code)}" data-tooltip="Open ${esc(clone)} in VS Code">${icon("code", 14)}<span><b>Open in VS Code</b></span><span class="menu__status-meta mono">${esc(clone)}</span></a>` : ""}
    ${groups}`;
}

export function renderRepos() {
  const menus = $("#repo-menus");
  if ($(":popover-open", menus)) return;
  const d = data();
  const repos = shownRepos();
  $("#repos").innerHTML = repos
    .map((r) => {
      const tone = mainTone(d?.repos?.[r.slug]?.main);
      const dot =
        tone === "error"
          ? `<span class="dot dot--error" data-tooltip="main is failing"></span><span class="sr-only">, main is failing</span>`
          : tone === "warning"
            ? `<span class="dot dot--warning" data-tooltip="main checks running"></span><span class="sr-only">, main checks running</span>`
            : "";
      return `
        <button class="repo" popovertarget="menu-${esc(r.id)}" data-repo="${esc(r.id)}" style="anchor-name: --repo-${esc(r.id)}">
          <span class="repo__logo">${r.logo}</span>
          <span>${esc(r.short)}</span>${dot}
          ${icon("chevronDown", 14)}
        </button>`;
    })
    .join("");
  menus.innerHTML = repos.map((r) => `<div class="menu" id="menu-${esc(r.id)}" popover aria-label="${esc(r.name)} links" style="position-anchor: --repo-${esc(r.id)}">${repoMenu(r)}</div>`).join("");
}

/** Popovers open in the top layer; place each under the button that opened it, flipped if it would overflow. */
export function placeMenu(menu, btn = $(`[popovertarget="${menu.id}"]`)) {
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const left = Math.max(12, Math.min(r.left, innerWidth - w - 12));
  const below = r.bottom + 6;
  const top = below + h > innerHeight - 12 && r.top - h - 6 > 12 ? r.top - h - 6 : below;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

/**
 * Whether the background worker runs the same code as this page. An old
 * worker doesn't know newer messages and answers them with nothing.
 */
export async function checkWorker() {
  if (!ext) return true;
  const reply = await chrome.runtime.sendMessage({ type: "ping" }).catch(() => null);
  const stale = reply?.rev !== DD.REV;
  if (stale !== !!state.staleWorker) {
    state.staleWorker = stale;
    renderTools();
  }
  return !stale;
}

export async function requestSync(manual = false) {
  if (state.settings.demo) {
    state.demo = null;
    renderAll();
    if (manual) toast("Sample data refreshed");
    return;
  }
  if (!state.settings.token) return;
  state.status = { ...state.status, syncing: true };
  renderTools();
  let result;
  try {
    result = ext ? await chrome.runtime.sendMessage({ type: "sync" }) : await DD.sync.run();
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  const { status } = await DD.storage.get("status");
  state.status = status || {};
  renderTools();
  if (!manual) return;
  if (result?.ok) toast("Synced with GitHub");
  else if (result?.skipped) toast("A sync is already running");
  else toast("Sync failed", "error");
}

export function maybeSync() {
  if (!state.settings.token || state.settings.demo) return;
  const last = state.status.at ? Date.parse(state.status.at) : 0;
  if (Date.now() - last > 60000) requestSync();
}

export const topActions = {
  sync: () => requestSync(true),
  "open-version": (el) => {
    const group = el.closest("[data-versioned]");
    const version = group.querySelector("input").value.trim().replace(/^v/i, "");
    if (!version) return go(group.querySelector("a").href);
    go(group.dataset.versioned.replace("<v>", encodeURIComponent(version)));
  },
  // Restarts the background worker on the current code; open extension pages, this one included, reload with it.
  "reload-extension": () => chrome.runtime.reload(),
};
