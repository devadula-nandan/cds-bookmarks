/** Turns raw GitHub data into the developer's prioritized day. */
DD.insights = (() => {
  const { ageDays, repoShort } = DD.util;

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
      ref: `${repoShort(item.repo)}#${item.number}`,
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
      const stale = days >= (settings.staleReviewDays || 2);
      const bot = isBot(pr.author);
      add(
        task(pr, "review", bot ? "low" : stale ? "high" : "medium", `Review requested by ${pr.author}`, {
          detail: stale ? `waiting ${Math.floor(days)}d` : null,
        })
      );
    });

    data.mentions.items.forEach((item) => add(task(item, "mention", "medium", `You were mentioned on this ${item.kind === "pr" ? "PR" : "issue"}`)));

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

  function stats(data, inbox) {
    if (!data) return null;
    const mainRed = Object.values(data.repos).filter((r) => ["FAILURE", "ERROR"].includes(r.main?.state)).length;
    return {
      reviews: data.reviews.total,
      mine: data.mine.total,
      blocked: data.mine.items.filter(isBlocked).length,
      ready: data.mine.items.filter((pr) => prState(pr) === "ready").length,
      assigned: data.assigned.total,
      mentions: data.mentions.total,
      triage: data.triage.total,
      mergedWeek: data.merged.total,
      reviewedToday: data.reviewed.total,
      inbox: inbox ? inbox.filter((t) => t.unread).length : null,
      mainRed,
    };
  }

  /** Returns true/false for auto rituals, or null when the ritual is manual. */
  function ritualAuto(auto, data) {
    if (!data || !auto) return null;
    switch (auto) {
      case "mainGreen":
        return Object.values(data.repos).every((r) => !["FAILURE", "ERROR"].includes(r.main?.state));
      case "reviews":
        return data.reviews.total === 0;
      case "ownBlocked":
        return !data.mine.items.some(isBlocked);
      case "mentions":
        return data.mentions.total === 0;
      default:
        return null;
    }
  }

  function standup(data) {
    if (!data) return "";
    const since = DD.util.previousWorkday();
    const line = (i) => `• ${i.title} (${repoShort(i.repo)}#${i.number})`;
    const shipped = data.merged.items.filter((p) => new Date(p.mergedAt) >= since);
    const reviewed = data.reviewed.items;
    const inFlight = data.mine.items.filter((p) => !isBlocked(p));
    const blocked = data.mine.items.filter(isBlocked);

    const out = [];
    out.push("*Yesterday*");
    shipped.forEach((p) => out.push(`${line(p)} — merged`));
    if (reviewed.length) out.push(`• Reviewed ${reviewed.length} PR${reviewed.length > 1 ? "s" : ""}: ${reviewed.slice(0, 5).map((p) => `${repoShort(p.repo)}#${p.number}`).join(", ")}`);
    if (!shipped.length && !reviewed.length) out.push("• —");
    out.push("", "*Today*");
    inFlight.slice(0, 5).forEach((p) => out.push(`${line(p)}${p.draft ? " — draft" : ""}`));
    if (data.reviews.total) out.push(`• ${data.reviews.total} review${data.reviews.total > 1 ? "s" : ""} in my queue`);
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

  return { focusQueue, stats, ritualAuto, standup, prState, isBlocked, hasConflict, isBot, greeting, PRIORITY };
})();
