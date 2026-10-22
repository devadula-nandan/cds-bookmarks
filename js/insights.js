/** Turns raw GitHub data into the developer's prioritized day. */
DD.insights = (() => {
  const { ageDays, repoShort, itemRef, plural } = DD.util;

  const PRIORITY = { urgent: 0, high: 1, medium: 2, low: 3 };

  /** Search results often report `mergeable: UNKNOWN` until GitHub recomputes, so the repo's conflict label counts too. */
  function hasConflict(pr) {
    return pr.mergeable === "CONFLICTING" || pr.labels.some((l) => /merge conflict/i.test(l.name));
  }

  function isBot(login) {
    return /\[bot\]$|^(renovate|dependabot|github-actions|carbon-bot)/i.test(login || "");
  }

  function prState(pr) {
    if (hasConflict(pr)) return "conflict";
    if (pr.ci === "FAILURE" || pr.ci === "ERROR") return "ciFailed";
    if (pr.reviewDecision === "CHANGES_REQUESTED") return "changes";
    if (pr.draft) return "draft";
    if (pr.reviewDecision === "APPROVED" && (pr.ci === "SUCCESS" || !pr.ci)) return "ready";
    if (pr.ci === "PENDING" || pr.ci === "EXPECTED") return "ciRunning";
    return "waiting";
  }

  function isBlocked(pr) {
    return ["conflict", "ciFailed", "changes"].includes(prState(pr));
  }

  function task(item, kind, priority, reason, extra = {}) {
    return {
      key: `${kind}:${item.id}`,
      kind,
      priority,
      reason,
      item,
      title: item.title,
      url: item.url,
      repo: item.repo,
      ref: itemRef(item),
      at: item.updatedAt,
      ...extra,
    };
  }

  function focusQueue(data, settings) {
    if (!data) return [];
    const tasks = [];
    const seen = new Set();
    const add = (t) => {
      if (seen.has(t.item?.id || t.key)) return;
      seen.add(t.item?.id || t.key);
      tasks.push(t);
    };

    Object.entries(data.repos || {}).forEach(([slug, health]) => {
      if (health.main?.state === "FAILURE" || health.main?.state === "ERROR") {
        tasks.push({
          key: `main:${slug}:${health.main.sha}`,
          kind: "main",
          priority: "urgent",
          reason: `${health.main.branch} is failing`,
          title: health.main.message || "Latest commit on main is failing",
          url: health.main.url,
          repo: slug,
          ref: `${repoShort(slug)}@${health.main.sha}`,
          at: health.main.committedAt,
        });
      }
    });

    data.mine.items.forEach((pr) => {
      const state = prState(pr);
      if (state === "ciFailed")
        add(task(pr, "ciFailed", pr.draft ? "medium" : "urgent", pr.draft ? "CI failing on your draft" : "CI failing on your PR"));
      else if (state === "conflict")
        add(task(pr, "conflict", pr.draft ? "medium" : "high", pr.draft ? "Draft has a merge conflict" : "Merge conflict — rebase needed"));
      else if (state === "changes")
        add(task(pr, "changes", "high", `Changes requested by ${pr.changeRequests.join(", ") || "a reviewer"}`));
      else if (state === "ready") add(task(pr, "ready", "high", "Approved & green — ready to merge"));
    });

    data.reviews.items.forEach((pr) => {
      const days = ageDays(pr.createdAt);
      const stale = days >= settings.staleReviewDays;
      const bot = isBot(pr.author);
      add(
        task(pr, "review", bot ? "low" : stale ? "high" : "medium", `Review requested by ${pr.author}`, {
          detail: stale ? `waiting ${Math.floor(days)}d` : null,
        })
      );
    });

    data.mentions.items.forEach((item) => add(task(item, "mention", "medium", `You were mentioned on this ${item.kind === "pr" ? "PR" : "issue"}`)));

    (data.following || [])
      .filter((i) => i.follow.newReply)
      .forEach((i) => add(task(i, "reply", "medium", `${i.follow.lastReply.author} replied on a thread you follow`, { at: i.follow.lastReply.at })));

    // A PR you reviewed got new commits: worth a second look, sooner if you'd asked for changes.
    (data.reviewedOpen?.items || []).forEach((pr) => {
      if (pr.myReview && pr.lastCommitAt && pr.lastCommitAt > pr.myReview.at)
        add(task(pr, "recheck", pr.myReview.state === "APPROVED" ? "low" : "medium", "New commits since your review", { detail: pr.myReview.state === "CHANGES_REQUESTED" ? "you requested changes" : null }));
    });

    data.assigned.items.forEach((item) =>
      add(task(item, "assigned", item.kind === "pr" ? "medium" : "low", item.kind === "pr" ? "Assigned PR" : "Assigned issue"))
    );

    data.mine.items.forEach((pr) => {
      const state = prState(pr);
      if (state === "waiting" && ageDays(pr.createdAt) >= 3)
        add(task(pr, "nudge", "low", "No review yet — nudge reviewers"));
    });

    return tasks.sort(
      (a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || new Date(a.at || 0) - new Date(b.at || 0)
    );
  }

  function standup(data) {
    if (!data) return "";
    const since = DD.util.previousWorkday();
    const line = (i) => `• ${i.title} (${itemRef(i)})`;
    const shipped = data.merged.items.filter((p) => new Date(p.mergedAt) >= since);
    const reviewed = data.reviewed.items;
    const inFlight = data.mine.items.filter((p) => !isBlocked(p));
    const blocked = data.mine.items.filter(isBlocked);

    const out = [];
    out.push("*Yesterday*");
    shipped.forEach((p) => out.push(`${line(p)} — merged`));
    if (reviewed.length) out.push(`• Reviewed ${plural(reviewed.length, "PR")}: ${reviewed.slice(0, 5).map(itemRef).join(", ")}`);
    if (!shipped.length && !reviewed.length) out.push("• —");
    out.push("", "*Today*");
    inFlight.slice(0, 5).forEach((p) => out.push(`${line(p)}${p.draft ? " — draft" : ""}`));
    if (data.reviews.total) out.push(`• ${plural(data.reviews.total, "review")} in my queue`);
    data.assigned.items.filter((i) => i.kind === "issue").slice(0, 3).forEach((i) => out.push(line(i)));
    if (out[out.length - 1] === "*Today*") out.push("• —");
    out.push("", "*Blockers*");
    blocked.forEach((p) => {
      const why = { conflict: "merge conflict", ciFailed: "CI failing", changes: "addressing review feedback" }[prState(p)];
      out.push(`${line(p)} — ${why}`);
    });
    if (!blocked.length) out.push("• None");
    return out.join("\n");
  }

  function greeting(date = new Date()) {
    const h = date.getHours();
    if (h < 5) return "Burning the midnight oil";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    if (h < 21) return "Good evening";
    return "Good night";
  }

  /** Urgent and high items are "now"; the rest can wait. */
  function bucket(task) {
    if (task.priority === "urgent" || task.priority === "high") return "now";
    return task.priority === "medium" ? "next" : "later";
  }

  /** Hidden for today, or until the item has new activity (its timestamp moves on from the one saved). */
  function isSnoozed(task, today = {}, untilChange = {}) {
    return !!today[task.key] || (task.key in untilChange && untilChange[task.key] === (task.at || ""));
  }

  /** One calm sentence for the header. */
  function summary(data, tasks) {
    if (!data) return "";
    const now = tasks.filter((t) => bucket(t) === "now");
    if (!now.length) return tasks.length ? "Nothing urgent. A good stretch for deep work." : "You're all caught up.";
    const count = (kinds) => now.filter((t) => kinds.includes(t.kind)).length;
    const parts = [];
    const reviews = count(["review"]);
    const blocked = count(["ciFailed", "conflict", "changes"]);
    const ready = count(["ready"]);
    const mains = count(["main"]);
    if (mains) parts.push(mains === 1 ? "a broken main" : `${mains} broken mains`);
    if (blocked) parts.push(DD.util.plural(blocked, "blocked PR"));
    if (reviews) parts.push(DD.util.plural(reviews, "overdue review"));
    if (ready) parts.push(`${ready} ready to merge`);
    if (!parts.length) return `${DD.util.plural(now.length, "thing")} ${now.length === 1 ? "needs" : "need"} you.`;
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
    return `${list[0].toUpperCase()}${list.slice(1)} ${now.length === 1 ? "needs" : "need"} you.`;
  }

  return { focusQueue, standup, prState, hasConflict, isBot, greeting, bucket, isSnoozed, summary };
})();
