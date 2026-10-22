/**
 * Bug of the day. Once a day (at `settings.bugHuntTime`, or as soon as the
 * computer is awake after it) Bob reads one of the user's local clones in ask
 * mode and reports the most obvious easy-to-fix bug it can find. Repos with a
 * clone take turns, one per day. Runs in the background worker; the page can
 * also start one.
 */
DD.hunt = (() => {
  const KEEP = 30;
  // A hunt that's been "running" longer than this was cut off (browser closed, worker killed).
  const STALE_MS = 25 * 60000;
  const TIMEOUT_MS = 15 * 60000;

  function huntable(settings) {
    return DD.repos.enabled(settings).filter((r) => r.slug && settings.clones?.[r.slug]);
  }

  function enabled(settings) {
    return !!(settings.ai && settings.bugHunt && settings.bobKey && huntable(settings).length);
  }

  function running(huntState) {
    return !!huntState?.running && Date.now() - Date.parse(huntState.startedAt || 0) < STALE_MS;
  }

  async function load() {
    const { huntState = {}, bugHunts = [] } = await DD.storage.get(["huntState", "bugHunts"]);
    return { huntState, bugHunts };
  }

  /** Called every minute by the background worker. */
  async function maybeRun(now = new Date()) {
    const settings = await DD.settings.load();
    if (!enabled(settings)) return;
    const { huntState } = await load();
    if (running(huntState) || huntState.lastDay === DD.util.todayKey(now)) return;
    if (now < DD.util.parseTime(settings.bugHuntTime, now)) return;
    await run();
  }

  function pickRepo(list, slug) {
    if (slug) return list.find((r) => r.slug === slug) || null;
    const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
    return list[day % list.length];
  }

  /** Whether a hunt can start now, and why not. Quick, so the page gets an answer right away. */
  async function check() {
    const settings = await DD.settings.load();
    if (!settings.ai || !settings.bobKey) return { ok: false, error: "Turn on Bob and add your API key first." };
    if (!huntable(settings).length) return { ok: false, error: "Add a local clone for at least one repo in Settings → Bob." };
    const { huntState } = await load();
    if (running(huntState)) return { ok: false, skipped: true, error: "A bug hunt is already running." };
    return { ok: true };
  }

  async function run({ slug } = {}) {
    const ready = await check();
    if (!ready.ok) return ready;
    const settings = await DD.settings.load();
    const { bugHunts } = await load();
    const repo = pickRepo(huntable(settings), slug);
    const day = DD.util.todayKey();
    // lastDay is set up front so a failed hunt isn't retried every minute; "Hunt again" retries by hand.
    await DD.storage.set({ huntState: { running: true, startedAt: new Date().toISOString(), repo: repo.slug, lastDay: day } });
    // An extension API call every 20s keeps the background worker from being stopped as idle mid-hunt.
    const keepAlive = setInterval(() => globalThis.chrome?.runtime?.getPlatformInfo?.(() => {}), 20000);
    try {
      // Hunt the latest main in a worktree of its own; if that fails (offline, no main), hunt the clone as it is.
      const clone = settings.clones[repo.slug];
      const git = await DD.ai.huntCheckout(clone, repo.slug).catch((err) => {
        console.warn("Couldn't check out the latest main; hunting the clone as it is", err);
        return DD.ai.gitInfo(clone).then((info) => ({ ...info, path: clone }));
      });
      const path = git.path;
      const previous = bugHunts
        .filter((h) => h.repo === repo.slug && h.found)
        .slice(0, 15)
        .map((h) => `- ${h.file || "?"}${h.line ? `:${h.line}` : ""} — ${h.title}`)
        .join("\n");
      const text = await DD.ai.ask(DD.ai.huntPrompt({ slug: repo.slug, branch: git.branch, head: git.head, previous }), settings, null, {
        workspace: path,
        maxTurns: 60,
        timeoutMs: TIMEOUT_MS,
      });
      const { markdown, meta } = DD.ai.splitReport(text);
      const found = !!meta?.title && meta.found !== false;

      // Someone may have reported it already.
      let related = [];
      if (found && meta.search && settings.token && !settings.demo) {
        const res = await DD.github.searchItems(settings.token, `repo:${repo.slug} ${meta.search}`, 5).catch(() => ({ items: [] }));
        related = res.items.map((i) => ({ ref: DD.util.itemRef(i), title: i.title, url: i.url, state: i.state, kind: i.kind }));
      }

      const report = {
        id: DD.util.uid(),
        at: new Date().toISOString(),
        day,
        repo: repo.slug,
        path,
        branch: git.branch,
        head: git.head,
        found,
        title: found ? meta.title : "No obvious bug found",
        file: meta?.file || null,
        line: meta?.line || null,
        severity: meta?.severity || null,
        effort: meta?.effort || null,
        confidence: meta?.confidence || null,
        markdown,
        related,
      };
      await DD.storage.set({ bugHunts: [report, ...bugHunts].slice(0, KEEP), huntState: { running: false, lastDay: day, at: report.at, repo: repo.slug } });
      await DD.sync.record(
        [
          {
            type: "bugHunt",
            key: `hunt:${report.id}`,
            title: found ? `Bug of the day: ${report.title}` : `No obvious bug found in ${DD.util.repoShort(repo.slug)} today`,
            body: found ? `${DD.util.repoShort(repo.slug)} · ${report.file || ""}${report.line ? `:${report.line}` : ""}` : "Bob will look somewhere else tomorrow.",
            url: "",
            repo: repo.slug,
          },
        ],
        settings
      );
      return { ok: true, report };
    } catch (err) {
      console.error("Bug hunt failed", err);
      const error = err?.message || String(err) || "Unknown error";
      await DD.storage.set({ huntState: { running: false, lastDay: day, at: new Date().toISOString(), repo: repo.slug, error } });
      return { ok: false, error };
    } finally {
      clearInterval(keepAlive);
    }
  }

  return { enabled, huntable, running, check, maybeRun, run, load };
})();
