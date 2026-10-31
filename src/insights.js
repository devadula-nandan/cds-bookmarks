// Turns GitHub data into the prioritized "For you" list, the header summary and the standup template.

import { ageDays, itemRef, plural, previousWorkday, repoShort } from "./core.js";

const PRIORITY = { urgent: 0, high: 1, medium: 2, low: 3, stale: 4 };

/** Review requests and my own PRs quiet this long move to Stale: they still want a decision, just not today. */
export const STALE_DAYS = 30;

/** Apps ("[bot]"), and machine users named like one: "*-bot", "*-agent" (carbon-monitor-agent), "svc-*", "bot-*". */
export const isBot = (login) => /\[bot\]$|-(bot|agent)$|^(svc|bot)-|^(renovate|dependabot|github-actions)/i.test(login || "");

/** Search results often say `mergeable: UNKNOWN` until GitHub recomputes, so the repo's conflict label counts too. */
export const hasConflict = (pr) => pr.mergeable === "CONFLICTING" || pr.labels.some((l) => /merge conflict/i.test(l));

/** Carbon labels PRs that change anything visual; a designer has to approve before they merge. */
export const needsDesign = (pr) => pr.labels.some((l) => /visual review/i.test(l));

const failing = (state) => state === "FAILURE" || state === "ERROR";

/**
 * Where one of my PRs stands, most pressing first. Approvals count against the repo's own rule: Carbon asks
 * for 2 developer approvals, while GitHub's "Approved" turns up after the first.
 */
export function prState(pr) {
  if (hasConflict(pr)) return "conflict";
  if (failing(pr.ci)) return "ciFailed";
  if (pr.reviewDecision === "CHANGES_REQUESTED") return "changes";
  if (pr.draft) return "draft";
  if (pr.queue) return "queued";
  const approved = pr.approvals.length >= (pr.approvalsNeeded || 1);
  if (approved && needsDesign(pr)) return "design";
  if (approved && pr.autoMerge) return "autoMerge";
  if (approved) return "ready";
  if (pr.ci === "PENDING" || pr.ci === "EXPECTED") return "ciRunning";
  if (pr.approvals.length) return "oneMore";
  return "waiting";
}

const isBlocked = (pr) => ["conflict", "ciFailed", "changes"].includes(prState(pr));

/** What fixes a failing check, for the ones the code isn't the fix for. */
export function checkHint(name) {
  if (/^DCO/i.test(name)) return "sign the DCO (see the bot's comment)";
  if (/follows template/i.test(name)) return "fill in the PR template";
  return null;
}

/** "avt, test and 2 more". */
export const checkNames = (checks) => (checks.length > 2 ? `${checks.slice(0, 2).map((c) => c.name).join(", ")} and ${checks.length - 2} more` : checks.map((c) => c.name).join(" and "));

/** "12 days", "3 months". */
export const ageText = (days) => (days < 60 ? plural(Math.floor(days), "day") : plural(Math.round(days / 30), "month"));

/** How much reading a review takes, from its size. */
export function reviewSize(pr) {
  const lines = (pr.additions || 0) + (pr.deletions || 0);
  if (lines <= 50 && (pr.files || 0) <= 3) return "Quick";
  return lines <= 400 ? "Standard" : "Deep";
}

/** When I was asked to review: the request itself, or when the PR was marked ready. */
export const askedAt = (pr) => pr.requestedAt || pr.readyAt || pr.createdAt;

function task(item, kind, priority, reason, extra = {}) {
  return { key: `${kind}:${item.id}`, kind, priority, reason, item, title: item.title, url: item.url, repo: item.repo, ref: itemRef(item), at: item.updatedAt, ...extra };
}

/** Everything that wants my attention, most urgent first. Each item appears once, under its most pressing reason. */
export function focusQueue(data, settings) {
  if (!data) return [];
  const tasks = [];
  const seen = new Set();
  const add = (t) => {
    if (seen.has(t.item.id)) return;
    seen.add(t.item.id);
    tasks.push(t);
  };

  for (const [slug, { main }] of Object.entries(data.repos || {}))
    if (failing(main?.state))
      tasks.push({
        key: `main:${slug}:${main.sha}`,
        kind: "main",
        priority: "urgent",
        reason: main.failing?.length ? `${main.branch} is failing: ${checkNames(main.failing)}` : `${main.branch} is failing`,
        title: main.message || "Latest commit on main is failing",
        url: main.url,
        repo: slug,
        ref: `${repoShort(slug)}@${main.sha}`,
        at: main.committedAt,
        checks: main.failing || [],
      });

  for (const pr of data.mine.items) {
    // Quiet for a month: a decision (close it or pick it back up), not a to-do.
    if (ageDays(pr.updatedAt) >= STALE_DAYS) {
      add(task(pr, "stalePr", "stale", `No activity for ${ageText(ageDays(pr.updatedAt))}${pr.draft ? " · draft" : ""}`));
      continue;
    }
    const state = prState(pr);
    if (state === "ciFailed") {
      const hint = pr.failingChecks.map((c) => checkHint(c.name)).find(Boolean);
      const what = pr.failingChecks.length ? `CI failing: ${checkNames(pr.failingChecks)}` : "CI failing";
      add(task(pr, "ciFailed", pr.draft ? "medium" : "urgent", pr.draft ? `${what} on your draft` : what, { detail: hint }));
    } else if (state === "conflict") add(task(pr, "conflict", pr.draft ? "medium" : "high", pr.draft ? "Draft has a merge conflict" : "Merge conflict — rebase needed"));
    else if (state === "changes") add(task(pr, "changes", "high", `Changes requested by ${pr.changeRequests.join(", ") || "a reviewer"}`));
    else if (state === "ready") {
      const green = pr.ci === "SUCCESS" || !pr.ci;
      add(task(pr, "ready", green ? "high" : "medium", green ? "Approved & green — ready to merge" : "Approved — can merge once checks pass"));
    }
  }

  for (const pr of data.reviews.items) {
    const days = ageDays(askedAt(pr));
    if (days >= STALE_DAYS) {
      add(task(pr, "staleReview", "stale", `Review requested ${ageText(days)} ago by ${pr.author} — still needed?`));
      continue;
    }
    const overdue = days >= settings.staleReviewDays;
    add(task(pr, "review", isBot(pr.author) ? "low" : overdue ? "high" : "medium", `Review requested by ${pr.author}`, { detail: overdue ? `waiting ${Math.floor(days)}d` : null }));
  }

  for (const item of data.mentions.items) add(task(item, "mention", "medium", `You were mentioned on this ${item.kind === "pr" ? "PR" : "issue"}`));

  for (const item of data.following || [])
    if (item.follow.newReply) add(task(item, "reply", "medium", `${item.follow.lastReply.author} replied on a thread you follow`, { at: item.follow.lastReply.at }));

  // A PR I reviewed got new commits: worth a second look, sooner if I'd asked for changes.
  for (const pr of data.reviewedOpen.items)
    if (pr.myReview && pr.lastCommitAt > pr.myReview.at)
      add(task(pr, "recheck", pr.myReview.state === "APPROVED" ? "low" : "medium", "New commits since your review", { detail: pr.myReview.state === "CHANGES_REQUESTED" ? "you requested changes" : null }));

  // My own PRs are often assigned to me too; they're covered above and below.
  for (const item of data.assigned.items) if (item.author !== settings.login) add(task(item, "assigned", item.kind === "pr" ? "medium" : "low", item.kind === "pr" ? "Assigned PR" : "Assigned issue"));

  // My PRs that need someone else: no review yet, short of approvals, or waiting on a designer.
  for (const pr of data.mine.items) {
    const state = prState(pr);
    if (state === "waiting" && ageDays(pr.readyAt) >= 3) add(task(pr, "nudge", "low", "No review yet — nudge reviewers"));
    else if (state === "oneMore") add(task(pr, "nudge", "low", `${pr.approvals.length} of ${pr.approvalsNeeded} approvals — ask for one more review`));
    else if (state === "design") add(task(pr, "nudge", "low", "Approved — waiting on design review"));
  }

  return tasks.sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || new Date(a.at || 0) - new Date(b.at || 0));
}

/** "now" for urgent and high, "next" for medium, "later" for low, and "stale" for what's gone quiet. */
export const bucket = (task) => (task.priority === "stale" ? "stale" : PRIORITY[task.priority] <= 1 ? "now" : task.priority === "medium" ? "next" : "later");

/** Hidden for today, or until the item has new activity (its timestamp moves on from the one saved). */
export const isSnoozed = (task, today = {}, untilChange = {}) => !!today[task.key] || (task.key in untilChange && untilChange[task.key] === (task.at || ""));

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

/** One calm sentence for the header, such as "A broken main and 2 overdue reviews need you." */
export function summary(tasks) {
  const now = tasks.filter((t) => bucket(t) === "now");
  if (!now.length) return tasks.some((t) => bucket(t) !== "stale") ? "Nothing urgent. A good stretch for deep work." : "You're all caught up.";
  const count = (...kinds) => now.filter((t) => kinds.includes(t.kind)).length;
  const mains = count("main");
  const parts = [
    mains && (mains === 1 ? "a broken main" : `${mains} broken mains`),
    count("ciFailed", "conflict", "changes") && plural(count("ciFailed", "conflict", "changes"), "blocked PR"),
    count("review") && plural(count("review"), "overdue review"),
    count("ready") && `${count("ready")} ready to merge`,
  ].filter(Boolean);
  const verb = now.length === 1 ? "needs" : "need";
  if (!parts.length) return `${plural(now.length, "thing")} ${verb} you.`;
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `${text[0].toUpperCase()}${text.slice(1)} ${verb} you.`;
}

/** The week in numbers: PRs merged, PRs reviewed, and the median wait for a first review on my merged PRs (hours). */
export function weekStats(data) {
  const weekAgo = Date.now() - 7 * 86400000;
  const reviewed = data.reviewed.items.filter((p) => p.myReview && Date.parse(p.myReview.at) >= weekAgo).length;
  const waits = data.merged.items
    .filter((p) => p.firstReviewAt)
    .map((p) => (Date.parse(p.firstReviewAt) - Date.parse(p.readyAt)) / 3600000)
    .filter((h) => h >= 0)
    .sort((a, b) => a - b);
  return { merged: data.merged.total, reviewed, firstReviewHours: waits.length ? waits[Math.floor(waits.length / 2)] : null };
}

/** A standup update built from GitHub alone (the no-Bob version). */
export function standup(data) {
  const since = previousWorkday();
  const line = (i) => `• ${i.title} (${itemRef(i)})`;
  const shipped = data.merged.items.filter((p) => new Date(p.mergedAt) >= since);
  const reviewed = data.reviewed.items.filter((p) => !p.myReview || new Date(p.myReview.at) >= since);
  const blocked = data.mine.items.filter(isBlocked);
  const why = { conflict: "merge conflict", ciFailed: "CI failing", changes: "addressing review feedback" };

  const yesterday = [...shipped.map((p) => `${line(p)} — merged`), ...(reviewed.length ? [`• Reviewed ${plural(reviewed.length, "PR")}: ${reviewed.slice(0, 5).map(itemRef).join(", ")}`] : [])];
  const today = [
    ...data.mine.items.filter((p) => !isBlocked(p)).slice(0, 5).map((p) => `${line(p)}${p.draft ? " — draft" : ""}`),
    ...(data.reviews.total ? [`• ${plural(data.reviews.total, "review")} in my queue`] : []),
    ...data.assigned.items.filter((i) => i.kind === "issue").slice(0, 3).map(line),
  ];
  return [
    "*Yesterday*",
    ...(yesterday.length ? yesterday : ["• —"]),
    "",
    "*Today*",
    ...(today.length ? today : ["• —"]),
    "",
    "*Blockers*",
    ...(blocked.length ? blocked.map((p) => `${line(p)} — ${why[prState(p)]}`) : ["• None"]),
  ].join("\n");
}
