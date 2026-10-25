// Turns GitHub data into the prioritized "For you" list, the header summary and the standup template.

import { ageDays, itemRef, plural, previousWorkday, repoShort } from "./core.js";

const PRIORITY = { urgent: 0, high: 1, medium: 2, low: 3 };

export const isBot = (login) => /\[bot\]$|^(renovate|dependabot|github-actions|carbon-bot)/i.test(login || "");

/** Search results often say `mergeable: UNKNOWN` until GitHub recomputes, so the repo's conflict label counts too. */
export const hasConflict = (pr) => pr.mergeable === "CONFLICTING" || pr.labels.some((l) => /merge conflict/i.test(l));

const failing = (state) => state === "FAILURE" || state === "ERROR";

/** Where one of my PRs stands, most pressing first. */
export function prState(pr) {
  if (hasConflict(pr)) return "conflict";
  if (failing(pr.ci)) return "ciFailed";
  if (pr.reviewDecision === "CHANGES_REQUESTED") return "changes";
  if (pr.draft) return "draft";
  if (pr.reviewDecision === "APPROVED" && (pr.ci === "SUCCESS" || !pr.ci)) return "ready";
  if (pr.ci === "PENDING" || pr.ci === "EXPECTED") return "ciRunning";
  return "waiting";
}

const isBlocked = (pr) => ["conflict", "ciFailed", "changes"].includes(prState(pr));

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
      tasks.push({ key: `main:${slug}:${main.sha}`, kind: "main", priority: "urgent", reason: `${main.branch} is failing`, title: main.message || "Latest commit on main is failing", url: main.url, repo: slug, ref: `${repoShort(slug)}@${main.sha}`, at: main.committedAt });

  for (const pr of data.mine.items) {
    const state = prState(pr);
    if (state === "ciFailed") add(task(pr, "ciFailed", pr.draft ? "medium" : "urgent", pr.draft ? "CI failing on your draft" : "CI failing on your PR"));
    else if (state === "conflict") add(task(pr, "conflict", pr.draft ? "medium" : "high", pr.draft ? "Draft has a merge conflict" : "Merge conflict — rebase needed"));
    else if (state === "changes") add(task(pr, "changes", "high", `Changes requested by ${pr.changeRequests.join(", ") || "a reviewer"}`));
    else if (state === "ready") add(task(pr, "ready", "high", "Approved & green — ready to merge"));
  }

  for (const pr of data.reviews.items) {
    const days = ageDays(pr.createdAt);
    const stale = days >= settings.staleReviewDays;
    add(task(pr, "review", isBot(pr.author) ? "low" : stale ? "high" : "medium", `Review requested by ${pr.author}`, { detail: stale ? `waiting ${Math.floor(days)}d` : null }));
  }

  for (const item of data.mentions.items) add(task(item, "mention", "medium", `You were mentioned on this ${item.kind === "pr" ? "PR" : "issue"}`));

  for (const item of data.following || [])
    if (item.follow.newReply) add(task(item, "reply", "medium", `${item.follow.lastReply.author} replied on a thread you follow`, { at: item.follow.lastReply.at }));

  // A PR I reviewed got new commits: worth a second look, sooner if I'd asked for changes.
  for (const pr of data.reviewedOpen.items)
    if (pr.myReview && pr.lastCommitAt > pr.myReview.at)
      add(task(pr, "recheck", pr.myReview.state === "APPROVED" ? "low" : "medium", "New commits since your review", { detail: pr.myReview.state === "CHANGES_REQUESTED" ? "you requested changes" : null }));

  for (const item of data.assigned.items) add(task(item, "assigned", item.kind === "pr" ? "medium" : "low", item.kind === "pr" ? "Assigned PR" : "Assigned issue"));

  for (const pr of data.mine.items) if (prState(pr) === "waiting" && ageDays(pr.createdAt) >= 3) add(task(pr, "nudge", "low", "No review yet — nudge reviewers"));

  return tasks.sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || new Date(a.at || 0) - new Date(b.at || 0));
}

/** "now" for urgent and high, "next" for medium, "later" for low. */
export const bucket = (task) => (PRIORITY[task.priority] <= 1 ? "now" : task.priority === "medium" ? "next" : "later");

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
  if (!now.length) return tasks.length ? "Nothing urgent. A good stretch for deep work." : "You're all caught up.";
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

/** A standup update built from GitHub alone (the no-Bob version). */
export function standup(data) {
  const since = previousWorkday();
  const line = (i) => `• ${i.title} (${itemRef(i)})`;
  const shipped = data.merged.items.filter((p) => new Date(p.mergedAt) >= since);
  const reviewed = data.reviewed.items;
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
