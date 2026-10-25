// The work panel: the For you / Issues / Pull requests / Following tabs, snoozing, and unfollowing.

import { ageDays, esc, plural, storage, updateDay } from "../core.js";
import { bucket, isBot, isSnoozed, prState } from "../insights.js";
import { repoBySlug } from "../repos.js";
import { syncNotice } from "./header.js";
import { icon } from "./icons.js";
import { renderAll } from "./main.js";
import { $, $$, CLASSIC_TOKEN_URL, aiOn, allTasks, bobTargets, connected, data, emptyState, issueItems, keepFocus, listSection, ref, repoScope, row, saveView, searchUrl, setHtml, skeleton, state, toast, view } from "./ui.js";

// ---------- rows ----------

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
  if (t.kind === "main")
    return row({
      key: t.key,
      url: t.url,
      title: `main is failing on ${repoBySlug(t.repo)?.short || t.repo}`,
      iconName: "alert",
      tone: "error",
      meta: `<span class="mono">${esc(t.ref.split("@")[1])}</span> · ${esc(t.title)}`,
      at: t.at,
      snooze: t.key,
      bob: { kind: "main", task: t },
    });
  const [iconName, tone] = TASK_LOOK[t.kind];
  const quiet = (t.kind === "review" && isBot(t.item.author)) || (t.kind === "ciFailed" && t.item.draft);
  return row({
    key: t.key,
    url: t.url,
    title: t.title,
    iconName,
    tone: quiet ? "neutral" : tone,
    meta: `${ref(t.item)} · ${esc(t.reason)}${t.detail ? ` · <span class="t-warning">${esc(t.detail)}</span>` : ""}`,
    at: t.item.updatedAt,
    snooze: t.key,
    bob: { item: t.item, kind: t.kind, task: t },
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

function myPrRow(pr) {
  const st = prState(pr);
  const [iconName, tone, text] = PR_LOOK[st];
  const by = st === "changes" && pr.changeRequests.length ? ` by ${esc(pr.changeRequests.join(", "))}` : "";
  return row({ key: pr.id, url: pr.url, title: pr.title, iconName, tone, meta: `${ref(pr)} · ${text}${by}${pr.draft && st !== "draft" ? " · draft" : ""}`, at: pr.updatedAt, bob: { item: pr } });
}

function reviewRow(pr) {
  const days = ageDays(pr.createdAt);
  const stale = !isBot(pr.author) && days >= state.settings.staleReviewDays;
  const size = pr.additions != null ? ` · <span class="mono"><span class="t-add">+${pr.additions}</span> <span class="t-del">−${pr.deletions}</span></span>` : "";
  return row({
    key: pr.id,
    url: pr.url,
    title: pr.title,
    iconName: "eye",
    tone: isBot(pr.author) ? "neutral" : stale ? "warning" : "info",
    meta: `${ref(pr)} · ${esc(pr.author)}${stale ? ` · <span class="t-warning">waiting ${Math.floor(days)}d</span>` : ""}${size}`,
    at: pr.createdAt,
    bob: { item: pr, kind: "review" },
  });
}

const MY_REVIEW = { APPROVED: "You approved", CHANGES_REQUESTED: "You requested changes", COMMENTED: "You commented", DISMISSED: "Your review was dismissed" };

function reviewedRow(pr) {
  const fresh = pr.myReview && pr.lastCommitAt > pr.myReview.at;
  return row({
    key: `reviewed:${pr.id}`,
    url: fresh ? `${pr.url}/files` : pr.url,
    title: pr.title,
    iconName: fresh ? "refresh" : pr.myReview?.state === "APPROVED" ? "check" : "message",
    tone: fresh ? "warning" : "neutral",
    meta: `${ref(pr)} · ${esc(pr.author)} · ${MY_REVIEW[pr.myReview?.state] || "You reviewed"}${fresh ? ` · <span class="t-warning">new commits</span>` : ""}`,
    at: fresh ? pr.lastCommitAt : pr.myReview?.at || pr.updatedAt,
    bob: { item: pr, kind: fresh ? "recheck" : "review" },
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
    bob: { item, kind: why === "mention" ? "mention" : null },
  });
}

function followingRow(item) {
  const f = item.follow;
  const eyes = item.reasons.includes("eyes");
  const why = eyes && item.reasons.includes("commented") ? "You reacted 👀 and commented" : eyes ? "You reacted 👀" : "You commented";
  const reply = f.newReply ? `<span class="t-info">${esc(f.lastReply.author)} replied</span>` : f.lastReply ? `last reply from ${esc(f.lastReply.author)}` : "no replies yet";
  return row({
    key: `following:${item.id}`,
    url: (f.newReply && f.lastReply.url) || item.url,
    title: item.title,
    iconName: f.newReply ? "message" : eyes ? "eyes" : item.kind === "pr" ? "pr" : "issue",
    tone: f.newReply ? "info" : "neutral",
    meta: `${ref(item)} · ${why} · ${reply}`,
    at: f.lastReply?.at || item.updatedAt,
    bob: { item, kind: f.newReply ? "reply" : null },
    unfollow: item.id,
  });
}

/** Followed threads, minus ones hidden until their next reply; new replies first. */
function followingItems(d) {
  return d.following
    .filter((i) => !state.followHidden[i.id] || i.follow.lastReply?.at > state.followHidden[i.id])
    .sort((a, b) => b.follow.newReply - a.follow.newReply || (b.follow.lastReply?.at || b.updatedAt).localeCompare(a.follow.lastReply?.at || a.updatedAt));
}

// ---------- tabs ----------

function forYouTab() {
  const all = allTasks();
  const tasks = all.filter((t) => !isSnoozed(t, state.day.snoozed, state.untilChange));
  const groups = { now: [], next: [], later: [] };
  tasks.forEach((t) => groups[bucket(t)].push(t));
  const onlyLater = !groups.now.length && !groups.next.length;
  const body = tasks.length
    ? listSection("now", "Now", groups.now, taskRow) + listSection("next", "Next", groups.next, taskRow) + listSection("later", onlyLater ? "When you have time" : "Later", groups.later, taskRow, onlyLater ? "" : "Can wait")
    : emptyState("check", "You're all caught up", "Nothing needs you right now.");
  const snoozed = all.length - tasks.length;
  const foot = snoozed ? `<span>${plural(snoozed, "item")} snoozed</span><button class="btn btn--ghost btn--sm" data-action="unsnooze">Restore</button>` : "";
  return { body, foot };
}

function issuesTab(d, login) {
  const triage = `is:issue is:open label:"status: needs triage 🕵️‍♀️" ${repoScope()}`;
  const bob = aiOn() && d.triage.items.length ? `<button class="btn btn--ghost btn--sm bob-btn" data-action="bob-triage">${icon("sparkle", 14)}Triage with Bob</button>` : "";
  const items = issueItems(d);
  return {
    body: items.length ? `<ul class="items">${items.map(issueRow).join("")}</ul>` : emptyState("check", "Nothing assigned and no new mentions"),
    foot: `<span class="work__foot-group"><a class="link" href="${esc(searchUrl(triage))}">${plural(d.triage.total, "issue")} ${d.triage.total === 1 ? "needs" : "need"} triage</a>${bob}</span><a class="link" href="${esc(searchUrl(`is:open assignee:${login} ${repoScope()}`))}">Open on GitHub</a>`,
  };
}

const PR_ORDER = ["ciFailed", "conflict", "changes", "ready", "waiting", "ciRunning", "draft"];

function pullRequestsTab(d, login) {
  const requested = [...d.reviews.items].sort((a, b) => isBot(a.author) - isBot(b.author) || a.createdAt.localeCompare(b.createdAt));
  const mine = [...d.mine.items].sort((a, b) => PR_ORDER.indexOf(prState(a)) - PR_ORDER.indexOf(prState(b)));
  // PRs I've already reviewed that are still open; ones with new commits first.
  const asked = new Set(requested.map((i) => i.id));
  const fresh = (p) => p.lastCommitAt > p.myReview?.at;
  const reviewed = d.reviewedOpen.items.filter((p) => !asked.has(p.id)).sort((a, b) => fresh(b) - fresh(a) || (b.lastCommitAt || "").localeCompare(a.lastCommitAt || ""));
  return {
    body:
      requested.length || mine.length || reviewed.length
        ? listSection("requested", "Review requested", requested, reviewRow) + listSection("mine", "Yours", mine, myPrRow) + listSection("reviewed", "Reviewed by you", reviewed, reviewedRow, "still open")
        : emptyState("check", "No open pull requests"),
    foot: `<span>${d.merged.total} merged this week · ${plural(d.reviewed.total, "PR")} reviewed since yesterday</span><a class="link" href="${esc(searchUrl(`is:pr is:open involves:${login} ${repoScope()}`))}">Open on GitHub</a>`,
  };
}

function followingTab(d, login) {
  const items = followingItems(d);
  const fresh = items.filter((i) => i.follow.newReply);
  return {
    body: items.length
      ? listSection("replies", "New replies", fresh, followingRow) + listSection("following", fresh.length ? "Following" : "All threads", items.filter((i) => !i.follow.newReply), followingRow)
      : emptyState("eyes", "Not following anything yet", "Issues and PRs you comment on or react to with 👀 show up here."),
    foot: `<span>👀 threads are picked up when they next get activity</span><a class="link" href="${esc(searchUrl(`is:open commenter:${login} ${repoScope()}`))}">Open on GitHub</a>`,
  };
}

const TABS = [
  { id: "focus", label: "For you", render: forYouTab },
  { id: "issues", label: "Issues", render: issuesTab, count: (d) => issueItems(d).length },
  { id: "prs", label: "Pull requests", render: pullRequestsTab, count: (d) => d.mine.total + d.reviews.total },
  { id: "following", label: "Following", render: followingTab, count: (d) => followingItems(d).filter((i) => i.follow.newReply).length || null },
];

function connectView() {
  return `
    <div class="connect">
      <span class="connect__mark">${icon("github", 28)}</span>
      <h2>Connect GitHub</h2>
      <p class="connect__lead">See review requests, your PRs, CI status, mentions and main-branch health for your Carbon repos — on every new tab.</p>
      <ol class="connect__steps">
        <li>Create a <a href="${CLASSIC_TOKEN_URL}">classic token</a> with <code>repo</code>, <code>notifications</code> and <code>read:org</code>.</li>
        <li>Paste it below. Your username is detected automatically.</li>
      </ol>
      <form class="connect__form" data-form="connect">
        <input class="input" type="password" name="token" placeholder="ghp_…" autocomplete="off" aria-label="GitHub token" data-focus="connect-token" required>
        <button class="btn btn--primary" type="submit">Connect</button>
      </form>
      <p class="connect__note">The token stays in this browser and is only sent to api.github.com.</p>
    </div>`;
}

export function renderWork() {
  const el = $("#work");
  if (!connected()) return setHtml(el, connectView());
  bobTargets.clear();
  const d = data();
  if (!TABS.some((t) => t.id === view.tab)) view.tab = "focus";
  const tab = TABS.find((t) => t.id === view.tab);
  const login = state.settings.login || "@me";
  const { body, foot } = d ? tab.render(d, login) : { body: state.status.error ? "" : skeleton(), foot: "" };
  // A sync re-renders the list: keep the reader's place.
  const scroll = $(".work__panel", el)?.scrollTop || 0;
  keepFocus(el, () =>
    setHtml(
      el,
      `<div class="tabs" role="tablist" aria-label="Work">
        ${TABS.map((t) => {
          const count = d && t.count?.(d);
          return `<button class="tab" role="tab" id="tab-${t.id}" data-tab="${t.id}" data-focus="tab-${t.id}" aria-selected="${t === tab}" tabindex="${t === tab ? 0 : -1}">${t.label}${count != null ? `<span class="tab__count">${count}</span>` : ""}</button>`;
        }).join("")}
      </div>
      <div class="work__panel" role="tabpanel" aria-labelledby="tab-${tab.id}">${syncNotice()}${body}</div>
      ${foot ? `<footer class="work__foot">${foot}</footer>` : ""}`
    )
  );
  $(".work__panel", el).scrollTop = scroll;
}

export function selectTab(id, focus = false) {
  view.tab = id;
  saveView();
  renderWork();
  $(".work__panel").scrollTop = 0;
  if (focus) $(`#tab-${id}`)?.focus();
}

/** J/K or the arrow keys move between rows. */
export function moveInList(step) {
  const titles = $$(".work__panel .item__title");
  if (!titles.length) return;
  const i = titles.indexOf(document.activeElement);
  const next = titles[i < 0 ? 0 : Math.min(Math.max(i + step, 0), titles.length - 1)];
  next.focus();
  next.scrollIntoView({ block: "nearest" });
}

// ---------- snoozing ----------

/** `until` is "tomorrow", or "change": hidden until the item has new activity. */
async function snooze(key, until) {
  if (until === "change") {
    // Keep only entries that still hide something, so the map doesn't grow forever.
    const tasks = allTasks();
    const live = Object.fromEntries(tasks.filter((t) => state.untilChange[t.key] === (t.at || "")).map((t) => [t.key, t.at || ""]));
    state.untilChange = { ...live, [key]: tasks.find((t) => t.key === key)?.at || "" };
    await storage.set({ snoozedUntilChange: state.untilChange });
  } else {
    state.day.snoozed[key] = true;
    await updateDay((day) => (day.snoozed[key] = true));
  }
  renderAll();
  toast(until === "change" ? "Snoozed until there's new activity" : "Snoozed until tomorrow", "neutral", { label: "Undo", run: () => unsnooze(key) });
}

/** Brings back one snoozed item, or all of them. */
export async function unsnooze(key) {
  if (key) {
    delete state.day.snoozed[key];
    delete state.untilChange[key];
  } else {
    state.day.snoozed = {};
    state.untilChange = {};
  }
  renderAll();
  await updateDay((day) => (day.snoozed = state.day.snoozed));
  await storage.set({ snoozedUntilChange: state.untilChange });
}

// The snooze button whose menu is open: the menu is anchored to it.
let snoozeButton = null;

/** While a row's snooze menu is open, its buttons stay visible (the menu is anchored to one of them). */
export function bindWork() {
  $("#snooze-menu").addEventListener("toggle", (e) => snoozeButton?.closest(".item")?.classList.toggle("is-active", e.newState === "open"));
}

export const workActions = {
  // The button opens the menu (popovertarget); pin the menu to it and remember which row it's for.
  "snooze-menu": (el) => {
    snoozeButton?.style.removeProperty("anchor-name");
    snoozeButton = el;
    el.style.anchorName = "--snooze";
    $("#snooze-menu").dataset.key = el.dataset.key;
  },
  "snooze-for": (el) => {
    $("#snooze-menu").hidePopover();
    snooze($("#snooze-menu").dataset.key, el.dataset.until);
  },
  unsnooze: () => unsnooze(),
  unfollow: async (el) => {
    state.followHidden = { ...state.followHidden, [el.dataset.id]: new Date().toISOString() };
    renderWork();
    await storage.set({ followHidden: state.followHidden });
  },
};
