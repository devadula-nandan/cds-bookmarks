// The work panel: the For you tab, the Issues and Pull requests tabs (GitHub's own views of them), snoozing, and the one-click fixes on rows (ready to merge, re-run CI, step off a stale review, close a stale PR).

import { ageDays, plural, storage, updateDay } from "../core.js";
import { TRIAGE_LABELS, addLabels, enableAutoMerge, removeReviewer, requestReviewers, rerunFailedJobs, setPrState } from "../github.js";
import { STALE_DAYS, ageText, askedAt, bucket, checkHint, isBot, isSnoozed, prState, reviewSize, weekStats } from "../insights.js";
import { repoBySlug } from "../repos.js";
import { requestSync, syncNotice, tokenNotice } from "./header.js";
import { icon } from "./icons.js";
import { html, nothing, render } from "./lit.js";
import { renderAll } from "./main.js";
import { $, $$, CLASSIC_TOKEN_URL, PRIVACY_URL, aiOn, allTasks, bobTargets, connected, data, emptyState, foldSection, listSection, openFolds, ref, row, saveView, skeleton, state, toast, view, visibleTasks } from "./ui.js";

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
  const link = (c) => (c.url ? html`<a class="item__link" href=${c.url} data-tooltip="Open the ${c.name} log">${c.name}</a>` : c.name);
  if (checks.length > 2) return html`${link(checks[0])}, ${link(checks[1])} and ${checks.length - 2} more`;
  return checks.length === 2 ? html`${link(checks[0])} and ${link(checks[1])}` : checks.map(link);
}

const warn = (text) => html`<span class="t-warning">${text}</span>`;

/** "CI failing: avt · fill in the PR template". */
function ciMeta(pr) {
  if (!pr.failingChecks?.length) return "CI failing";
  const hint = pr.failingChecks.map((c) => checkHint(c.name)).find(Boolean);
  return html`CI failing: ${checkLinks(pr.failingChecks)}${hint ? html` · ${warn(hint)}` : nothing}`;
}

/** Ready to merge: adds the repo's ready label and turns on auto-merge, whichever of the two apply. */
function readyCta(pr) {
  const label = data().repos?.[pr.repo]?.readyLabel;
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
      meta: html`<span class="mono">${t.ref.split("@")[1]}</span> · ${t.checks?.length ? html`${checkLinks(t.checks)} · ` : nothing}${t.title}`,
      at: t.at,
      snooze: t.key,
      bob: { kind: "main", task: t },
    });
  const [iconName, tone] = TASK_LOOK[t.kind];
  const quiet = (t.kind === "review" && isBot(t.item.author)) || (t.kind === "ciFailed" && t.item.draft);
  const reason = t.kind === "ciFailed" ? html`${ciMeta(t.item)}${t.item.draft ? " · draft" : ""}` : t.reason;
  return row({
    key: t.key,
    url: t.url,
    title: t.title,
    iconName,
    tone: quiet ? "neutral" : tone,
    meta: html`${ref(t.item)} · ${reason}${t.detail && t.kind !== "ciFailed" ? html` · ${warn(t.detail)}` : nothing}`,
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
  let text = PR_LOOK[st][2];
  if (st === "changes" && pr.changeRequests.length) text += ` by ${pr.changeRequests.join(", ")}`;
  if (st === "queued" && pr.queue.position) text += ` · #${pr.queue.position}`;
  if (st === "oneMore") text = `${pr.approvals.length} of ${pr.approvalsNeeded} approvals · ${pr.approvals.join(", ")}`;
  if (st === "ciFailed") text = ciMeta(pr);
  const stale = ageDays(pr.updatedAt) >= STALE_DAYS;
  return row({
    key: pr.id,
    url: pr.url,
    title: pr.title,
    iconName: stale ? "clock" : iconName,
    tone: stale ? "neutral" : tone,
    meta: html`${ref(pr)} · ${stale ? `No activity for ${ageText(ageDays(pr.updatedAt))} · ` : ""}${text}${pr.draft && st !== "draft" ? " · draft" : ""}`,
    at: pr.updatedAt,
    bob: { item: pr },
    cta: stale ? closeCta(pr) : st === "ready" ? readyCta(pr) : st === "ciFailed" ? rerunCta(pr) : null,
  });
}

function reviewRow(pr, team = false) {
  const days = ageDays(askedAt(pr));
  const stale = days >= STALE_DAYS;
  const overdue = !stale && !isBot(pr.author) && days >= state.settings.staleReviewDays;
  const size = pr.additions != null ? html` · <span data-tooltip="${plural(pr.files || 0, "file")} changed">${reviewSize(pr)} <span class="mono"><span class="t-add">+${pr.additions}</span> <span class="t-del">−${pr.deletions}</span></span></span>` : nothing;
  const age = stale ? ` · requested ${ageText(days)} ago` : overdue ? html` · ${warn(`waiting ${Math.floor(days)}d`)}` : nothing;
  return row({
    key: pr.id,
    url: pr.url,
    title: pr.title,
    iconName: stale ? "clock" : "eye",
    tone: isBot(pr.author) || stale ? "neutral" : overdue ? "warning" : "info",
    meta: html`${ref(pr)} · ${pr.author}${age}${size}`,
    at: askedAt(pr),
    bob: { item: pr, kind: "review" },
    // "Remove me" can't take a request off a team.
    cta: stale && !team ? unrequestCta(pr) : null,
  });
}

const teamReviewRow = (pr) => reviewRow(pr, true);

const MY_REVIEW = { APPROVED: "You approved", CHANGES_REQUESTED: "You requested changes", COMMENTED: "You commented", DISMISSED: "Your review was dismissed" };

function reviewedRow(pr) {
  const fresh = pr.myReview && pr.lastCommitAt > pr.myReview.at;
  return row({
    key: `reviewed:${pr.id}`,
    url: fresh ? `${pr.url}/files` : pr.url,
    title: pr.title,
    iconName: fresh ? "refresh" : pr.myReview?.state === "APPROVED" ? "check" : "message",
    tone: fresh ? "warning" : "neutral",
    meta: html`${ref(pr)} · ${pr.author} · ${MY_REVIEW[pr.myReview?.state] || "You reviewed"}${fresh ? html` · ${warn("new commits")}` : nothing}`,
    at: fresh ? pr.lastCommitAt : pr.myReview?.at || pr.updatedAt,
    bob: { item: pr, kind: fresh ? "recheck" : "review" },
  });
}

const ISSUE_LOOK = {
  assigned: ["issue", "neutral", "Assigned"],
  mentioning: ["at", "info", "Mentioned"],
  created: ["issue", "neutral", "Opened by you"],
};

/** A row for one of the issues dashboard's views. */
const issueRow = (list) => (item) => {
  const [iconName, tone, why] = ISSUE_LOOK[list];
  return row({
    key: item.id,
    url: item.url,
    title: item.title,
    iconName,
    tone,
    meta: html`${ref(item)} · ${why}${list === "created" ? nothing : html` · ${item.author}`}`,
    at: item.updatedAt,
    bob: { item, kind: list === "mentioning" ? "mention" : null },
  });
};

/** An issue waiting for triage: labelled for it, or in a triage status on the repo's board. */
function triageRow(item) {
  const labelled = item.labels.some((l) => TRIAGE_LABELS.includes(l));
  return row({
    key: `triage:${item.id}`,
    url: item.url,
    title: item.title,
    iconName: "issue",
    tone: "neutral",
    meta: html`${ref(item)} · ${labelled ? "Needs triage label" : "Triage on the board"} · ${item.author}`,
    at: item.updatedAt,
    bob: { item },
  });
}

/** A thread I follow: I reacted 👀 to it or commented on it. Opens on the newest reply when there's one I haven't answered. */
function followingRow(item) {
  const f = item.follow;
  const eyes = item.reasons.includes("eyes");
  const why = eyes && item.reasons.includes("commented") ? "You reacted 👀 and commented" : eyes ? "You reacted 👀" : "You commented";
  const reply = f.newReply ? html`<span class="t-info">${f.lastReply.author} replied</span>` : f.lastReply ? `last reply from ${f.lastReply.author}` : "no replies yet";
  return row({
    key: `following:${item.id}`,
    url: (f.newReply && f.lastReply.url) || item.url,
    title: item.title,
    iconName: f.newReply ? "message" : eyes ? "eyes" : item.kind === "pr" ? "pr" : "issue",
    tone: f.newReply ? "info" : "neutral",
    meta: html`${ref(item)} · ${why} · ${reply}`,
    at: f.lastReply?.at || item.updatedAt,
    bob: { item, kind: f.newReply ? "reply" : null },
  });
}

// ---------- tabs ----------

const byKey = (t) => t.key;
const byId = (i) => i.id;

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
  const folded = html`${foldSection("deps", "Dependency updates", deps, taskRow, byKey, "from bots")}${foldSection("stale", "Stale", groups.stale, taskRow, byKey, `quiet for ${STALE_DAYS}+ days: close, step off, or pick back up`)}`;
  const body = active
    ? html`${listSection("now", "Now", groups.now, taskRow, byKey)}${listSection("next", "Next", groups.next, taskRow, byKey)}${listSection("later", onlyLater ? "When you have time" : "Later", groups.later, taskRow, byKey, onlyLater ? "" : "Can wait")}${folded}`
    : html`${emptyState("check", "You're all caught up", "Nothing needs you right now.")}${folded}`;
  const snoozed = all.length - tasks.length;
  const foot = snoozed ? html`<span>${plural(snoozed, "item")} snoozed</span><button class="btn btn--ghost btn--sm" data-action="unsnooze">Restore</button>` : null;
  return { body, foot };
}

const items = (d, key) => d[key]?.items || [];
const newestFirst = (a, b) => b.updatedAt.localeCompare(a.updatedAt);

/** GitHub's issues dashboard: Assigned to me, Mentioning me and Created by me, open issues only, each issue once. */
function issueViews(d) {
  const seen = new Set();
  const open = (key) => items(d, key).filter((i) => i.kind === "issue" && !seen.has(i.id) && seen.add(i.id)).sort(newestFirst);
  return { assigned: open("assigned"), mentioning: open("mentioning"), created: open("created") };
}

/** Not one of GitHub's views either: every thread of this kind I follow, folded at the bottom; new replies first. */
function followingFold(d, kind) {
  const threads = (d.following || [])
    .filter((i) => i.kind === kind)
    .sort((a, b) => b.follow.newReply - a.follow.newReply || (b.follow.lastReply?.at || b.updatedAt).localeCompare(a.follow.lastReply?.at || a.updatedAt));
  const fresh = threads.filter((i) => i.follow.newReply).length;
  return foldSection(`following-${kind}`, "Following", threads, followingRow, byId, fresh ? `${fresh} new ${fresh === 1 ? "reply" : "replies"}` : "you reacted 👀 or commented");
}

function issuesTab(d) {
  const bob = aiOn() && d.triage.items.length ? html`<button class="btn btn--ghost btn--sm bob-btn" data-action="bob-triage">${icon("sparkle", 14)}Triage with Bob</button>` : nothing;
  const { assigned, mentioning, created } = issueViews(d);
  // Not one of GitHub's views: GitHub can't search labels and board statuses together.
  const triage = foldSection("triage", "Needs triage", [...d.triage.items].sort(newestFirst), triageRow, byId, "labelled, or Triage on the board");
  const folds = html`${triage}${followingFold(d, "issue")}`;
  return {
    body:
      assigned.length || mentioning.length || created.length
        ? html`${listSection("assigned", "Assigned to me", assigned, issueRow("assigned"), byId)}${listSection("mentioning", "Mentioning me", mentioning, issueRow("mentioning"), byId)}${listSection("created", "Created by me", created, issueRow("created"), byId)}${folds}`
        : html`${emptyState("check", "No open issues assigned to you, mentioning you or created by you")}${folds}`,
    foot: html`<span class="work__foot-group"><a class="link" href="#" data-action="show-triage">${plural(d.triage.total, "issue")} ${d.triage.total === 1 ? "needs" : "need"} triage</a>${bob}</span><a class="link" href="https://github.com/issues/assigned">Open on GitHub</a>`,
  };
}

/**
 * GitHub's pull requests inbox, section by section. My PRs are sorted by the dashboard's own reading of them
 * (CI from the newest runs, the repo's approval rule), so a PR waiting on design review waits, though GitHub
 * calls it approved. PRs in the merge queue or with auto-merge on count as ready to merge.
 */
function inboxSections(d) {
  // With team requests on, the review list has them too.
  const yours = d.reviews.items.filter((p) => !state.settings.includeTeamReviews || p.askedMe).sort(newestFirst);
  const asked = new Set(yours.map(byId));
  const team = (state.settings.includeTeamReviews ? items(d, "teamReviews") : []).filter((p) => !asked.has(p.id)).sort(newestFirst);
  const mine = [...d.mine.items].sort(newestFirst);
  const where = (pr) => {
    if (pr.draft) return "drafts";
    const st = prState(pr);
    if (["conflict", "ciFailed", "changes"].includes(st)) return "action";
    return ["ready", "autoMerge", "queued"].includes(st) ? "ready" : "waiting";
  };
  const of = (section) => mine.filter((p) => where(p) === section);
  // Not one of GitHub's: PRs I've already reviewed that are still open, ones with new commits first.
  const fresh = (p) => p.lastCommitAt > p.myReview?.at;
  const reviewed = d.reviewedOpen.items.filter((p) => !asked.has(p.id)).sort((a, b) => fresh(b) - fresh(a) || (b.lastCommitAt || "").localeCompare(a.lastCommitAt || ""));
  return { yours, team, drafts: of("drafts"), waiting: of("waiting"), action: of("action"), ready: of("ready"), reviewed };
}

function pullRequestsTab(d) {
  const s = inboxSections(d);
  const any = Object.values(s).some((l) => l.length);
  const following = followingFold(d, "pr");
  return {
    body: any
      ? html`${listSection("yours", "Needs your review", s.yours, reviewRow, byId)}${listSection("team", "Needs your teams' review", s.team, teamReviewRow, byId)}${listSection("drafts", "Your drafts", s.drafts, myPrRow, byId)}${listSection("waiting", "Waiting for review or checks", s.waiting, myPrRow, byId)}${listSection("action", "Needs action", s.action, myPrRow, byId)}${listSection("ready", "Ready to merge", s.ready, myPrRow, byId)}${foldSection("reviewed", "Reviewed by you", s.reviewed, reviewedRow, byId, "still open")}${following}`
      : html`${emptyState("check", "No open pull requests")}${following}`,
    foot: html`${weekLine(d)}<a class="link" href="https://github.com/pulls/inbox">Open on GitHub</a>`,
  };
}

/** "5h", "1.5d". */
const hours = (h) => (h < 24 ? `${Math.max(1, Math.round(h))}h` : `${(h / 24).toFixed(1).replace(/\.0$/, "")}d`);

/** "This week: 3 merged · 7 reviewed · first reviews in ~1.5d". */
function weekLine(d) {
  const w = weekStats(d);
  const wait = w.firstReviewHours != null ? html` · <span data-tooltip="Median time from ready for review to the first review, on your PRs merged this week">first reviews in ~${hours(w.firstReviewHours)}</span>` : nothing;
  return html`<span>This week: ${w.merged} merged · ${plural(w.reviewed, "PR")} reviewed${wait}</span>`;
}

const TABS = [
  { id: "focus", label: "For you", render: forYouTab, count: () => visibleTasks().filter((t) => bucket(t) === "now").length || null },
  { id: "issues", label: "Issues", render: issuesTab, count: (d) => issueViews(d).assigned.length },
  { id: "prs", label: "Pull requests", render: pullRequestsTab, count: (d) => d.mine.total + inboxSections(d).yours.length },
];

const CONNECT = html`
  <div class="connect">
    <span class="connect__mark">${icon("github", 28)}</span>
    <h2>Connect GitHub</h2>
    <p class="connect__lead">See review requests, your PRs, CI status, mentions and main-branch health for your Carbon repos — on every new tab.</p>
    <ol class="connect__steps">
      <li>Create a <a href=${CLASSIC_TOKEN_URL}>classic token</a> with <code>repo</code>, <code>notifications</code>, <code>read:org</code> and <code>read:project</code>.</li>
      <li>Paste it below. Your username is detected automatically.</li>
    </ol>
    <form class="connect__form" data-form="connect">
      <input class="input" type="password" name="token" placeholder="ghp_…" autocomplete="off" aria-label="GitHub token" required>
      <button class="btn btn--primary" type="submit">Connect</button>
    </form>
    <p class="connect__note">By connecting, you let Dev Dashboard read your GitHub pull requests, issues, reviews, comments and notifications with this token. The token and that data stay in this browser and are only sent to api.github.com. <a href=${PRIVACY_URL}>Privacy policy</a></p>
  </div>`;

export function renderWork() {
  const el = $("#work");
  if (!connected()) return render(CONNECT, el);
  bobTargets.clear();
  const d = data();
  if (!TABS.some((t) => t.id === view.tab)) view.tab = "focus";
  const tab = TABS.find((t) => t.id === view.tab);
  const { body, foot } = d ? tab.render(d) : { body: state.status.error ? nothing : skeleton(), foot: null };
  render(
    html`<div class="tabs" role="tablist" aria-label="Work">
        ${TABS.map((t) => {
          const count = d && t.count?.(d);
          return html`<button class="tab" role="tab" id="tab-${t.id}" data-tab=${t.id} aria-selected=${t === tab} tabindex=${t === tab ? 0 : -1}>${t.label}${count != null ? html`<span class="tab__count">${count}</span>` : nothing}</button>`;
        })}
      </div>
      <div class="work__panel" role="tabpanel" aria-labelledby="tab-${tab.id}">${syncNotice()}${tokenNotice()}${body}</div>
      ${foot ? html`<footer class="work__foot">${foot}</footer>` : nothing}`,
    el
  );
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
  const key = `${el.dataset.action}:${el.dataset.id}`;
  const label = (text) => {
    if (text) state.fixing.set(key, text);
    else state.fixing.delete(key);
    renderWork();
  };
  label(busy);
  try {
    await run();
    label("Done");
    toast(done, "success", undo && { label: "Undo", run: () => undo().then(() => requestSync(), (err) => toast(err.message, "error")) });
    // The sync that follows brings the row up to date (or takes it away); the label goes with it.
    requestSync().finally(() => label(null));
  } catch (err) {
    label(null);
    toast(err.message, "error");
  }
}

const fixActions = {
  "pr-ready": (el) => {
    const pr = findPr(el.dataset.id);
    const label = data().repos?.[pr.repo]?.readyLabel;
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
  // The footer's "N need triage" opens the Needs triage group.
  "show-triage": () => {
    openFolds.add("triage");
    renderWork();
    $('[data-fold="triage"]')?.scrollIntoView({ block: "start", behavior: "smooth" });
  },
};
