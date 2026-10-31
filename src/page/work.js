// The work panel: the For you / Issues / Pull requests / Following tabs, snoozing, unfollowing, and the
// one-click fixes on rows (ready to merge, re-run CI, step off a stale review, close a stale PR).

import { ageDays, esc, plural, storage, updateDay } from "../core.js";
import { addLabels, enableAutoMerge, removeReviewer, requestReviewers, rerunFailedJobs, setPrState } from "../github.js";
import { STALE_DAYS, ageText, askedAt, bucket, checkHint, isBot, isSnoozed, prState, reviewSize, weekStats } from "../insights.js";
import { repoBySlug } from "../repos.js";
import { requestSync, syncNotice, tokenNotice } from "./header.js";
import { icon } from "./icons.js";
import { renderAll } from "./main.js";
import { $, $$, CLASSIC_TOKEN_URL, PRIVACY_URL, aiOn, allTasks, bobTargets, connected, data, emptyState, foldSection, issueItems, keepFocus, listSection, openFolds, ref, repoScope, row, saveView, searchUrl, setHtml, skeleton, state, toast, view, visibleTasks } from "./ui.js";

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
  staleReview: ["clock", "neutral"],
  stalePr: ["clock", "neutral"],
};

/** The failing checks, linked to their logs: "avt and test", or "avt, test and 3 more". */
function checkLinks(checks) {
  const link = (c) => (c.url ? `<a class="item__link" href="${esc(c.url)}" data-tooltip="Open the ${esc(c.name)} log">${esc(c.name)}</a>` : esc(c.name));
  if (checks.length > 2) return `${checks.slice(0, 2).map(link).join(", ")} and ${checks.length - 2} more`;
  return checks.map(link).join(" and ");
}

/** "CI failing: avt · fill in the PR template". */
function ciMeta(pr) {
  if (!pr.failingChecks?.length) return "CI failing";
  const hint = pr.failingChecks.map((c) => checkHint(c.name)).find(Boolean);
  return `CI failing: ${checkLinks(pr.failingChecks)}${hint ? ` · <span class="t-warning">${esc(hint)}</span>` : ""}`;
}

/** Ready to merge: adds the repo's ready label and turns on auto-merge, whichever of the two apply. */
function readyCta(pr) {
  const label = repoBySlug(pr.repo)?.readyLabel;
  const addsLabel = label && !pr.labels.includes(label);
  const merges = pr.canAutoMerge && !pr.autoMerge;
  if (!addsLabel && !merges) return null;
  const what = [addsLabel && `adds “${label}”`, merges && "turns on auto-merge, so GitHub merges it once checks pass"].filter(Boolean).join(" and ");
  return { label: "Ready to merge", iconName: "merge", action: "pr-ready", id: pr.id, tooltip: what[0].toUpperCase() + what.slice(1), primary: true };
}

const rerunCta = (pr) => (pr.failingChecks?.some((c) => c.runId) ? { label: "Re-run", iconName: "refresh", action: "pr-rerun", id: pr.id, tooltip: `Re-run the failed jobs (${pr.failingChecks.map((c) => c.name).join(", ")})` } : null);

const unrequestCta = (pr) => ({ label: "Remove me", action: "pr-unrequest", id: pr.id, tooltip: "Remove yourself as a reviewer (you can undo)" });

const closeCta = (pr) => ({ label: "Close", action: "pr-close", id: pr.id, tooltip: "Close this PR (you can undo)" });

function taskCta(t) {
  if (t.kind === "ready") return readyCta(t.item);
  if (t.kind === "ciFailed") return rerunCta(t.item);
  if (t.kind === "staleReview") return unrequestCta(t.item);
  if (t.kind === "stalePr") return closeCta(t.item);
  return null;
}

function taskRow(t) {
  if (t.kind === "main")
    return row({
      key: t.key,
      url: t.url,
      title: `main is failing on ${repoBySlug(t.repo)?.short || t.repo}`,
      iconName: "alert",
      tone: "error",
      meta: `<span class="mono">${esc(t.ref.split("@")[1])}</span> · ${t.checks?.length ? `${checkLinks(t.checks)} · ` : ""}${esc(t.title)}`,
      at: t.at,
      snooze: t.key,
      bob: { kind: "main", task: t },
    });
  const [iconName, tone] = TASK_LOOK[t.kind];
  const quiet = (t.kind === "review" && isBot(t.item.author)) || (t.kind === "ciFailed" && t.item.draft);
  const reason = t.kind === "ciFailed" ? `${ciMeta(t.item)}${t.item.draft ? " · draft" : ""}` : esc(t.reason);
  return row({
    key: t.key,
    url: t.url,
    title: t.title,
    iconName,
    tone: quiet ? "neutral" : tone,
    meta: `${ref(t.item)} · ${reason}${t.detail && t.kind !== "ciFailed" ? ` · <span class="t-warning">${esc(t.detail)}</span>` : ""}`,
    at: t.item.updatedAt,
    snooze: t.key,
    bob: { item: t.item, kind: t.kind, task: t },
    cta: taskCta(t),
  });
}

const PR_LOOK = {
  conflict: ["alert", "warning", "Merge conflict"],
  ciFailed: ["x", "error", "CI failing"],
  changes: ["message", "warning", "Changes requested"],
  ready: ["merge", "success", "Ready to merge"],
  autoMerge: ["merge", "info", "Auto-merge on · merges once checks pass"],
  queued: ["merge", "info", "In the merge queue"],
  design: ["eye", "neutral", "Approved · waiting on design review"],
  oneMore: ["check", "neutral", "Needs one more approval"],
  ciRunning: ["clock", "neutral", "CI running"],
  draft: ["draft", "neutral", "Draft"],
  waiting: ["pr", "neutral", "Waiting for review"],
};

function myPrRow(pr) {
  const st = prState(pr);
  const [iconName, tone] = PR_LOOK[st];
  let text = esc(PR_LOOK[st][2]);
  if (st === "ciFailed") text = ciMeta(pr);
  if (st === "changes" && pr.changeRequests.length) text += ` by ${esc(pr.changeRequests.join(", "))}`;
  if (st === "queued" && pr.queue.position) text += ` · #${pr.queue.position}`;
  if (st === "oneMore") text = `${pr.approvals.length} of ${pr.approvalsNeeded} approvals · ${esc(pr.approvals.join(", "))}`;
  const stale = ageDays(pr.updatedAt) >= STALE_DAYS;
  return row({
    key: pr.id,
    url: pr.url,
    title: pr.title,
    iconName: stale ? "clock" : iconName,
    tone: stale ? "neutral" : tone,
    meta: `${ref(pr)} · ${stale ? `No activity for ${ageText(ageDays(pr.updatedAt))} · ` : ""}${text}${pr.draft && st !== "draft" ? " · draft" : ""}`,
    at: pr.updatedAt,
    bob: { item: pr },
    cta: stale ? closeCta(pr) : st === "ready" ? readyCta(pr) : st === "ciFailed" ? rerunCta(pr) : null,
  });
}

function reviewRow(pr) {
  const days = ageDays(askedAt(pr));
  const stale = days >= STALE_DAYS;
  const overdue = !stale && !isBot(pr.author) && days >= state.settings.staleReviewDays;
  const size = pr.additions != null ? ` · <span data-tooltip="${plural(pr.files || 0, "file")} changed">${reviewSize(pr)} <span class="mono"><span class="t-add">+${pr.additions}</span> <span class="t-del">−${pr.deletions}</span></span></span>` : "";
  const age = stale ? ` · requested ${ageText(days)} ago` : overdue ? ` · <span class="t-warning">waiting ${Math.floor(days)}d</span>` : "";
  return row({
    key: pr.id,
    url: pr.url,
    title: pr.title,
    iconName: stale ? "clock" : "eye",
    tone: isBot(pr.author) || stale ? "neutral" : overdue ? "warning" : "info",
    meta: `${ref(pr)} · ${esc(pr.author)}${age}${size}`,
    at: askedAt(pr),
    bob: { item: pr, kind: "review" },
    cta: stale ? unrequestCta(pr) : null,
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
  const groups = { now: [], next: [], later: [], stale: [] };
  tasks.forEach((t) => groups[bucket(t)].push(t));
  // Dependency bumps wait together, folded, so a handful of them doesn't bury the rest of Later.
  let deps = groups.later.filter((t) => t.kind === "review" && isBot(t.item.author));
  if (deps.length > 1) groups.later = groups.later.filter((t) => !deps.includes(t));
  else deps = [];
  const active = groups.now.length + groups.next.length + groups.later.length + deps.length;
  const onlyLater = !groups.now.length && !groups.next.length;
  const folded = foldSection("deps", "Dependency updates", deps, taskRow, "from bots") + foldSection("stale", "Stale", groups.stale, taskRow, `quiet for ${STALE_DAYS}+ days: close, step off, or pick back up`);
  const body = active
    ? listSection("now", "Now", groups.now, taskRow) + listSection("next", "Next", groups.next, taskRow) + listSection("later", onlyLater ? "When you have time" : "Later", groups.later, taskRow, onlyLater ? "" : "Can wait") + folded
    : emptyState("check", "You're all caught up", "Nothing needs you right now.") + folded;
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

const PR_ORDER = ["ciFailed", "conflict", "changes", "ready", "oneMore", "design", "waiting", "ciRunning", "autoMerge", "queued", "draft"];

/** "5h", "1.5d". */
const hours = (h) => (h < 24 ? `${Math.max(1, Math.round(h))}h` : `${(h / 24).toFixed(1).replace(/\.0$/, "")}d`);

function pullRequestsTab(d, login) {
  // People before bots, stale requests last, and otherwise the longest waiting first.
  const stale = (p) => ageDays(askedAt(p)) >= STALE_DAYS;
  const requested = [...d.reviews.items].sort((a, b) => stale(a) - stale(b) || isBot(a.author) - isBot(b.author) || askedAt(a).localeCompare(askedAt(b)));
  const quiet = (p) => ageDays(p.updatedAt) >= STALE_DAYS;
  const mine = [...d.mine.items].sort((a, b) => quiet(a) - quiet(b) || PR_ORDER.indexOf(prState(a)) - PR_ORDER.indexOf(prState(b)));
  // PRs I've already reviewed that are still open; ones with new commits first.
  const asked = new Set(requested.map((i) => i.id));
  const fresh = (p) => p.lastCommitAt > p.myReview?.at;
  const reviewed = d.reviewedOpen.items.filter((p) => !asked.has(p.id)).sort((a, b) => fresh(b) - fresh(a) || (b.lastCommitAt || "").localeCompare(a.lastCommitAt || ""));
  return {
    body:
      requested.length || mine.length || reviewed.length
        ? listSection("requested", "Review requested", requested, reviewRow) + listSection("mine", "Yours", mine, myPrRow) + listSection("reviewed", "Reviewed by you", reviewed, reviewedRow, "still open")
        : emptyState("check", "No open pull requests"),
    foot: `${weekLine(d)}<a class="link" href="${esc(searchUrl(`is:pr is:open involves:${login} ${repoScope()}`))}">Open on GitHub</a>`,
  };
}

/** "This week: 3 merged · 7 reviewed · first reviews in ~1.5d". */
function weekLine(d) {
  const w = weekStats(d);
  const wait = w.firstReviewHours != null ? ` · <span data-tooltip="Median time from ready for review to the first review, on your PRs merged this week">first reviews in ~${hours(w.firstReviewHours)}</span>` : "";
  return `<span>This week: ${w.merged} merged · ${plural(w.reviewed, "PR")} reviewed${wait}</span>`;
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
  { id: "focus", label: "For you", render: forYouTab, count: () => visibleTasks().filter((t) => bucket(t) === "now").length || null },
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
      <p class="connect__note">By connecting, you let Dev Dashboard read your GitHub pull requests, issues, reviews, comments and notifications with this token. The token and that data stay in this browser and are only sent to api.github.com. <a href="${PRIVACY_URL}">Privacy policy</a></p>
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
      <div class="work__panel" role="tabpanel" aria-labelledby="tab-${tab.id}">${syncNotice()}${tokenNotice()}${body}</div>
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

/** While a row's snooze menu is open, its buttons stay visible (the menu is anchored to one of them). Folded groups remember being open. */
export function bindWork() {
  $("#snooze-menu").addEventListener("toggle", (e) => snoozeButton?.closest(".item")?.classList.toggle("is-active", e.newState === "open"));
  $("#work").addEventListener("toggle", (e) => e.target.dataset?.fold && (e.target.open ? openFolds.add(e.target.dataset.fold) : openFolds.delete(e.target.dataset.fold)), true);
}

// ---------- one-click fixes ----------

const findPr = (id) => {
  const d = data();
  return [...d.mine.items, ...d.reviews.items].find((p) => p.id === id);
};

/**
 * One GitHub change from a row's button: the button shows it's working, a toast says how it went (with
 * Undo where there is one), and a sync brings the row up to date.
 */
async function change(el, busy, run, done, undo = null) {
  const html = el.innerHTML;
  el.disabled = true;
  el.textContent = busy;
  try {
    await run();
    el.textContent = "Done";
    toast(done, "success", undo && { label: "Undo", run: () => undo().then(() => requestSync(), (err) => toast(err.message, "error")) });
    requestSync();
  } catch (err) {
    el.disabled = false;
    el.innerHTML = html;
    toast(err.message, "error");
  }
}

const fixActions = {
  "pr-ready": (el) => {
    const pr = findPr(el.dataset.id);
    const label = repoBySlug(pr.repo)?.readyLabel;
    const token = state.settings.token;
    const merges = pr.canAutoMerge && !pr.autoMerge;
    change(
      el,
      "Marking…",
      async () => {
        if (label && !pr.labels.includes(label)) await addLabels(token, pr.repo, pr.number, [label]);
        if (merges) await enableAutoMerge(token, pr.id, data().repos[pr.repo]?.mergeMethod);
      },
      merges ? `Auto-merge is on for #${pr.number}. GitHub merges it once checks pass.` : `Marked #${pr.number} ready to merge`
    );
  },
  "pr-rerun": (el) => {
    const pr = findPr(el.dataset.id);
    const runs = [...new Set(pr.failingChecks.map((c) => c.runId).filter(Boolean))];
    change(el, "Starting…", () => Promise.all(runs.map((id) => rerunFailedJobs(state.settings.token, pr.repo, id))), `Re-running ${pr.failingChecks.map((c) => c.name).join(", ")} on #${pr.number}`);
  },
  "pr-unrequest": (el) => {
    const pr = findPr(el.dataset.id);
    const { token, login } = state.settings;
    change(el, "Removing…", () => removeReviewer(token, pr.repo, pr.number, login), `You're no longer a reviewer on #${pr.number}`, () => requestReviewers(token, pr.repo, pr.number, [login]));
  },
  "pr-close": (el) => {
    const pr = findPr(el.dataset.id);
    const token = state.settings.token;
    change(el, "Closing…", () => setPrState(token, pr.repo, pr.number, "closed"), `Closed #${pr.number}`, () => setPrState(token, pr.repo, pr.number, "open"));
  },
};

export const workActions = {
  ...fixActions,
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
