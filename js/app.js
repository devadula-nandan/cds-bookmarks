(() => {
  const { esc, timeAgo, repoShort } = DD.util;
  const { icon } = DD.icons;
  const store = DD.store;
  const views = DD.views;
  const $ = (sel) => document.querySelector(sel);

  let lastSync = 0;

  /**
   * Masonry for `[data-masonry]` grids: each card spans as many small grid rows
   * as its height needs, so short cards tuck under tall ones while DOM order
   * (and keyboard order) stays intact.
   */
  const masonry = (() => {
    const native = CSS.supports("grid-template-rows", "masonry");
    let observer = null;

    function fit(el, row, gap) {
      el.style.gridRowEnd = `span ${Math.max(1, Math.ceil((el.offsetHeight + gap) / row))}`;
    }

    function layout() {
      observer?.disconnect();
      const grid = $("[data-masonry]");
      if (!grid || native) return;
      const style = getComputedStyle(grid);
      const row = parseFloat(style.gridAutoRows) || 4;
      const gap = parseFloat(style.columnGap) || 16;
      const cards = [...grid.children];
      cards.forEach((el) => fit(el, row, gap));
      observer = new ResizeObserver((entries) => entries.forEach((e) => fit(e.target, row, gap)));
      cards.forEach((el) => observer.observe(el));
    }

    return { layout };
  })();

  /** Horizontal snap carousel for the Up next queue. */
  const carousel = (() => {
    function scroller() {
      return $(".upnext__scroller");
    }

    function listEl() {
      return scroller()?.querySelector(".upnext__list");
    }

    function rows() {
      const list = listEl();
      if (!list) return 1;
      return getComputedStyle(list).gridTemplateRows.split(" ").filter(Boolean).length || 1;
    }

    function cardStep() {
      const root = scroller();
      const card = root?.querySelector(".next");
      if (!card) return 0;
      const list = listEl();
      const gap = list ? parseFloat(getComputedStyle(list).columnGap || getComputedStyle(list).gap) || 12 : 12;
      return card.getBoundingClientRect().width + gap;
    }

    function update() {
      const root = scroller();
      const prev = $("#upnext-prev");
      const next = $("#upnext-next");
      const pos = $("#upnext-pos");
      if (!root || !prev) return;
      const cards = root.querySelectorAll(".next").length;
      const max = Math.max(0, root.scrollWidth - root.clientWidth - 2);
      prev.disabled = root.scrollLeft <= 2;
      next.disabled = root.scrollLeft >= max;
      const section = root.closest(".upnext");
      if (section) {
        section.classList.toggle("is-overflow-start", root.scrollLeft > 16);
        section.classList.toggle("is-overflow-end", max > 16 && root.scrollLeft < max - 16);
      }
      const step = cardStep();
      const per = rows();
      const col = step ? Math.round(root.scrollLeft / step) : 0;
      const start = col * per + 1;
      const end = Math.min(start + per - 1, cards);
      if (pos) pos.textContent = start >= end ? `${end} / ${cards}` : `${start}–${end} / ${cards}`;
    }

    function move(dir) {
      const root = scroller();
      if (!root) return;
      root.scrollBy({ left: dir * cardStep(), behavior: "smooth" });
    }

    function bind() {
      const root = scroller();
      if (!root) return;
      root.addEventListener("scroll", update, { passive: true });
      root.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          move(-1);
        }
      });
      update();
    }

    return { bind, move, update };
  })();

  /** Edge fades for the Your day rail, matching the Up next carousel. */
  const railFade = (() => {
    let ro = null;

    function body() {
      return $(".board__pane .stage > .rail-card .rail-card__body");
    }

    function update() {
      const root = body();
      const card = root?.closest(".rail-card");
      if (!root || !card) return;
      const max = Math.max(0, root.scrollHeight - root.clientHeight - 2);
      card.classList.toggle("is-overflow-start", root.scrollTop > 16);
      card.classList.toggle("is-overflow-end", max > 16 && root.scrollTop < max - 16);
    }

    function bind() {
      ro?.disconnect();
      ro = null;
      const root = body();
      if (!root) return;
      root.addEventListener("scroll", update, { passive: true });
      ro = new ResizeObserver(update);
      ro.observe(root);
      update();
    }

    return { bind, update };
  })();

  /** Live 12-hour clock; each glyph slides out as the next slides in. */
  const clock = (() => {
    let timer = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const SLOTS = ["h0", "h1", "m0", "m1", "ap"];

    function pad(n) {
      return String(n).padStart(2, "0");
    }

    function parts(d = new Date()) {
      let h = d.getHours();
      const ap = h < 12 ? "AM" : "PM";
      h = h % 12 || 12;
      const mm = pad(d.getMinutes());
      return { h0: h >= 10 ? "1" : "\u00a0", h1: String(h % 10), m0: mm[0], m1: mm[1], ap };
    }

    function label(d = new Date()) {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
    }

    function glyph(text) {
      const el = document.createElement("span");
      el.className = "clock__num";
      el.textContent = text;
      el.setAttribute("aria-hidden", "true");
      return el;
    }

    function shown(slot) {
      return slot.querySelector(".clock__num:not(.is-out)")?.textContent ?? "";
    }

    function isBlank(text) {
      return text === "\u00a0" || text === " " || text === "";
    }

    function settle(slot, text) {
      slot.querySelectorAll(".clock__num").forEach((n) => n.remove());
      slot.toggleAttribute("data-empty", isBlank(text));
      slot.append(glyph(text));
    }

    function step(slot, text) {
      if (shown(slot) === text) return;
      if (reduce.matches) return settle(slot, text);
      slot.toggleAttribute("data-empty", isBlank(text));
      slot.querySelectorAll(".clock__num.is-out").forEach((n) => n.remove());
      const outgoing = slot.querySelector(".clock__num:not(.is-out)");
      const incoming = glyph(text);
      incoming.classList.add("is-in");
      slot.append(incoming);
      outgoing?.classList.add("is-out");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => incoming.classList.add("is-on"));
      });
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        outgoing?.remove();
        incoming.classList.remove("is-in", "is-on");
      };
      incoming.addEventListener("transitionend", (e) => {
        if (e.propertyName === "transform") finish();
      });
      setTimeout(finish, 700);
    }

    function mount(el, d) {
      const p = parts(d);
      el.innerHTML = `
        <span class="clock__digit" data-slot="h0"></span>
        <span class="clock__digit" data-slot="h1"></span>
        <span class="clock__sep" aria-hidden="true">:</span>
        <span class="clock__digit" data-slot="m0"></span>
        <span class="clock__digit" data-slot="m1"></span>
        <span class="clock__period" data-slot="ap"></span>`;
      SLOTS.forEach((id) => settle(el.querySelector(`[data-slot="${id}"]`), p[id]));
    }

    function paint(animate) {
      const el = $("#live-clock");
      if (!el) return;
      const now = new Date();
      if (!el.querySelector("[data-slot]")) mount(el, now);
      el.dateTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
      el.setAttribute("aria-label", label(now));
      const p = parts(now);
      SLOTS.forEach((id) => {
        const slot = el.querySelector(`[data-slot="${id}"]`);
        if (!slot) return;
        if (animate) step(slot, p[id]);
        else settle(slot, p[id]);
      });
    }

    function loop() {
      clearTimeout(timer);
      paint(true);
      const now = new Date();
      timer = setTimeout(loop, Math.max(250, (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 30));
    }

    function bind() {
      paint(false);
    }

    function start() {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") clearTimeout(timer);
        else loop();
      });
      loop();
    }

    return { bind, start };
  })();

  let enterIO = null;
  let enterTimer = 0;
  function bindEnter(root) {
    enterIO?.disconnect();
    enterIO = null;
    const items = [...(root?.querySelectorAll(".masonry > *") || [])];
    if (!items.length) return;
    if (!root.classList.contains("is-entering") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      items.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const overflow = getComputedStyle(root).overflowY;
    const scrollRoot = overflow === "auto" || overflow === "scroll" ? root : null;
    enterIO = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add("is-in");
          enterIO?.unobserve(e.target);
        });
      },
      { root: scrollRoot, threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    items.forEach((el) => enterIO.observe(el));
  }

  // ---------- routing ----------

  function route() {
    const [page = "", sub = ""] = location.hash.replace(/^#\/?/, "").split("/");
    return { page: page || "today", sub };
  }

  function renderContent({ keepScroll = false } = {}) {
    const { page, sub } = route();
    const scroll = window.scrollY;
    const html =
      {
        today: () => views.home(),
        reviews: () => views.reviews(),
        prs: () => views.prs(sub),
        issues: () => views.issues(sub),
        repo: () => views.repoPage(sub),
        links: () => views.links(),
        settings: () => views.settings(),
      }[page]?.() ?? views.home();
    const carouselX = keepScroll ? $(".upnext__scroller")?.scrollLeft || 0 : 0;
    const railY = keepScroll ? $(".board__pane .stage > .rail-card .rail-card__body")?.scrollTop || 0 : 0;
    const boardY = keepScroll ? $("#content")?.scrollTop || 0 : 0;
    const content = $("#content");
    if (!keepScroll) {
      content.classList.add("is-entering");
      clearTimeout(enterTimer);
      enterTimer = setTimeout(() => content.classList.remove("is-entering"), 1400);
    }
    content.innerHTML = views.syncAlert() + html;
    if (keepScroll) {
      window.scrollTo(0, scroll);
      content.scrollTop = boardY;
    } else {
      window.scrollTo(0, 0);
      content.scrollTop = 0;
      if (page === "settings" && sub) document.getElementById(`settings-${sub}`)?.scrollIntoView({ block: "start" });
    }
    masonry.layout();
    carousel.bind();
    railFade.bind();
    clock.bind();
    bindEnter(content);
    if (keepScroll) {
      const root = $(".upnext__scroller");
      if (root) root.scrollLeft = carouselX;
      carousel.update();
      const rail = $(".board__pane .stage > .rail-card .rail-card__body");
      if (rail) rail.scrollTop = railY;
      railFade.update();
    }
  }

  function renderNav() {
    const { page } = route();
    const st = DD.insights.stats(DD.scope.data(DD.state.data), DD.scope.inbox(DD.state.inbox));
    const item = (href, ic, text, active, count, tone = "") => `
      <a class="nav-tab ${active ? "nav-tab--active" : ""}" href="${href}" ${active ? 'aria-current="page"' : ""}>
        ${ic}<span>${text}</span>
        ${count ? `<span class="nav-count ${tone ? `nav-count--${tone}` : ""}">${count}</span>` : ""}
      </a>`;
    $("#mainnav").innerHTML = `
      ${item("#/", icon("home", 16), "Today", page === "today")}
      ${item("#/reviews", icon("eye", 16), "Reviews", page === "reviews", st?.reviews, "info")}
      ${item("#/prs", icon("pr", 16), "My PRs", page === "prs", st?.mine, st?.blocked ? "warning" : "")}
      ${item("#/issues", icon("issue", 16), "Issues", page === "issues", st ? st.assigned + st.mentions : 0)}
      <span class="mainnav__sep" aria-hidden="true"></span>
      ${item("#/links", icon("link", 16), "Links", page === "links")}`;
    $("#mainnav .nav-tab--active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const avatar = $("#header-avatar");
    if (avatar) {
      if (page === "settings") avatar.setAttribute("aria-current", "page");
      else avatar.removeAttribute("aria-current");
    }
    scopePicker.render();
  }

  // ---------- repo scope picker ----------

  const scopePicker = (() => {
    let open = false;
    const STATE_TEXT = { error: "main failing", success: "main passing", warning: "main running", gray: "status unknown" };

    function tone(repo) {
      const state = DD.state.data?.repos?.[repo.slug]?.main?.state;
      if (!state) return "gray";
      if (["FAILURE", "ERROR"].includes(state)) return "error";
      return state === "SUCCESS" ? "success" : "warning";
    }

    function overallTone(repos) {
      const tones = repos.map(tone);
      if (tones.includes("error")) return "error";
      if (tones.includes("warning")) return "warning";
      return tones.length && tones.every((t) => t === "success") ? "success" : "gray";
    }

    function option(slug, logo, name, sub, t, selected) {
      return `
        <li class="scope__option ${selected ? "is-selected" : ""}" role="option" aria-selected="${selected}" tabindex="-1" data-slug="${esc(slug)}">
          <span class="scope__logo">${logo}</span>
          <span class="scope__name">${esc(name)}<small>${sub}</small></span>
          <span class="scope__check">${selected ? icon("check", 16) : ""}</span>
        </li>`;
    }

    function render() {
      const repos = DD.repos.enabled();
      const current = DD.scope.current();
      const failing = repos.filter((r) => tone(r) === "error");
      const allSub = failing.length
        ? `<span class="t-error">main failing on ${esc(failing.map((r) => views.shortName(r)).join(", "))}</span>`
        : `${repos.length} repositories`;
      $("#scope").innerHTML = `
        <button class="scope__btn" id="scope-btn" aria-haspopup="listbox" aria-expanded="${open}" aria-controls="scope-list" aria-label="Repository scope: ${esc(current ? current.name : "All repositories")}">
          <span class="dot dot--${current ? tone(current) : overallTone(repos)}"></span>
          <span class="scope__label">${current ? esc(views.shortName(current)) : "All repos"}</span>
          ${icon("chevronDown", 14)}
        </button>
        <ul class="scope__list" id="scope-list" role="listbox" aria-label="Show work from" ${open ? "" : "hidden"}>
          <li class="scope__heading" role="presentation">Show work from</li>
          ${option("", icon("book", 18), "All repositories", allSub, overallTone(repos), !current)}
          ${repos
            .map((r) => {
              const t = tone(r);
              const sub = `<span class="dot dot--${t}"></span>${STATE_TEXT[t]} · <span class="mono">${esc(r.slug.split("/")[1])}</span>`;
              return option(r.slug, r.logo, r.name, sub, t, current?.slug === r.slug);
            })
            .join("")}
        </ul>`;
    }

    function toggle(force) {
      open = force ?? !open;
      $("#scope-list").hidden = !open;
      $("#scope-btn").setAttribute("aria-expanded", String(open));
      if (open) ($("#scope-list .is-selected") || $("#scope-list [role=option]"))?.focus();
    }

    function choose(slug) {
      open = false;
      DD.scope.set(slug);
      views.ui.repo = slug || "all";
      renderAll({ keepScroll: true });
      $("#scope-btn")?.focus();
    }

    function bind() {
      const root = $("#scope");
      root.addEventListener("click", (e) => {
        if (e.target.closest("#scope-btn")) return toggle();
        const opt = e.target.closest("[role=option]");
        if (opt) choose(opt.dataset.slug);
      });
      document.addEventListener("click", (e) => open && !root.contains(e.target) && toggle(false));
      root.addEventListener("keydown", (e) => {
        if (!open) {
          if (e.key === "ArrowDown" && e.target.id === "scope-btn") {
            e.preventDefault();
            toggle(true);
          }
          return;
        }
        const opts = [...root.querySelectorAll("[role=option]")];
        const i = opts.indexOf(document.activeElement);
        if (e.key === "Escape") {
          e.stopPropagation();
          toggle(false);
          $("#scope-btn").focus();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          opts[(i + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length].focus();
        } else if ((e.key === "Enter" || e.key === " ") && i >= 0) {
          e.preventDefault();
          choose(opts[i].dataset.slug);
        }
      });
    }

    return { render, bind, choose };
  })();

  function closeDemoPopover() {
    const pop = $("#sync-popover");
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    $("#sync-demo-btn")?.setAttribute("aria-expanded", "false");
  }

  function toggleDemoPopover() {
    const pop = $("#sync-popover");
    const btn = $("#sync-demo-btn");
    if (!pop || !btn) return;
    const open = pop.hidden;
    pop.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  }

  function renderHeader() {
    const s = store.settings;
    const status = $("#sync-status");
    status.classList.toggle("sync--demo", !!s.demo && !DD.state.syncing && !DD.state.error);
    if (DD.state.syncing) status.innerHTML = `<span class="spinner"></span><span>Syncing…</span>`;
    else if (DD.state.error) status.innerHTML = `<span class="dot dot--error"></span><span title="${esc(DD.state.error)}">Sync failed</span>`;
    else if (s.demo) {
      if (!status.querySelector("#sync-demo-btn")) {
        status.innerHTML = `
          <button class="sync__btn" id="sync-demo-btn" type="button" data-action="demo-info" aria-haspopup="dialog" aria-expanded="false" aria-controls="sync-popover" title="You're viewing sample data">
            <span class="dot dot--warning"></span>
            <span>Sample data</span>
          </button>
          <div class="sync__popover" id="sync-popover" role="dialog" aria-labelledby="sync-popover-title" hidden>
            <p id="sync-popover-title">You're viewing <b>sample data</b>. Connect a GitHub token to see your real day.</p>
            <div class="sync__popover-actions">
              <a class="btn btn--sm btn--tertiary" href="#/settings">Connect</a>
              <button class="btn btn--sm btn--ghost" type="button" data-action="demo-off">Exit sample</button>
            </div>
          </div>`;
      }
    } else if (!s.token) status.innerHTML = `<span class="dot dot--gray"></span><a href="#/settings">Not connected</a>`;
    else if (DD.state.data) status.innerHTML = `<span class="dot dot--success"></span><span title="${esc(new Date(DD.state.data.fetchedAt).toLocaleString())}">Synced ${timeAgo(DD.state.data.fetchedAt)}</span>`;
    else status.innerHTML = "";
    $("#refresh-btn").classList.toggle("is-spinning", DD.state.syncing);
    $("#theme-btn").innerHTML = icon(["g90", "g100"].includes(s.theme) ? "sun" : "moon", 18);
    const v = DD.state.data?.viewer;
    $("#header-avatar").innerHTML = v?.avatarUrl ? `<img src="${esc(v.avatarUrl)}" alt="${esc(v.login)}" width="28" height="28">` : icon("user", 18);
  }

  function renderAll(opts) {
    renderHeader();
    renderNav();
    renderContent(opts);
  }

  /** Re-render without clobbering whatever the user is typing in. */
  function softRender() {
    renderHeader();
    renderNav();
    const active = document.activeElement;
    if (active && $("#content").contains(active) && /INPUT|SELECT|TEXTAREA/.test(active.tagName)) return;
    renderContent({ keepScroll: true });
  }

  // ---------- sync ----------

  function hydrateFromCache() {
    const s = store.settings;
    if (s.demo) {
      DD.state.data = DD.demo.data(s.login || "you");
      return;
    }
    if (!s.token) return;
    const cached = store.read(store.KEYS.cache, null);
    if (cached?.data) {
      DD.state.data = cached.data;
      DD.state.inbox = cached.inbox || null;
      lastSync = new Date(cached.data.fetchedAt).getTime();
    }
  }

  async function sync({ manual = false } = {}) {
    const s = store.settings;
    if (DD.state.syncing) return;
    if (s.demo) {
      DD.state.data = DD.demo.data(s.login || "you");
      DD.state.inbox = null;
      lastSync = Date.now();
      softRender();
      if (manual) DD.notify.flash("Sample data refreshed");
      return;
    }
    if (!s.token) return;

    DD.state.syncing = true;
    renderHeader();
    try {
      if (!s.login) {
        const viewer = await DD.github.fetchViewer(s.token);
        store.saveSettings({ login: viewer.login, tokenScopes: viewer.scopes });
      }
      const repos = DD.repos.enabled();
      const [data, inbox] = await Promise.all([
        DD.github.fetchDashboard({ token: s.token, login: store.settings.login, repos, includeTeamReviews: s.includeTeamReviews }),
        DD.github.fetchInbox(s.token, repos).then(
          (threads) => ({ threads }),
          (err) => ({ err })
        ),
      ]);
      DD.state.data = data;
      DD.state.error = null;
      DD.state.errorSso = null;
      if (data.scopes !== store.settings.tokenScopes) store.saveSettings({ tokenScopes: data.scopes });
      if (inbox.threads) {
        DD.state.inbox = inbox.threads;
        DD.state.inboxError = null;
      } else {
        DD.state.inbox = null;
        DD.state.inboxError = [401, 403, 404].includes(inbox.err.status)
          ? "This token can't read GitHub notifications."
          : inbox.err.message;
      }
      store.write(store.KEYS.cache, { data, inbox: DD.state.inbox });
      lastSync = Date.now();
      DD.notify.process(data, DD.state.inbox);
      if (manual) DD.notify.flash("Synced with GitHub");
    } catch (err) {
      console.error("Sync failed", err);
      DD.state.error = err.message;
      DD.state.errorSso = err.sso || null;
      lastSync = Date.now();
      DD.notify.toast({ type: "ciFailed", title: "Sync failed", body: err.message }, 10000);
    } finally {
      DD.state.syncing = false;
      softRender();
    }
  }

  function tick() {
    const s = store.settings;
    const due = Date.now() - lastSync >= (s.pollMinutes || 3) * 60000;
    if (due && (s.token || s.demo)) sync();
    DD.notify.checkSchedule();
    renderHeader();
    if (route().page === "today") softRender();
  }

  // ---------- actions ----------

  async function connect(token) {
    token = token.trim();
    if (!token) return;
    try {
      const viewer = await DD.github.fetchViewer(token);
      store.saveSettings({ token, login: viewer.login, tokenScopes: viewer.scopes, demo: false });
      localStorage.removeItem(store.KEYS.snapshot);
      localStorage.removeItem(store.KEYS.cache);
      DD.state.data = null;
      DD.notify.flash(`Connected as ${viewer.login}`);
      if (route().page === "settings") location.hash = "#/";
      renderAll();
      await sync();
    } catch (err) {
      DD.notify.toast({ type: "ciFailed", title: "Couldn't connect", body: err.message });
    }
  }

  function setTheme(theme) {
    document.documentElement.className = `cds-theme-zone-${theme}`;
    store.saveSettings({ theme });
    renderHeader();
    renderContent({ keepScroll: true });
  }

  function resetSnapshot() {
    localStorage.removeItem(store.KEYS.snapshot);
  }

  const actions = {
    sync: () => sync({ manual: true }),
    "theme-toggle": () => setTheme(["g90", "g100"].includes(store.settings.theme) ? "white" : "g100"),
    theme: (el) => setTheme(el.dataset.theme),
    "open-center": () => DD.notify.togglePanel(),
    "open-notif": (el) => DD.notify.open(el.dataset.id),
    palette: () => palette.open(),

    "dismiss-task": (el) => {
      store.updateDay((d) => (d.dismissed[el.dataset.key] = true));
      renderContent({ keepScroll: true });
    },
    "restore-tasks": () => {
      store.updateDay((d) => (d.dismissed = {}));
      renderContent({ keepScroll: true });
    },
    scope: (el) => scopePicker.choose(el.dataset.slug),
    "upnext-prev": () => carousel.move(-1),
    "upnext-next": () => carousel.move(1),
    fold: (el) => {
      views.ui.open[el.dataset.fold] = !views.ui.open[el.dataset.fold];
      renderContent({ keepScroll: true });
    },
    "lane-more": (el) => {
      views.ui.laneAll[el.dataset.lane] = !views.ui.laneAll[el.dataset.lane];
      renderContent({ keepScroll: true });
    },
    "thread-read": (el) => DD.notify.threadAction(el.dataset.thread, "read"),
    "thread-done": (el) => DD.notify.threadAction(el.dataset.thread, "done"),
    "todo-remove": (el) => {
      store.updateDay((d) => (d.todos = d.todos.filter((t) => t.id !== el.dataset.id)));
      renderContent({ keepScroll: true });
    },
    "copy-standup": async () => {
      const ok = await DD.util.copy(DD.insights.standup(DD.state.data));
      DD.notify.flash(ok ? "Standup copied to clipboard" : "Couldn't copy", ok ? "success" : "error");
    },
    "filter-repo": (el) => {
      views.ui.repo = el.dataset.repo;
      renderContent({ keepScroll: true });
    },
    "open-version": (el) => {
      const group = el.closest("[data-versioned]");
      const version = group.querySelector(".version-input").value.trim() || "latest";
      window.open(group.dataset.versioned.replace("<v>", encodeURIComponent(version)), store.settings.openInNewTab ? "_blank" : "_self", "noopener");
    },
    "demo-on": () => {
      store.saveSettings({ demo: true });
      resetSnapshot();
      DD.state.data = DD.demo.data(store.settings.login || "you");
      const samples = DD.demo.notifications();
      samples.forEach((n, i) => DD.notify.push(n, { silent: i < samples.length - 1 }));
      renderAll();
    },
    "demo-info": () => toggleDemoPopover(),
    "demo-off": () => {
      store.saveSettings({ demo: false });
      DD.notify.removeWhere((n) => n.key?.startsWith("demo:"));
      DD.state.data = null;
      hydrateFromCache();
      renderAll();
      sync();
    },
    disconnect: () => {
      if (!confirm("Remove the GitHub token from this browser?")) return;
      store.saveSettings({ token: "", login: "" });
      [store.KEYS.cache, store.KEYS.snapshot].forEach((k) => localStorage.removeItem(k));
      Object.assign(DD.state, { data: null, inbox: null, inboxError: null, error: null, errorSso: null });
      renderAll({ keepScroll: true });
    },
    "test-notif": async () => {
      const samples = [
        { type: "review", title: "Review requested: carbon#12345", body: "This is what a review request looks like" },
        { type: "ciFailed", title: "CI failed on carbon#12345", body: "This is what a CI failure looks like" },
        { type: "approved", title: "carbon#12345 approved", body: "This is what an approval looks like" },
      ];
      const sample = samples[Math.floor(Math.random() * samples.length)];
      const n = DD.notify.push({ ...sample, key: `test:${Date.now()}`, url: "https://github.com/notifications" });
      const perm = await DD.notify.requestDesktopPermission();
      if (perm === "granted") {
        store.saveSettings({ desktopNotifications: true });
        if (n) await DD.notify.osNotify(n);
        DD.notify.flash("Test push sent — check your notification center");
        if (route().page === "settings") renderContent({ keepScroll: true });
      } else if (perm === "denied" || perm === "insecure" || perm === "unsupported") {
        DD.notify.flash("The browser blocked push notifications", "error");
      }
    },
    "meeting-add": () => {
      store.saveSettings({ meetings: [...store.settings.meetings, { id: DD.util.uid(), title: "New meeting", time: "15:00", minutes: 30, days: [1, 2, 3, 4, 5] }] });
      renderContent({ keepScroll: true });
    },
    "meeting-remove": (el) => {
      const id = el.closest("[data-id]").dataset.id;
      store.saveSettings({ meetings: store.settings.meetings.filter((m) => m.id !== id) });
      renderContent({ keepScroll: true });
    },
    "ritual-add": () => {
      store.saveSettings({ rituals: [...store.settings.rituals, { id: DD.util.uid(), label: "New responsibility" }] });
      renderContent({ keepScroll: true });
      const inputs = document.querySelectorAll("[data-ritual='label']");
      inputs[inputs.length - 1]?.select();
    },
    "ritual-remove": (el) => {
      const id = el.closest("[data-id]").dataset.id;
      store.saveSettings({ rituals: store.settings.rituals.filter((r) => r.id !== id) });
      renderContent({ keepScroll: true });
    },
    reset: () => {
      if (!confirm("Reset all dashboard settings, notifications and daily state? Your token will be removed.")) return;
      Object.keys(localStorage)
        .filter((k) => k.startsWith("devdash:") || k.startsWith("msal."))
        .forEach((k) => localStorage.removeItem(k));
      location.hash = "#/";
      location.reload();
    },
  };

  function bindEvents() {
    document.addEventListener("click", (e) => {
      const pop = $("#sync-popover");
      if (pop && !pop.hidden && (!e.target.closest("#sync-status") || e.target.closest("#sync-popover a"))) closeDemoPopover();
      const el = e.target.closest("[data-action]");
      if (!el || el.closest("#notif-panel")) return;
      const fn = actions[el.dataset.action];
      if (!fn || el.tagName === "INPUT" || el.tagName === "SELECT") return;
      e.preventDefault();
      fn(el);
    });

    document.addEventListener("submit", (e) => {
      const form = e.target.closest("[data-form]");
      if (!form) return;
      e.preventDefault();
      const value = new FormData(form).get(form.dataset.form === "connect" ? "token" : "text") || "";
      if (form.dataset.form === "connect") connect(value);
      if (form.dataset.form === "todo" && value.trim()) {
        store.updateDay((d) => d.todos.push({ id: DD.util.uid(), text: value.trim(), done: false }));
        renderContent({ keepScroll: true });
        document.querySelector("[data-form='todo'] input")?.focus();
      }
    });

    document.addEventListener("change", (e) => {
      const el = e.target;
      const s = store.settings;

      if (el.dataset.action === "ritual") {
        store.updateDay((d) => (d.rituals[el.dataset.id] = el.checked));
        return renderContent({ keepScroll: true });
      }
      if (el.dataset.action === "todo-toggle") {
        store.updateDay((d) => {
          const t = d.todos.find((x) => x.id === el.dataset.id);
          if (t) t.done = el.checked;
        });
        return renderContent({ keepScroll: true });
      }
      if (el.dataset.action === "sort") {
        views.ui.sort = el.value;
        return renderContent({ keepScroll: true });
      }
      if (el.dataset.action === "repo-toggle") {
        const disabled = new Set(s.disabledRepos);
        el.checked ? disabled.delete(el.dataset.id) : disabled.add(el.dataset.id);
        store.saveSettings({ disabledRepos: [...disabled] });
        resetSnapshot();
        renderNav();
        return sync();
      }
      if (el.dataset.action === "desktop-toggle") {
        if (!el.checked) return store.saveSettings({ desktopNotifications: false });
        DD.notify.requestDesktopPermission().then(async (perm) => {
          store.saveSettings({ desktopNotifications: perm === "granted" });
          if (perm === "granted") {
            await DD.notify.testPush();
            DD.notify.flash("Push notifications on — a test alert was sent");
          } else {
            DD.notify.flash("The browser blocked push notifications", "error");
          }
          renderContent({ keepScroll: true });
        });
        return;
      }
      if (el.dataset.notify) {
        return store.saveSettings({ notifyOn: { ...s.notifyOn, [el.dataset.notify]: el.checked } });
      }
      if (el.dataset.ritual) {
        const id = el.closest("[data-id]").dataset.id;
        return store.saveSettings({ rituals: s.rituals.map((r) => (r.id === id ? { ...r, label: el.value } : r)) });
      }
      if (el.dataset.meeting) {
        const id = el.closest("[data-id]").dataset.id;
        const field = el.dataset.meeting;
        const value = field === "minutes" ? Number(el.value) : el.value;
        return store.saveSettings({ meetings: s.meetings.map((m) => (m.id === id ? { ...m, [field]: value } : m)) });
      }
      if (el.dataset.setting) {
        const key = el.dataset.setting;
        const value = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? Number(el.value) : el.value;
        store.saveSettings({ [key]: value });
        if (key === "demo") return value ? actions["demo-on"]() : actions["demo-off"]();
        if (key === "includeTeamReviews") {
          resetSnapshot();
          sync();
        }
        if (key === "dnd") DD.notify.refresh();
        if (key === "openInNewTab") renderContent({ keepScroll: true });
      }
    });

    document.addEventListener(
      "input",
      DD.util.debounce((e) => {
        if (e.target.dataset.action !== "filter-q") return;
        views.ui.q = e.target.value;
        renderContent({ keepScroll: true });
        const input = document.querySelector("[data-action='filter-q']");
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      }, 150)
    );

    window.addEventListener("hashchange", () => {
      views.ui.q = "";
      views.ui.repo = DD.scope.current()?.slug || "all";
      renderNav();
      renderContent();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && Date.now() - lastSync > 60000) sync();
    });

    DD.notify.bindCenter();
    DD.notify.initPush();
    scopePicker.bind();
    bindKeys();
  }

  // ---------- keyboard ----------

  function bindKeys() {
    let pendingG = 0;
    document.addEventListener("keydown", (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        return palette.toggle();
      }
      if (e.key === "Escape") {
        if (!$("#palette").hidden) return palette.close();
        if (!$("#notif-panel").hidden) return DD.notify.togglePanel(false);
        if ($("#sync-popover") && !$("#sync-popover").hidden) {
          closeDemoPopover();
          $("#sync-demo-btn")?.focus();
        }
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (Date.now() - pendingG < 1000) {
        const dest = { h: "#/", t: "#/", r: "#/reviews", p: "#/prs", i: "#/issues", l: "#/links", s: "#/settings" }[key];
        pendingG = 0;
        if (dest) {
          e.preventDefault();
          location.hash = dest;
        }
        return;
      }
      if (key === "g") pendingG = Date.now();
      else if (key === "/") {
        e.preventDefault();
        palette.open();
      } else if (key === "n") DD.notify.togglePanel();
      else if (key === "r") sync({ manual: true });
    });
  }

  // ---------- command palette ----------

  const palette = (() => {
    let items = [];
    let results = [];
    let index = 0;

    function collect() {
      const out = [];
      const nav = (label, hash, ic) => out.push({ group: "Go to", label, ic, run: () => (location.hash = hash) });
      nav("Today", "#/", "home");
      nav("Review queue", "#/reviews", "eye");
      nav("My pull requests", "#/prs", "pr");
      nav("Merged this week", "#/prs/merged", "rocket");
      nav("Assigned issues", "#/issues/assigned", "issue");
      nav("Mentions", "#/issues/mentions", "at");
      nav("Triage queue", "#/issues/triage", "shield");
      nav("Links", "#/links", "link");
      nav("Settings", "#/settings", "settings");
      DD.repos.enabled().forEach((r) => nav(`${r.name} overview`, `#/repo/${r.id}`, "book"));

      const cmd = (label, ic, run) => out.push({ group: "Commands", label, ic, run });
      cmd("Sync now", "refresh", () => sync({ manual: true }));
      cmd("Open notification center", "bell", () => DD.notify.togglePanel(true));
      cmd(store.settings.dnd ? "Turn off do not disturb" : "Turn on do not disturb", "bellOff", () => {
        store.saveSettings({ dnd: !store.settings.dnd });
        DD.notify.refresh();
      });
      cmd("Copy standup draft", "copy", () => actions["copy-standup"]());
      cmd("Toggle light / dark theme", "moon", () => actions["theme-toggle"]());

      const d = DD.state.data;
      const seen = new Set();
      if (d) {
        [
          ["reviews", "Review requested"],
          ["mine", "My PR"],
          ["assigned", "Assigned"],
          ["mentions", "Mentioned"],
          ["triage", "Needs triage"],
          ["merged", "Merged"],
        ].forEach(([key, tag]) =>
          d[key].items.forEach((i) => {
            if (seen.has(i.id)) return;
            seen.add(i.id);
            out.push({
              group: "Work",
              label: i.title,
              hint: `${repoShort(i.repo)}#${i.number} · ${tag}`,
              ic: i.kind === "pr" ? "pr" : "issue",
              search: `${repoShort(i.repo)} ${i.number} #${i.number} ${i.author} ${tag}`,
              run: () => window.open(i.url, store.settings.openInNewTab ? "_blank" : "_self", "noopener"),
            });
          })
        );
      }

      DD.repos.all.forEach((r) =>
        r.groups.forEach((g) =>
          g.links.forEach((l) =>
            out.push({
              group: "Links",
              label: `${views.shortName(r)} · ${l.label}`,
              hint: g.title,
              ic: "link",
              run: () => window.open(l.href, store.settings.openInNewTab ? "_blank" : "_self", "noopener"),
            })
          )
        )
      );
      return out;
    }

    function filter(q) {
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      results = !terms.length
        ? items.filter((i) => i.group !== "Links" && i.group !== "Work").concat(items.filter((i) => i.group === "Work").slice(0, 8))
        : items.filter((i) => {
            const hay = `${i.label} ${i.hint || ""} ${i.search || ""} ${i.group}`.toLowerCase();
            return terms.every((t) => hay.includes(t));
          });
      results = results.slice(0, 60);
      index = 0;
      draw();
    }

    function draw() {
      let group = "";
      $("#palette-list").innerHTML = results.length
        ? results
            .map((r, i) => {
              const head = r.group !== group ? `<li class="palette__group" role="presentation">${esc((group = r.group))}</li>` : "";
              return `${head}<li class="palette__item ${i === index ? "is-active" : ""}" role="option" aria-selected="${i === index}" data-index="${i}">${icon(r.ic, 16)}<span class="palette__label">${esc(r.label)}</span>${r.hint ? `<span class="palette__hint">${esc(r.hint)}</span>` : ""}</li>`;
            })
            .join("")
        : `<li class="palette__empty">No matches</li>`;
      $("#palette-list .is-active")?.scrollIntoView({ block: "nearest" });
    }

    function run(i) {
      const r = results[i];
      if (!r) return;
      close();
      r.run();
    }

    function open() {
      items = collect();
      $("#palette").hidden = false;
      const input = $("#palette-input");
      input.value = "";
      filter("");
      input.focus();
    }

    function close() {
      $("#palette").hidden = true;
    }

    function toggle() {
      $("#palette").hidden ? open() : close();
    }

    function bind() {
      $(".palette__icon").innerHTML = icon("search", 18);
      $("#palette-input").addEventListener("input", (e) => filter(e.target.value));
      $("#palette-input").addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          index = (index + (e.key === "ArrowDown" ? 1 : -1) + results.length) % Math.max(results.length, 1);
          draw();
        } else if (e.key === "Enter") {
          e.preventDefault();
          run(index);
        }
      });
      $("#palette-list").addEventListener("click", (e) => {
        const li = e.target.closest("[data-index]");
        if (li) run(+li.dataset.index);
      });
      $("#palette").addEventListener("click", (e) => {
        if (e.target.id === "palette") close();
      });
    }

    return { open, close, toggle, bind };
  })();

  // ---------- init ----------

  function initStaticIcons() {
    $(".brand__mark").innerHTML = icon("zap", 18);
    $(".search-trigger__icon").innerHTML = icon("search", 16);
    $("#refresh-btn").innerHTML = icon("refresh", 18);
    $(".bell__icon").innerHTML = icon("bell", 18);
    $(".panel__close").innerHTML = icon("x", 16);
    if (!/Mac|iPhone|iPad/.test(navigator.platform)) document.querySelectorAll("kbd").forEach((k) => (k.textContent = k.textContent.replace("⌘", "Ctrl ")));
  }

  function init() {
    initStaticIcons();
    if (!store.settings.demo) DD.notify.removeWhere((n) => n.key?.startsWith("demo:"));
    hydrateFromCache();
    views.ui.repo = DD.scope.current()?.slug || "all";
    palette.bind();
    bindEvents();
    renderAll();
    DD.notify.refresh();
    ["notifications", "inbox"].forEach((event) =>
      DD.bus.on(event, () => {
        if (route().page === "today" || route().page === "settings") softRender();
      })
    );
    sync();
    clock.start();
    setInterval(tick, 60000);
  }

  init();
})();
