DD.notify = (() => {
  const { esc, timeAgo, repoShort, todayKey } = DD.util;
  const { icon } = DD.icons;
  const MAX = 200;

  const TYPES = {
    review: { icon: "eye", tone: "info", setting: "reviewRequested", label: "Review" },
    ciFailed: { icon: "alert", tone: "error", setting: "ciFailed", label: "CI" },
    ciPassed: { icon: "check", tone: "success", setting: "ciPassed", label: "CI" },
    changes: { icon: "message", tone: "warning", setting: "changesRequested", label: "Review" },
    approved: { icon: "check", tone: "success", setting: "approved", label: "Review" },
    merged: { icon: "merge", tone: "success", setting: "merged", label: "Merged" },
    conflict: { icon: "alert", tone: "warning", setting: "conflict", label: "Conflict" },
    mention: { icon: "at", tone: "info", setting: "mentioned", label: "Mention" },
    assigned: { icon: "user", tone: "info", setting: "assigned", label: "Assigned" },
    mainBroken: { icon: "alert", tone: "error", setting: "mainBroken", label: "main" },
    mainFixed: { icon: "check", tone: "success", setting: "mainBroken", label: "main" },
    release: { icon: "tag", tone: "info", setting: "release", label: "Release" },
    inbox: { icon: "inbox", tone: "info", setting: "githubInbox", label: "GitHub" },
    meeting: { icon: "calendar", tone: "info", setting: "meetings", label: "Schedule" },
    system: { icon: "activity", tone: "info", setting: null, label: "System" },
  };

  let list = DD.store.read(DD.store.KEYS.notifications, []);
  let filter = "all";

  function save() {
    DD.store.write(DD.store.KEYS.notifications, list.slice(0, MAX));
  }

  function unreadCount() {
    return list.filter((n) => !n.read).length;
  }

  // ---------- delivery ----------

  function push(input, { silent = false } = {}) {
    const meta = TYPES[input.type] || TYPES.system;
    if (meta.setting && DD.store.settings.notifyOn[meta.setting] === false) return null;
    if (input.key && list.some((n) => n.key === input.key)) return null;

    const n = { id: DD.util.uid(), createdAt: new Date().toISOString(), read: false, ...input };
    list.unshift(n);
    list = list.slice(0, MAX);
    save();
    if (!silent && !DD.store.settings.dnd) deliver(n);
    refresh();
    return n;
  }

  function deliver(n, { forceOs = false } = {}) {
    const settings = DD.store.settings;
    if (document.visibilityState === "visible" && !forceOs) toast(n);
    if (settings.desktopNotifications && (forceOs || document.visibilityState !== "visible")) osNotify(n);
    if (settings.sound) chime(TYPES[n.type]?.tone);
  }

  function iconPath() {
    return new URL("icons/icon-192.png", document.baseURI).href;
  }

  async function osNotify(n) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const opts = {
      body: n.body || "",
      tag: n.key || n.id || n.title,
      icon: iconPath(),
      badge: iconPath(),
      data: { url: n.url || location.href, id: n.id || null },
    };
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) return reg.showNotification(n.title, opts);
    } catch (err) {
      console.warn("Service worker notification failed", err);
    }
    try {
      const desktop = new Notification(n.title, opts);
      desktop.onclick = () => {
        window.focus();
        if (n.id) open(n.id);
      };
    } catch (err) {
      console.warn("Desktop notification failed", err);
    }
  }

  const PUSH_DB = "devdash-push";
  const PUSH_STORE = "kv";

  function openPushDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(PUSH_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(PUSH_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function syncPushConfig() {
    if (!window.indexedDB) return;
    const s = DD.store.settings;
    const snapshot = DD.store.read(DD.store.KEYS.snapshot, null);
    const config = {
      token: s.token || "",
      enabled: !!(s.desktopNotifications && typeof Notification !== "undefined" && Notification.permission === "granted"),
      dnd: !!s.dnd,
      pollMinutes: s.pollMinutes || 3,
      notifyOn: s.notifyOn,
      repos: DD.repos.enabled().map((r) => r.slug.toLowerCase()),
      lastInbox: snapshot?.inbox || {},
    };
    const db = await openPushDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(PUSH_STORE, "readwrite");
        tx.objectStore(PUSH_STORE).put(config, "config");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
    await registerPeriodicSync();
  }

  async function registerPeriodicSync() {
    const s = DD.store.settings;
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg?.periodicSync) return;
      if (!s.desktopNotifications || !s.token) {
        await reg.periodicSync.unregister("devdash-sync").catch(() => {});
        return;
      }
      await reg.periodicSync.register("devdash-sync", { minInterval: Math.max(1, s.pollMinutes || 3) * 60 * 1000 });
    } catch {
      /* periodic background sync is Chrome/Edge installed-PWA only */
    }
  }

  let workerBound = false;

  async function registerWorker() {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return null;
    try {
      const reg = await navigator.serviceWorker.register(new URL("sw.js", document.baseURI), { updateViaCache: "none" });
      if (!workerBound) {
        navigator.serviceWorker.addEventListener("message", onSwMessage);
        workerBound = true;
      }
      return reg;
    } catch (err) {
      console.warn("Service worker registration failed", err);
      return null;
    }
  }

  function onSwMessage(event) {
    const msg = event.data || {};
    if (msg.type !== "notification-click") return;
    if (msg.id && list.some((n) => n.id === msg.id)) return open(msg.id);
    if (msg.url && msg.url !== location.href) window.open(msg.url, DD.store.settings.openInNewTab ? "_blank" : "_self", "noopener");
  }

  async function initPush() {
    await registerWorker();
    DD.bus.on("settings", () => syncPushConfig());
    await syncPushConfig();
    if (DD.store.settings.desktopNotifications && "Notification" in window && Notification.permission !== "granted") {
      DD.store.saveSettings({ desktopNotifications: false });
    }
  }

  function chime(tone) {
    try {
      const ctx = (chime.ctx ||= new (window.AudioContext || window.webkitAudioContext)());
      const notes = tone === "error" ? [440, 330] : [660, 880];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = "sine";
        const t = ctx.currentTime + i * 0.12;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.3);
      });
    } catch {
      /* audio unavailable */
    }
  }

  function toast(n, timeout = 7000) {
    const host = document.getElementById("toasts");
    if (!host) return;
    const meta = TYPES[n.type] || TYPES.system;
    const el = document.createElement("div");
    el.className = `toast toast--${meta.tone}`;
    el.setAttribute("role", meta.tone === "error" ? "alert" : "status");
    el.innerHTML = `
      <span class="toast__icon">${icon(meta.icon, 20)}</span>
      <div class="toast__body">
        <div class="toast__title">${esc(n.title)}</div>
        ${n.body ? `<div class="toast__text">${esc(n.body)}</div>` : ""}
      </div>
      <button class="icon-btn icon-btn--sm toast__close" aria-label="Dismiss">${icon("x", 16)}</button>`;
    el.addEventListener("click", (e) => {
      if (e.target.closest(".toast__close")) return dismiss();
      if (n.id) open(n.id);
      dismiss();
    });
    host.prepend(el);
    while (host.children.length > 4) host.lastElementChild.remove();
    const timer = setTimeout(dismiss, timeout);
    el.addEventListener("mouseenter", () => clearTimeout(timer));
    function dismiss() {
      el.classList.add("toast--leaving");
      setTimeout(() => el.remove(), 200);
    }
  }

  /** Lightweight confirmation toast that isn't stored in the center. */
  function flash(title, tone = "success") {
    toast({ type: tone === "error" ? "ciFailed" : "ciPassed", title }, 3000);
  }

  function open(id) {
    const n = list.find((x) => x.id === id);
    if (!n) return;
    n.read = true;
    save();
    refresh();
    if (n.url) window.open(n.url, DD.store.settings.openInNewTab ? "_blank" : "_self", "noopener");
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
    };
  }

  function ref(item) {
    return `${repoShort(item.repo)}#${item.number}`;
  }

  function detect(prev, data, inbox) {
    const events = [];
    const isNew = (ids, id) => !ids?.includes(id);

    data.reviews.items.forEach((pr) => {
      if (isNew(prev.reviews, pr.id))
        events.push({ type: "review", key: `review:${pr.id}`, title: `Review requested: ${ref(pr)}`, body: `${pr.author} · ${pr.title}`, url: pr.url, repo: pr.repo });
    });

    data.mine.items.forEach((pr) => {
      const before = prev.mine?.[pr.id];
      if (!before) return;
      const stamp = data.fetchedAt;
      if (pr.ci !== before.ci) {
        if (pr.ci === "FAILURE" || pr.ci === "ERROR")
          events.push({ type: "ciFailed", key: `ci:${pr.id}:${stamp}`, title: `CI failed on ${ref(pr)}`, body: pr.title, url: `${pr.url}/checks`, repo: pr.repo });
        else if (pr.ci === "SUCCESS" && before.ci)
          events.push({ type: "ciPassed", key: `ci:${pr.id}:${stamp}`, title: `CI passed on ${ref(pr)}`, body: pr.title, url: pr.url, repo: pr.repo });
      }
      if (pr.reviewDecision !== before.decision) {
        if (pr.reviewDecision === "APPROVED")
          events.push({ type: "approved", key: `dec:${pr.id}:${stamp}`, title: `${ref(pr)} approved`, body: `${pr.approvals.join(", ") || "A reviewer"} approved · ${pr.title}`, url: pr.url, repo: pr.repo });
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
        events.push({ type: "assigned", key: `assigned:${item.id}`, title: `Assigned to ${ref(item)}`, body: item.title, url: item.url, repo: item.repo });
    });

    Object.entries(data.repos).forEach(([slug, health]) => {
      const before = prev.main?.[slug];
      const now = health.main?.state;
      if (before === undefined) return;
      const red = (s) => s === "FAILURE" || s === "ERROR";
      if (red(now) && !red(before))
        events.push({ type: "mainBroken", key: `main:${slug}:${health.main.sha}`, title: `main is failing on ${repoShort(slug)}`, body: health.main.message, url: health.main.url, repo: slug });
      if (!red(now) && red(before) && now === "SUCCESS")
        events.push({ type: "mainFixed", key: `mainfix:${slug}:${health.main.sha}`, title: `main is green again on ${repoShort(slug)}`, body: health.main.message, url: health.main.url, repo: slug });

      const tag = health.release?.tagName;
      if (tag && prev.release?.[slug] && prev.release[slug] !== tag)
        events.push({ type: "release", key: `release:${slug}:${tag}`, title: `${repoShort(slug)} ${tag} released`, body: health.release.isPrerelease ? "Pre-release" : "Stable release", url: health.release.url, repo: slug });
    });

    if (inbox && prev.inbox) {
      inbox
        .filter((t) => t.unread && prev.inbox[t.id] !== t.updatedAt)
        .filter((t) => !["review_requested", "mention", "assign"].includes(t.reason))
        .forEach((t) =>
          events.push({ type: "inbox", key: `inbox:${t.id}:${t.updatedAt}`, title: `${repoShort(t.repo)}: ${t.title}`, body: `GitHub · ${t.reason.replace(/_/g, " ")}`, url: t.url, repo: t.repo, threadId: t.id })
        );
    }

    return events;
  }

  /** Compare against the last sync and emit notifications for what changed. */
  function process(data, inbox) {
    const prev = DD.store.read(DD.store.KEYS.snapshot, null);
    const next = snapshot(data, inbox);
    if (prev && inbox && !prev.inbox) prev.inbox = next.inbox;
    DD.store.write(DD.store.KEYS.snapshot, next);
    if (!prev) {
      push(
        {
          type: "system",
          title: "Dashboard connected",
          body: `${data.reviews.total} reviews waiting · ${data.mine.total} PRs in flight · ${data.assigned.total} assigned`,
        },
        { silent: true }
      );
      syncPushConfig();
      return [];
    }
    const events = detect(prev, data, inbox);
    const burst = events.length > 5;
    events.forEach((e, i) => push(e, { silent: burst && i > 0 }));
    if (burst) toast({ type: "system", title: `${events.length} new updates`, body: "Open the notification center to see them all." });
    syncPushConfig();
    return events;
  }

  // ---------- schedule reminders ----------

  function checkSchedule() {
    const now = new Date();
    const day = DD.store.day();
    const remind = (key, payload) => {
      if (day.notified[key]) return;
      DD.store.updateDay((s) => (s.notified[key] = true));
      push({ type: "meeting", key: `${todayKey()}:${key}`, ...payload });
    };

    const settings = DD.store.settings;
    settings.meetings
      .filter((m) => !m.days?.length || m.days.includes(now.getDay()))
      .forEach((m) => {
        const start = DD.util.parseTime(m.time);
        const mins = (start - now) / 60000;
        if (mins <= 5 && mins > -1) remind(`meeting:${m.id}`, { title: `${m.title} ${mins > 0.5 ? `in ${Math.ceil(mins)} min` : "is starting"}`, body: `${m.time} · ${m.minutes || 15} min` });
      });

    const isWorkday = now.getDay() !== 0 && now.getDay() !== 6;
    if (!isWorkday) return;
    const start = DD.util.parseTime(settings.workStart);
    const end = DD.util.parseTime(settings.workEnd);
    const sinceStart = (now - start) / 60000;
    if (sinceStart >= 0 && sinceStart < 30 && DD.state.data) {
      const s = DD.insights.stats(DD.state.data, DD.state.inbox);
      remind("start", { title: "Your day is ready", body: `${s.reviews} reviews · ${s.blocked} blocked PRs · ${s.assigned} assigned` });
    }
    const toEnd = (end - now) / 60000;
    if (toEnd <= 30 && toEnd > 0) remind("wrap", { title: "Wrap-up in 30 minutes", body: "Push your branches, update the board and note tomorrow's first task." });
  }

  // ---------- notification center ----------

  function groupLabel(date) {
    const d = new Date(date);
    const today = todayKey();
    if (todayKey(d) === today) return "Today";
    if (todayKey(d) === todayKey(new Date(Date.now() - 86400000))) return "Yesterday";
    return "Earlier";
  }

  function renderItem(n) {
    const meta = TYPES[n.type] || TYPES.system;
    return `
      <li class="notif ${n.read ? "" : "notif--unread"} notif--${meta.tone}" data-id="${esc(n.id)}">
        <span class="notif__icon">${icon(meta.icon, 16)}</span>
        <button class="notif__main" data-action="open">
          <span class="notif__title">${esc(n.title)}</span>
          ${n.body ? `<span class="notif__body">${esc(n.body)}</span>` : ""}
          <span class="notif__meta">${esc(meta.label)}${n.repo ? ` · ${esc(repoShort(n.repo))}` : ""} · ${timeAgo(n.createdAt)}</span>
        </button>
        <span class="notif__actions">
          ${n.read ? "" : `<button class="icon-btn icon-btn--sm" data-action="read" title="Mark as read" aria-label="Mark as read">${icon("check", 14)}</button>`}
          <button class="icon-btn icon-btn--sm" data-action="remove" title="Remove" aria-label="Remove">${icon("x", 14)}</button>
        </span>
      </li>`;
  }

  function renderInbox() {
    const { inbox, inboxError } = DD.state;
    if (DD.store.settings.demo && !inbox) return `<p class="empty">The GitHub inbox isn't available with sample data.</p>`;
    if (inboxError)
      return `<div class="empty"><p>${esc(inboxError)}</p><p class="muted">The inbox needs a classic token with the <code>notifications</code> scope.</p></div>`;
    if (!inbox) return `<p class="empty">Connect GitHub to see your inbox.</p>`;
    const unread = inbox.filter((t) => t.unread);
    if (!unread.length) return `<div class="empty">${icon("inbox", 32)}<p>Inbox zero for your tracked repos.</p></div>`;
    return `<ul class="notif-list">${unread
      .map(
        (t) => `
        <li class="notif notif--unread" data-thread="${esc(t.id)}">
          <span class="notif__icon">${icon(t.type === "PullRequest" ? "pr" : t.type === "Release" ? "tag" : "issue", 16)}</span>
          <a class="notif__main" href="${esc(t.url)}" target="_blank" rel="noopener" data-action="thread-open">
            <span class="notif__title">${esc(t.title)}</span>
            <span class="notif__meta">${esc(repoShort(t.repo))} · ${esc(t.reason.replace(/_/g, " "))} · ${timeAgo(t.updatedAt)}</span>
          </a>
          <span class="notif__actions">
            <button class="icon-btn icon-btn--sm" data-action="thread-read" title="Mark read on GitHub" aria-label="Mark read on GitHub">${icon("check", 14)}</button>
            <button class="icon-btn icon-btn--sm" data-action="thread-done" title="Mark done on GitHub" aria-label="Mark done on GitHub">${icon("inbox", 14)}</button>
          </span>
        </li>`
      )
      .join("")}</ul>`;
  }

  function renderCenter() {
    const panel = document.getElementById("notif-panel");
    if (!panel || panel.hidden) return;
    const inboxCount = DD.state.inbox?.filter((t) => t.unread).length || 0;
    const items = filter === "unread" ? list.filter((n) => !n.read) : list;

    let body;
    if (filter === "inbox") body = renderInbox();
    else if (!items.length)
      body = `<div class="empty">${icon("bell", 32)}<p>${filter === "unread" ? "You're all caught up." : "No notifications yet. Changes on your PRs, reviews and repos will show up here."}</p></div>`;
    else {
      const groups = {};
      items.forEach((n) => (groups[groupLabel(n.createdAt)] ||= []).push(n));
      body = Object.entries(groups)
        .map(([label, group]) => `<h4 class="notif-group">${label}</h4><ul class="notif-list">${group.map(renderItem).join("")}</ul>`)
        .join("");
    }

    panel.querySelector(".panel__tabs").innerHTML = [
      ["all", "All", list.length],
      ["unread", "Unread", unreadCount()],
      ["inbox", "GitHub inbox", inboxCount],
    ]
      .map(([id, label, count]) => `<button class="seg ${filter === id ? "seg--active" : ""}" data-filter="${id}">${label}${count ? ` <span class="count">${count}</span>` : ""}</button>`)
      .join("");
    panel.querySelector(".panel__body").innerHTML = body;
    panel.querySelector("[data-action='dnd']").innerHTML = icon(DD.store.settings.dnd ? "bellOff" : "bell", 16);
    panel.querySelector("[data-action='dnd']").title = DD.store.settings.dnd ? "Do not disturb is on" : "Do not disturb";
    panel.querySelector("[data-action='dnd']").classList.toggle("icon-btn--active", DD.store.settings.dnd);
  }

  function favicon(count) {
    const badge = count
      ? `<circle cx="24" cy="8" r="8" fill="%23da1e28"/><text x="24" y="12" font-size="11" font-family="Arial" font-weight="700" text-anchor="middle" fill="white">${count > 9 ? "9+" : count}</text>`
      : "";
    return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="2" y="6" width="24" height="24" rx="4" fill="%230f62fe"/><path d="M9 14h10M9 19h7M9 24h4" stroke="white" stroke-width="2.5" stroke-linecap="round"/>${badge}</svg>`;
  }

  function updateBadge() {
    const count = unreadCount();
    const badge = document.getElementById("bell-badge");
    if (badge) {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.hidden = count === 0;
    }
    document.title = `${count ? `(${count}) ` : ""}Dev Dashboard`;
    let link = document.querySelector("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = favicon(count);
  }

  function refresh() {
    updateBadge();
    renderCenter();
    DD.bus.emit("notifications");
  }

  function togglePanel(force) {
    const panel = document.getElementById("notif-panel");
    const scrim = document.getElementById("scrim");
    const show = force ?? panel.hidden;
    panel.hidden = !show;
    scrim.hidden = !show;
    document.getElementById("bell-btn").setAttribute("aria-expanded", String(show));
    if (show) {
      renderCenter();
      panel.querySelector(".panel__close").focus();
    }
  }

  async function threadAction(threadId, action) {
    const token = DD.store.settings.token;
    if (!token) return;
    try {
      if (action === "done") await DD.github.markThreadDone(token, threadId);
      else await DD.github.markThreadRead(token, threadId);
      const t = DD.state.inbox?.find((x) => x.id === threadId);
      if (t) t.unread = false;
      renderCenter();
      DD.bus.emit("inbox");
    } catch (err) {
      flash(err.message, "error");
    }
  }

  function bindCenter() {
    const panel = document.getElementById("notif-panel");
    panel.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-filter]");
      if (tab) {
        filter = tab.dataset.filter;
        return renderCenter();
      }
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const id = btn.closest("[data-id]")?.dataset.id;
      const thread = btn.closest("[data-thread]")?.dataset.thread;
      switch (btn.dataset.action) {
        case "close":
          return togglePanel(false);
        case "open":
          return open(id);
        case "read": {
          const n = list.find((x) => x.id === id);
          if (n) n.read = true;
          save();
          return refresh();
        }
        case "remove":
          list = list.filter((x) => x.id !== id);
          save();
          return refresh();
        case "read-all":
          list.forEach((n) => (n.read = true));
          save();
          return refresh();
        case "clear":
          list = [];
          save();
          return refresh();
        case "dnd":
          DD.store.saveSettings({ dnd: !DD.store.settings.dnd });
          flash(DD.store.settings.dnd ? "Do not disturb on — notifications are collected silently" : "Do not disturb off");
          return refresh();
        case "thread-read":
          return threadAction(thread, "read");
        case "thread-done":
          return threadAction(thread, "done");
        case "thread-open":
          return threadAction(thread, "read");
      }
    });
    document.getElementById("scrim").addEventListener("click", () => togglePanel(false));
  }

  async function requestDesktopPermission() {
    if (!("Notification" in window)) return "unsupported";
    if (!window.isSecureContext) return "insecure";
    await registerWorker();
    if (Notification.permission === "granted") return "granted";
    const perm = await Notification.requestPermission();
    if (perm === "granted") await syncPushConfig();
    return perm;
  }

  async function testPush() {
    const perm = await requestDesktopPermission();
    if (perm !== "granted") return perm;
    DD.store.saveSettings({ desktopNotifications: true });
    await osNotify({
      type: "system",
      title: "Push notifications are on",
      body: "Reviews, CI and mentions will show up here when this tab is in the background.",
      key: `test:${Date.now()}`,
      url: location.href,
    });
    return perm;
  }

  function pushStatus() {
    if (!("Notification" in window)) return { perm: "unsupported", worker: false };
    return {
      perm: window.isSecureContext ? Notification.permission : "insecure",
      worker: "serviceWorker" in navigator && window.isSecureContext,
    };
  }

  return {
    TYPES,
    push,
    process,
    checkSchedule,
    toast,
    flash,
    togglePanel,
    threadAction,
    bindCenter,
    refresh,
    unreadCount,
    requestDesktopPermission,
    initPush,
    testPush,
    osNotify,
    pushStatus,
    syncPushConfig,
    recent: (n = 8) => list.slice(0, n),
    removeWhere(predicate) {
      list = list.filter((n) => !predicate(n));
      save();
      refresh();
    },
    open,
  };
})();
