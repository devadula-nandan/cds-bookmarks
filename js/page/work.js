/** The work panel: its tabs and lists, snoozing, and moving through rows from the keyboard. */

import { renderAll } from "../app.js";
import { emptyState, keepFocus, ref, row, setHtml, skeleton, toast } from "./pieces.js";
import { $, $$, CLASSIC_TOKEN_URL, aiOn, aiTargets, allTasks, connected, data, issueItems, repoScope, saveUi, searchUrl, state, ui } from "./state.js";

const { EASE, calm, collapse, expand, stagger } = DD.motion;
const { ageDays, esc, plural } = DD.util;
const { icon } = DD.icons;
const ins = DD.insights;

const TASK_LOOK = {
  main: ["alert", "error"],
  ciFailed: ["x", "error"],
  conflict: ["alert", "warning"],
  changes: ["message", "warning"],
  ready: ["merge", "success"],
  review: ["eye", "info"],
  mention: ["at", "info"],
  assigned: ["user", "neutral"],
  nudge: ["clock", "neutral"],
  reply: ["message", "info"],
  recheck: ["refresh", "warning"],
};

function taskRow(t) {
  if (t.kind === "main") {
    const repo = DD.repos.bySlug(t.repo);
    return row({
      key: t.key,
      url: t.url,
      title: `main is failing on ${repo?.short || t.repo}`,
      iconName: "alert",
      tone: "error",
      meta: `<span class="mono">${esc(t.ref.split("@")[1] || "")}</span> · ${esc((t.title || "").split("\n")[0])}`,
      at: t.at,
      snooze: t.key,
      ai: { kind: "main", task: t },
    });
  }
  const [iconName, base] = TASK_LOOK[t.kind] || ["git", "neutral"];
  const tone = t.kind === "review" && ins.isBot(t.item.author) ? "neutral" : t.kind === "ciFailed" && t.item.draft ? "warning" : base;
  const detail = t.detail ? ` · <span class="t-warning">${esc(t.detail)}</span>` : "";
  return row({
    key: t.key,
    url: t.url,
    title: t.title,
    iconName,
    tone,
    meta: `${ref(t.item)} · ${esc(t.reason)}${detail}`,
    at: t.item.updatedAt,
    snooze: t.key,
    ai: { item: t.item, kind: t.kind, task: t },
  });
}

const PR_LOOK = {
  conflict: ["alert", "warning", "Merge conflict"],
  ciFailed: ["x", "error", "CI failing"],
  changes: ["message", "warning", "Changes requested"],
  ready: ["merge", "success", "Ready to merge"],
  ciRunning: ["clock", "neutral", "CI running"],
  draft: ["draft", "neutral", "Draft"],
  waiting: ["pr", "neutral", "Waiting for review"],
};

const PR_ORDER = ["ciFailed", "conflict", "changes", "ready", "waiting", "ciRunning", "draft"];

function prRow(pr) {
  const st = ins.prState(pr);
  const [iconName, tone, text] = PR_LOOK[st] || PR_LOOK.waiting;
  const by = st === "changes" && pr.changeRequests.length ? ` by ${esc(pr.changeRequests.join(", "))}` : "";
  const draft = pr.draft && st !== "draft" ? " · draft" : "";
  return row({ key: pr.id, url: pr.url, title: pr.title, iconName, tone, meta: `${ref(pr)} · ${text}${by}${draft}`, at: pr.updatedAt, ai: { item: pr } });
}

function reviewRow(pr) {
  const days = ageDays(pr.createdAt);
  const stale = !ins.isBot(pr.author) && days >= state.settings.staleReviewDays;
  const size = pr.additions != null ? ` · <span class="mono"><span class="t-add">+${pr.additions}</span> <span class="t-del">−${pr.deletions}</span></span>` : "";
  return row({
    key: pr.id,
    url: pr.url,
    title: pr.title,
    iconName: "eye",
    tone: ins.isBot(pr.author) ? "neutral" : stale ? "warning" : "info",
    meta: `${ref(pr)} · ${esc(pr.author)}${stale ? ` · <span class="t-warning">waiting ${Math.floor(days)}d</span>` : ""}${size}`,
    at: pr.createdAt,
    ai: { item: pr, kind: "review" },
  });
}

function issueRow({ item, why }) {
  const isPR = item.kind === "pr";
  return row({
    key: item.id,
    url: item.url,
    title: item.title,
    iconName: why === "mention" ? "at" : isPR ? "pr" : "issue",
    tone: why === "mention" ? "info" : "neutral",
    meta: `${ref(item)} · ${why === "mention" ? `Mentioned${isPR ? " on a PR" : ""}` : `Assigned${isPR ? " PR" : ""}`} · ${esc(item.author)}`,
    at: item.updatedAt,
    ai: { item, kind: why === "mention" ? "mention" : null },
  });
}

function focusView(d) {
  const all = allTasks();
  const tasks = all.filter((t) => !ins.isSnoozed(t, state.day.snoozed, state.untilChange));
  const snoozed = all.length - tasks.length;
  const groups = { now: [], next: [], later: [] };
  tasks.forEach((t) => groups[ins.bucket(t)].push(t));

  // Each heading shares a wrapper with its list, so a sticky heading scrolls away with its own section.
  const section = (id, title, list, hint = "") =>
    list.length
      ? `<div class="section"><h3 class="group" id="group-${id}">${title} <span>${list.length}</span>${hint ? `<small>${hint}</small>` : ""}</h3><ul class="items items--${id}" aria-labelledby="group-${id}">${list.map(taskRow).join("")}</ul></div>`
      : "";

  let body;
  if (!tasks.length) body = emptyState("check", "You're all caught up", "Nothing needs you right now.");
  else {
    const onlyLater = !groups.now.length && !groups.next.length;
    body = section("now", "Now", groups.now) + section("next", "Next", groups.next) + section("later", onlyLater ? "When you have time" : "Later", groups.later, onlyLater ? "" : "Can wait");
  }
  const forToday = all.filter((t) => state.day.snoozed[t.key]).length;
  const foot = snoozed ? `<span>${plural(snoozed, "item")} snoozed${forToday === snoozed ? " until tomorrow" : ""}</span><button class="btn btn--ghost btn--sm" data-action="unsnooze">Restore</button>` : "";
  return { body, foot };
}

/** A titled block whose heading pins while its rows scroll (see .section in the CSS). */
function listSection(id, title, items, render, hint = "") {
  if (!items.length) return "";
  return `<div class="section"><h3 class="group" id="group-${id}">${title} <span>${items.length}</span>${hint ? `<small>${hint}</small>` : ""}</h3><ul class="items" aria-labelledby="group-${id}">${items.map(render).join("")}</ul></div>`;
}

const MY_REVIEW = { APPROVED: "You approved", CHANGES_REQUESTED: "You requested changes", COMMENTED: "You commented", DISMISSED: "Your review was dismissed" };

function reviewedRow(pr) {
  const fresh = pr.myReview && pr.lastCommitAt > pr.myReview.at;
  const review = MY_REVIEW[pr.myReview?.state] || "You reviewed";
  return row({
    key: `reviewed:${pr.id}`,
    url: fresh ? `${pr.url}/files` : pr.url,
    title: pr.title,
    iconName: fresh ? "refresh" : pr.myReview?.state === "APPROVED" ? "check" : "message",
    tone: fresh ? "warning" : "neutral",
    meta: `${ref(pr)} · ${esc(pr.author)} · ${review}${fresh ? ` · <span class="t-warning">new commits</span>` : ""}`,
    at: fresh ? pr.lastCommitAt : pr.myReview?.at || pr.updatedAt,
    ai: { item: pr, kind: fresh ? "recheck" : "review" },
  });
}

function followingRow(item) {
  const f = item.follow;
  const why = item.reasons.includes("eyes") && item.reasons.includes("commented") ? "You reacted 👀 and commented" : item.reasons.includes("eyes") ? "You reacted 👀" : "You commented";
  const reply = f.newReply ? `<span class="t-info">${esc(f.lastReply.author)} replied</span>` : f.lastReply ? `last reply from ${esc(f.lastReply.author)}` : "no replies yet";
  return row({
    key: `following:${item.id}`,
    url: f.newReply && f.lastReply?.url ? f.lastReply.url : item.url,
    title: item.title,
    iconName: f.newReply ? "message" : item.reasons.includes("eyes") ? "eyes" : item.kind === "pr" ? "pr" : "issue",
    tone: f.newReply ? "info" : "neutral",
    meta: `${ref(item)} · ${why} · ${reply}`,
    at: f.lastReply?.at || item.updatedAt,
    ai: { item, kind: f.newReply ? "reply" : null },
    dismiss: item.id,
  });
}

/** Followed threads, minus ones hidden until their next reply. */
function followingItems(d) {
  return (d.following || [])
    .filter((i) => {
      const hidden = state.followHidden[i.id];
      return !hidden || (i.follow.lastReply && i.follow.lastReply.at > hidden);
    })
    .sort((a, b) => Number(b.follow.newReply) - Number(a.follow.newReply) || (b.follow.lastReply?.at || b.updatedAt).localeCompare(a.follow.lastReply?.at || a.updatedAt));
}

function listView(items, render, emptyTitle) {
  return items.length ? `<ul class="items items--flat">${items.map(render).join("")}</ul>` : emptyState("check", emptyTitle);
}

function workTabs(d) {
  return [
    { id: "focus", label: "For you", count: null },
    { id: "reviews", label: "Reviews", count: d?.reviews.total },
    { id: "prs", label: "My PRs", count: d?.mine.total },
    { id: "issues", label: "Issues", count: d ? issueItems(d).length : null },
    { id: "following", label: "Following", count: d ? followingItems(d).filter((i) => i.follow.newReply).length || null : null },
  ];
}

/** The sync error for the header's "Sync failed" popup (`failed`), or, when the sync worked, partial-data warnings for the work panel. */
export function syncNotice(failed = false) {
  const s = state.settings;
  if (s.demo || !s.token) return "";
  const { error, errorSso } = state.status;
  const d = state.cache?.data;
  if (failed ? !error : error) return "";
  const messages = failed ? [error] : d?.warnings || [];
  if (!messages.length) return "";
  const text = messages.join(" ");
  const sso = errorSso || d?.sso;
  const hints = [];
  if (sso || /SAML|SSO/i.test(text)) hints.push(`The organization requires SSO. On <a href="https://github.com/settings/tokens">your tokens page</a>, choose <b>Configure SSO</b> next to this token and authorize <b>carbon-design-system</b>.`);
  if (/personal access token|fine-grained|not accessible/i.test(text) || s.tokenScopes === null) hints.push(`Fine-grained tokens can be blocked by org policy. A <a href="${CLASSIC_TOKEN_URL}">classic token</a> with <code>repo</code>, <code>notifications</code> and <code>read:org</code> is most reliable.`);
  if (/401|rejected/i.test(text)) hints.push(`Create a new <a href="${CLASSIC_TOKEN_URL}">classic token</a> on github.com and paste it in Settings.`);
  if (/reach api\.github\.com/i.test(text)) hints.push("On a corporate network or VPN, a proxy may be blocking api.github.com.");
  return `
    <div class="notice notice--${failed ? "error" : "warning"}" ${failed ? "" : 'role="alert"'}>
      ${icon("alert", 16)}
      <div class="notice__body">
        <p class="notice__title">${failed ? "Couldn't sync with GitHub" : `Some data couldn't load${d?.failed?.length ? ` (${esc(d.failed.join(", "))})` : ""}`}</p>
        <p class="notice__text">${esc(messages.slice(0, 2).join(" · "))}</p>
        ${hints.length ? `<ul class="notice__hints">${hints.map((h) => `<li>${h}</li>`).join("")}</ul>` : ""}
        <div class="notice__actions">
          ${sso ? `<a class="btn btn--primary btn--sm" href="${esc(sso)}">Authorize SSO</a>` : ""}
          <button class="btn btn--sm" data-action="sync">Retry</button>
          <button class="btn btn--ghost btn--sm" data-action="settings" data-section="github">Token settings</button>
        </div>
      </div>
    </div>`;
}

function connectView() {
  const repos = DD.repos.enabled(state.settings);
  return `
    <div class="connect">
      <span class="connect__mark">${icon("github", 28)}</span>
      <h2>Connect GitHub</h2>
      <p class="connect__lead">See review requests, your PRs, CI status, mentions and main-branch health for ${repos.length} Carbon repos — on every new tab.</p>
      <ol class="connect__steps">
        <li>Create a <a href="${CLASSIC_TOKEN_URL}">classic token</a> with <code>repo</code>, <code>notifications</code> and <code>read:org</code>.</li>
        <li>Paste it below. Your username is detected automatically.</li>
      </ol>
      <form class="connect__form" data-form="connect">
        <input class="input" type="password" name="token" placeholder="ghp_…" autocomplete="off" aria-label="GitHub token" data-focus="connect-token" required>
        <button class="btn btn--primary" type="submit">Connect</button>
      </form>
      <p class="connect__note">The token stays in this browser and is only sent to api.github.com.</p>
      <button class="btn btn--ghost" data-action="demo-on">Explore with sample data first</button>
    </div>`;
}

/** Edge fades on the scrolling work list: under the pinned heading once scrolled, and at the bottom while more is below. */
export function updateFades(panel) {
  if (!panel) return;
  panel.classList.toggle("is-scrolled", panel.scrollTop > 0);
  panel.classList.toggle("has-more", panel.scrollTop + panel.clientHeight < panel.scrollHeight - 1);
}

export function renderWork() {
  const el = $("#work");
  aiTargets.clear();
  // Syncs re-render the list; keep the reader's place unless they switched tabs.
  const prev = $(".work__panel", el);
  const sameTab = prev?.getAttribute("aria-labelledby") === `tab-${ui.tab}`;
  const scroll = sameTab ? prev.scrollTop : 0;
  // What was on screen before, so the render can point out what changed.
  const before = sameTab ? new Set($$(".item__title[data-focus]", prev).map((t) => t.dataset.focus)) : null;
  const loading = !!(prev && $(".item--skeleton", prev));
  const counts = Object.fromEntries($$(".tab", el).map((t) => [t.id, $(".tab__count", t)?.textContent]));
  keepFocus(el, () => {
    if (!connected()) {
      if (!$(".connect", el)) setHtml(el, connectView());
      return;
    }
    const d = data();
    const tabs = workTabs(d);
    if (!tabs.some((t) => t.id === ui.tab)) ui.tab = "focus";

    let body = "";
    let foot = "";
    const login = state.settings.login || "@me";
    if (!d) body = state.status.error ? "" : skeleton();
    else if (ui.tab === "focus") ({ body, foot } = focusView(d));
    else if (ui.tab === "reviews") {
      const items = [...d.reviews.items].sort((a, b) => Number(ins.isBot(a.author)) - Number(ins.isBot(b.author)) || new Date(a.createdAt) - new Date(b.createdAt));
      const requested = new Set(items.map((i) => i.id));
      // PRs you've already reviewed, newest commits first, so a re-review stands out.
      const reviewed = (d.reviewedOpen?.items || [])
        .filter((p) => !requested.has(p.id))
        .sort((a, b) => Number(b.lastCommitAt > b.myReview?.at) - Number(a.lastCommitAt > a.myReview?.at) || (b.lastCommitAt || "").localeCompare(a.lastCommitAt || ""));
      body =
        items.length || reviewed.length
          ? listSection("requested", "Requested from you", items, reviewRow) + listSection("reviewed", "Reviewed by you", reviewed, reviewedRow, "still open")
          : emptyState("check", "No reviews waiting on you");
      foot = `<span>${plural(d.reviewed.total, "PR")} reviewed since yesterday</span><a class="link" href="${esc(searchUrl(`is:pr is:open user-review-requested:${login} ${repoScope()}`))}">Open on GitHub</a>`;
    } else if (ui.tab === "prs") {
      const items = [...d.mine.items].sort((a, b) => PR_ORDER.indexOf(ins.prState(a)) - PR_ORDER.indexOf(ins.prState(b)));
      body = listView(items, prRow, "No open pull requests");
      foot = `<span>${d.merged.total} merged this week</span><a class="link" href="${esc(searchUrl(`is:pr is:open author:${login} ${repoScope()}`))}">Open on GitHub</a>`;
    } else if (ui.tab === "following") {
      const items = followingItems(d);
      const fresh = items.filter((i) => i.follow.newReply);
      body = items.length
        ? listSection("replies", "New replies", fresh, followingRow) + listSection("following", fresh.length ? "Following" : "All threads", items.filter((i) => !i.follow.newReply), followingRow)
        : emptyState("eyes", "Not following anything yet", "Issues and PRs you comment on or react to with 👀 show up here.");
      foot = `<span>👀 threads are picked up when they next get activity</span><a class="link" href="${esc(searchUrl(`is:open commenter:${login} ${repoScope()}`))}">Open on GitHub</a>`;
    } else {
      body = listView(issueItems(d), issueRow, "Nothing assigned and no new mentions");
      const triage = `is:issue is:open label:"status: needs triage 🕵️‍♀️" ${repoScope()}`;
      const bobTriage = aiOn() && d.triage.items.length ? `<button class="btn btn--ghost btn--sm bob-btn" data-action="ai-triage">${icon("sparkle", 14)}Triage with Bob</button>` : "";
      foot = `<span class="work__foot-group"><a class="link" href="${esc(searchUrl(triage))}">${plural(d.triage.total, "issue")} ${d.triage.total === 1 ? "needs" : "need"} triage</a>${bobTriage}</span><a class="link" href="${esc(searchUrl(`is:open assignee:${login} ${repoScope()}`))}">Open on GitHub</a>`;
    }

    setHtml(
      el,
      `
      <div class="tabs" role="tablist" aria-label="Work">
        ${tabs
          .map(
            (t) => `
          <button class="tab" role="tab" id="tab-${t.id}" data-tab="${t.id}" data-focus="tab-${t.id}" aria-selected="${ui.tab === t.id}" aria-controls="work-panel" tabindex="${ui.tab === t.id ? 0 : -1}">
            ${t.label}${t.count != null ? `<span class="tab__count">${t.count}</span>` : ""}
          </button>`
          )
          .join("")}
      </div>
      <div class="work__panel" id="work-panel" role="tabpanel" aria-labelledby="tab-${ui.tab}">
        ${syncNotice()}
        ${body}
      </div>
      ${foot ? `<footer class="work__foot">${foot}</footer>` : ""}`
    );
  });
  const panel = $(".work__panel", el);
  if (panel) panel.scrollTop = scroll;
  updateFades(panel);
  if (!panel || calm()) return;
  $$(".tab", el).forEach((t) => {
    const c = $(".tab__count", t);
    if (c && t.id in counts && counts[t.id] !== c.textContent) c.classList.add("is-bumped");
  });
  const rows = $$(".item__title[data-focus]", panel).map((t) => t.closest(".item"));
  if (loading) stagger(rows, "translateY(4px)");
  else if (before?.size)
    rows
      .filter((row) => !before.has($(".item__title", row).dataset.focus))
      .forEach((row) => {
        row.classList.add("is-new-row");
        expand(row);
      });
}

/** `until` is "tomorrow" or "change": hidden until the item has new activity, however many days that takes. */
async function snooze(key, until = "tomorrow") {
  await removeRow($(`#work [data-focus="${CSS.escape(key)}"]`)?.closest(".item"));
  if (until === "change") {
    // Keep only entries that still hide something, so the map doesn't grow forever.
    const tasks = allTasks();
    const live = Object.fromEntries(tasks.filter((t) => state.untilChange[t.key] === (t.at || "")).map((t) => [t.key, t.at || ""]));
    const t = tasks.find((x) => x.key === key);
    state.untilChange = { ...live, [key]: t?.at || "" };
  } else state.day.snoozed[key] = true;
  renderAll();
  toast(until === "change" ? "Snoozed until there's new activity" : "Snoozed until tomorrow", "neutral", { label: "Undo", run: () => unsnoozeOne(key) });
  if (until === "change") await DD.storage.set({ snoozedUntilChange: state.untilChange });
  else await DD.day.update((d) => (d.snoozed[key] = true));
}

async function unsnoozeOne(key) {
  const wasToday = !!state.day.snoozed[key];
  delete state.day.snoozed[key];
  const { [key]: _, ...rest } = state.untilChange;
  state.untilChange = rest;
  // renderWork unfolds and highlights the row, as it does for anything new in the list.
  renderAll();
  $(`#work [data-focus="${CSS.escape(key)}"]`)?.focus();
  if (wasToday) await DD.day.update((d) => delete d.snoozed[key]);
  else await DD.storage.set({ snoozedUntilChange: state.untilChange });
}

// The snooze button whose menu is open: the menu is anchored to it (see the snooze-menu action).
export let snoozeFrom = null;

/** A row is about to leave the work list: hand focus to its neighbour so keyboard users keep their place, then fold it. */
async function removeRow(row) {
  if (row?.contains(document.activeElement)) {
    const titles = $$(".work__panel .item__title");
    const i = titles.indexOf($(".item__title", row));
    (titles[i + 1] || titles[i - 1] || $(`#tab-${ui.tab}`))?.focus({ preventScroll: true });
  }
  await collapse(row);
}

/** Arrow keys or J/K move between rows of the work list. */
export function moveInList(step) {
  const titles = $$(".work__panel .item__title[href]");
  if (!titles.length) return;
  const i = titles.indexOf(document.activeElement);
  const next = i < 0 ? titles[0] : titles[Math.min(Math.max(i + step, 0), titles.length - 1)];
  next.focus();
  next.scrollIntoView({ block: "nearest" });
}

export async function unsnooze() {
  state.day.snoozed = {};
  state.untilChange = {};
  renderAll();
  await DD.day.update((d) => (d.snoozed = {}));
  await DD.storage.set({ snoozedUntilChange: {} });
}

export const workActions = {
  // The button's popovertarget opens the menu; remember which row it's for and pin the menu to it.
  "snooze-menu": (el) => {
    const menu = $("#snooze-menu");
    snoozeFrom?.style.removeProperty("anchor-name");
    snoozeFrom = el;
    el.style.anchorName = "--snooze";
    menu.dataset.key = el.dataset.key;
  },
  "snooze-for": (el) => {
    const menu = $("#snooze-menu");
    menu.hidePopover();
    snooze(menu.dataset.key, el.dataset.until);
  },
  unsnooze,
  unfollow: async (el) => {
    await removeRow(el.closest(".item"));
    state.followHidden = { ...state.followHidden, [el.dataset.id]: new Date().toISOString() };
    renderWork();
    await DD.storage.set({ followHidden: state.followHidden });
  },
};

export function selectTab(id, focus = false) {
  const from = $(`#tab-${ui.tab}`)?.getBoundingClientRect();
  ui.tab = id;
  saveUi();
  renderWork();
  const to = $(`#tab-${id}`);
  if (focus) to?.focus();
  if (!from || !to || calm()) return;
  const r = to.getBoundingClientRect();
  if (r.left === from.left) return;
  // The underline is inset 10px on each side (see .tab::after).
  const scale = (from.width - 20) / (r.width - 20);
  to.animate({ transform: [`translateX(${from.left - r.left}px) scaleX(${scale})`, "none"] }, { duration: 220, easing: EASE, pseudoElement: "::after" });
  $(".work__panel")?.animate({ opacity: [0, 1], transform: ["translateY(4px)", "none"] }, { duration: 180, easing: EASE });
}
