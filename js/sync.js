/**
 * Fetches GitHub, diffs against the previous sync and records what changed.
 * Runs in the background service worker (extension) or the page (web preview);
 * each context plugs in its own notifier.
 */
DD.sync = (() => {
  const { itemRef: ref, repoShort, todayKey, uid } = DD.util;
  const ACTIVITY_MAX = 100;
  const BURST = 4;

  const TYPES = {
    review: { icon: "eye", tone: "info", setting: "reviewRequested" },
    ciFailed: { icon: "x", tone: "error", setting: "ciFailed" },
    ciPassed: { icon: "check", tone: "success", setting: "ciPassed" },
    changes: { icon: "message", tone: "warning", setting: "changesRequested" },
    approved: { icon: "check", tone: "success", setting: "approved" },
    merged: { icon: "merge", tone: "success", setting: "merged" },
    conflict: { icon: "alert", tone: "warning", setting: "conflict" },
    mention: { icon: "at", tone: "info", setting: "mentioned" },
    assigned: { icon: "user", tone: "info", setting: "assigned" },
    mainBroken: { icon: "alert", tone: "error", setting: "mainBroken" },
    mainFixed: { icon: "check", tone: "success", setting: "mainBroken" },
    release: { icon: "tag", tone: "neutral", setting: "release" },
    inbox: { icon: "inbox", tone: "neutral", setting: "githubInbox" },
    meeting: { icon: "calendar", tone: "info", setting: "meetings" },
    reply: { icon: "message", tone: "info", setting: "replies" },
    recheck: { icon: "refresh", tone: "warning", setting: "recheck" },
    bugHunt: { icon: "bug", tone: "warning", setting: "bugHunt" },
  };
  const WATCH_DAYS = 60;

  let notifier = async () => {};

  function setNotifier(fn) {
    notifier = fn;
  }

  // ---------- change detection ----------

  function snapshot(data, inbox) {
    const pick = (l) => l.items.map((i) => i.id);
    return {
      at: data.fetchedAt,
      reviews: pick(data.reviews),
      mentions: pick(data.mentions),
      assigned: pick(data.assigned),
      merged: pick(data.merged),
      mine: Object.fromEntries(
        data.mine.items.map((p) => [p.id, { ci: p.ci, decision: p.reviewDecision, conflict: DD.insights.hasConflict(p) }])
      ),
      main: Object.fromEntries(Object.entries(data.repos).map(([s, r]) => [s, r.main?.state || null])),
      release: Object.fromEntries(Object.entries(data.repos).map(([s, r]) => [s, r.release?.tagName || null])),
      inbox: inbox ? Object.fromEntries(inbox.map((t) => [t.id, t.updatedAt])) : null,
      following: Object.fromEntries((data.following || []).map((i) => [i.id, i.follow.lastReply?.at || null])),
      reviewedOpen: Object.fromEntries((data.reviewedOpen?.items || []).map((p) => [p.id, p.lastCommitAt])),
    };
  }

  function detect(prev, data, inbox) {
    const events = [];
    const isNew = (ids, id) => !ids?.includes(id);
    const stamp = data.fetchedAt;

    data.reviews.items.forEach((pr) => {
      if (isNew(prev.reviews, pr.id))
        events.push({ type: "review", key: `review:${pr.id}`, title: `Review requested: ${ref(pr)}`, body: `${pr.author} · ${pr.title}`, url: pr.url, repo: pr.repo });
    });

    data.mine.items.forEach((pr) => {
      const before = prev.mine?.[pr.id];
      if (!before) return;
      if (pr.ci !== before.ci) {
        if (pr.ci === "FAILURE" || pr.ci === "ERROR")
          events.push({ type: "ciFailed", key: `ci:${pr.id}:${stamp}`, title: `CI failed on ${ref(pr)}`, body: pr.title, url: `${pr.url}/checks`, repo: pr.repo });
        else if (pr.ci === "SUCCESS" && before.ci)
          events.push({ type: "ciPassed", key: `ci:${pr.id}:${stamp}`, title: `CI passed on ${ref(pr)}`, body: pr.title, url: pr.url, repo: pr.repo });
      }
      if (pr.reviewDecision !== before.decision) {
        if (pr.reviewDecision === "APPROVED")
          events.push({ type: "approved", key: `dec:${pr.id}:${stamp}`, title: `${ref(pr)} approved`, body: `${pr.approvals.join(", ") || "A reviewer"} · ${pr.title}`, url: pr.url, repo: pr.repo });
        if (pr.reviewDecision === "CHANGES_REQUESTED")
          events.push({ type: "changes", key: `dec:${pr.id}:${stamp}`, title: `Changes requested on ${ref(pr)}`, body: `${pr.changeRequests.join(", ") || "A reviewer"} · ${pr.title}`, url: pr.url, repo: pr.repo });
      }
      if (DD.insights.hasConflict(pr) && before.conflict === false)
        events.push({ type: "conflict", key: `conflict:${pr.id}:${stamp}`, title: `Merge conflict on ${ref(pr)}`, body: pr.title, url: pr.url, repo: pr.repo });
    });

    data.merged.items.forEach((pr) => {
      if (isNew(prev.merged, pr.id))
        events.push({ type: "merged", key: `merged:${pr.id}`, title: `Merged: ${ref(pr)}`, body: pr.title, url: pr.url, repo: pr.repo });
    });

    data.mentions.items.forEach((item) => {
      if (isNew(prev.mentions, item.id))
        events.push({ type: "mention", key: `mention:${item.id}`, title: `Mentioned on ${ref(item)}`, body: item.title, url: item.url, repo: item.repo });
    });

    data.assigned.items.forEach((item) => {
      if (isNew(prev.assigned, item.id))
        events.push({ type: "assigned", key: `assigned:${item.id}`, title: `Assigned: ${ref(item)}`, body: item.title, url: item.url, repo: item.repo });
    });

    Object.entries(data.repos).forEach(([slug, health]) => {
      const before = prev.main?.[slug];
      const now = health.main?.state;
      if (before === undefined) return;
      const red = (s) => s === "FAILURE" || s === "ERROR";
      if (red(now) && !red(before))
        events.push({ type: "mainBroken", key: `main:${slug}:${health.main.sha}`, title: `main is failing on ${repoShort(slug)}`, body: health.main.message, url: health.main.url, repo: slug });
      if (red(before) && now === "SUCCESS")
        events.push({ type: "mainFixed", key: `mainfix:${slug}:${health.main.sha}`, title: `main is green again on ${repoShort(slug)}`, body: health.main.message, url: health.main.url, repo: slug });

      const tag = health.release?.tagName;
      if (tag && prev.release?.[slug] && prev.release[slug] !== tag)
        events.push({ type: "release", key: `release:${slug}:${tag}`, title: `${repoShort(slug)} ${tag} released`, body: health.release.isPrerelease ? "Pre-release" : "Stable release", url: health.release.url, repo: slug });
    });

    // Older snapshots don't have these yet; the first sync just records a baseline.
    if (prev.following)
      (data.following || []).forEach((i) => {
        const reply = i.follow.lastReply;
        if (i.follow.newReply && reply && prev.following[i.id] !== reply.at)
          events.push({ type: "reply", key: `reply:${i.id}:${reply.at}`, title: `${reply.author} replied on ${ref(i)}`, body: i.title, url: reply.url || i.url, repo: i.repo });
      });

    if (prev.reviewedOpen)
      (data.reviewedOpen?.items || []).forEach((pr) => {
        const before = prev.reviewedOpen[pr.id];
        if (before !== undefined && pr.lastCommitAt !== before && pr.myReview && pr.lastCommitAt > pr.myReview.at)
          events.push({ type: "recheck", key: `recheck:${pr.id}:${pr.lastCommitAt}`, title: `New commits on ${ref(pr)} since your review`, body: `${pr.author} · ${pr.title}`, url: `${pr.url}/files`, repo: pr.repo });
      });

    if (inbox && prev.inbox) {
      inbox
        .filter((t) => t.unread && prev.inbox[t.id] !== t.updatedAt)
        .filter((t) => !["review_requested", "mention", "assign"].includes(t.reason))
        .forEach((t) =>
          events.push({ type: "inbox", key: `inbox:${t.id}:${t.updatedAt}`, title: `${repoShort(t.repo)}: ${t.title}`, body: `GitHub · ${t.reason.replace(/_/g, " ")}`, url: t.url, repo: t.repo })
        );
    }

    return events;
  }

  // ---------- recording + delivery ----------

  function wanted(settings, event) {
    const setting = TYPES[event.type]?.setting;
    return settings.notifications && (!setting || settings.notifyOn[setting] !== false);
  }

  /** Every change lands in the activity log; only the ones the user opted into become OS notifications. */
  async function record(events, settings) {
    if (!events.length) return;
    const { activity = [] } = await DD.storage.get("activity");
    const known = new Set(activity.map((a) => a.key));
    const at = new Date().toISOString();
    const fresh = events.filter((e) => !known.has(e.key)).map((e) => ({ id: uid(), createdAt: at, ...e }));
    if (!fresh.length) return;
    await DD.storage.set({ activity: [...fresh, ...activity].slice(0, ACTIVITY_MAX) });

    const loud = fresh.filter((e) => wanted(settings, e));
    if (loud.length > BURST)
      await notifier([{ type: "inbox", key: `burst:${at}`, title: `${loud.length} updates on GitHub`, body: "Open a new tab to catch up." }]);
    else if (loud.length) await notifier(loud);
  }

  /**
   * The 👀 watch list: ids join when a sync sees the viewer's 👀, and leave
   * when it's removed, the thread closes, or it's been quiet for WATCH_DAYS.
   */
  function updateWatching(watching, seen = []) {
    const next = { ...watching };
    const now = new Date().toISOString();
    seen.forEach(({ id, eyes }) => {
      if (eyes) next[id] ||= { addedAt: now };
      else delete next[id];
    });
    const cutoff = new Date(Date.now() - WATCH_DAYS * 86400000).toISOString();
    Object.keys(next).forEach((id) => next[id].addedAt < cutoff && delete next[id]);
    return next;
  }

  async function setStatus(patch) {
    const { status = {} } = await DD.storage.get("status");
    const next = { ...status, ...patch };
    await DD.storage.set({ status: next });
    return next;
  }

  async function run() {
    const settings = await DD.settings.load();
    if (settings.demo || !settings.token) return { skipped: true };

    const { status = {} } = await DD.storage.get("status");
    if (status.syncing && Date.now() - Date.parse(status.startedAt || 0) < 60000) return { skipped: true };
    await setStatus({ syncing: true, startedAt: new Date().toISOString() });

    try {
      let { login } = settings;
      if (!login) {
        const viewer = await DD.github.fetchViewer(settings.token);
        login = viewer.login;
        await DD.settings.save({ login, tokenScopes: viewer.scopes });
      }
      const repos = DD.repos.enabled(settings);
      const { watching = {} } = await DD.storage.get("watching");
      const [data, inboxResult] = await Promise.all([
        DD.github.fetchDashboard({ token: settings.token, login, repos, includeTeamReviews: settings.includeTeamReviews, watching }),
        DD.github.fetchInbox(settings.token, repos).then(
          (threads) => ({ threads }),
          (err) => ({ err })
        ),
      ]);
      const inbox = inboxResult.threads || null;
      const inboxError = inboxResult.err
        ? [401, 403, 404].includes(inboxResult.err.status)
          ? "This token can't read GitHub notifications."
          : inboxResult.err.message
        : null;

      const { snapshot: prev } = await DD.storage.get("snapshot");
      const next = snapshot(data, inbox);
      if (prev && inbox && !prev.inbox) prev.inbox = next.inbox;
      const events = prev ? detect(prev, data, inbox) : [];

      await DD.storage.set({ cache: { data, inbox }, snapshot: next, watching: updateWatching(watching, data.eyesSeen) });
      await setStatus({ syncing: false, at: new Date().toISOString(), error: null, errorSso: null, inboxError });
      if (data.scopes !== settings.tokenScopes) await DD.settings.save({ tokenScopes: data.scopes });
      await record(events, await DD.settings.load());
      return { ok: true, events };
    } catch (err) {
      console.error("Sync failed", err);
      await setStatus({ syncing: false, at: new Date().toISOString(), error: err.message, errorSso: err.sso || null });
      return { ok: false, error: err.message };
    }
  }

  // ---------- meeting reminders ----------

  function todaysMeetings(settings, now = new Date()) {
    return settings.meetings
      .filter((m) => !m.days?.length || m.days.includes(now.getDay()))
      .map((m) => {
        const start = DD.util.parseTime(m.time, now);
        return { ...m, start, end: new Date(start.getTime() + m.minutes * 60000) };
      })
      .sort((a, b) => a.start - b.start);
  }

  async function remind(settings) {
    if (!settings.notifications || settings.notifyOn.meetings === false) return;
    const now = new Date();
    const today = todayKey(now);
    const { reminded = {} } = await DD.storage.get("reminded");
    const sent = reminded[today] || {};
    const due = todaysMeetings(settings, now).filter((m) => {
      const mins = (m.start - now) / 60000;
      return mins <= 5 && mins > -1 && !sent[m.id];
    });
    if (!due.length) return;
    due.forEach((m) => (sent[m.id] = true));
    await DD.storage.set({ reminded: { [today]: sent } });
    await notifier(
      due.map((m) => {
        const mins = Math.ceil((m.start - now) / 60000);
        return { type: "meeting", key: `meeting:${today}:${m.id}`, title: mins > 0 ? `${m.title} in ${mins} min` : `${m.title} is starting`, body: `${m.time} · ${m.minutes} min` };
      })
    );
  }

  /** Called every minute: reminders, then a sync if one is due. */
  async function tick() {
    const settings = await DD.settings.load();
    await remind(settings);
    const { status = {} } = await DD.storage.get("status");
    const last = status.at ? Date.parse(status.at) : 0;
    if (Date.now() - last >= settings.pollMinutes * 60000 - 5000) await run();
  }

  return { TYPES, run, tick, record, setNotifier, todaysMeetings };
})();
