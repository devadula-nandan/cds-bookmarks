DD.views = (() => {
  const { esc, timeAgo, repoShort, hexToRgba, ageDays } = DD.util;
  const { icon } = DD.icons;
  const ins = DD.insights;

  /** Per-session UI state for list views (filters, tabs). */
  const ui = { repo: "all", q: "", sort: "updated", issuesTab: "assigned", laneAll: {}, open: {} };

  const target = () => (DD.store.settings.openInNewTab ? ' target="_blank" rel="noopener"' : "");
  const connected = () => !!(DD.store.settings.token || DD.store.settings.demo);
  const scoped = () => DD.scope.data(DD.state.data);
  const scopedInbox = () => DD.scope.inbox(DD.state.inbox);
  const scopeRepos = () => (DD.scope.current() ? [DD.scope.current()] : DD.repos.enabled());

  // ---------- small building blocks ----------

  function repoChip(slug) {
    const repo = DD.repos.bySlug(slug);
    return `<span class="chip chip--${repo?.accent || "gray"}">${esc(repo?.name ? shortName(repo) : repoShort(slug))}</span>`;
  }

  function shortName(repo) {
    return { cds: "Carbon", c4ip: "IBM Products", c4ai: "AI Chat", labs: "Labs", charts: "Charts" }[repo.id] || repo.name;
  }

  function label(l) {
    return `<span class="label" style="background:${hexToRgba(l.color, 0.18)};border-color:${hexToRgba(l.color, 0.55)}">${esc(l.name)}</span>`;
  }

  /** Initials sit underneath the photo, so a missing or broken avatar still looks intentional. */
  function avatar(item, size = 32) {
    const login = item.author || "?";
    const hue = [...login].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    const img = item.avatar ? `<img src="${esc(item.avatar)}" alt="" loading="lazy" onerror="this.remove()">` : "";
    return `<span class="avatar avatar--initials" style="width:${size}px;height:${size}px;--hue:${hue}" title="${esc(login)}">${esc(login.slice(0, 2))}${img}</span>`;
  }

  const CI = {
    SUCCESS: ["success", "check", "CI passing"],
    FAILURE: ["error", "x", "CI failing"],
    ERROR: ["error", "x", "CI error"],
    PENDING: ["warning", "clock", "CI running"],
    EXPECTED: ["warning", "clock", "CI expected"],
  };

  function prPills(pr) {
    const pills = [];
    if (pr.draft) pills.push(`<span class="pill pill--gray">Draft</span>`);
    if (pr.ci && CI[pr.ci]) {
      const [tone, ic, text] = CI[pr.ci];
      pills.push(`<span class="pill pill--${tone}" title="${text}">${icon(ic, 12)}${text}</span>`);
    }
    if (pr.reviewDecision === "APPROVED") pills.push(`<span class="pill pill--success">${icon("check", 12)}Approved</span>`);
    if (pr.reviewDecision === "CHANGES_REQUESTED") pills.push(`<span class="pill pill--warning">${icon("message", 12)}Changes requested</span>`);
    if (ins.hasConflict(pr)) pills.push(`<span class="pill pill--error">${icon("alert", 12)}Conflict</span>`);
    return pills.join("");
  }

  function size(pr) {
    if (pr.additions == null) return "";
    const total = pr.additions + pr.deletions;
    const tshirt = total < 50 ? "XS" : total < 200 ? "S" : total < 500 ? "M" : total < 1000 ? "L" : "XL";
    return `<span class="size" title="${total} lines changed"><span class="size__t">${tshirt}</span><span class="add">+${pr.additions}</span><span class="del">−${pr.deletions}</span></span>`;
  }

  function rowTone(item) {
    if (item.kind !== "pr") return "";
    const state = ins.prState(item);
    if (state === "conflict" || state === "ciFailed") return "row--alert";
    if (state === "changes" || state === "ciRunning") return "row--warn";
    if (state === "ready") return "row--ok";
    return "";
  }

  function row(item, i = 0) {
    const isPR = item.kind === "pr";
    const tone = rowTone(item);
    return `
      <li class="row${tone ? ` ${tone}` : ""}" style="--i:${Math.min(i, 16)}">
        ${avatar(item)}
        <div class="row__main">
          <a class="row__title" href="${esc(item.url)}"${target()}>${esc(item.title)}</a>
          <div class="row__meta">
            ${repoChip(item.repo)}
            <span class="mono">#${item.number}</span>
            <span>by ${esc(item.author)}</span>
            <span title="${esc(new Date(item.createdAt).toLocaleString())}">opened ${timeAgo(item.createdAt)}</span>
            <span>updated ${timeAgo(item.updatedAt)}</span>
            ${item.comments ? `<span class="row__comments">${icon("message", 12)}${item.comments}</span>` : ""}
          </div>
          ${item.labels.length ? `<div class="row__labels">${item.labels.map(label).join("")}</div>` : ""}
        </div>
        <div class="row__status">
          ${isPR ? prPills(item) : `<span class="pill pill--gray">${icon("issue", 12)}Issue</span>`}
          ${isPR ? size(item) : ""}
        </div>
      </li>`;
  }

  function empty(iconName, text, sub = "") {
    return `<div class="empty">${icon(iconName, 32)}<p>${text}</p>${sub ? `<p class="muted">${sub}</p>` : ""}</div>`;
  }

  function skeleton(lines = 4) {
    return `<ul class="list">${Array.from({ length: lines }, () => `<li class="row row--skeleton"><span class="sk sk--avatar"></span><div class="row__main"><span class="sk sk--line"></span><span class="sk sk--line sk--short"></span></div></li>`).join("")}</ul>`;
  }

  const CLASSIC_TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,notifications,read:org&description=Dev%20Dashboard";

  function syncHints(text, sso) {
    const hints = [];
    if (sso || /SAML|SSO/i.test(text))
      hints.push(`The organization requires SSO. On <a href="https://github.com/settings/tokens" target="_blank" rel="noopener">your tokens page</a>, choose <b>Configure SSO</b> next to this token and authorize <b>carbon-design-system</b>.`);
    if (/personal access token|fine-grained|not accessible/i.test(text) || DD.store.settings.tokenScopes === null)
      hints.push(`Fine-grained tokens can be blocked by organization policy. A <a href="${CLASSIC_TOKEN_URL}" target="_blank" rel="noopener">classic token</a> with <code>repo</code>, <code>notifications</code> and <code>read:org</code> is the most reliable.`);
    if (/401|rejected/i.test(text)) hints.push(`Create a new <a href="${CLASSIC_TOKEN_URL}" target="_blank" rel="noopener">classic token</a> on github.com (not github.ibm.com) and paste it in Settings.`);
    if (/reach api\.github\.com/i.test(text)) hints.push("On a corporate network or VPN, a proxy may be blocking api.github.com.");
    return hints;
  }

  /** Prominent sync problem panel; the header status alone is easy to miss. */
  function syncAlert() {
    const s = DD.store.settings;
    if (!s.token || s.demo) return "";
    const { error, errorSso, data } = DD.state;
    const warnings = error ? [] : data?.warnings || [];
    if (!error && !warnings.length) return "";
    const sso = errorSso || data?.sso;
    const messages = error ? [error] : warnings;
    const hints = syncHints(messages.join(" "), sso);
    return `
      <div class="alert alert--${error ? "error" : "warning"}" role="alert">
        <span class="alert__icon">${icon("alert", 20)}</span>
        <div class="alert__body">
          <p class="alert__title">${error ? "Couldn't load your work from GitHub" : `Part of your data couldn't be loaded${data?.failed?.length ? ` (${data.failed.join(", ")})` : ""}`}</p>
          <ul class="alert__messages">${messages.slice(0, 3).map((m) => `<li><code>${esc(m)}</code></li>`).join("")}</ul>
          ${hints.length ? `<ul class="alert__hints">${hints.map((h) => `<li>${h}</li>`).join("")}</ul>` : ""}
          <div class="alert__actions">
            ${sso ? `<a class="btn btn--primary btn--sm" href="${esc(sso)}" target="_blank" rel="noopener">Authorize token for SSO</a>` : ""}
            <button class="btn btn--tertiary btn--sm" data-action="sync">Retry</button>
            <a class="btn btn--ghost btn--sm" href="#/settings">Token settings</a>
          </div>
        </div>
      </div>`;
  }

  /** Loading placeholder, or an error state when the first sync failed. */
  function pending(lines) {
    if (DD.state.error && !DD.state.data) return empty("alert", "Nothing to show yet.", "The last sync failed — see the message above.");
    return skeleton(lines);
  }

  function pageHeader(title, subtitle, actions = "") {
    return `<header class="page-header"><div><h1>${title}</h1>${subtitle ? `<p class="muted">${subtitle}</p>` : ""}</div><div class="page-header__actions">${actions}</div></header>`;
  }

  // ---------- list filtering ----------

  function filterBar(items) {
    const counts = {};
    items.forEach((i) => (counts[i.repo] = (counts[i.repo] || 0) + 1));
    const repos = DD.repos.enabled();
    return `
      <div class="filterbar">
        <div class="segmented" role="group" aria-label="Filter by repository">
          <button class="seg ${ui.repo === "all" ? "seg--active" : ""}" data-action="filter-repo" data-repo="all">All <span class="count">${items.length}</span></button>
          ${repos.map((r) => `<button class="seg ${ui.repo === r.slug ? "seg--active" : ""}" data-action="filter-repo" data-repo="${esc(r.slug)}">${esc(shortName(r))} <span class="count">${counts[r.slug] || 0}</span></button>`).join("")}
        </div>
        <div class="filterbar__right">
          <label class="search-field">${icon("search", 16)}<input type="search" placeholder="Filter by title, author, label…" value="${esc(ui.q)}" data-action="filter-q" aria-label="Filter"></label>
          <select class="select" data-action="sort" aria-label="Sort">
            ${[["updated", "Recently updated"], ["oldest", "Oldest first"], ["newest", "Newest first"], ["size", "Smallest first"]].map(([v, t]) => `<option value="${v}" ${ui.sort === v ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </div>
      </div>`;
  }

  function applyFilters(items) {
    const q = ui.q.trim().toLowerCase();
    let out = items.filter((i) => ui.repo === "all" || i.repo === ui.repo);
    if (q) out = out.filter((i) => [i.title, i.author, `#${i.number}`, ...i.labels.map((l) => l.name)].join(" ").toLowerCase().includes(q));
    const by = {
      updated: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
      oldest: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
      newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      size: (a, b) => (a.additions ?? 0) + (a.deletions ?? 0) - ((b.additions ?? 0) + (b.deletions ?? 0)),
    };
    return [...out].sort(by[ui.sort]);
  }

  function listSection(items, emptyState) {
    if (!DD.state.data) return pending();
    const filtered = applyFilters(items);
    return `${filterBar(items)}${filtered.length ? `<ul class="list">${filtered.map(row).join("")}</ul>` : emptyState}`;
  }

  // ---------- home ----------

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const PRIO = ins.PRIORITY;

  function ciTone(main) {
    if (!main) return "gray";
    if (["FAILURE", "ERROR"].includes(main.state)) return "error";
    return main.state === "SUCCESS" ? "success" : "warning";
  }

  function repoName(slug) {
    const repo = DD.repos.bySlug(slug);
    return repo ? shortName(repo) : repoShort(slug);
  }

  function todaysMeetings(now = new Date()) {
    return DD.store.settings.meetings
      .filter((m) => !m.days?.length || m.days.includes(now.getDay()))
      .map((m) => {
        const start = DD.util.parseTime(m.time, now);
        return { ...m, start, end: new Date(start.getTime() + (m.minutes || 15) * 60000) };
      })
      .sort((a, b) => a.start - b.start);
  }

  function untilText(ms) {
    const mins = Math.max(0, Math.round(ms / 60000));
    return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  }

  function dayTimeline() {
    const s = DD.store.settings;
    const now = new Date();
    const start = DD.util.parseTime(s.workStart);
    const end = DD.util.parseTime(s.workEnd);
    const span = end - start;
    const pct = Math.max(0, Math.min(100, ((now - start) / span) * 100));
    const weekend = now.getDay() === 0 || now.getDay() === 6;
    const meetings = weekend ? [] : todaysMeetings(now);

    let status;
    let tone = "open";
    if (weekend) {
      status = "Weekend — enjoy it";
      tone = "weekend";
    } else if (now < start) {
      status = `Day starts in ${untilText(start - now)}`;
      tone = "wait";
    } else if (now > end) {
      status = "Workday done — time to log off";
      tone = "done";
    } else status = `${untilText(end - now)} left today`;

    const live = meetings.find((m) => now >= m.start && now < m.end);
    const next = meetings.find((m) => m.start > now);
    if (live) tone = "live";
    const upcoming = live
      ? `<span class="pill pill--error">Now</span> ${esc(live.title)} until ${esc(DD.util.fmtTime(live.end))}`
      : next
        ? `Next: <b>${esc(next.title)}</b> in ${untilText(next.start - now)}`
        : weekend
          ? ""
          : "No more meetings today";

    const markers = meetings
      .map((m) => {
        const p = ((m.start - start) / span) * 100;
        if (p < 0 || p > 100) return "";
        const w = Math.max(0.8, ((m.end - m.start) / span) * 100);
        return `<span class="daybar__meeting ${m.end < now ? "is-past" : ""}" style="left:${p}%;width:${w}%" title="${esc(m.time)} · ${esc(m.title)}"></span>`;
      })
      .join("");

    return `
      <div class="daybar daybar--${tone}" aria-label="Workday progress">
        <div class="daybar__head">
          <span class="daybar__status">${icon("clock", 14)} ${status}</span>
          <a class="daybar__next" href="#/settings/schedule">${upcoming}</a>
        </div>
        <div class="daybar__track">
          <span class="daybar__fill" style="width:${weekend ? 0 : pct}%"></span>
          ${markers}
          ${!weekend && pct > 0 && pct < 100 ? `<span class="daybar__now" style="left:${pct}%"></span>` : ""}
        </div>
        <div class="daybar__scale"><span>${esc(s.workStart)}</span><span>${esc(s.workEnd)}</span></div>
      </div>`;
  }

  function heroSummary(stats) {
    if (!connected()) return "Connect GitHub to turn this into your live developer cockpit.";
    if (!stats) return DD.state.error ? "Couldn't sync with GitHub yet." : "Syncing your repositories…";
    const bits = [];
    if (stats.reviews) bits.push(`<b>${plural(stats.reviews, "review")}</b> waiting on you`);
    if (stats.blocked) bits.push(`<b class="t-warning">${plural(stats.blocked, "blocked PR")}</b>`);
    if (stats.ready) bits.push(`<b class="t-success">${stats.ready} ready to merge</b>`);
    if (stats.mentions) bits.push(plural(stats.mentions, "mention"));
    if (!bits.length) return "Nothing urgent. A great day for deep work.";
    return `You have ${bits.join(", ").replace(/, ([^,]*)$/, " and $1")}.`;
  }

  function brief(st) {
    const s = DD.store.settings;
    const name = (scoped()?.viewer?.name || s.login || "").split(" ")[0];
    const date = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    return `
      <section class="brief">
        <div class="brief__hello">
          <p class="eyebrow">${esc(date)}${DD.scope.current() ? `<span class="scope-note">${esc(shortName(DD.scope.current()))} only · <button data-action="scope" data-slug="">Show all repos</button></span>` : ""}</p>
          <h1>${ins.greeting()}${name ? `, ${esc(name)}` : ""}</h1>
          <p class="brief__summary">${heroSummary(st)}</p>
        </div>
        ${dayTimeline()}
        ${heroHealth()}
      </section>`;
  }

  const MAIN_STATE = { error: "failing", success: "passing", warning: "running", gray: "unknown" };

  /** Compact main-branch status for the hero — one chip per tracked repo. */
  function heroHealth() {
    const d = scoped();
    if (!d) return "";
    const repos = scopeRepos();
    if (!repos.length) return "";
    return `
      <ul class="brief__health" aria-label="Main branch status">
        ${repos
          .map((r, i) => {
            const h = d.repos?.[r.slug];
            const m = h?.main;
            const tone = ciTone(m);
            const last = m ? `${m.sha} · ${timeAgo(m.committedAt)}\n${(m.message || "").split("\n")[0]}` : "No recent commit data";
            return `
              <li style="--i:${i}">
                <a class="health-chip health-chip--${tone}" href="${esc(m?.url || `https://github.com/${r.slug}`)}"${target()} title="${esc(last)}">
                  <span class="health-chip__logo">${r.logo}</span>
                  <span class="health-chip__name">${esc(shortName(r))}</span>
                  <span class="dot dot--${tone}"></span>
                  <span class="health-chip__state">${MAIN_STATE[tone]}</span>
                  ${h?.release ? `<span class="health-chip__rel mono">${esc(h.release.tagName)}</span>` : ""}
                </a>
              </li>`;
          })
          .join("")}
      </ul>`;
  }

  function mainAlerts() {
    const d = scoped();
    if (!d) return "";
    const failing = scopeRepos().filter((r) => ciTone(d.repos?.[r.slug]?.main) === "error");
    if (!failing.length) return "";
    if (failing.length === 1) {
      const r = failing[0];
      const m = d.repos[r.slug].main;
      return `
        <a class="redline" href="${esc(m.url)}"${target()}>
          <span class="redline__icon">${icon("alert", 18)}</span>
          <span class="redline__text"><b>${esc(shortName(r))}: main is failing</b><span>${esc((m.message || "").split("\n")[0])}</span></span>
          <span class="redline__meta mono">${esc(m.sha)} · ${timeAgo(m.committedAt)}</span>
          <span class="redline__cta">View checks ${icon("external", 14)}</span>
        </a>`;
    }
    return `
      <div class="redline redline--multi" role="alert">
        <span class="redline__icon">${icon("alert", 18)}</span>
        <span class="redline__text"><b>main is failing on ${failing.length} repos</b><span>Broken main blocks everyone's merges — check if someone is on it.</span></span>
        <span class="redline__repos">
          ${failing
            .map((r) => {
              const m = d.repos[r.slug].main;
              return `<a class="redline__repo" href="${esc(m.url)}"${target()} title="${esc((m.message || "").split("\n")[0])}">${esc(shortName(r))} <span class="mono">${esc(m.sha)}</span>${icon("external", 12)}</a>`;
            })
            .join("")}
        </span>
      </div>`;
  }

  function pulse(st) {
    const d = scoped();
    const s = DD.store.settings;
    const stale = d ? d.reviews.items.filter((p) => !ins.isBot(p.author) && ageDays(p.createdAt) >= s.staleReviewDays).length : 0;
    const cell = (i, attrs, label, value, sub, tone = "") => `
      <a class="pulse__cell ${tone ? `pulse__cell--${tone}` : ""}" style="--i:${i}" ${attrs}>
        <span class="pulse__label">${label}</span>
        <span class="pulse__value">${value ?? "—"}</span>
        <span class="pulse__sub">${sub || "&nbsp;"}</span>
      </a>`;
    const v = (x) => (st ? x : null);
    return `
      <section class="pulse" aria-label="Summary">
        ${cell(0, 'href="#/reviews"', "Reviews", v(st?.reviews), st ? (stale ? `${stale} waiting ${s.staleReviewDays}d+` : `${st.reviewedToday} done since yesterday`) : "", stale ? "warning" : st?.reviews ? "info" : "")}
        ${cell(1, 'href="#/prs"', "My PRs", v(st?.mine), st ? (st.blocked ? `${st.blocked} blocked` : `${st.ready} ready to merge`) : "", st?.blocked ? "error" : "")}
        ${cell(2, 'href="#/issues"', "Issues", v(st ? st.assigned + st.mentions : null), st ? `${st.assigned} assigned · ${st.mentions} mentions` : "")}
        ${cell(3, 'href="#/issues/triage"', "Triage", v(st?.triage), "team queue")}
        ${cell(4, 'href="#/prs/merged"', "Shipped", v(st?.mergedWeek), "merged this week", st?.mergedWeek ? "success" : "")}
      </section>`;
  }

  const TASK_ICON = { main: "alert", ciFailed: "x", conflict: "alert", changes: "message", ready: "merge", review: "eye", mention: "at", assigned: "user", nudge: "clock" };
  const ACTION_LABEL = { ciFailed: "Fix CI", conflict: "Rebase", changes: "Address", ready: "Merge", review: "Review", mention: "Reply", assigned: "Open", nudge: "Nudge" };

  function snooze(t) {
    return `<button class="icon-btn icon-btn--xs" data-action="dismiss-task" data-key="${esc(t.key)}" title="Snooze until tomorrow" aria-label="Snooze until tomorrow">${icon("snooze", 14)}</button>`;
  }

  /** Ranked action queue (failing main stays in the hero alert). */
  function pickUpNext(visible) {
    return visible.filter((t) => t.kind !== "main" && t.item);
  }

  function upNext(visible, hidden) {
    const items = pickUpNext(visible);
    const restore = hidden ? `<button class="btn btn--ghost btn--sm" data-action="restore-tasks">${plural(hidden, "item")} snoozed · restore</button>` : "";
    if (!items.length)
      return `
        <section class="card upnext upnext--clear">
          <span class="upnext__clear-icon">${icon("check", 20)}</span>
          <div><h2>Queue clear</h2><p class="muted">Nothing needs you right now — a great time for deep work.</p></div>
          ${restore}
        </section>`;
    return `
      <section class="card upnext">
        <header class="card__head">
          <h2>${icon("zap", 16)} Up next</h2>
          <span class="card__hint">Ranked by urgency — swipe or use the arrows</span>
          <span class="upnext__tools">
            ${restore}
            <span class="upnext__pos" id="upnext-pos">1 / ${items.length}</span>
            <span class="upnext__nav">
              <button class="icon-btn icon-btn--sm" data-action="upnext-prev" id="upnext-prev" aria-label="Previous" disabled>${icon("chevronLeft", 16)}</button>
              <button class="icon-btn icon-btn--sm" data-action="upnext-next" id="upnext-next" aria-label="Next">${icon("chevron", 16)}</button>
            </span>
          </span>
        </header>
        <div class="upnext__viewport">
          <div class="upnext__scroller" tabindex="0" role="region" aria-roledescription="carousel" aria-label="Up next queue">
            <ol class="upnext__list${items.length > 3 ? " upnext__list--board" : ""}">
              ${items.map((t, i) => nextTile(t, i)).join("")}
            </ol>
          </div>
        </div>
      </section>`;
  }

  const KIND_LABEL = {
    ciFailed: "CI failing",
    conflict: "Merge conflict",
    changes: "Changes requested",
    ready: "Ready to merge",
    review: "Review request",
    mention: "Mention",
    assigned: "Assigned",
    nudge: "Needs reviewers",
  };

  function nextTile(t, i) {
    const lead = i === 0;
    const who = ["mention", "assigned"].includes(t.kind) ? t.item.author : null;
    return `
      <li class="next next--${t.priority} next--${t.kind}${lead ? " next--lead" : ""}" style="--i:${Math.min(i, 12)}">
        <div class="next__top">
          <span class="next__step" aria-hidden="true">${i + 1}</span>
          <span class="next__kind">${icon(TASK_ICON[t.kind] || "zap", 14)} ${KIND_LABEL[t.kind] || "Task"}</span>
          ${lead ? `<span class="next__lead-tag">Start here</span>` : ""}
          ${snooze(t)}
        </div>
        <a class="next__title" href="${esc(t.url)}"${target()}>${esc(t.title)}</a>
        <p class="next__reason">${esc(t.reason)}${t.detail ? ` · <b>${esc(t.detail)}</b>` : ""}</p>
        <div class="next__foot">
          <span class="next__meta">
            ${repoChip(t.repo)}
            <span class="mono">#${t.item.number}</span>
            ${who ? `<span class="next__who">${esc(who)}</span>` : ""}
            <span>${timeAgo(t.at || t.item.updatedAt)}</span>
          </span>
          <a class="btn btn--sm ${lead ? "btn--primary" : "btn--tertiary"}" href="${esc(t.url)}"${target()}>${ACTION_LABEL[t.kind] || "Open"} ${icon("arrowRight", 14)}</a>
        </div>
      </li>`;
  }

  const CI_MARK = {
    SUCCESS: ["success", "check", "CI passing"],
    FAILURE: ["error", "x", "CI failing"],
    ERROR: ["error", "x", "CI error"],
    PENDING: ["warning", "clock", "CI running"],
    EXPECTED: ["warning", "clock", "CI expected"],
  };

  function ciMark(pr) {
    const mark = CI_MARK[pr.ci];
    return mark ? `<span class="ci ci--${mark[0]}" title="${mark[2]}">${icon(mark[1], 12)}</span>` : "";
  }

  const PR_STATUS = {
    conflict: ["error", "Merge conflict"],
    ciFailed: ["error", "CI failing"],
    changes: ["warning", "Changes requested"],
    ready: ["success", "Ready to merge"],
    ciRunning: ["info", "CI running"],
    draft: ["gray", "Draft"],
    waiting: ["info", "Awaiting review"],
  };

  /** The one thing that decides what happens next with the PR. */
  function prStatus(pr) {
    const [tone, text] = PR_STATUS[ins.prState(pr)] || PR_STATUS.waiting;
    const extra = pr.draft && ins.prState(pr) !== "draft" ? ` <span class="muted">· draft</span>` : "";
    return `<div class="wi__foot"><span class="status status--${tone}"><span class="status__dot"></span>${text}</span>${extra}</div>`;
  }

  function laneItem(item, t, laneId) {
    const isPR = item.kind === "pr";
    const tag =
      laneId === "issues"
        ? `<span class="wi__tag">${t?.kind === "mention" ? "Mentioned" : "Assigned"}</span>`
        : laneId !== "mine" && isPR && item.draft
          ? `<span class="wi__tag">Draft</span>`
          : "";
    const foot =
      laneId === "mine"
        ? prStatus(item)
        : `<div class="wi__foot">
            ${avatar(item, 18)}<span class="wi__who">${esc(item.author)}</span>
            ${t?.detail ? `<span class="t-warning">${esc(t.detail)}</span>` : ""}
            <span class="wi__end">${isPR ? ciMark(item) + size(item) : item.comments ? `<span class="row__comments">${icon("message", 12)}${item.comments}</span>` : ""}</span>
          </div>`;
    return `
      <li class="wi wi--${t?.priority || "low"}">
        <div class="wi__top">
          <span class="wi__ref"><span class="repo-dot repo-dot--${DD.repos.bySlug(item.repo)?.accent || "gray"}"></span>${esc(repoName(item.repo))} <span class="mono">#${item.number}</span></span>
          ${tag}
          <span class="wi__time" title="Updated ${esc(new Date(item.updatedAt).toLocaleString())}">${timeAgo(item.updatedAt)}</span>
          ${t ? snooze(t) : ""}
        </div>
        <a class="wi__title" href="${esc(item.url)}"${target()}>${esc(item.title)}</a>
        ${foot}
      </li>`;
  }

  const LANE_LIMIT = 3;

  function lane({ id, title, iconName, href, entries, emptyText, foot }) {
    const limit = ui.laneAll[id] ? entries.length : LANE_LIMIT;
    return `
      <section class="lane lane--${id}">
        <header class="lane__head">
          <h2>${icon(iconName, 16)} ${title}</h2>
          <span class="count">${entries.length}</span>
          <a class="lane__link" href="${href}" title="Open full list">${icon("chevron", 16)}</a>
        </header>
        ${entries.length ? `<ul class="lane__list">${entries.slice(0, limit).map(([item, t]) => laneItem(item, t, id)).join("")}</ul>` : `<div class="lane__empty">${icon("check", 18)}<span>${emptyText}</span></div>`}
        ${entries.length > LANE_LIMIT ? `<button class="lane__more" data-action="lane-more" data-lane="${id}">${ui.laneAll[id] ? "Show less" : `Show ${entries.length - LANE_LIMIT} more`}</button>` : ""}
        <footer class="lane__foot">${foot}</footer>
      </section>`;
  }

  function workLanes(all) {
    const d = scoped();
    const day = DD.store.day();
    const taskFor = new Map(all.filter((t) => t.item).map((t) => [t.item.id, t]));
    const prioOf = (i) => PRIO[taskFor.get(i.id)?.priority] ?? 4;
    const live = (items) =>
      items
        .filter((i) => !day.dismissed[taskFor.get(i.id)?.key])
        .sort((a, b) => prioOf(a) - prioOf(b) || new Date(a.createdAt) - new Date(b.createdAt))
        .map((i) => [i, taskFor.get(i.id)]);

    const taken = new Set([...d.reviews.items, ...d.mine.items].map((i) => i.id));
    const issueItems = [];
    [...d.assigned.items, ...d.mentions.items].forEach((i) => {
      if (taken.has(i.id)) return;
      taken.add(i.id);
      issueItems.push(i);
    });
    const blocked = d.mine.items.filter(ins.isBlocked).length;

    return [
      lane({
        id: "reviews",
        title: "Review requests",
        iconName: "eye",
        href: "#/reviews",
        entries: live(d.reviews.items),
        emptyText: "Nobody is waiting on your review.",
        foot: `<a href="#/reviews">${plural(d.reviewed.total, "PR")} reviewed since yesterday</a>`,
      }),
      lane({
        id: "mine",
        title: "My pull requests",
        iconName: "pr",
        href: "#/prs",
        entries: live(d.mine.items),
        emptyText: "No open pull requests.",
        foot: `${blocked ? `<span class="t-warning">${blocked} blocked</span> · ` : ""}<a href="#/prs/merged">${d.merged.total} merged this week</a>`,
      }),
      lane({
        id: "issues",
        title: "Issues & mentions",
        iconName: "issue",
        href: "#/issues",
        entries: live(issueItems),
        emptyText: "Nothing assigned and no new mentions.",
        foot: `<a href="#/issues/triage">${plural(d.triage.total, "issue")} ${d.triage.total === 1 ? "needs" : "need"} triage</a>`,
      }),
    ].join("");
  }

  function connectCard() {
    return `
      <section class="card card--connect">
        <div class="connect__art">${icon("github", 40)}</div>
        <h2>Connect GitHub to see your day</h2>
        <p class="muted">The dashboard reads review requests, your PRs, CI status, assignments, mentions, triage queues and repo health for
          ${DD.repos.enabled().map((r) => `<b>${esc(r.slug)}</b>`).join(", ")}. Your token stays in this browser and is only sent to api.github.com.</p>
        <ol class="steps">
          <li>Create a <a href="${CLASSIC_TOKEN_URL}" target="_blank" rel="noopener">classic token</a> with <code>repo</code>, <code>notifications</code> and <code>read:org</code> scopes.</li>
          <li>Paste it below. Your username is detected automatically.</li>
        </ol>
        <form class="connect__form" data-form="connect">
          <input class="input" type="password" name="token" placeholder="ghp_…" autocomplete="off" aria-label="GitHub token" required>
          <button class="btn btn--primary" type="submit">Connect</button>
        </form>
        <button class="btn btn--ghost" data-action="demo-on">Explore with sample data instead</button>
      </section>`;
  }

  // ---------- home: side rail ----------

  function yourDay() {
    const day = DD.store.day();
    const now = new Date();
    const rituals = DD.store.settings.rituals.map((r) => {
      const auto = ins.ritualAuto(r.auto, scoped());
      return { ...r, auto, done: auto === true || !!day.rituals[r.id] };
    });
    const done = rituals.filter((r) => r.done).length;
    const pct = rituals.length ? Math.round((done / rituals.length) * 100) : 0;
    const meetings = todaysMeetings(now);
    const openTodos = day.todos.filter((t) => !t.done).length;

    const check = (attrs, isDone, text, extra = "") => `
      <li class="${isDone ? "is-done" : ""}">
        <label>
          <input type="checkbox" ${attrs} ${isDone ? "checked" : ""}>
          <span class="check">${icon("check", 12)}</span>
          <span class="checklist__text">${esc(text)}</span>
        </label>
        ${extra}
      </li>`;

    return `
      <section class="card rail-card">
        <header class="card__head">
          <h2>${icon("clipboard", 16)} Your day</h2>
          <span class="progress" title="${pct}% of today's responsibilities done"><span class="progress__bar"><span style="width:${pct}%"></span></span>${done}/${rituals.length}</span>
        </header>

        <h3 class="subhead">Schedule <a href="#/settings/schedule">Edit</a></h3>
        ${
          meetings.length
            ? `<ul class="agenda">${meetings
                .map((m) => {
                  const state = now > m.end ? "past" : now >= m.start ? "live" : "next";
                  return `<li class="agenda__item agenda__item--${state}"><span class="agenda__time mono">${esc(m.time)}</span><span class="agenda__title">${esc(m.title)}</span><span class="muted small">${m.minutes || 15}m</span>${state === "live" ? `<span class="pill pill--error">Now</span>` : ""}</li>`;
                })
                .join("")}</ul>`
            : `<p class="muted small">No recurring meetings today.</p>`
        }

        <h3 class="subhead">Responsibilities</h3>
        ${(() => {
          const item = (r) =>
            check(
              `data-action="ritual" data-id="${esc(r.id)}" ${r.auto === true ? "disabled" : ""}`,
              r.done,
              r.label,
              r.auto !== null ? `<span class="tag-auto" title="Ticks itself from live GitHub data">auto</span>` : ""
            );
          const open = rituals.filter((r) => !r.done);
          const finished = rituals.filter((r) => r.done);
          const showDone = ui.open.rituals;
          return `
            ${open.length ? `<ul class="checklist">${open.map(item).join("")}</ul>` : `<p class="rail-empty">${icon("check", 16)} All done for today.</p>`}
            ${
              finished.length
                ? `<button class="fold" data-action="fold" data-fold="rituals" aria-expanded="${!!showDone}">${icon(showDone ? "chevronDown" : "chevron", 14)}${finished.length} done</button>
                   ${showDone ? `<ul class="checklist checklist--done">${finished.map(item).join("")}</ul>` : ""}`
                : ""
            }`;
        })()}

        <h3 class="subhead">To-dos ${openTodos ? `<span class="count">${openTodos}</span>` : ""}</h3>
        <form class="todo-form" data-form="todo">
          <input class="input input--sm" name="text" placeholder="Add a task for today…" autocomplete="off" aria-label="New to-do">
          <button class="icon-btn icon-btn--sm" type="submit" aria-label="Add">${icon("plus", 16)}</button>
        </form>
        ${
          day.todos.length
            ? `<ul class="checklist">${day.todos
                .map((t) =>
                  check(
                    `data-action="todo-toggle" data-id="${esc(t.id)}"`,
                    t.done,
                    t.text,
                    `<button class="icon-btn icon-btn--xs" data-action="todo-remove" data-id="${esc(t.id)}" aria-label="Remove">${icon("x", 14)}</button>`
                  )
                )
                .join("")}</ul>`
            : ""
        }
      </section>`;
  }

  function repoCard(repo) {
    const data = DD.state.data;
    const h = data?.repos?.[repo.slug];
    const count = (l) => (data ? data[l].items.filter((i) => i.repo === repo.slug).length : "—");
    const main = h?.main;
    const tone = ciTone(main);
    const mainText = !main ? "Unknown" : { error: "failing", success: "passing", warning: "running", gray: "no checks" }[tone];
    const storybooks = repo.groups.find((g) => g.key === "storybooks")?.links || [];

    return `
      <article class="card repo-card">
        <header class="repo-card__head">
          <span class="repo-card__logo">${repo.logo}</span>
          <div>
            <h3>${esc(repo.name)}</h3>
            <a class="muted small mono" href="https://github.com/${esc(repo.slug)}"${target()}>${esc(repo.slug)}</a>
          </div>
        </header>
        <a class="health health--${tone}" href="${esc(main?.url || `https://github.com/${repo.slug}`)}"${target()}>
          <span class="dot dot--${tone}"></span>
          <span><b>${esc(main?.branch || "main")}</b> ${mainText}</span>
          ${main ? `<span class="muted small mono">${esc(main.sha)} · ${timeAgo(main.committedAt)}</span>` : ""}
        </a>
        ${h?.release ? `<a class="release" href="${esc(h.release.url)}"${target()}>${icon("tag", 14)}<b>${esc(h.release.tagName)}</b>${h.release.isPrerelease ? `<span class="pill pill--gray">pre</span>` : ""}<span class="muted small">${timeAgo(h.release.publishedAt)}</span></a>` : ""}
        <dl class="metrics">
          <div><dt>Review me</dt><dd>${count("reviews")}</dd></div>
          <div><dt>My PRs</dt><dd>${count("mine")}</dd></div>
          <div><dt>Assigned</dt><dd>${count("assigned")}</dd></div>
          <div><dt>Triage</dt><dd>${count("triage")}</dd></div>
          <div><dt>Open PRs</dt><dd>${h?.openPRs ?? "—"}</dd></div>
          <div><dt>Open issues</dt><dd>${h?.openIssues ?? "—"}</dd></div>
        </dl>
        ${
          repo.board || storybooks.length
            ? `<footer class="repo-card__links">
          ${repo.board ? `<a class="link-btn" href="${esc(repo.board)}"${target()}>${icon("board", 14)}Sprint board</a>` : ""}
          ${storybooks.map((l) => `<a class="link-btn" href="${esc(l.href)}"${target()}>${icon("book", 14)}${esc(l.label)}</a>`).join("")}
        </footer>`
            : ""
        }
      </article>`;
  }

  function standupCard() {
    const text = scoped() ? ins.standup(scoped()) : "";
    const open = ui.open.standup;
    return `
      <section class="card rail-card">
        <header class="card__head">
          <h2>${icon("message", 16)} Standup</h2>
          <button class="btn btn--tertiary btn--sm" data-action="copy-standup" ${text ? "" : "disabled"}>${icon("copy", 14)}Copy draft</button>
        </header>
        ${
          text
            ? `<button class="fold" data-action="fold" data-fold="standup" aria-expanded="${!!open}">${icon(open ? "chevronDown" : "chevron", 14)}${open ? "Hide" : "Preview"} yesterday · today · blockers</button>
               ${open ? `<pre class="standup">${esc(text)}</pre>` : ""}`
            : connected()
              ? pending(2)
              : `<p class="muted small">Available once GitHub is connected.</p>`
        }
      </section>`;
  }

  function home() {
    const s = DD.store.settings;
    const d = scoped();
    const st = ins.stats(d, scopedInbox());
    if (!connected()) return `${brief(st)}<div class="connect-wrap">${connectCard()}${yourDay()}</div>`;

    const all = ins.focusQueue(d, s);
    const day = DD.store.day();
    const visible = all.filter((t) => !day.dismissed[t.key]);
    const lanePending = `<section class="lane">${pending(3)}</section>`;
    return `
      <div class="board">
        <div class="board__pane">
          ${brief(st)}
          ${mainAlerts()}
          ${pulse(st)}
          <div class="stage">
            ${d ? upNext(visible, all.length - visible.length) : `<section class="card upnext">${pending(3)}</section>`}
            ${yourDay()}
          </div>
        </div>
        <div class="masonry" data-masonry>
          ${d ? workLanes(all) : lanePending.repeat(3)}
          ${standupCard()}
        </div>
      </div>`;
  }

  // ---------- list pages ----------

  function reviews() {
    const d = DD.state.data;
    const stale = d ? d.reviews.items.filter((p) => !ins.isBot(p.author) && ageDays(p.createdAt) >= DD.store.settings.staleReviewDays).length : 0;
    return `
      ${pageHeader(`${icon("eye", 24)} Review queue`, d ? `${d.reviews.total} pull requests waiting on your review${stale ? ` · <span class="t-warning">${stale} older than ${DD.store.settings.staleReviewDays} days</span>` : ""}` : "", ghLink("review-requested"))}
      ${connected() ? listSection(d?.reviews.items || [], empty("check", "Review queue is empty.", "Nobody is waiting on you. Nice.")) : connectCard()}
      ${d?.reviewed.items.length ? `<h2 class="section-title">${icon("check", 18)} Reviewed since yesterday</h2><ul class="list">${d.reviewed.items.map(row).join("")}</ul>` : ""}`;
  }

  function prs(sub) {
    const d = DD.state.data;
    const merged = sub === "merged";
    const tabs = `
      <div class="tabs">
        <a class="tab ${!merged ? "tab--active" : ""}" href="#/prs">Open <span class="count">${d?.mine.total ?? ""}</span></a>
        <a class="tab ${merged ? "tab--active" : ""}" href="#/prs/merged">Merged this week <span class="count">${d?.merged.total ?? ""}</span></a>
      </div>`;
    const items = merged ? d?.merged.items : d?.mine.items;
    const blocked = d ? d.mine.items.filter(ins.isBlocked).length : 0;
    return `
      ${pageHeader(`${icon("pr", 24)} My pull requests`, d ? `${d.mine.total} open${blocked ? ` · <span class="t-warning">${blocked} need attention</span>` : ""}` : "", ghLink("author"))}
      ${connected() ? tabs + listSection(items || [], empty("pr", merged ? "Nothing merged this week yet." : "No open pull requests.")) : connectCard()}`;
  }

  function issues(sub) {
    const d = DD.state.data;
    if (sub) ui.issuesTab = sub;
    const tabsDef = [
      ["assigned", "Assigned to me", d?.assigned],
      ["mentions", "Mentions (7 days)", d?.mentions],
      ["triage", "Needs triage", d?.triage],
    ];
    const current = tabsDef.find(([id]) => id === ui.issuesTab) || tabsDef[0];
    return `
      ${pageHeader(`${icon("issue", 24)} Issues & mentions`, "Assignments, conversations that mention you, and the shared triage queue.", ghLink("assignee"))}
      ${connected() ? `
        <div class="tabs">${tabsDef.map(([id, text, l]) => `<a class="tab ${ui.issuesTab === id ? "tab--active" : ""}" href="#/issues/${id}">${text} <span class="count">${l?.total ?? ""}</span></a>`).join("")}</div>
        ${listSection(current[2]?.items || [], empty("check", "Nothing here."))}
        ${current[0] === "triage" && d && d.triage.total > d.triage.items.length ? `<p class="muted small">Showing ${d.triage.items.length} of ${d.triage.total}.</p>` : ""}` : connectCard()}`;
  }

  function ghLink(kind) {
    const login = DD.store.settings.login || "@me";
    const scope = DD.repos.enabled().map((r) => `repo:${r.slug}`).join(" ");
    const q = {
      "review-requested": `is:pr is:open user-review-requested:${login} ${scope}`,
      author: `is:pr is:open author:${login} ${scope}`,
      assignee: `is:open assignee:${login} ${scope}`,
    }[kind];
    return `<a class="btn btn--tertiary btn--sm" href="https://github.com/search?type=pullrequests&q=${encodeURIComponent(q)}"${target()}>${icon("github", 14)}Open on GitHub</a>`;
  }

  // ---------- repo + links ----------

  function linkGroups(repo) {
    return repo.groups
      .map(
        (g) => `
        <div class="link-group">
          <h3>${icon({ github: "github", website: "globe", storybooks: "book" }[g.key] || "link", 16)} ${esc(g.title)}</h3>
          <div class="link-group__items">
            ${g.links.map((l) => l.versionedHref ? `
              <div class="versioned" data-versioned="${esc(l.versionedHref)}">
                <a class="link-btn" href="${esc(l.href)}"${target()}>${esc(l.label)}</a>
                <input class="input version-input" value="${esc(l.version || "latest")}" aria-label="${esc(l.label)} version">
                <button class="icon-btn" data-action="open-version" title="Open this version" aria-label="Open version">${icon("external", 14)}</button>
              </div>` : `<a class="link-btn" href="${esc(l.href)}"${target()}>${esc(l.label)}</a>`).join("")}
          </div>
        </div>`
      )
      .join("");
  }

  function repoPage(id) {
    const repo = DD.repos.byId(id);
    if (!repo) return empty("alert", "Repository not found.");
    const d = DD.state.data;
    const mine = (l) => (d ? d[l].items.filter((i) => i.repo === repo.slug) : []);
    const section = (title, ic, items, emptyText) => `
      <section class="card">
        <div class="card__head"><h2>${icon(ic, 18)} ${title} <span class="count">${items.length}</span></h2></div>
        ${!d && connected() ? pending(2) : items.length ? `<ul class="list list--flush">${items.map(row).join("")}</ul>` : `<p class="muted small">${emptyText}</p>`}
      </section>`;
    return `
      ${pageHeader(`<span class="page-logo">${repo.logo}</span>${esc(repo.name)}`, `<a href="https://github.com/${esc(repo.slug)}"${target()} class="mono">${esc(repo.slug)}</a>`)}
      <div class="repo-layout">
        <div class="repo-layout__side">${repoCard(repo)}<section class="card"><div class="card__head"><h2>${icon("link", 18)} Links</h2></div>${linkGroups(repo)}</section></div>
        <div class="repo-layout__main">
          ${connected() ? `
            ${section("Waiting for my review", "eye", mine("reviews"), "No reviews requested here.")}
            ${section("My pull requests", "pr", mine("mine"), "No open PRs here.")}
            ${section("Assigned to me", "user", mine("assigned"), "Nothing assigned.")}
            ${section("Needs triage", "shield", mine("triage"), "Triage queue is empty.")}` : connectCard()}
        </div>
      </div>`;
  }

  function links() {
    return `
      ${pageHeader(`${icon("link", 24)} Links`, "Boards, docs and Storybooks for every repo. Edit them in <code>bookmarks-data.js</code>.")}
      <div class="links-grid">
        ${DD.repos.all.map((r) => `<section class="card"><div class="card__head"><h2><span class="page-logo page-logo--sm">${r.logo}</span>${esc(r.name)}</h2></div>${linkGroups(r)}</section>`).join("")}
      </div>`;
  }

  // ---------- settings ----------

  function toggle(name, checked, text, sub = "") {
    return `<label class="switch"><input type="checkbox" data-setting="${esc(name)}" ${checked ? "checked" : ""}><span class="switch__track"><span class="switch__thumb"></span></span><span class="switch__text">${text}${sub ? `<small>${sub}</small>` : ""}</span></label>`;
  }

  const NOTIFY_LABELS = {
    reviewRequested: "New review requests",
    ciFailed: "CI fails on my PR",
    ciPassed: "CI passes on my PR",
    changesRequested: "Changes requested on my PR",
    approved: "My PR is approved",
    merged: "My PR is merged",
    conflict: "Merge conflicts on my PR",
    mentioned: "Mentions",
    assigned: "New assignments",
    mainBroken: "main breaks or recovers",
    release: "New releases",
    githubInbox: "Other GitHub inbox activity",
    meetings: "Meeting & workday reminders",
  };

  function pushHint(perm, worker) {
    if (perm === "denied") return "Blocked by the browser — allow notifications for this site, then toggle this back on";
    if (perm === "unsupported") return "Not supported in this browser";
    if (perm === "insecure") return "Needs HTTPS (GitHub Pages) or localhost — file:// pages can't show push alerts";
    if (!worker) return "This browser can't register a service worker, so lock-screen alerts may not work";
    if (perm === "granted") return "OS alerts when this tab is in the background. Install the app (browser menu → Add to Dock / Home Screen) so Chrome can still wake it after you close the tab";
    return "We'll ask the browser for permission. Alerts appear on your lock screen when this tab is in the background";
  }

  function settingsPage() {
    const s = DD.store.settings;
    const { perm, worker } = DD.notify.pushStatus();
    const rl = DD.state.data?.rateLimit;
    return `
      ${pageHeader(`${icon("settings", 24)} Settings`, "Everything is stored locally in this browser.")}
      <div class="settings">
        <section class="card" id="settings-github">
          <div class="card__head"><h2>${icon("github", 18)} GitHub connection</h2>${s.token ? `<span class="pill pill--success">${icon("check", 12)}Connected${s.login ? ` as ${esc(s.login)}` : ""}</span>` : `<span class="pill pill--gray">Not connected</span>`}</div>
          <form class="field-row" data-form="connect">
            <input class="input" type="password" name="token" placeholder="${s.token ? "••••••••••••  (saved — paste to replace)" : "ghp_…"}" autocomplete="off" aria-label="GitHub token">
            <button class="btn btn--primary" type="submit">${s.token ? "Update token" : "Connect"}</button>
            ${s.token ? `<button class="btn btn--danger-ghost" type="button" data-action="disconnect">Disconnect</button>` : ""}
          </form>
          <p class="muted small">Use a <a href="https://github.com/settings/tokens/new?scopes=repo,notifications,read:org&description=Dev%20Dashboard" target="_blank" rel="noopener">classic token</a> with <code>repo</code>, <code>notifications</code>, <code>read:org</code>. Fine-grained tokens work for everything except the GitHub inbox.</p>
          ${s.token ? `<p class="muted small">Token type: ${s.tokenScopes === null ? `<b>fine-grained</b> — the GitHub inbox won't work and org policy may block it; a classic token is recommended.` : s.tokenScopes !== undefined ? `<b>classic</b> · scopes: <code>${esc(s.tokenScopes || "none")}</code>${/notifications|repo/.test(s.tokenScopes || "") ? "" : ` — add <code>notifications</code> for the GitHub inbox`}` : "checking on next sync…"}</p>` : ""}
          ${rl ? `<p class="muted small">API budget: ${rl.remaining}/${rl.limit} points left this hour · each sync costs ~${rl.cost}.</p>` : ""}
          <div class="field-grid">
            <label class="field"><span>Sync every</span><select class="select" data-setting="pollMinutes">${[1, 2, 3, 5, 10, 15].map((m) => `<option value="${m}" ${+s.pollMinutes === m ? "selected" : ""}>${m} min</option>`).join("")}</select></label>
            <label class="field"><span>Review is stale after</span><select class="select" data-setting="staleReviewDays">${[1, 2, 3, 5].map((d) => `<option value="${d}" ${+s.staleReviewDays === d ? "selected" : ""}>${d} day${d > 1 ? "s" : ""}</option>`).join("")}</select></label>
          </div>
          ${toggle("includeTeamReviews", s.includeTeamReviews, "Include team review requests", "Otherwise only reviews requested from you directly")}
          ${toggle("demo", s.demo, "Sample data mode", "Explore the dashboard with realistic fake data")}
        </section>

        <section class="card">
          <div class="card__head"><h2>${icon("book", 18)} Repositories</h2></div>
          <p class="muted small">Tracked repos come from <code>bookmarks-data.js</code>. Turn off the ones you don't want in your day.</p>
          ${DD.repos.all.map((r) => `<label class="switch"><input type="checkbox" data-action="repo-toggle" data-id="${esc(r.id)}" ${!s.disabledRepos.includes(r.id) ? "checked" : ""} ${r.slug ? "" : "disabled"}><span class="switch__track"><span class="switch__thumb"></span></span><span class="switch__text">${esc(r.name)}<small class="mono">${esc(r.slug || "no GitHub repo found")}</small></span></label>`).join("")}
        </section>

        <section class="card">
          <div class="card__head"><h2>${icon("bell", 18)} Notifications</h2><button class="btn btn--tertiary btn--sm" data-action="test-notif">Send test</button></div>
          <label class="switch"><input type="checkbox" data-action="desktop-toggle" ${s.desktopNotifications && perm === "granted" ? "checked" : ""} ${perm === "unsupported" || perm === "insecure" ? "disabled" : ""}><span class="switch__track"><span class="switch__thumb"></span></span><span class="switch__text">Push notifications<small>${pushHint(perm, worker)}</small></span></label>
          ${toggle("sound", s.sound, "Play a sound", "Short chime on new notifications")}
          ${toggle("dnd", s.dnd, "Do not disturb", "Collect notifications silently")}
          <h3 class="subhead">Notify me about</h3>
          <div class="check-grid">
            ${Object.entries(NOTIFY_LABELS).map(([k, text]) => `<label class="mini-check"><input type="checkbox" data-notify="${k}" ${s.notifyOn[k] ? "checked" : ""}><span class="check">${icon("check", 12)}</span>${text}</label>`).join("")}
          </div>
        </section>

        <section class="card" id="settings-schedule">
          <div class="card__head"><h2>${icon("calendar", 18)} Workday & schedule</h2></div>
          <div class="field-grid">
            <label class="field"><span>Workday starts</span><input class="input" type="time" data-setting="workStart" value="${esc(s.workStart)}"></label>
            <label class="field"><span>Workday ends</span><input class="input" type="time" data-setting="workEnd" value="${esc(s.workEnd)}"></label>
          </div>
          <h3 class="subhead">Recurring meetings <span class="muted small">(weekdays, reminded 5 min before)</span></h3>
          <ul class="edit-list">
            ${s.meetings.map((m) => `
              <li data-id="${esc(m.id)}">
                <input class="input input--sm" type="time" value="${esc(m.time)}" data-meeting="time" aria-label="Time">
                <input class="input input--sm" value="${esc(m.title)}" data-meeting="title" aria-label="Title">
                <input class="input input--sm input--num" type="number" min="5" step="5" value="${m.minutes || 15}" data-meeting="minutes" aria-label="Minutes">
                <button class="icon-btn" data-action="meeting-remove" aria-label="Remove">${icon("trash", 16)}</button>
              </li>`).join("")}
          </ul>
          <button class="btn btn--ghost btn--sm" data-action="meeting-add">${icon("plus", 14)}Add meeting</button>
        </section>

        <section class="card">
          <div class="card__head"><h2>${icon("clipboard", 18)} Daily responsibilities</h2></div>
          <p class="muted small">Your checklist resets every day. Items marked <span class="tag-auto">auto</span> tick themselves from GitHub data.</p>
          <ul class="edit-list">
            ${s.rituals.map((r) => `
              <li data-id="${esc(r.id)}">
                <input class="input input--sm" value="${esc(r.label)}" data-ritual="label" aria-label="Responsibility">
                ${r.auto ? `<span class="tag-auto">auto</span>` : ""}
                <button class="icon-btn" data-action="ritual-remove" aria-label="Remove">${icon("trash", 16)}</button>
              </li>`).join("")}
          </ul>
          <button class="btn btn--ghost btn--sm" data-action="ritual-add">${icon("plus", 14)}Add responsibility</button>
        </section>

        <section class="card">
          <div class="card__head"><h2>${icon("sun", 18)} Appearance & behaviour</h2></div>
          <div class="segmented" role="group" aria-label="Theme">
            ${["white", "g10", "g90", "g100"].map((t) => `<button class="seg ${s.theme === t ? "seg--active" : ""}" data-action="theme" data-theme="${t}">${t}</button>`).join("")}
          </div>
          ${toggle("openInNewTab", s.openInNewTab, "Open links in a new tab")}
          <h3 class="subhead">Keyboard shortcuts</h3>
          <dl class="shortcuts">
            <div><dt><kbd>⌘</kbd><kbd>K</kbd> / <kbd>/</kbd></dt><dd>Command palette & search</dd></div>
            <div><dt><kbd>N</kbd></dt><dd>Toggle notification center</dd></div>
            <div><dt><kbd>R</kbd></dt><dd>Sync now</dd></div>
            <div><dt><kbd>G</kbd> then <kbd>H</kbd>/<kbd>R</kbd>/<kbd>P</kbd>/<kbd>I</kbd>/<kbd>L</kbd>/<kbd>S</kbd></dt><dd>Go to Today, Reviews, PRs, Issues, Links, Settings</dd></div>
          </dl>
          <h3 class="subhead">Danger zone</h3>
          <button class="btn btn--danger-ghost btn--sm" data-action="reset">Reset dashboard</button>
        </section>
      </div>`;
  }

  return { ui, home, reviews, prs, issues, repoPage, links, settings: settingsPage, shortName, syncAlert };
})();
