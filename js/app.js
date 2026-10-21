/** The new tab page. Reads state from storage, renders, and asks the background worker to sync. */
(() => {
  const { esc, timeAgo, plural, ageDays } = DD.util;
  const { icon } = DD.icons;
  const ins = DD.insights;
  const ext = DD.storage.isExtension && !!globalThis.chrome?.runtime?.id;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const CLASSIC_TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,notifications,read:org&description=Dev%20Dashboard";
  const UI_KEY = "devdash-ui";

  /** Per-browser view preferences; losing them is harmless. */
  const ui = (() => {
    const fallback = { tab: "focus" };
    try {
      return { ...fallback, ...JSON.parse(localStorage.getItem(UI_KEY) || "{}") };
    } catch {
      return fallback;
    }
  })();

  function saveUi() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify(ui));
    } catch {}
  }

  const state = {
    settings: DD.settings.defaults(),
    cache: null,
    status: {},
    day: { todos: [], snoozed: {} },
    activity: [],
    seenAt: null,
    clearedAt: null,
    demo: null,
  };

  // ---------- derived data ----------

  function data() {
    if (state.settings.demo) return (state.demo ||= DD.demo.data(state.settings.login || "you"));
    return state.cache?.data || null;
  }

  function connected() {
    return !!(state.settings.token || state.settings.demo);
  }

  function allTasks() {
    const d = data();
    return d ? ins.focusQueue(d, state.settings) : [];
  }

  function visibleTasks() {
    return allTasks().filter((t) => !state.day.snoozed[t.key]);
  }

  function activity() {
    if (state.settings.demo) {
      const base = Date.now();
      return DD.demo.notifications().map((n, i) => ({ ...n, id: n.key, createdAt: new Date(base - (i + 1) * 47 * 60000).toISOString() }));
    }
    const cleared = state.clearedAt ? Date.parse(state.clearedAt) : 0;
    return state.activity.filter((a) => Date.parse(a.createdAt) > cleared);
  }

  function unread() {
    const seen = state.seenAt ? Date.parse(state.seenAt) : 0;
    return activity().filter((a) => Date.parse(a.createdAt) > seen).length;
  }

  /** Assigned issues and mentions that aren't already in reviews or my PRs. */
  function issueItems(d) {
    const taken = new Set([...d.reviews.items, ...d.mine.items].map((i) => i.id));
    const out = [];
    const add = (why) => (item) => {
      if (taken.has(item.id)) return;
      taken.add(item.id);
      out.push({ item, why });
    };
    d.assigned.items.forEach(add("assigned"));
    d.mentions.items.forEach(add("mention"));
    return out;
  }

  function mainTone(main) {
    if (!main?.state) return null;
    if (["FAILURE", "ERROR"].includes(main.state)) return "error";
    if (["PENDING", "EXPECTED"].includes(main.state)) return "warning";
    return main.state === "SUCCESS" ? "success" : null;
  }

  function agoText(at) {
    const t = timeAgo(at);
    return t === "now" ? "just now" : `${t} ago`;
  }

  function searchUrl(q) {
    return `https://github.com/search?type=issues&q=${encodeURIComponent(q)}`;
  }

  /** Repos switched on in Settings, for the bar and search. */
  function shownRepos() {
    return DD.repos.all.filter((r) => !state.settings.disabledRepos.includes(r.id));
  }

  function repoScope() {
    return DD.repos.enabled(state.settings).map((r) => `repo:${r.slug}`).join(" ");
  }

  /** Bob needs the extension (native messaging) and is opt-in. */
  function aiOn() {
    return ext && DD.ai.supported && state.settings.ai;
  }

  /** Row key → what Bob should look at, rebuilt on every work render. */
  const aiTargets = new Map();

  // ---------- small pieces ----------

  function iconChip(name, tone) {
    return `<span class="chip-icon tone-${tone || "neutral"}">${icon(name, 16)}</span>`;
  }

  function timeEl(at) {
    return at ? `<time class="item__time" data-at="${esc(at)}" datetime="${esc(at)}" title="${esc(new Date(at).toLocaleString())}">${timeAgo(at)}</time>` : "";
  }

  function ref(item) {
    return `${esc(DD.repos.label(item.repo))} <span class="mono">#${item.number}</span>`;
  }

  /** `ai` is what Bob gets for this row ({ item, kind, task }); the button only shows when Bob is on. */
  function row({ key, url, title, iconName, tone, meta, at, snooze, ai }) {
    const mode = ai && aiOn() ? DD.ai.modeFor(ai.item || {}, ai.kind) : null;
    if (mode) aiTargets.set(key, ai);
    const buttons = [
      mode ? `<button class="icon-btn icon-btn--sm item__bob" data-action="ai-item" data-key="${esc(key)}" title="${esc(DD.ai.MODES[mode].verb)}" aria-label="${esc(DD.ai.MODES[mode].verb)}: ${esc(title)}">${icon("sparkle", 16)}</button>` : "",
      snooze ? `<button class="icon-btn icon-btn--sm" data-action="snooze" data-key="${esc(snooze)}" title="Snooze until tomorrow" aria-label="Snooze until tomorrow">${icon("snooze", 16)}</button>` : "",
    ].join("");
    return `
      <li class="item">
        ${iconChip(iconName, tone)}
        <div class="item__body">
          <a class="item__title" href="${esc(url)}" data-focus="${esc(key)}">${esc(title)}</a>
          <p class="item__meta">${meta}</p>
        </div>
        <div class="item__end">
          ${timeEl(at)}
          ${buttons ? `<span class="item__actions">${buttons}</span>` : ""}
        </div>
      </li>`;
  }

  function skeleton(lines = 5) {
    return `<ul class="items" aria-hidden="true">${Array.from({ length: lines }, () => `<li class="item item--skeleton"><span class="sk sk--icon"></span><div class="item__body"><span class="sk sk--line"></span><span class="sk sk--short"></span></div></li>`).join("")}</ul>`;
  }

  function emptyState(iconName, title, text = "") {
    return `<div class="empty">${iconChip(iconName, "success")}<p class="empty__title">${title}</p>${text ? `<p class="empty__text">${text}</p>` : ""}</div>`;
  }

  function toggle({ attrs, checked, label, hint = "", disabled = false }) {
    return `
      <label class="switch">
        <input type="checkbox" role="switch" ${attrs} ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
        <span class="switch__track" aria-hidden="true"></span>
        <span class="switch__text">${label}${hint ? `<small>${hint}</small>` : ""}</span>
      </label>`;
  }

  /** Re-render a region without losing keyboard focus inside it. */
  function keepFocus(root, render) {
    const active = document.activeElement;
    const inside = active && root.contains(active);
    const key = inside ? active.dataset.focus : null;
    const typed = key && active.matches("input:not([type=checkbox])") ? active.value : null;
    const caret = typed != null ? [active.selectionStart, active.selectionEnd] : null;
    render();
    if (!key) return;
    const next = root.querySelector(`[data-focus="${CSS.escape(key)}"]`);
    if (!next) return;
    if (typed != null) next.value = typed;
    next.focus({ preventScroll: true });
    if (caret && "setSelectionRange" in next) {
      try {
        next.setSelectionRange(...caret);
      } catch {}
    }
  }

  // ---------- masthead + tools ----------

  function renderMasthead() {
    const now = new Date();
    const d = data();
    const name = (d?.viewer?.name || state.settings.login || "").split(" ")[0];
    $("#date").textContent = `${now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · ${DD.util.fmtTime(now)}`;
    $("#greeting").textContent = `${ins.greeting(now)}${name ? `, ${name}` : ""}`;
    let summary;
    if (!connected()) summary = "Connect GitHub to see what needs you today.";
    else if (!d) summary = state.status.error ? "Couldn't reach GitHub. Details below." : "Loading your work…";
    else summary = ins.summary(d, visibleTasks());
    $("#summary").textContent = summary;
    // Rebuilt every minute by tick(), so only touch it when it changes (keeps focus on the button).
    const plan = aiOn() && d ? `<button class="link link--bob" data-action="ai-plan">${icon("sparkle", 14)}Plan my day with Bob</button>` : "";
    const host = $("#hello-ai");
    if (host.dataset.html !== plan) {
      host.innerHTML = plan;
      host.dataset.html = plan;
      host.hidden = !plan;
    }
  }

  function renderTools() {
    const s = state.settings;
    const st = state.status;
    const count = unread();
    let status = "";
    if (s.demo) status = `<button class="pill-btn" data-action="demo-off" title="You're looking at sample data">Sample data <span class="pill-btn__sep">·</span> Exit</button>`;
    else if (s.token && st.syncing) status = `<span class="sync">Syncing…</span>`;
    else if (s.token && st.error) status = `<span class="sync sync--error">Sync failed</span>`;
    else if (s.token && st.at) status = `<span class="sync" title="Last synced ${esc(new Date(st.at).toLocaleString())}">Updated <span data-ago="${esc(st.at)}">${agoText(st.at)}</span></span>`;

    $("#tools").innerHTML = `
      ${status}
      ${connected() ? `<button class="icon-btn ${st.syncing ? "is-spinning" : ""}" data-action="sync" title="Sync now (R)" aria-label="Sync now">${icon("refresh", 18)}</button>` : ""}
      <button class="icon-btn" popovertarget="activity" title="Activity (A)" aria-label="Activity${count ? `, ${count} new` : ""}">
        ${icon("bell", 18)}${count ? `<span class="badge-dot" aria-hidden="true"></span>` : ""}
      </button>
      <button class="icon-btn" data-action="settings" title="Settings" aria-label="Settings">${icon("gear", 18)}</button>`;
  }

  // ---------- repos bar + link menus ----------

  function prettyLabel(label) {
    const text = String(label).replace(/\s+-\s+/, " · ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function repoMenu(repo) {
    const d = data();
    const health = d?.repos?.[repo.slug];
    const main = health?.main;
    const tone = mainTone(main);
    const stateText = { error: "failing", warning: "running", success: "passing" }[tone] || "status unknown";
    const groups = repo.groups
      .map(
        (g) => `
        <div class="menu__group">
          <p class="menu__label">${esc(g.title)}</p>
          ${g.links
            .map((l) =>
              l.versionedHref
                ? `<div class="menu__versioned" data-versioned="${esc(l.versionedHref)}">
                     <a class="menu__link" href="${esc(l.href)}">${esc(prettyLabel(l.label))}</a>
                     <input class="menu__version" value="${esc(l.version || "")}" placeholder="version" aria-label="${esc(l.label)} version" data-action-enter="open-version">
                     <button class="icon-btn icon-btn--sm" data-action="open-version" title="Open this version" aria-label="Open this version">${icon("arrowRight", 14)}</button>
                   </div>`
                : `<a class="menu__link" href="${esc(l.href)}">${esc(prettyLabel(l.label))}</a>`
            )
            .join("")}
        </div>`
      )
      .join("");

    return `
      <header class="menu__head">
        <span class="menu__logo">${repo.logo}</span>
        <div>
          <p class="menu__title">${esc(repo.name)}</p>
          ${repo.slug ? `<a class="menu__slug mono" href="https://github.com/${esc(repo.slug)}" title="${esc(repo.slug)}">${esc(DD.util.repoShort(repo.slug))}</a>` : ""}
        </div>
      </header>
      ${
        main
          ? `<a class="menu__status" href="${esc(main.url)}" title="${esc(main.message || "")}">
               <span class="dot dot--${tone || "neutral"}"></span>
               <span><b>${esc(main.branch)}</b> ${stateText}</span>
               <span class="menu__status-meta mono">${esc(main.sha)} · ${timeAgo(main.committedAt)}</span>
             </a>`
          : ""
      }
      ${health?.release ? `<a class="menu__status" href="${esc(health.release.url)}">${icon("tag", 14)}<span><b>${esc(health.release.tagName)}</b>${health.release.isPrerelease ? " pre-release" : ""}</span><span class="menu__status-meta">${timeAgo(health.release.publishedAt)}</span></a>` : ""}
      ${groups}`;
  }

  function renderRepos() {
    const menus = $("#repo-menus");
    if ($(":popover-open", menus)) return;
    const d = data();
    const repos = shownRepos();
    $("#repos").innerHTML = repos
      .map((r) => {
        const tone = mainTone(d?.repos?.[r.slug]?.main);
        const dot =
          tone === "error"
            ? `<span class="dot dot--error" title="main is failing"></span><span class="sr-only">, main is failing</span>`
            : tone === "warning"
              ? `<span class="dot dot--warning" title="main checks running"></span><span class="sr-only">, main checks running</span>`
              : "";
        return `
          <button class="repo" popovertarget="menu-${esc(r.id)}" data-repo="${esc(r.id)}" style="anchor-name: --repo-${esc(r.id)}">
            <span class="repo__logo">${r.logo}</span>
            <span>${esc(r.short)}</span>${dot}
            ${icon("chevronDown", 14)}
          </button>`;
      })
      .join("");
    menus.innerHTML = repos.map((r) => `<div class="menu" id="menu-${esc(r.id)}" popover aria-label="${esc(r.name)} links" style="position-anchor: --repo-${esc(r.id)}">${repoMenu(r)}</div>`).join("");
  }

  /** Popovers open in the top layer; place each under the button that opened it, flipped if it would overflow. */
  function placeMenu(menu) {
    const btn = $(`[popovertarget="${menu.id}"]`);
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const left = Math.max(12, Math.min(r.left, innerWidth - w - 12));
    const below = r.bottom + 6;
    const top = below + h > innerHeight - 12 && r.top - h - 6 > 12 ? r.top - h - 6 : below;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  // ---------- work panel ----------

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
    const tasks = all.filter((t) => !state.day.snoozed[t.key]);
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
    const foot = snoozed ? `<span>${plural(snoozed, "item")} snoozed until tomorrow</span><button class="link" data-action="unsnooze">Restore</button>` : "";
    return { body, foot };
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
    ];
  }

  function syncNotice() {
    const s = state.settings;
    if (s.demo || !s.token) return "";
    const { error, errorSso } = state.status;
    const d = state.cache?.data;
    const warnings = error ? [] : d?.warnings || [];
    if (!error && !warnings.length) return "";
    const messages = error ? [error] : warnings;
    const text = messages.join(" ");
    const sso = errorSso || d?.sso;
    const hints = [];
    if (sso || /SAML|SSO/i.test(text)) hints.push(`The organization requires SSO. On <a href="https://github.com/settings/tokens">your tokens page</a>, choose <b>Configure SSO</b> next to this token and authorize <b>carbon-design-system</b>.`);
    if (/personal access token|fine-grained|not accessible/i.test(text) || s.tokenScopes === null) hints.push(`Fine-grained tokens can be blocked by org policy. A <a href="${CLASSIC_TOKEN_URL}">classic token</a> with <code>repo</code>, <code>notifications</code> and <code>read:org</code> is most reliable.`);
    if (/401|rejected/i.test(text)) hints.push(`Create a new <a href="${CLASSIC_TOKEN_URL}">classic token</a> on github.com and paste it in Settings.`);
    if (/reach api\.github\.com/i.test(text)) hints.push("On a corporate network or VPN, a proxy may be blocking api.github.com.");
    return `
      <div class="notice notice--${error ? "error" : "warning"}" role="alert">
        ${icon("alert", 16)}
        <div class="notice__body">
          <p class="notice__title">${error ? "Couldn't sync with GitHub" : `Some data couldn't load${d?.failed?.length ? ` (${esc(d.failed.join(", "))})` : ""}`}</p>
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
        <button class="link" data-action="demo-on">Explore with sample data first</button>
      </div>`;
  }

  /** Edge fades on the scrolling work list: under the pinned heading once scrolled, and at the bottom while more is below. */
  function updateFades(panel) {
    if (!panel) return;
    panel.classList.toggle("is-scrolled", panel.scrollTop > 0);
    panel.classList.toggle("has-more", panel.scrollTop + panel.clientHeight < panel.scrollHeight - 1);
  }

  function renderWork() {
    const el = $("#work");
    aiTargets.clear();
    // Syncs re-render the list; keep the reader's place unless they switched tabs.
    const prev = $(".work__panel", el);
    const scroll = prev?.getAttribute("aria-labelledby") === `tab-${ui.tab}` ? prev.scrollTop : 0;
    keepFocus(el, () => {
      if (!connected()) {
        if (!$(".connect", el)) el.innerHTML = connectView();
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
        body = listView(items, reviewRow, "No reviews waiting on you");
        foot = `<span>${plural(d.reviewed.total, "PR")} reviewed since yesterday</span><a class="link" href="${esc(searchUrl(`is:pr is:open user-review-requested:${login} ${repoScope()}`))}">Open on GitHub</a>`;
      } else if (ui.tab === "prs") {
        const items = [...d.mine.items].sort((a, b) => PR_ORDER.indexOf(ins.prState(a)) - PR_ORDER.indexOf(ins.prState(b)));
        body = listView(items, prRow, "No open pull requests");
        foot = `<span>${d.merged.total} merged this week</span><a class="link" href="${esc(searchUrl(`is:pr is:open author:${login} ${repoScope()}`))}">Open on GitHub</a>`;
      } else {
        body = listView(issueItems(d), issueRow, "Nothing assigned and no new mentions");
        const triage = `is:issue is:open label:"status: needs triage 🕵️‍♀️" ${repoScope()}`;
        const bobTriage = aiOn() && d.triage.items.length ? `<button class="link link--bob" data-action="ai-triage">${icon("sparkle", 14)}Triage with Bob</button>` : "";
        foot = `<span class="work__foot-group"><a class="link" href="${esc(searchUrl(triage))}">${plural(d.triage.total, "issue")} ${d.triage.total === 1 ? "needs" : "need"} triage</a>${bobTriage}</span><a class="link" href="${esc(searchUrl(`is:open assignee:${login} ${repoScope()}`))}">Open on GitHub</a>`;
      }

      el.innerHTML = `
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
        ${foot ? `<footer class="work__foot">${foot}</footer>` : ""}`;
    });
    const panel = $(".work__panel", el);
    if (panel) panel.scrollTop = scroll;
    updateFades(panel);
  }

  // ---------- today ----------

  function renderToday() {
    const el = $("#today");
    const now = new Date();
    const meetings = DD.sync.todaysMeetings(state.settings, now);
    const todos = state.day.todos;
    const open = todos.filter((t) => !t.done).length;
    const d = data();

    const agenda = meetings.length
      ? `<ul class="agenda">${meetings
          .map((m) => {
            const live = now >= m.start && now < m.end;
            const past = now >= m.end;
            const mins = Math.round((m.start - now) / 60000);
            const when = live ? `<span class="agenda__live">Now</span>` : past ? `${m.minutes || 15}m` : mins < 60 ? `in ${mins}m` : `${m.minutes || 15}m`;
            return `<li class="agenda__item ${past ? "is-past" : ""} ${live ? "is-live" : ""}"><time>${esc(DD.util.fmtTime(m.start))}</time><span class="agenda__title">${esc(m.title)}</span><span class="agenda__when">${when}</span></li>`;
          })
          .join("")}</ul>`
      : `<p class="quiet">No meetings today.</p>`;

    keepFocus(el, () => {
      el.innerHTML = `
        <header class="panel__head">
          <h2>Today</h2>
          <button class="link" data-action="settings" data-section="schedule">Edit</button>
        </header>
        ${agenda}
        <div class="today__todos">
          <h3 class="subhead">To-dos ${open ? `<span>${open}</span>` : ""}</h3>
          <ul class="todos">
            ${todos
              .map(
                (t) => `
              <li class="todo ${t.done ? "is-done" : ""}">
                <label>
                  <input type="checkbox" data-action="todo-toggle" data-id="${esc(t.id)}" data-focus="todo-${esc(t.id)}" ${t.done ? "checked" : ""}>
                  <span>${esc(t.text)}</span>
                </label>
                <button class="icon-btn icon-btn--sm todo__remove" data-action="todo-remove" data-id="${esc(t.id)}" aria-label="Remove ${esc(t.text)}">${icon("x", 14)}</button>
              </li>`
              )
              .join("")}
          </ul>
          <form class="todo-form" data-form="todo">
            ${icon("plus", 16)}
            <input name="text" placeholder="Add a to-do" autocomplete="off" aria-label="New to-do" data-focus="todo-input">
          </form>
        </div>
        ${
          connected()
            ? `<footer class="today__foot">
                 <button class="btn btn--ghost btn--block" data-action="copy-standup" ${d ? "" : "disabled"} title="Yesterday, today and blockers from your GitHub activity">${icon("copy", 16)}Copy standup update</button>
                 ${aiOn() ? `<button class="btn btn--ghost btn--block" data-action="ai-standup" ${d ? "" : "disabled"} title="Bob writes it from your PRs, reviews and to-dos; edit before copying">${icon("sparkle", 16)}Write standup with Bob</button>` : ""}
               </footer>`
            : ""
        }`;
    });
  }

  // ---------- activity drawer ----------

  function dayLabel(at) {
    const key = DD.util.todayKey(new Date(at));
    if (key === DD.util.todayKey()) return "Today";
    if (key === DD.util.todayKey(new Date(Date.now() - 86400000))) return "Yesterday";
    return "Earlier";
  }

  function renderActivity() {
    const list = activity();
    const seen = state.seenAt ? Date.parse(state.seenAt) : 0;
    let current = "";
    const items = list
      .map((a) => {
        const meta = DD.sync.TYPES[a.type] || { icon: "activity", tone: "neutral" };
        const label = dayLabel(a.createdAt);
        const head = label !== current ? `<li class="drawer__day">${(current = label)}</li>` : "";
        return `${head}
          <li class="item ${Date.parse(a.createdAt) > seen ? "is-new" : ""}">
            ${iconChip(meta.icon, meta.tone)}
            <div class="item__body">
              ${a.url ? `<a class="item__title" href="${esc(a.url)}">${esc(a.title)}</a>` : `<span class="item__title">${esc(a.title)}</span>`}
              ${a.body ? `<p class="item__meta">${esc(a.body)}</p>` : ""}
            </div>
            <div class="item__end">${timeEl(a.createdAt)}</div>
          </li>`;
      })
      .join("");

    const s = state.settings;
    const off = !s.notifications ? "Desktop notifications are off." : "";
    $("#activity").innerHTML = `
      <header class="drawer__head">
        <h2>Activity</h2>
        <div class="drawer__actions">
          ${aiOn() && list.length ? `<button class="btn btn--ghost btn--sm" data-action="ai-catchup">${icon("sparkle", 14)}Catch me up</button>` : ""}
          ${list.length && !s.demo ? `<button class="btn btn--ghost btn--sm" data-action="clear-activity">Clear</button>` : ""}
          <button class="icon-btn icon-btn--sm" data-action="close-activity" aria-label="Close">${icon("x", 16)}</button>
        </div>
      </header>
      ${
        list.length
          ? `<ul class="items drawer__list">${items}</ul>`
          : `<div class="empty">${iconChip("bell", "neutral")}<p class="empty__title">No activity yet</p><p class="empty__text">Approvals, CI results, merges and releases show up here as they happen.</p></div>`
      }
      <footer class="drawer__foot">${off} <button class="link" data-action="settings" data-section="notifications">Notification settings</button></footer>`;
  }

  function openActivity() {
    const drawer = $("#activity");
    if (!drawer.matches(":popover-open")) drawer.showPopover();
  }

  /** Content is built right before the drawer opens; it counts as seen once it's on screen. */
  function bindActivity() {
    const drawer = $("#activity");
    drawer.addEventListener("beforetoggle", (e) => e.newState === "open" && renderActivity());
    drawer.addEventListener("toggle", async (e) => {
      if (e.newState !== "open") return renderTools();
      $(".drawer__head .icon-btn", drawer)?.focus();
      state.lastSeenAt = state.seenAt;
      state.seenAt = new Date().toISOString();
      await DD.storage.set({ activitySeenAt: state.seenAt });
    });
  }

  // ---------- settings ----------

  const NOTIFY_LABELS = {
    reviewRequested: "Review requests",
    ciFailed: "CI fails on my PR",
    ciPassed: "CI passes on my PR",
    changesRequested: "Changes requested",
    approved: "My PR is approved",
    merged: "My PR is merged",
    conflict: "Merge conflicts",
    mentioned: "Mentions",
    assigned: "Assignments",
    mainBroken: "main breaks or recovers",
    release: "New releases",
    githubInbox: "Other GitHub inbox activity",
    meetings: "Meeting reminders",
  };

  function select(setting, value, options) {
    return `<select class="input input--select" data-setting="${setting}">${options.map(([v, t]) => `<option value="${v}" ${+value === v ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  }

  function renderSettings() {
    const s = state.settings;
    const rl = state.cache?.data?.rateLimit;
    const tokenInfo = !s.token
      ? ""
      : s.tokenScopes === null
        ? "Fine-grained token — the GitHub inbox won't work and org policy may block it. A classic token is recommended."
        : s.tokenScopes !== undefined
          ? `Classic token · scopes: <code>${esc(s.tokenScopes || "none")}</code>${/notifications|repo/.test(s.tokenScopes || "") ? "" : " — add <code>notifications</code> for inbox activity"}`
          : "";

    const body = $(".sheet__body", $("#settings"));
    const scroll = body?.scrollTop || 0;
    $("#settings").innerHTML = `
      <header class="sheet__head">
        <h2>Settings</h2>
        <button class="icon-btn" data-action="close-settings" aria-label="Close settings">${icon("x", 18)}</button>
      </header>
      <div class="sheet__body">
        <section class="setting-section" id="set-github">
          <h3>GitHub</h3>
          <p class="status-line">
            <span class="dot dot--${s.token ? "success" : "neutral"}"></span>
            ${s.token ? `Connected${s.login ? ` as <b>${esc(s.login)}</b>` : ""}` : "Not connected"}
          </p>
          <form class="field-row" data-form="connect">
            <input class="input" type="password" name="token" placeholder="${s.token ? "Paste a new token to replace it" : "ghp_…"}" autocomplete="off" aria-label="GitHub token" data-focus="settings-token">
            <button class="btn btn--primary" type="submit">${s.token ? "Replace" : "Connect"}</button>
            ${s.token ? `<button class="btn btn--danger" type="button" data-action="disconnect">Disconnect</button>` : ""}
          </form>
          <p class="hint">${tokenInfo || `Use a <a href="${CLASSIC_TOKEN_URL}">classic token</a> with <code>repo</code>, <code>notifications</code> and <code>read:org</code>.`}${rl ? ` API budget: ${rl.remaining}/${rl.limit} this hour.` : ""}</p>
          <div class="fields">
            <label class="field"><span>Check GitHub every</span>${select("pollMinutes", s.pollMinutes, [1, 2, 3, 5, 10, 15].map((m) => [m, `${m} min`]))}</label>
            <label class="field"><span>Reviews are overdue after</span>${select("staleReviewDays", s.staleReviewDays, [1, 2, 3, 5].map((d) => [d, plural(d, "day")]))}</label>
          </div>
          ${toggle({ attrs: 'data-setting="includeTeamReviews"', checked: s.includeTeamReviews, label: "Include team review requests", hint: "Otherwise only reviews requested from you directly" })}
          ${toggle({ attrs: 'data-setting="demo"', checked: s.demo, label: "Sample data", hint: "Explore with realistic fake data" })}
        </section>

        ${bobSettings()}

        <section class="setting-section" id="set-repos">
          <h3>Repositories</h3>
          <p class="hint">Turned-off repos are hidden from the bar, search and your work list. Edit the list in <code>bookmarks-data.js</code>.</p>
          ${DD.repos.all
            .map((r) =>
              toggle({
                attrs: `data-repo-toggle="${esc(r.id)}"`,
                checked: !s.disabledRepos.includes(r.id),
                disabled: !r.slug,
                label: esc(r.name),
                hint: `<span class="mono">${esc(r.slug || "no GitHub repo found")}</span>`,
              })
            )
            .join("")}
        </section>

        <section class="setting-section" id="set-notifications">
          <h3>Notifications</h3>
          ${toggle({ attrs: 'data-setting="notifications"', checked: s.notifications, label: "Desktop notifications", hint: ext ? "Shown by Chrome, even when no new tab is open" : "Shown while this page is open in the background" })}
          <fieldset class="checks" ${s.notifications ? "" : "disabled"}>
            <legend>Notify me about</legend>
            ${Object.entries(NOTIFY_LABELS)
              .map(([k, text]) => `<label class="check"><input type="checkbox" data-notify="${k}" ${s.notifyOn[k] ? "checked" : ""}><span>${text}</span></label>`)
              .join("")}
          </fieldset>
          <button class="btn btn--sm" data-action="test-notification" ${s.notifications ? "" : "disabled"}>Send a test notification</button>
        </section>

        <section class="setting-section" id="set-schedule">
          <h3>Meetings</h3>
          <p class="hint">Recurring weekday meetings appear under Today and are reminded 5 minutes before.</p>
          <ul class="meetings">
            ${s.meetings
              .map(
                (m) => `
              <li data-id="${esc(m.id)}">
                <input class="input input--sm" type="time" value="${esc(m.time)}" data-meeting="time" aria-label="Start time">
                <input class="input input--sm" value="${esc(m.title)}" data-meeting="title" aria-label="Title">
                <label class="minutes"><input class="input input--sm" type="number" min="5" step="5" value="${m.minutes || 15}" data-meeting="minutes" aria-label="Length in minutes"><span>min</span></label>
                <button class="icon-btn icon-btn--sm" data-action="meeting-remove" aria-label="Remove ${esc(m.title)}">${icon("trash", 16)}</button>
              </li>`
              )
              .join("")}
          </ul>
          <button class="btn btn--sm" data-action="meeting-add">${icon("plus", 14)}Add meeting</button>
        </section>

        <section class="setting-section" id="set-appearance">
          <h3>Appearance</h3>
          <div class="segmented" role="radiogroup" aria-label="Theme">
            ${[
              ["system", "System"],
              ["light", "Light"],
              ["dark", "Dark"],
            ]
              .map(([v, t]) => `<button class="segmented__opt" role="radio" aria-checked="${s.theme === v}" data-action="theme" data-theme="${v}">${t}</button>`)
              .join("")}
          </div>
        </section>

        <section class="setting-section" id="set-keys">
          <h3>Keyboard</h3>
          <dl class="keys">
            <div><dt><kbd>/</kbd> or <kbd>${/Mac/.test(navigator.platform) ? "⌘" : "Ctrl"}</kbd><kbd>K</kbd></dt><dd>Search</dd></div>
            <div><dt><kbd>1</kbd>–<kbd>4</kbd></dt><dd>Switch work tabs</dd></div>
            <div><dt><kbd>R</kbd></dt><dd>Sync now</dd></div>
            <div><dt><kbd>A</kbd></dt><dd>Activity</dd></div>
          </dl>
        </section>

        <section class="setting-section">
          <h3>Reset</h3>
          <p class="hint">Removes the token, settings, to-dos and activity from this browser.</p>
          <button class="btn btn--danger btn--sm" data-action="reset">Reset everything</button>
        </section>
      </div>`;
    const next = $(".sheet__body", $("#settings"));
    if (next) next.scrollTop = scroll;
  }

  function bobSettings() {
    const s = state.settings;
    if (!ext || !DD.ai.supported)
      return `<section class="setting-section" id="set-bob"><h3>Bob</h3><p class="hint">Bob actions run through Bob Shell on your computer, so they need the Chrome extension rather than the web version.</p></section>`;
    const st = state.bobStatus || {};
    const helper = st.checking
      ? `<span class="dot dot--neutral"></span>Looking for the Bob helper…`
      : st.ok
        ? `<span class="dot dot--success"></span><span>Helper ready · <b>Bob Shell ${esc(st.version)}</b></span>`
        : `<span class="dot dot--${st.code === "missing" ? "warning" : "error"}"></span><span>${esc(st.error || "Not checked yet")}</span>`;
    const setup =
      st.code === "missing"
        ? `<ol class="steps">
             <li>Install <a href="https://bob.ibm.com/docs/shell">Bob Shell</a> (it needs Node.js).</li>
             <li>In Terminal, from the <code>dev-dashboard</code> folder, run <code>sh ai-helper/install.sh</code></li>
             <li>Click <b>Check again</b>.</li>
           </ol>`
        : "";
    return `
      <section class="setting-section" id="set-bob">
        <h3>Bob</h3>
        ${toggle({ attrs: 'data-setting="ai"', checked: s.ai, label: "Bob actions", hint: "Review briefs, CI explanations, day plans, standups and answers from IBM Bob, when you ask" })}
        ${
          s.ai
            ? `<p class="status-line">${helper}<button class="link" data-action="bob-check">Check again</button></p>
               ${setup}
               <form class="field-row" data-form="bob-key">
                 <input class="input" type="password" name="key" placeholder="${s.bobKey ? "Paste a new key to replace it" : "Bob API key"}" autocomplete="off" aria-label="Bob API key" data-focus="bob-key">
                 <button class="btn btn--primary" type="submit">${s.bobKey ? "Replace" : "Save"}</button>
                 ${s.bobKey ? `<button class="btn btn--danger" type="button" data-action="bob-key-remove">Remove</button>` : ""}
               </form>
               <p class="hint">${s.bobKey ? "Key saved. " : ""}Create an <b>Inference</b> key at <a href="https://bob.ibm.com">bob.ibm.com</a> under Settings → API keys. It stays in this browser and is only handed to Bob Shell on this computer.</p>
               <div class="fields">
                 <label class="field"><span>Team ID, for General keys only</span><input class="input" data-setting="bobTeamId" value="${esc(s.bobTeamId)}" placeholder="Optional" autocomplete="off"></label>
               </div>
               <p class="hint">Nothing goes to Bob until you click a Bob action. Then that item's title, description, comments, diff or CI log is sent through Bob Shell and counts toward your Bob usage.</p>
               <button class="btn btn--sm" data-action="bob-test" ${s.bobKey && st.ok ? "" : "disabled"}>Send a test prompt</button>`
            : ""
        }
      </section>`;
  }

  async function refreshBobStatus() {
    if (!ext || !DD.ai.supported || !state.settings.ai) return;
    state.bobStatus = { checking: true };
    if ($("#settings").open) renderSettings();
    state.bobStatus = await DD.ai.status();
    if ($("#settings").open) renderSettings();
  }

  function openSettings(section) {
    const dialog = $("#settings");
    if (!state.bobStatus?.ok) refreshBobStatus();
    renderSettings();
    if (!dialog.open) dialog.showModal();
    if (section) $(`#set-${section}`)?.scrollIntoView({ block: "start" });
  }

  /** Two-step confirm for destructive buttons, instead of a blocking browser dialog. */
  function confirmed(el, label) {
    if (el.dataset.armed) return true;
    el.dataset.armed = "1";
    const original = el.innerHTML;
    el.textContent = label;
    setTimeout(() => {
      if (!el.isConnected) return;
      delete el.dataset.armed;
      el.innerHTML = original;
    }, 4000);
    return false;
  }

  // ---------- search ----------

  const search = (() => {
    const input = () => $("#search-input");
    const list = () => $("#search-results");
    let results = [];
    let index = 0;

    function linkIndex() {
      const out = [];
      shownRepos().forEach((r) => {
        if (r.slug) out.push({ group: "Repos", label: r.name, hint: r.slug, iconName: "book", url: `https://github.com/${r.slug}`, terms: `${r.short} ${r.id}` });
        r.groups.forEach((g) =>
          g.links.forEach((l) => out.push({ group: "Links", label: `${r.short} · ${prettyLabel(l.label)}`, hint: g.title, iconName: "link", url: l.href, terms: `${r.name} ${r.id}` }))
        );
      });
      return out;
    }

    function workIndex() {
      const d = data();
      if (!d) return [];
      const seen = new Set();
      const out = [];
      [
        ["reviews", "Review"],
        ["mine", "My PR"],
        ["assigned", "Assigned"],
        ["mentions", "Mention"],
        ["triage", "Triage"],
        ["merged", "Merged"],
      ].forEach(([key, tag]) =>
        d[key].items.forEach((i) => {
          if (seen.has(i.id)) return;
          seen.add(i.id);
          out.push({
            group: "Work",
            label: i.title,
            hint: `${DD.repos.label(i.repo)} #${i.number} · ${tag}`,
            iconName: i.kind === "pr" ? "pr" : "issue",
            url: i.url,
            terms: `${i.number} #${i.number} ${i.author} ${DD.util.repoShort(i.repo)} ${i.labels.map((l) => l.name).join(" ")}`,
          });
        })
      );
      return out;
    }

    function actionIndex() {
      const s = state.settings;
      const act = (label, iconName, run, terms = "") => ({ group: "Actions", label, iconName, run, terms });
      return [
        connected() && act("Sync now", "refresh", () => requestSync(true), "refresh reload"),
        act("Copy standup update", "copy", copyStandup, "standup slack"),
        aiOn() && data() && act("Write standup with Bob", "sparkle", bobStandup, "standup slack ai bob"),
        aiOn() && data() && act("Plan my day with Bob", "sparkle", bobPlan, "plan schedule day ai bob"),
        aiOn() && act("Catch me up with Bob", "sparkle", bobCatchUp, "activity summary ai bob"),
        act("Open activity", "bell", openActivity, "notifications"),
        act("Open settings", "gear", () => openSettings(), "preferences token"),
        act(`Switch to ${document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches) ? "light" : "dark"} theme`, "moon", toggleTheme, "theme dark light"),
        Object.keys(state.day.snoozed).length && act("Restore snoozed items", "snooze", unsnooze, "unsnooze"),
        s.demo ? act("Exit sample data", "x", () => setDemo(false)) : null,
      ].filter(Boolean);
    }

    /** "carbon#123", "products 456" or "#789" jumps straight to an issue or PR. */
    function jump(q) {
      const m = q.trim().match(/^(?:([a-z][\w.-]*)\s*)?#?(\d{1,6})$/i);
      if (!m) return null;
      const alias = (m[1] || "").toLowerCase();
      const repos = DD.repos.enabled(state.settings);
      const repo = alias
        ? repos.find((r) => [r.id, r.short, r.name, DD.util.repoShort(r.slug)].some((n) => n.toLowerCase().replace(/\s+/g, "-").startsWith(alias)))
        : repos[0];
      if (!repo) return null;
      return { group: "Go to", label: `${DD.util.repoShort(repo.slug)}#${m[2]}`, hint: `Open on GitHub`, iconName: "arrowRight", url: `https://github.com/${repo.slug}/issues/${m[2]}` };
    }

    function isQuestion(q) {
      const words = q.split(/\s+/).length;
      return words >= 3 && (/\?$/.test(q) || /^(what|what's|whats|how|why|which|where|when|who|can|could|should|is|are|do|does|did|any|summari[sz]e|explain|list|show me|tell me|help)\b/i.test(q));
    }

    function score(item, terms) {
      const label = item.label.toLowerCase();
      const hay = `${label} ${(item.hint || "").toLowerCase()} ${(item.terms || "").toLowerCase()}`;
      if (!terms.every((t) => hay.includes(t))) return -1;
      let s = 0;
      terms.forEach((t) => {
        if (label.startsWith(t)) s += 4;
        else if (new RegExp(`(^|[\\s·(:/#-])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(label)) s += 2;
        else if (label.includes(t)) s += 1;
      });
      return s;
    }

    function update() {
      const q = input().value.trim();
      if (!q) return close();
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      const ORDER = { "Go to": 0, Work: 1, Repos: 2, Links: 3, Actions: 4 };
      const matched = [...workIndex(), ...linkIndex(), ...actionIndex()]
        .map((item) => ({ item, s: score(item, terms) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s || ORDER[a.item.group] - ORDER[b.item.group])
        .slice(0, 8)
        .map((x) => x.item)
        .sort((a, b) => ORDER[a.group] - ORDER[b.group]);
      const target = jump(q);
      const go = target && !matched.some((r) => r.url && target.url.replace("/issues/", "/") === r.url.replace(/\/(issues|pull)\//, "/")) ? target : null;
      const bobItems = aiOn()
        ? [
            { group: "Search", label: `Ask Bob “${q}”`, hint: "About your work and links", iconName: "sparkle", ask: q },
            { group: "Search", label: `Find with Bob: “${q}”`, hint: "Builds a GitHub search", iconName: "sparkle", find: q },
          ]
        : [];
      results = [
        ...(go ? [go] : []),
        ...matched,
        ...bobItems,
        { group: "Search", label: `Search GitHub for “${q}”`, iconName: "github", url: searchUrl(`org:carbon-design-system ${q}`) },
        { group: "Search", label: `Search the web for “${q}”`, iconName: "globe", web: q },
      ];
      // A question goes to Bob on Enter; anything else still lands on the best match.
      index = bobItems.length && !go && isQuestion(q) ? results.findIndex((r) => r.ask) : 0;
      draw();
    }

    function draw() {
      let group = "";
      list().innerHTML = results
        .map((r, i) => {
          const head = r.group !== group && r.group !== "Search" ? `<li class="search__group" role="presentation">${esc((group = r.group))}</li>` : "";
          if (r.group === "Search" && group !== "Search") {
            group = "Search";
            return `<li class="search__sep" role="presentation"></li>${option(r, i)}`;
          }
          return head + option(r, i);
        })
        .join("");
      list().hidden = false;
      input().setAttribute("aria-expanded", "true");
      input().setAttribute("aria-activedescendant", `sr-${index}`);
      $(`#sr-${index}`)?.scrollIntoView({ block: "nearest" });
    }

    function option(r, i) {
      return `<li class="search__item ${i === index ? "is-active" : ""}" id="sr-${i}" role="option" aria-selected="${i === index}" data-index="${i}">${icon(r.iconName, 16)}<span class="search__label">${esc(r.label)}</span>${r.hint ? `<span class="search__hint">${esc(r.hint)}</span>` : ""}</li>`;
    }

    function close() {
      results = [];
      list().hidden = true;
      list().innerHTML = "";
      input().setAttribute("aria-expanded", "false");
      input().removeAttribute("aria-activedescendant");
    }

    function run(i, newTab) {
      const r = results[i];
      if (!r) return;
      input().value = "";
      close();
      if (r.run) return r.run();
      if (r.ask) return bobAsk(r.ask);
      if (r.find) return bobFind(r.find);
      if (r.web) return webSearch(r.web, newTab);
      go(r.url, newTab);
    }

    function bind() {
      input().addEventListener("input", update);
      input().addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          if (!results.length) return;
          e.preventDefault();
          index = (index + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
          draw();
        } else if (e.key === "Enter") {
          e.preventDefault();
          run(index, e.metaKey || e.ctrlKey);
        } else if (e.key === "Escape") {
          e.stopPropagation();
          if (input().value) {
            input().value = "";
            close();
          } else input().blur();
        }
      });
      input().addEventListener("blur", () => setTimeout(close, 120));
      input().addEventListener("focus", () => input().value.trim() && update());
      list().addEventListener("mousedown", (e) => e.preventDefault());
      list().addEventListener("click", (e) => {
        const li = e.target.closest("[data-index]");
        if (li) run(+li.dataset.index, e.metaKey || e.ctrlKey);
      });
    }

    return { bind, focus: () => input().focus() };
  })();

  function go(url, newTab) {
    if (!url) return;
    if (newTab) window.open(url, "_blank", "noopener");
    else location.assign(url);
  }

  function webSearch(text, newTab) {
    if (ext && chrome.search?.query) return chrome.search.query({ text, disposition: newTab ? "NEW_TAB" : "CURRENT_TAB" });
    go(`https://www.google.com/search?q=${encodeURIComponent(text)}`, newTab);
  }

  // ---------- Bob ----------

  /**
   * The Bob sheet shows one conversation: `spec.build()` makes the opening
   * prompt (fetching GitHub detail if needed), follow-ups resend it with the
   * exchange so far. Opening answers are cached per item version or per day.
   */
  const bob = { spec: null, base: "", cacheKey: null, turns: [], loading: null, error: null, controller: null, timer: 0 };

  function bobContext() {
    return {
      login: state.settings.login || data()?.viewer?.login || "",
      settings: state.settings,
      data: data(),
      tasks: visibleTasks(),
      meetings: DD.sync.todaysMeetings(state.settings),
      todos: state.day.todos,
      activity: activity(),
    };
  }

  function openBob(spec, { fresh = false } = {}) {
    bob.controller?.abort();
    Object.assign(bob, { spec, base: "", cacheKey: null, turns: [], error: null });
    const dialog = $("#ai");
    if (!dialog.open) dialog.showModal();
    runBob(null, fresh);
  }

  async function runBob(question, fresh = false) {
    const controller = new AbortController();
    bob.controller = controller;
    bob.error = null;
    bob.loading = { stage: question || bob.base ? "Bob is thinking…" : "Gathering context from GitHub…", since: Date.now() };
    if (question) bob.turns.push({ role: "user", text: question });
    renderBob();
    try {
      let prompt;
      if (!question) {
        const built = await bob.spec.build();
        if (controller.signal.aborted) return;
        bob.base = built.prompt;
        bob.cacheKey = built.cacheKey || null;
        const hit = !fresh && (await DD.ai.cached(bob.cacheKey));
        if (hit) return bob.turns.push({ role: "bob", text: hit.text, at: hit.at, cached: true });
        prompt = bob.base;
        bob.loading.stage = "Bob is thinking…";
        renderBob();
      } else prompt = DD.ai.followUpPrompt(bob.base, bob.turns.slice(0, -1), question);
      const text = await DD.ai.ask(prompt, state.settings, controller.signal);
      if (controller.signal.aborted) return;
      bob.turns.push({ role: "bob", text, at: new Date().toISOString() });
      if (!question) DD.ai.remember(bob.cacheKey, { text });
    } catch (err) {
      if (controller.signal.aborted || err.code === "cancelled") {
        if (question && bob.turns.at(-1)?.role === "user") bob.turns.pop();
        if (!bob.turns.length) bob.error = new DD.ai.AIError("You stopped Bob before it answered.", "cancelled");
        return;
      }
      bob.error = err;
    } finally {
      if (bob.controller === controller) {
        bob.controller = null;
        bob.loading = null;
        renderBob();
      }
    }
  }

  function bobAnswer(t, first) {
    const { format } = bob.spec;
    if (first && format === "edit") return `<textarea class="input bob__edit" rows="11" aria-label="Draft, editable" data-focus="bob-edit" spellcheck="true">${esc(t.text)}</textarea>`;
    if (first && format === "query")
      return `<form class="field-row" data-form="bob-query">
                <input class="input mono" name="q" value="${esc(DD.ai.cleanQuery(t.text))}" aria-label="GitHub search query" data-focus="bob-query" spellcheck="false">
                <button class="btn btn--primary" type="submit">Search GitHub</button>
              </form>`;
    return `<div class="bob__answer">${DD.ai.markdown(t.text)}</div>`;
  }

  function renderBob() {
    const el = $("#ai");
    if (!bob.spec) return;
    const { spec, turns, loading, error } = bob;
    const firstBob = turns.find((t) => t.role === "bob");
    const lastBob = turns.findLast((t) => t.role === "bob");
    const todos = lastBob && !loading ? DD.ai.checklist(lastBob.text) : [];
    const thread = turns.map((t) => (t.role === "user" ? `<p class="bob__q">${esc(t.text)}</p>` : bobAnswer(t, t === firstBob))).join("");

    const fix =
      error?.code === "nokey" || error?.code === "missing"
        ? `<button class="btn btn--primary btn--sm" data-action="settings" data-section="bob">Bob settings</button>`
        : "";
    const failure = error
      ? `<div class="notice ${error.code === "cancelled" ? "" : "notice--error"}" role="alert">${icon("alert", 16)}<div class="notice__body">
           <p class="notice__title">${error.code === "missing" ? "Bob helper not found" : error.code === "nokey" ? "No Bob API key" : error.code === "cancelled" ? "Stopped" : "Bob couldn't answer"}</p>
           <p class="notice__text">${esc(error.message)}</p>
           <div class="notice__actions">${fix}<button class="btn btn--sm" data-action="bob-retry">Try again</button></div>
         </div></div>`
      : "";
    const waiting = loading
      ? `<div class="bob__loading" role="status"><span class="bob__spinner" aria-hidden="true"></span><span>${esc(loading.stage)}</span><span class="bob__elapsed mono" data-since="${loading.since}">${Math.round((Date.now() - loading.since) / 1000)}s</span><button class="btn btn--ghost btn--sm" data-action="bob-cancel">Cancel</button></div>`
      : "";
    const meta = firstBob ? `<span class="bob__meta">${firstBob.cached ? "Saved answer" : "Answered"} <span data-ago="${esc(firstBob.at)}">${agoText(firstBob.at)}</span></span>` : "";
    const tools = lastBob
      ? `<div class="bob__tools">
           <button class="btn btn--ghost btn--sm" data-action="bob-copy">${icon("copy", 14)}Copy</button>
           ${todos.length ? `<button class="btn btn--ghost btn--sm" data-action="bob-todos">${icon("plus", 14)}Add ${plural(todos.length, "to-do")}</button>` : ""}
           <button class="btn btn--ghost btn--sm" data-action="bob-regenerate" ${loading ? "disabled" : ""}>${icon("refresh", 14)}Regenerate</button>
           ${meta}
         </div>`
      : "";
    const follow = lastBob
      ? `<form class="bob__follow" data-form="bob-follow">
           <input class="input" name="q" placeholder="Ask a follow-up" autocomplete="off" aria-label="Follow-up question" data-focus="bob-follow" ${loading ? "disabled" : ""}>
           <button class="icon-btn" type="submit" aria-label="Send" ${loading ? "disabled" : ""}>${icon("send", 16)}</button>
         </form>`
      : "";

    keepFocus(el, () => {
      el.innerHTML = `
        <header class="sheet__head bob__head">
          <span class="chip-icon tone-info">${icon("sparkle", 16)}</span>
          <div class="bob__title">
            <h2>${esc(spec.title)}</h2>
            ${spec.subtitle ? (spec.url ? `<a class="bob__subtitle" href="${esc(spec.url)}" target="_blank" rel="noopener">${esc(spec.subtitle)}</a>` : `<p class="bob__subtitle">${esc(spec.subtitle)}</p>`) : ""}
          </div>
          <button class="icon-btn" data-action="bob-close" aria-label="Close">${icon("x", 18)}</button>
        </header>
        <div class="sheet__body bob__body">${thread}${waiting}${failure}</div>
        ${tools || follow ? `<footer class="bob__foot">${tools}${follow}</footer>` : ""}`;
    });
    const body = $(".bob__body", el);
    if (loading || bob.turns.at(-1)?.role === "user") body.scrollTop = body.scrollHeight;
    else if (bob.turns.length > 1) $$(".bob__q", body).at(-1)?.scrollIntoView({ block: "start" });

    clearInterval(bob.timer);
    if (loading)
      bob.timer = setInterval(() => {
        const t = $(".bob__elapsed", el);
        if (t) t.textContent = `${Math.round((Date.now() - +t.dataset.since) / 1000)}s`;
      }, 1000);
  }

  function closeBob() {
    bob.controller?.abort();
    clearInterval(bob.timer);
    bob.spec = null;
    if ($("#ai").open) $("#ai").close();
  }

  function bobItem(key) {
    const target = aiTargets.get(key);
    if (!target) return;
    const mode = DD.ai.modeFor(target.item || {}, target.kind);
    const subject = target.item || target.task;
    const ref = target.item ? `${DD.util.repoShort(subject.repo)}#${subject.number}` : target.task.ref;
    openBob({ title: DD.ai.MODES[mode].label, subtitle: `${ref} · ${subject.title}`, url: subject.url, build: () => DD.ai.itemPrompt(bobContext(), target) });
  }

  function bobAsk(q) {
    openBob({ title: "Ask Bob", subtitle: q, build: async () => ({ prompt: DD.ai.askPrompt(bobContext(), q) }) });
  }

  function bobFind(q) {
    openBob({ title: "Find on GitHub", subtitle: q, format: "query", build: async () => ({ prompt: DD.ai.searchQueryPrompt(bobContext(), q) }) });
  }

  function bobPlan() {
    openBob({ title: "Plan my day", subtitle: new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }), build: async () => ({ prompt: DD.ai.planPrompt(bobContext()), cacheKey: `plan:${DD.util.todayKey()}` }) });
  }

  function bobStandup() {
    openBob({ title: "Standup update", subtitle: "Edit it, then copy it into Slack", format: "edit", build: async () => ({ prompt: DD.ai.standupPrompt(bobContext()), cacheKey: `standup:${DD.util.todayKey()}` }) });
  }

  function bobCatchUp() {
    const all = activity();
    const since = state.lastSeenAt ? Date.parse(state.lastSeenAt) : 0;
    let entries = all.filter((a) => Date.parse(a.createdAt) > since);
    if (entries.length < 3) entries = all.filter((a) => Date.now() - Date.parse(a.createdAt) < 86400000);
    if (entries.length < 3) entries = all.slice(0, 30);
    if ($("#activity").matches(":popover-open")) $("#activity").hidePopover();
    openBob({ title: "Catch me up", subtitle: plural(entries.length, "update"), build: async () => ({ prompt: DD.ai.catchUpPrompt(bobContext(), entries) }) });
  }

  function bobTriage() {
    const d = data();
    openBob({ title: "Triage", subtitle: `${plural(Math.min(12, d.triage.items.length), "issue")} waiting for triage`, build: async () => ({ prompt: await DD.ai.triagePrompt(bobContext()), cacheKey: `triage:${DD.util.todayKey()}` }) });
  }

  async function bobCopy() {
    const last = bob.turns.findLast((t) => t.role === "bob");
    const edited = bob.spec?.format === "edit" && last === bob.turns.find((t) => t.role === "bob") ? $(".bob__edit", $("#ai"))?.value : null;
    try {
      await navigator.clipboard.writeText(edited ?? last?.text ?? "");
      toast("Copied", "success");
    } catch {
      toast("Couldn't copy to the clipboard", "error");
    }
  }

  async function bobTodos() {
    const items = DD.ai.checklist(bob.turns.findLast((t) => t.role === "bob")?.text).map((text) => ({ id: DD.util.uid(), text, done: false }));
    if (!items.length) return;
    state.day.todos.push(...items);
    renderToday();
    await DD.day.update((d) => d.todos.push(...items));
    toast(`Added ${plural(items.length, "to-do")}`, "success");
  }

  // ---------- actions ----------

  function toast(text, tone = "neutral") {
    const host = $("#toasts");
    const el = document.createElement("div");
    el.className = `toast toast--${tone}`;
    el.setAttribute("role", tone === "error" ? "alert" : "status");
    el.textContent = text;
    host.append(el);
    while (host.children.length > 3) host.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add("is-leaving");
      setTimeout(() => el.remove(), 200);
    }, 3200);
  }

  async function requestSync(manual = false) {
    if (state.settings.demo) {
      state.demo = null;
      renderAll();
      if (manual) toast("Sample data refreshed");
      return;
    }
    if (!state.settings.token) return;
    state.status = { ...state.status, syncing: true };
    renderTools();
    let result;
    try {
      result = ext ? await chrome.runtime.sendMessage({ type: "sync" }) : await DD.sync.run();
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    const { status } = await DD.storage.get("status");
    state.status = status || {};
    renderTools();
    if (!manual) return;
    if (result?.ok) toast("Synced with GitHub");
    else if (result?.skipped) toast("A sync is already running");
    else toast("Sync failed", "error");
  }

  function maybeSync() {
    if (!state.settings.token || state.settings.demo) return;
    const last = state.status.at ? Date.parse(state.status.at) : 0;
    if (Date.now() - last > 60000) requestSync();
  }

  async function connect(token, form) {
    token = token.trim();
    if (!token) return;
    const btn = form?.querySelector("[type=submit]");
    if (btn) btn.disabled = true;
    try {
      const viewer = await DD.github.fetchViewer(token);
      await DD.storage.remove(["cache", "snapshot", "status", "activity", "activitySeenAt", "activityClearedAt"]);
      Object.assign(state, { cache: null, status: {}, activity: [], seenAt: null, clearedAt: null, demo: null });
      state.settings = await DD.settings.save({ token, login: viewer.login, tokenScopes: viewer.scopes, demo: false });
      toast(`Connected as ${viewer.login}`, "success");
      if ($("#settings").open) $("#settings").close();
      renderAll();
      requestSync();
    } catch (err) {
      toast(`Couldn't connect: ${err.message}`, "error");
      if (btn) btn.disabled = false;
    }
  }

  async function setDemo(on) {
    state.demo = null;
    state.settings = await DD.settings.save({ demo: on });
    renderAll();
    if ($("#settings").open) renderSettings();
    if (!on) maybeSync();
  }

  async function copyStandup() {
    const d = data();
    if (!d) return;
    try {
      await navigator.clipboard.writeText(ins.standup(d));
      toast("Standup update copied", "success");
    } catch {
      toast("Couldn't copy to the clipboard", "error");
    }
  }

  async function snooze(key) {
    state.day.snoozed[key] = true;
    renderAll();
    await DD.day.update((d) => (d.snoozed[key] = true));
  }

  async function unsnooze() {
    state.day.snoozed = {};
    renderAll();
    await DD.day.update((d) => (d.snoozed = {}));
  }

  function applyTheme() {
    const t = state.settings.theme;
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("devdash-theme", t);
    } catch {}
  }

  async function setTheme(theme) {
    state.settings = await DD.settings.save({ theme });
    applyTheme();
    if ($("#settings").open) renderSettings();
  }

  function toggleTheme() {
    const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    setTheme(dark ? "light" : "dark");
  }

  /** Changing what's tracked invalidates the diff baseline, so the next sync doesn't announce everything as new. */
  async function resetBaseline() {
    await DD.storage.remove("snapshot");
    requestSync();
  }

  async function sendTestNotification() {
    if (ext) {
      const res = await chrome.runtime.sendMessage({ type: "test-notification" }).catch((err) => ({ ok: false, error: err.message }));
      toast(res?.ok ? "Test notification sent" : "Chrome blocked the notification — check your OS notification settings for Chrome", res?.ok ? "success" : "error");
      return;
    }
    if (!("Notification" in window)) return toast("This browser doesn't support notifications", "error");
    const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (perm !== "granted") return toast("The browser blocked notifications", "error");
    new Notification("Notifications are working", { body: "Reviews, CI failures and mentions will show up like this.", icon: "icons/icon-128.png" });
  }

  const actions = {
    sync: () => requestSync(true),
    activity: () => $("#activity").togglePopover(),
    "close-activity": () => $("#activity").hidePopover(),
    "clear-activity": async () => {
      state.clearedAt = new Date().toISOString();
      renderActivity();
      renderTools();
      await DD.storage.set({ activityClearedAt: state.clearedAt });
    },
    settings: (el) => {
      $("#activity").matches(":popover-open") && $("#activity").hidePopover();
      if ($("#ai").open) closeBob();
      openSettings(el.dataset.section);
    },
    "close-settings": () => $("#settings").close(),
    snooze: (el) => snooze(el.dataset.key),
    unsnooze,
    "demo-on": () => setDemo(true),
    "demo-off": () => setDemo(false),
    "copy-standup": copyStandup,
    "todo-remove": async (el) => {
      state.day.todos = state.day.todos.filter((t) => t.id !== el.dataset.id);
      renderToday();
      $('[data-focus="todo-input"]')?.focus();
      await DD.day.update((d) => (d.todos = d.todos.filter((t) => t.id !== el.dataset.id)));
    },
    "open-version": (el) => {
      const group = el.closest("[data-versioned]");
      const version = group.querySelector("input").value.trim().replace(/^v/i, "");
      if (!version) return go(group.querySelector("a").href);
      go(group.dataset.versioned.replace("<v>", encodeURIComponent(version)));
    },
    theme: (el) => setTheme(el.dataset.theme),
    "test-notification": sendTestNotification,
    "ai-item": (el) => bobItem(el.dataset.key),
    "ai-plan": bobPlan,
    "ai-standup": bobStandup,
    "ai-catchup": bobCatchUp,
    "ai-triage": bobTriage,
    "bob-close": closeBob,
    "bob-cancel": () => bob.controller?.abort(),
    "bob-retry": () => {
      const last = bob.turns.at(-1);
      if (last?.role !== "user") return openBob(bob.spec, { fresh: true });
      bob.turns.pop();
      runBob(last.text);
    },
    "bob-regenerate": () => openBob(bob.spec, { fresh: true }),
    "bob-copy": bobCopy,
    "bob-todos": bobTodos,
    "bob-check": refreshBobStatus,
    "bob-test": () => {
      $("#settings").close();
      openBob({ title: "Test prompt", subtitle: "Checks that Bob Shell can answer", build: async () => ({ prompt: "Reply with one short sentence confirming you can read this, and name the model you are if you know it." }) });
    },
    "bob-key-remove": async (el) => {
      if (!confirmed(el, "Click again to remove")) return;
      state.settings = await DD.settings.save({ bobKey: "" });
      renderSettings();
    },
    disconnect: async (el) => {
      if (!confirmed(el, "Click again to disconnect")) return;
      await DD.storage.remove(["cache", "snapshot", "status", "activity"]);
      Object.assign(state, { cache: null, status: {}, activity: [] });
      state.settings = await DD.settings.save({ token: "", login: "", tokenScopes: undefined });
      renderAll();
      renderSettings();
    },
    reset: async (el) => {
      if (!confirmed(el, "Click again to erase everything")) return;
      await DD.storage.clear();
      ["devdash-theme", UI_KEY].forEach((k) => {
        try {
          localStorage.removeItem(k);
        } catch {}
      });
      location.reload();
    },
    "meeting-add": async () => {
      const meetings = [...state.settings.meetings, { id: DD.util.uid(), title: "New meeting", time: "15:00", minutes: 30, days: [1, 2, 3, 4, 5] }];
      state.settings = await DD.settings.save({ meetings });
      renderSettings();
      renderToday();
      const titles = $$('[data-meeting="title"]', $("#settings"));
      titles.at(-1)?.select();
    },
    "meeting-remove": async (el) => {
      const id = el.closest("[data-id]").dataset.id;
      state.settings = await DD.settings.save({ meetings: state.settings.meetings.filter((m) => m.id !== id) });
      renderSettings();
      renderToday();
    },
  };

  async function onSettingsChange(el) {
    const s = state.settings;
    if (el.dataset.repoToggle) {
      const disabled = new Set(s.disabledRepos);
      el.checked ? disabled.delete(el.dataset.repoToggle) : disabled.add(el.dataset.repoToggle);
      state.settings = await DD.settings.save({ disabledRepos: [...disabled] });
      renderAll();
      return resetBaseline();
    }
    if (el.dataset.notify) {
      state.settings = await DD.settings.save({ notifyOn: { ...s.notifyOn, [el.dataset.notify]: el.checked } });
      return;
    }
    if (el.dataset.meeting) {
      const id = el.closest("[data-id]").dataset.id;
      const field = el.dataset.meeting;
      const value = field === "minutes" ? Math.max(5, Number(el.value) || 15) : el.value;
      state.settings = await DD.settings.save({ meetings: s.meetings.map((m) => (m.id === id ? { ...m, [field]: value } : m)) });
      return renderToday();
    }
    const key = el.dataset.setting;
    if (!key) return;
    const value = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? Number(el.value) : el.value;
    if (key === "demo") return setDemo(value);
    if (key === "notifications" && value && !ext && "Notification" in window && Notification.permission !== "granted") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        el.checked = false;
        return toast("The browser blocked notifications", "error");
      }
    }
    state.settings = await DD.settings.save({ [key]: value });
    if (key === "notifications") renderSettings();
    if (key === "includeTeamReviews") resetBaseline();
    if (key === "staleReviewDays") renderAll();
    if (key === "ai") {
      renderAll();
      renderSettings();
      refreshBobStatus();
    }
  }

  // ---------- events ----------

  function selectTab(id, focus = false) {
    ui.tab = id;
    saveUi();
    renderWork();
    if (focus) $(`#tab-${id}`)?.focus();
  }

  function bind() {
    document.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-tab]");
      if (tab) return selectTab(tab.dataset.tab);
      const el = e.target.closest("[data-action]");
      if (!el || el.tagName === "INPUT") return;
      const fn = actions[el.dataset.action];
      if (!fn) return;
      e.preventDefault();
      fn(el);
    });

    document.addEventListener("submit", (e) => {
      const form = e.target.closest("[data-form]");
      if (!form) return;
      e.preventDefault();
      if (form.dataset.form === "connect") connect(new FormData(form).get("token") || "", form);
      if (form.dataset.form === "bob-key") {
        const key = String(new FormData(form).get("key") || "").trim();
        if (!key) return;
        DD.settings.save({ bobKey: key }).then((s) => {
          state.settings = s;
          toast("Bob API key saved", "success");
          renderSettings();
          refreshBobStatus();
        });
      }
      if (form.dataset.form === "bob-follow") {
        const q = String(new FormData(form).get("q") || "").trim();
        if (q && !bob.loading) runBob(q);
      }
      if (form.dataset.form === "bob-query") {
        const q = String(new FormData(form).get("q") || "").trim();
        if (q) go(searchUrl(q));
      }
      if (form.dataset.form === "todo") {
        const input = form.querySelector("input");
        const text = input.value.trim();
        if (!text) return;
        const todo = { id: DD.util.uid(), text, done: false };
        state.day.todos.push(todo);
        input.value = "";
        renderToday();
        $('[data-focus="todo-input"]')?.focus();
        DD.day.update((d) => d.todos.push(todo));
      }
    });

    document.addEventListener("change", (e) => {
      const el = e.target;
      if (el.dataset.action === "todo-toggle") {
        const id = el.dataset.id;
        const t = state.day.todos.find((x) => x.id === id);
        if (t) t.done = el.checked;
        renderToday();
        DD.day.update((d) => {
          const x = d.todos.find((y) => y.id === id);
          if (x) x.done = el.checked;
        });
        return;
      }
      if (el.closest("#settings")) onSettingsChange(el);
    });

    $("#repo-menus").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.dataset.actionEnter) {
        e.preventDefault();
        actions[e.target.dataset.actionEnter](e.target);
      }
    });

    $("#repo-menus").addEventListener(
      "toggle",
      (e) => {
        if (e.newState !== "open") return;
        if (!CSS.supports("anchor-name: --a")) placeMenu(e.target);
        e.target.querySelector("a")?.focus({ preventScroll: true });
      },
      true
    );

    $("#work").addEventListener("keydown", (e) => {
      if (!e.target.matches("[role=tab]")) return;
      const tabs = $$("[role=tab]", $("#work"));
      const i = tabs.indexOf(e.target);
      let next = null;
      if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
      if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
      if (e.key === "Home") next = tabs[0];
      if (e.key === "End") next = tabs.at(-1);
      if (!next) return;
      e.preventDefault();
      selectTab(next.dataset.tab, true);
    });

    document.addEventListener("keydown", (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        return search.focus();
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || $("#settings").open || $("#ai").open) return;
      if (e.key === "/") {
        e.preventDefault();
        search.focus();
      } else if (e.key === "r" || e.key === "R") requestSync(true);
      else if (e.key === "a" || e.key === "A") actions.activity();
      else if (/^[1-4]$/.test(e.key) && connected()) selectTab(["focus", "reviews", "prs", "issues"][+e.key - 1], true);
    });

    $("#settings").addEventListener("click", (e) => {
      if (e.target === $("#settings")) $("#settings").close();
    });

    $("#ai").addEventListener("click", (e) => {
      if (e.target === $("#ai")) closeBob();
    });
    // Escape closes the dialog natively; stop Bob too. The event is async, so skip it if Bob was reopened meanwhile.
    $("#ai").addEventListener("close", () => !$("#ai").open && closeBob());

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      tick();
      maybeSync();
    });

    // Scroll events don't bubble, so listen in the capture phase for the work list.
    document.addEventListener("scroll", (e) => e.target.classList?.contains("work__panel") && updateFades(e.target), true);
    addEventListener("resize", () => updateFades($(".work__panel")));

    bindActivity();
    DD.storage.onChange(onStorage);
  }

  /** Another tab or the background worker changed something. */
  async function onStorage(changes) {
    if ("settings" in changes) {
      const before = state.settings;
      state.settings = DD.settings.normalize(changes.settings);
      if (before.theme !== state.settings.theme) applyTheme();
      if (before.demo !== state.settings.demo) state.demo = null;
    }
    if ("cache" in changes) state.cache = changes.cache || null;
    if ("status" in changes) state.status = changes.status || {};
    if ("activity" in changes) state.activity = changes.activity || [];
    if ("activitySeenAt" in changes) state.seenAt = changes.activitySeenAt || null;
    if ("activityClearedAt" in changes) state.clearedAt = changes.activityClearedAt || null;
    if (dayKey in changes) state.day = { todos: [], snoozed: {}, ...changes[DD.day.key()] };
    scheduleRender();
    if ($("#activity").matches(":popover-open") && "activity" in changes) renderActivity();
    if ($("#settings").open && "settings" in changes && !$("#settings").contains(document.activeElement)) renderSettings();
  }

  let frame = 0;
  function scheduleRender() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(renderAll);
  }

  function renderAll() {
    renderMasthead();
    renderTools();
    renderRepos();
    renderWork();
    renderToday();
  }

  /** Once a minute: clock, relative times and meeting states, without rebuilding the work list. */
  let lastMinute = -1;
  let dayKey = DD.day.key();
  function tick() {
    const now = new Date();
    if (now.getMinutes() === lastMinute) return;
    lastMinute = now.getMinutes();
    if (DD.day.key(now) !== dayKey) {
      dayKey = DD.day.key(now);
      DD.day.load(now).then((day) => {
        state.day = day;
        renderAll();
      });
    }
    renderMasthead();
    $$("[data-at]").forEach((el) => (el.textContent = timeAgo(el.dataset.at)));
    $$("[data-ago]").forEach((el) => (el.textContent = agoText(el.dataset.ago)));
    if (!$("#today").contains(document.activeElement)) renderToday();
  }

  async function load() {
    const stored = await DD.storage.get(["settings", "cache", "status", "activity", "activitySeenAt", "activityClearedAt"]);
    state.settings = DD.settings.normalize(stored.settings);
    state.cache = stored.cache || null;
    state.status = stored.status || {};
    state.activity = stored.activity || [];
    state.seenAt = stored.activitySeenAt || null;
    state.clearedAt = stored.activityClearedAt || null;
    state.day = await DD.day.load();
  }

  async function init() {
    $$("[data-icon]").forEach((el) => (el.innerHTML = icon(el.dataset.icon, 18)));
    await load();
    applyTheme();
    bind();
    search.bind();
    renderAll();
    document.body.classList.add("is-ready");
    setInterval(tick, 10000);
    lastMinute = new Date().getMinutes();

    if (!ext) {
      DD.sync.setNotifier(async (events) => {
        if (document.visibilityState === "visible") return events.slice(0, 3).forEach((e) => toast(e.title));
        if ("Notification" in window && Notification.permission === "granted") events.forEach((e) => new Notification(e.title, { body: e.body || "", tag: e.key }));
      });
      setInterval(() => DD.sync.tick(), 60000);
    }
    maybeSync();
  }

  init();
})();
