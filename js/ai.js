/**
 * Bob (IBM's AI assistant) for the new tab page. Requests go to the local
 * ai-helper over Chrome native messaging, which runs `bob run --mode ask` on
 * this computer. Nothing is sent unless the user clicks an AI action.
 */
DD.ai = (() => {
  const { repoShort, timeAgo, plural } = DD.util;
  const HOST = "com.devdashboard.bob";
  const CACHE_KEY = "aiCache";
  const CACHE_MAX = 40;

  const supported = !!globalThis.chrome?.runtime?.connectNative;

  class AIError extends Error {
    constructor(message, code = "failed") {
      super(message);
      this.code = code;
    }
  }

  // ---------- transport ----------

  /** Turns Bob Shell's errors into ones the page can explain and act on. */
  function helperError(message = "Bob didn't answer.") {
    const text = String(message).replace(/^Error:\s*/, "");
    if (/license agreement is required|accept the license/i.test(text))
      return new AIError("Bob Shell needs its license accepted once. In Terminal, run `bob --show-license` to read it, then `bob --accept-license`.", "license");
    if (/api key is required|invalid api key|unauthori[sz]ed|401/i.test(text)) return new AIError(`Bob rejected the API key. Check it in Settings → Bob. (${text})`, "nokey");
    return new AIError(text);
  }

  /** One request per port, so closing the port (Cancel) stops Bob. */
  function call(message, signal) {
    return new Promise((resolve, reject) => {
      if (!supported) return reject(new AIError("Bob needs the Chrome extension, not the web version.", "unsupported"));
      let port;
      try {
        port = chrome.runtime.connectNative(HOST);
      } catch (err) {
        return reject(new AIError(err.message, "missing"));
      }
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        try {
          port.disconnect();
        } catch {}
        fn(value);
      };
      port.onMessage.addListener((reply) => finish(reply?.ok ? resolve : reject, reply?.ok ? reply : helperError(reply?.error)));
      port.onDisconnect.addListener(() => {
        const msg = chrome.runtime.lastError?.message || "The Bob helper stopped unexpectedly.";
        const missing = /not found|forbidden|not registered/i.test(msg);
        finish(reject, new AIError(missing ? "The Bob helper isn't installed. Run ai-helper/install.sh from the extension folder." : msg, missing ? "missing" : "failed"));
      });
      signal?.addEventListener("abort", () => finish(reject, new AIError("Cancelled", "cancelled")));
      port.postMessage({ id: DD.util.uid(), ...message });
    });
  }

  async function status() {
    try {
      const reply = await call({ type: "ping" });
      return { ok: true, version: reply.version, home: reply.home || null };
    } catch (err) {
      return { ok: false, code: err.code, error: err.message };
    }
  }

  /**
   * `opts.workspace` runs Bob inside a local clone (still ask mode, so it
   * reads but doesn't change files); `maxTurns` and `timeoutMs` give it room
   * to explore.
   */
  async function ask(prompt, settings, signal, { workspace, maxTurns, timeoutMs } = {}) {
    if (!settings.bobKey) throw new AIError("Add your Bob API key in Settings → Bob.", "nokey");
    const reply = await call({ type: "ask", prompt, key: settings.bobKey, teamId: settings.bobTeamId || undefined, workspace, maxTurns, timeoutMs }, signal);
    return reply.text;
  }

  async function findClones(slugs) {
    return (await call({ type: "find-clones", slugs })).clones;
  }

  async function gitInfo(path) {
    return call({ type: "git-info", path });
  }

  /** Fetches the latest main of `slug` into the bug hunter's own worktree of the clone at `path`. */
  async function huntCheckout(path, slug) {
    return call({ type: "hunt-checkout", path, slug });
  }

  // ---------- cache ----------

  async function cached(key) {
    if (!key) return null;
    const { [CACHE_KEY]: all = {} } = await DD.storage.get(CACHE_KEY);
    return all[key] || null;
  }

  async function remember(key, entry) {
    if (!key) return;
    const { [CACHE_KEY]: all = {} } = await DD.storage.get(CACHE_KEY);
    all[key] = { ...entry, at: new Date().toISOString() };
    const keep = Object.entries(all)
      .sort((a, b) => b[1].at.localeCompare(a[1].at))
      .slice(0, CACHE_MAX);
    await DD.storage.set({ [CACHE_KEY]: Object.fromEntries(keep) });
  }

  // ---------- context ----------

  const clip = (text, max) => {
    const s = String(text || "").replace(/<!--[\s\S]*?-->/g, "").trim();
    return s.length > max ? `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]` : s;
  };

  const refOf = DD.util.itemRef;
  const linkOf = (i) => `[${refOf(i)}](${i.url})`;

  function itemLine(i, extra = "") {
    const bits = [`${linkOf(i)} "${i.title}"`, `by ${i.author}`, `updated ${timeAgo(i.updatedAt)} ago`];
    if (i.kind === "pr") {
      bits.push(DD.insights.prState(i));
      if (i.additions != null) bits.push(`+${i.additions} −${i.deletions}`);
      if (i.approvals?.length) bits.push(`approved by ${i.approvals.join(", ")}`);
      if (i.changeRequests?.length) bits.push(`changes requested by ${i.changeRequests.join(", ")}`);
    }
    if (i.labels?.length) bits.push(`labels: ${i.labels.map((l) => l.name).join(", ")}`);
    return `- ${bits.join(" · ")}${extra}`;
  }

  function section(title, items, render = itemLine) {
    return items.length ? `### ${title}\n${items.map((i) => render(i)).join("\n")}` : `### ${title}\n- none`;
  }

  /** `code` is set when Bob runs inside a local clone and should read it. */
  function preamble(ctx, { code } = {}) {
    const now = new Date();
    return [
      `You are Bob, helping ${ctx.login || "a developer"}, who works on IBM's Carbon Design System, from their browser new-tab dashboard.`,
      `It is ${now.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}.`,
      "Rules:",
      code
        ? `- You're running in a local clone of ${code}. Read and search its files to ground your answer, and cite them as [path:line](https://github.com/${code}/blob/main/path#Lline). Combine that with the context below. If neither settles it, say what you checked and what's missing.`
        : "- Work only from the context below. Don't call tools or read files; everything you need is here. If something isn't in the context, say what's missing in one line.",
      "- Be concise and concrete. Lead with the answer. No greeting, preamble or sign-off.",
      "- Format with GitHub Markdown. Link PRs and issues as [repo#123](url) using the URLs given.",
    ].join("\n");
  }

  /** Everything on the dashboard, compactly: the ranked queue, lists, main health and today. */
  function workContext(ctx) {
    const { data: d, tasks, meetings, todos } = ctx;
    if (!d) return "## My work\nGitHub isn't connected yet.";
    const queue = tasks.length
      ? tasks.map((t) => `- [${DD.insights.bucket(t)}] ${t.reason}${t.detail ? ` (${t.detail})` : ""} — ${t.kind === "main" ? `[${t.ref}](${t.url})` : linkOf(t.item)} "${t.title}"`).join("\n")
      : "- nothing";
    const health = Object.entries(d.repos || {})
      .map(([slug, h]) => `- ${slug}: ${h.main?.state || "unknown"}${h.release ? ` · latest release ${h.release.tagName} (${timeAgo(h.release.publishedAt)} ago)` : ""}${h.triage != null ? ` · ${h.triage} issues need triage` : ""}`)
      .join("\n");
    return [
      "## My work",
      `### Needs attention, ranked (now / next / later)\n${queue}`,
      section(`Reviews requested from me (${d.reviews.total})`, d.reviews.items),
      section(`My open PRs (${d.mine.total})`, d.mine.items),
      section("Assigned to me", d.assigned.items),
      section("Mentions this week", d.mentions.items),
      section("Merged this week", d.merged.items),
      section("Reviewed since yesterday", d.reviewed.items),
      `### main branch health\n${health || "- unknown"}`,
      "## Today",
      `### Meetings\n${meetings.length ? meetings.map((m) => `- ${DD.util.fmtTime(m.start)}–${DD.util.fmtTime(m.end)} ${m.title}`).join("\n") : "- none"}`,
      `### To-dos\n${todos.length ? todos.map((t) => `- [${t.done ? "x" : " "}] ${t.text}`).join("\n") : "- none"}`,
    ].join("\n\n");
  }

  function linksContext() {
    return [
      "## Bookmarked links (repos, boards, sites, Storybooks)",
      ...DD.repos.all.map((r) => `### ${r.name}${r.slug ? ` (${r.slug})` : ""}\n${r.groups.flatMap((g) => g.links.map((l) => `- ${g.title} · ${l.label}: ${l.href}`)).join("\n")}`),
    ].join("\n");
  }

  function activityContext(activity, max = 30) {
    return activity.length ? activity.slice(0, max).map((a) => `- ${timeAgo(a.createdAt)} ago · ${a.title}${a.body ? ` — ${a.body}` : ""}${a.url ? ` (${a.url})` : ""}`).join("\n") : "- nothing yet";
  }

  function discussion(detail, { login } = {}) {
    const out = [];
    if (detail.body) out.push(`## Description\n${clip(detail.body, 6000)}`);
    const reviews = detail.reviews.filter((r) => r.body || r.state === "CHANGES_REQUESTED" || r.state === "APPROVED");
    if (reviews.length) out.push(`## Reviews\n${reviews.map((r) => `- ${r.author} ${r.state.toLowerCase().replace("_", " ")}${r.body ? `: ${clip(r.body, 1500)}` : ""}`).join("\n")}`);
    const open = detail.threads.filter((t) => !t.resolved);
    if (open.length)
      out.push(
        `## Unresolved review threads (${open.length})\n${open
          .map((t) => `- ${t.path}${t.line ? `:${t.line}` : ""}${t.outdated ? " (outdated)" : ""}\n${t.comments.map((c) => `  - ${c.author}: ${clip(c.body, 800)}`).join("\n")}`)
          .join("\n")}`
      );
    if (detail.comments.length) out.push(`## Recent comments\n${detail.comments.map((c) => `- ${c.author}${login && c.body.includes(`@${login}`) ? " (mentions me)" : ""}, ${timeAgo(c.at)} ago: ${clip(c.body, 1500)}`).join("\n")}`);
    return out.join("\n\n");
  }

  function filesContext(detail) {
    if (!detail.files.length) return "";
    return `## Changed files (${detail.changedFiles ?? detail.files.length})\n${detail.files.map((f) => `- ${f.path} (+${f.additions} −${f.deletions})`).join("\n")}`;
  }

  /** Error lines plus what led up to them, from a raw Actions job log. */
  function logExcerpt(log, max = 7000) {
    const lines = String(log)
      .split("\n")
      .map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, "").replace(/\x1b\[[0-9;]*m/g, ""));
    const hits = lines.reduce((acc, l, i) => (/##\[error\]|\b(Error|ERROR|FAIL|Failed|failed|✕|×)\b/.test(l) ? [...acc, i] : acc), []);
    let picked;
    if (!hits.length) picked = lines.slice(-80);
    else {
      const keep = new Set();
      hits.slice(-4).forEach((i) => {
        for (let j = Math.max(0, i - 30); j <= Math.min(lines.length - 1, i + 4); j++) keep.add(j);
      });
      picked = [...keep].sort((a, b) => a - b).map((i) => lines[i]);
    }
    const text = picked.join("\n");
    return text.length > max ? text.slice(-max) : text;
  }

  async function checksContext(failed, { token, slug }) {
    if (!failed.length) return "## Failing checks\n- GitHub reports CI as failing but returned no failed check details.";
    const parts = [];
    let logs = 0;
    for (const c of failed.slice(0, 6)) {
      let block = `### ${c.name} — ${String(c.conclusion).toLowerCase()}${c.url ? ` (${c.url})` : ""}`;
      if (c.title) block += `\n${c.title}`;
      if (c.summary) block += `\n${clip(c.summary, 1200)}`;
      const notes = c.annotations.filter((a) => a.message && !/Process completed with exit code/.test(a.message));
      if (notes.length) block += `\nAnnotations:\n${notes.map((a) => `- ${a.level || ""} ${a.path || ""}${a.line ? `:${a.line}` : ""} ${clip(a.message, 600)}`).join("\n")}`;
      if (token && c.id && /\/actions\/runs\//.test(c.url || "") && logs < 3) {
        logs++;
        try {
          block += `\nLog excerpt:\n\`\`\`\n${logExcerpt(await DD.github.fetchJobLog(token, slug, c.id))}\n\`\`\``;
        } catch (err) {
          block += `\n(log unavailable: ${err.message})`;
        }
      }
      parts.push(block);
    }
    if (failed.length > 6) parts.push(`…and ${plural(failed.length - 6, "more failing check")}.`);
    return `## Failing checks\n${parts.join("\n\n")}`;
  }

  // ---------- features ----------

  const MODES = {
    review: { label: "Review brief", verb: "Brief me on this review" },
    ci: { label: "Why CI is failing", verb: "Explain the CI failure" },
    main: { label: "Why main is failing", verb: "Explain why main is failing" },
    changes: { label: "Requested changes", verb: "Turn review feedback into a checklist" },
    conflict: { label: "Resolve the conflict", verb: "Help me resolve the conflict" },
    ready: { label: "Merge message", verb: "Write the squash-merge message" },
    nudge: { label: "Nudge reviewers", verb: "Draft a nudge for reviewers" },
    mention: { label: "What they need", verb: "What do they need from me?" },
    issue: { label: "Issue plan", verb: "Summarize and plan this issue" },
    summary: { label: "PR summary", verb: "Summarize where this PR stands" },
  };

  /** Which kind of help fits an item, from the work list it appears in. */
  function modeFor(item, kind) {
    if (kind === "main") return "main";
    if (kind === "review" || kind === "recheck") return "review";
    if (kind === "mention" || kind === "reply") return "mention";
    if (kind === "ciFailed") return "ci";
    if (["changes", "conflict", "ready", "nudge"].includes(kind)) return kind;
    if (item.kind === "issue") return "issue";
    const st = DD.insights.prState(item);
    if (st === "ciFailed") return "ci";
    if (["changes", "conflict", "ready"].includes(st)) return st;
    if (st === "waiting" && DD.util.ageDays(item.createdAt) >= 3) return "nudge";
    return "summary";
  }

  const INSTRUCTIONS = {
    review: `I've been asked to review this PR. Write a review brief with these sections:
**What it does** — 2–3 sentences.
**Where to look** — bullets naming the files or hunks that deserve attention, and why.
**Possible issues** — concrete bugs, edge cases, accessibility, API or styling regressions you can see in the diff, each pointing at a file. Say "None spotted" if so.
**Suggested comments** — up to 3 review comments I could leave, as quotes.
**Effort** — size and a time estimate in one line.`,
    ci: `CI is failing on my PR. Using the failing checks, log excerpts and diff:
**Likely cause** — the actual error and which change caused it, in 2–3 sentences.
**Fix** — concrete steps, including file paths and commands (Carbon uses yarn).
**Flaky?** — one line on whether this looks unrelated to the change and safe to re-run.`,
    main: `The default branch is failing. Using the failing checks and log excerpts:
**Likely cause** — the error and the commit or area that probably caused it.
**Impact** — whether this blocks other PRs.
**Next step** — what to do or who to tell, in one or two bullets.
**Flaky?** — one line.`,
    changes: `Reviewers requested changes on my PR. Turn their unresolved feedback into a checklist:
- One "- [ ] " task per actionable request, starting with a verb, ending with the file:line and reviewer in parentheses.
Then **Questions to answer** — any comments that need a reply rather than a code change, with a suggested reply. Skip resolved or outdated threads.`,
    conflict: `My PR has a merge conflict with its base branch. Give:
**Likely conflicts** — which of the changed files probably conflict, based on what else commonly changes.
**Commands** — a bash code block to rebase onto the latest base branch and push safely.
**Tips** — one or two short bullets for resolving conflicts in these files (for example, yarn.lock or snapshots).`,
    ready: `My PR is approved and green. Write the squash-merge commit message in Conventional Commits format, the convention Carbon uses: a "type(scope): subject" line under 72 characters, a blank line, then 1–4 short bullet points, then "Closes #N" for any issue the description says it fixes. Reply with just the message in a single code block.`,
    nudge: `Nobody has reviewed my PR yet. Draft a short, friendly Slack message (2–3 sentences) asking for a review: what the PR does in one line, why it matters, and how big it is. Put the message in a quote. Then one line suggesting who might be a good reviewer based on the changed files, if you can tell.`,
    mention: `Someone mentioned me here. Tell me:
**What they need** — one sentence.
**Context** — 2–3 bullets.
**Suggested reply** — a short reply I could post, as a quote.`,
    issue: `This issue is on my plate. Give:
**Summary** — 2–3 sentences, including expected vs actual behavior if it's a bug.
**Plan** — a "- [ ] " checklist of 3–6 concrete steps, naming likely Carbon packages or components.
**Open questions** — anything I should ask before starting. Omit if none.`,
    summary: `Summarize where this PR stands: what it does (one or two sentences), what's left before it can merge, and the single next action for me.`,
  };

  /** Where an item's answer is saved: a new commit or any update to the item makes a new key. The page uses it to show answers that are ready. */
  function answerKey({ item, kind, task }) {
    const mode = modeFor(item || {}, kind);
    return mode === "main" ? task.key : `${mode}:${item.id}:${item.updatedAt}`;
  }

  /** Builds the prompt for one work item, fetching its description, discussion, diff and CI as needed. */
  async function itemPrompt(ctx, { item, kind, task }) {
    const mode = modeFor(item || {}, kind);
    const token = ctx.settings.demo ? null : ctx.settings.token;
    const parts = [preamble(ctx)];

    if (mode === "main") {
      const health = ctx.data.repos[task.repo]?.main;
      parts.push(`## Commit\n${task.repo}@${health?.sha} on ${health?.branch}: ${health?.message}\n${health?.url}`);
      if (token) {
        const checks = await DD.github.fetchCommitChecks(token, task.repo, health.sha);
        if (checks.message) parts.push(`## Commit message\n${clip(checks.message, 2000)}`);
        parts.push(await checksContext(checks.failed, { token, slug: task.repo }));
      }
      parts.push(`## Task\n${INSTRUCTIONS.main}`);
      return { mode, prompt: parts.join("\n\n"), cacheKey: answerKey({ kind, task }) };
    }

    parts.push(`## ${item.kind === "pr" ? "Pull request" : "Issue"}\n${itemLine(item)}\nOpened ${timeAgo(item.createdAt)} ago.`);
    if (token) {
      const detail = await DD.github.fetchDetail(token, item.id);
      if (item.kind === "pr") parts.push(`Branch: ${detail.headRef} → ${detail.baseRef}`);
      parts.push(discussion(detail, ctx.settings));
      if (item.kind === "pr" && mode !== "mention") parts.push(filesContext(detail));
      if (mode === "ci") parts.push(await checksContext(detail.failed, { token, slug: item.repo }));
      if (["review", "ci", "ready", "summary"].includes(mode)) {
        try {
          const diff = await DD.github.fetchDiff(token, item.repo, item.number);
          parts.push(`## Diff\n\`\`\`diff\n${clip(diff, mode === "review" ? 45000 : 18000)}\n\`\`\``);
        } catch (err) {
          parts.push(`(diff unavailable: ${err.message})`);
        }
      }
    } else parts.push("(Sample data: only the title and status are available.)");
    parts.push(`## Task\n${INSTRUCTIONS[mode]}`);
    return { mode, prompt: parts.filter(Boolean).join("\n\n"), cacheKey: answerKey({ item, kind, task }) };
  }

  // ---------- lookups: Bob plans them, the dashboard runs them ----------

  /** The first JSON object in a reply, fenced or not. */
  function parseJson(text) {
    const s = String(text || "");
    const fenced = s.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    const raw = fenced ? fenced[1] : s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1);
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function lookupPlanPrompt(ctx, text, purpose, pages = []) {
    const repos = DD.repos.enabled(ctx.settings).map((r) => `- ${r.name}: ${r.slug}`).join("\n");
    const site = pages.length ? `, "pages": ["up to 2 paths from the website pages below whose guidance would help, or none"]` : "";
    return `Plan the GitHub lookups that would help ${purpose}. Today is ${DD.util.todayKey()}; my GitHub login is ${ctx.login || "unknown"}.
Repos:
${repos}

Reply with only this JSON, no prose:
{"repo": "owner/name the text is most about, or null", "queries": ["up to 3 GitHub issue/PR search queries, each scoped with repo: or org:carbon-design-system, using qualifiers like is:issue, is:pr, is:open, label:, author:, in:title"], "refs": ["owner/name#123 for each issue or PR the text names"], "code": true if reading that repo's source code would help, else false${site}}
${pages.length ? `\nCarbon website pages (${SITE}):\n${pages.join("\n")}\n` : ""}
Text:
${clip(text, 6000)}`;
  }

  // ---------- the Carbon website ----------

  const SITE = "https://www.carbondesignsystem.com";
  let sitePaths = null;

  /** Every page path in the website's sitemaps, fetched once per tab. Empty if the site can't be reached. */
  async function websitePages() {
    sitePaths ||= (async () => {
      const locs = async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
      };
      const maps = await locs(`${SITE}/sitemap.xml`);
      const urls = (await Promise.all(maps.map((m) => locs(m).catch(() => [])))).flat();
      return [...new Set(urls.filter((u) => u.startsWith(SITE)).map((u) => u.slice(SITE.length) || "/"))];
    })().catch(() => {
      sitePaths = null;
      return [];
    });
    return sitePaths;
  }

  /** A website page's main content as plain text. */
  async function fetchWebsitePage(path) {
    const res = await fetch(SITE + path);
    if (!res.ok) throw new Error(String(res.status));
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const main = doc.querySelector("main") || doc.body;
    main.querySelectorAll("script, style, svg, nav, iframe").forEach((n) => n.remove());
    return main.textContent.replace(/\s+/g, " ").trim();
  }

  /**
   * Bob turns the text into searches and refs, the dashboard fetches them
   * from GitHub, and the result goes into the final prompt. When the text is
   * about code and that repo has a local clone, the final run reads it too.
   */
  async function retrieve(ctx, text, purpose, stage = () => {}, signal, { website = false } = {}) {
    const token = ctx.settings.demo ? null : ctx.settings.token;
    stage("Planning what to look up…");
    const pages = website ? await websitePages() : [];
    let plan = null;
    try {
      plan = parseJson(await ask(lookupPlanPrompt(ctx, text, purpose, pages), ctx.settings, signal, { maxTurns: 1, timeoutMs: 90000 }));
    } catch (err) {
      if (["cancelled", "nokey", "missing"].includes(err.code)) throw err;
    }
    plan ||= {};
    const parts = [];
    if (token) {
      const queries = (plan.queries || []).filter((q) => typeof q === "string" && q.trim()).slice(0, 3);
      const refs = (plan.refs || []).map((r) => String(r).match(/^([\w.-]+\/[\w.-]+)#(\d+)$/)).filter(Boolean).slice(0, 4);
      stage(`Searching GitHub${queries.length ? ` (${plural(queries.length, "query", "queries")})` : ""}…`);
      const [results, fetched] = await Promise.all([
        Promise.all(queries.map((q) => DD.github.searchItems(token, q, 6).then((r) => ({ q, ...r }), (err) => ({ q, error: err.message, items: [] })))),
        Promise.all(refs.map((m) => DD.github.fetchRef(token, m[1], m[2]).catch(() => null))),
      ]);
      fetched.filter(Boolean).forEach((i) =>
        parts.push(`### ${linkOf(i)} "${i.title}" (${i.state.toLowerCase()})\n${clip(i.body, 3000)}${i.discussion.length ? `\nLatest comments:\n${i.discussion.map((c) => `- ${c.author}: ${clip(c.body, 600)}`).join("\n")}` : ""}`)
      );
      results.forEach((r) =>
        parts.push(
          `### Search \`${r.q}\` — ${r.error ? `failed: ${r.error}` : plural(r.total, "result")}\n${r.items.map((i) => `${itemLine(i, ` · ${i.state.toLowerCase()}`)}${i.body ? `\n  > ${clip(i.body, 400).replace(/\n+/g, " ")}` : ""}`).join("\n") || "- no results"}`
        )
      );
    }
    const picked = (plan.pages || []).map((p) => String(p).replace(SITE, "")).filter((p) => pages.includes(p)).slice(0, 2);
    let site = "";
    if (picked.length) {
      stage(`Reading the Carbon website (${plural(picked.length, "page")})…`);
      const texts = await Promise.all(picked.map((p) => fetchWebsitePage(p).catch((err) => `(unavailable: ${err.message})`)));
      site = `## Retrieved from the Carbon website\n${picked.map((p, i) => `### ${SITE}${p}\n${clip(texts[i], 8000)}`).join("\n\n")}`;
    }
    const clone = plan.code && plan.repo ? ctx.settings.clones?.[plan.repo] : null;
    return {
      block: [token ? `## Retrieved from GitHub\n${parts.join("\n\n") || "- Nothing relevant found."}` : "", site].filter(Boolean).join("\n\n"),
      repo: plan.repo || null,
      code: clone ? plan.repo : null,
      opts: clone ? { workspace: clone, maxTurns: 30, timeoutMs: 420000 } : {},
    };
  }

  async function askBuild(ctx, question, stage, signal) {
    const found = await retrieve(ctx, question, "answer my question", stage, signal, { website: true });
    stage(found.code ? `Reading ${repoShort(found.code)} and thinking…` : "Bob is thinking…");
    return {
      prompt: [preamble(ctx, { code: found.code }), workContext(ctx), `## Recent activity\n${activityContext(ctx.activity, 15)}`, linksContext(), found.block, `## My question\n${question}`].filter(Boolean).join("\n\n"),
      opts: found.opts,
    };
  }

  /** Extra lookups for a follow-up question, appended to the original context. */
  async function askAugment(ctx, question, stage, signal) {
    const found = await retrieve(ctx, question, "answer my follow-up question", stage, signal, { website: true });
    stage("Bob is thinking…");
    return { extra: found.block, opts: found.opts };
  }

  async function slackBuild(ctx, thread, stage, signal) {
    const found = await retrieve(ctx, thread, "answer the support question in this Slack thread", stage, signal, { website: true });
    stage(found.code ? `Reading ${repoShort(found.code)} and drafting…` : "Drafting the reply…");
    const prompt = [
      preamble(ctx, { code: found.code }),
      `## Slack thread (oldest first)\n${clip(thread, 12000)}`,
      found.block,
      linksContext(),
      `## Task
Draft my reply in this thread as a Carbon maintainer. Ground every claim in the sources above${found.code ? " or the code you read" : ""}; never invent props, APIs, tokens or versions. If the sources don't settle it, say what's unknown and ask for what we'd need (package and version, a StackBlitz or repro, a screenshot). Point to an existing issue or PR when one covers it.
Tone: friendly, direct, brief — a few short lines, not an essay. Use Slack formatting: *bold*, \`code\`, "• " bullets, links as <url|text>.
Reply with the message only, then a line containing just "SOURCES:", then a "- " list of the links or file paths you relied on.`,
    ]
      .filter(Boolean)
      .join("\n\n");
    return { prompt, opts: found.opts };
  }

  /** Splits a Slack draft into the message and its "SOURCES:" list. */
  function splitSources(text) {
    const s = String(text || "");
    const at = s.search(/^\s*\**SOURCES:?\**\s*$/im);
    return at < 0 ? { reply: s.trim(), sources: "" } : { reply: s.slice(0, at).trim(), sources: s.slice(at).replace(/^\s*\**SOURCES:?\**\s*$/im, "").trim() };
  }

  // ---------- bug hunt ----------

  function huntPrompt({ slug, branch, head, previous }) {
    return `You're hunting for one real bug in ${slug}, checked out locally at ${branch} (${String(head).slice(0, 7)}). You're in ask mode: read and search the code, don't change anything.

Find the single most obvious bug that's easy to fix — something a maintainer could fix in under an hour with a small diff. Good candidates: inverted or wrong conditions, off-by-one errors, a missing null check that can throw, the wrong variable or prop used, listeners or timers never cleaned up, a React hook missing a dependency so state goes stale, wrong ARIA attributes or roles, misspelled class names or tokens that silently break styling, copy-paste mistakes between sibling components.
Not wanted: style nits, refactors, missing features, TODO comments, test-only problems, or anything you can't point to in the code.
Prefer component and library source (for example under packages/) over docs, stories or examples. Look somewhere different from these earlier finds:
${previous || "- none yet"}

Before reporting, read the surrounding code and its callers to make sure it's really a bug. If you find nothing you're confident about, say so rather than guessing.

Report in GitHub Markdown:
## <one-line title>
**Where** — the file and line.
**What's wrong** — 2–4 sentences, quoting the offending lines in a code block.
**Why it's a bug** — the wrong behaviour a user would actually see, and how to reproduce it if you can.
**Fix** — a minimal diff in a \`\`\`diff block.
**Confidence** — high, medium or low, with one line of reasoning.

Finish with this JSON block and nothing after it:
\`\`\`json
{"found": true, "title": "…", "file": "path/from/repo/root", "line": 123, "severity": "low|medium|high", "effort": "e.g. 15 min", "confidence": "high|medium|low", "search": "2–4 keywords to look for an existing GitHub issue"}
\`\`\``;
  }

/** Context for follow-ups on a bug report; they run in the same clone. */
  function reportPrompt(ctx, report) {
    return [
      preamble(ctx, { code: report.repo }),
      `## Bug you found earlier\nIn a local clone of ${report.repo} at ${report.branch} (${String(report.head || "").slice(0, 7)}), ${timeAgo(report.at)} ago.\n\n${report.markdown}`,
      report.related?.length ? `## Possibly related GitHub issues\n${report.related.map((r) => `- [${r.ref}](${r.url}) "${r.title}" (${String(r.state).toLowerCase()})`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  /** The Markdown report and the trailing JSON summary of a hunt. */
  function splitReport(text) {
    const s = String(text || "");
    const fences = [...s.matchAll(/```json\s*([\s\S]*?)```/g)];
    const last = fences.at(-1);
    let meta = null;
    try {
      meta = last ? JSON.parse(last[1]) : null;
    } catch {}
    return { markdown: (last ? s.slice(0, last.index) : s).trim(), meta };
  }

  function planPrompt(ctx) {
    return [
      preamble(ctx),
      workContext(ctx),
      `## Task
Plan the rest of my working day (until about 6 PM) around my meetings.
**Plan** — a time-blocked list like "- **10:15–11:00** Review [carbon#123](url) (overdue)". Put urgent and blocking work first, keep reviews that unblock others early, and leave short gaps around meetings.
**Top to-dos** — a "- [ ] " checklist of the 3–5 things I should finish today.
Keep it under 15 lines. If it's already past 6 PM, plan tomorrow morning instead.`,
    ].join("\n\n");
  }

  function standupPrompt(ctx) {
    const done = ctx.todos.filter((t) => t.done).map((t) => `- ${t.text}`);
    return [
      preamble(ctx),
      workContext(ctx),
      `## Template draft (built from GitHub)\n${DD.insights.standup(ctx.data)}`,
      `## To-dos I finished\n${done.join("\n") || "- none"}`,
      `## Task
Write my standup update to paste into Slack. Use Slack formatting, not Markdown: *Yesterday*, *Today* and *Blockers* on their own lines, "• " bullets, refs like carbon#123 without links. First person, plain and brief: one line per bullet, at most 5 bullets per section, group related PRs, and say what each change is for rather than repeating the title. Blockers: "• None" if nothing is blocked. Reply with only the update.`,
    ].join("\n\n");
  }

  function catchUpPrompt(ctx, entries) {
    return [
      preamble(ctx),
      `## Activity since I last looked (newest first)\n${activityContext(entries, 40)}`,
      `## Task
Catch me up in under 10 lines.
**Needs me** — things I should act on, most urgent first, with links.
**FYI** — the rest, grouped (for example "3 PRs merged", "carbon v11.70 released").`,
    ].join("\n\n");
  }

  async function triagePrompt(ctx) {
    const items = ctx.data.triage.items.slice(0, 12);
    const token = ctx.settings.demo ? null : ctx.settings.token;
    const bodies = token ? await DD.github.fetchBodies(token, items.map((i) => i.id)).catch(() => ({})) : {};
    return [
      preamble(ctx),
      `## Issues waiting for triage (${ctx.data.triage.total} total, ${items.length} shown)\n${items.map((i) => `${itemLine(i)}\n${bodies[i.id] ? `  > ${clip(bodies[i.id], 1200).replace(/\n/g, "\n  > ")}` : ""}`).join("\n")}`,
      `## Task
Help me triage. For each issue, one bullet: the link, a one-line summary, then suggested **type** (bug, feature, docs, question), **component or package**, **severity** (sev 1–4 for bugs), and either "ready" or what info to ask the reporter for. Flag likely duplicates within the list. End with **Pick up** — the one or two I could fix quickly.`,
    ].join("\n\n");
  }

  function searchQueryPrompt(ctx, request) {
    const repos = DD.repos.enabled(ctx.settings).map((r) => `- ${r.name}: ${r.slug}`).join("\n");
    return `Turn the request below into a single GitHub issues/PR search query.
Today is ${DD.util.todayKey()}. My GitHub login is ${ctx.login || "@me"}.
Repos I work on:\n${repos}
Use qualifiers such as repo:, org:, is:pr, is:issue, is:open, author:, assignee:, involves:, review-requested:, label:"…", created:>=YYYY-MM-DD, updated:, in:title and sort:updated-desc. If no repo is named, scope it with org:carbon-design-system.
Reply with only the query on one line — no code fences, no explanation.

Request: ${request}`;
  }

  /** A follow-up re-sends the original context, the exchange so far, and the new question. */
  function followUpPrompt(base, turns, question) {
    const history = turns.map((t) => `### ${t.role === "user" ? "Me" : "You"}\n${t.text}`).join("\n\n");
    return `${base}\n\n## Conversation so far\n${history}\n\n## Follow-up question\n${question}\nAnswer the follow-up directly, using the same context.`;
  }

  const DRAFT_KIND = { edit: "standup update", reply: "Slack reply", query: "GitHub search query" };

  /**
   * A follow-up on a draft asks for a revision of the draft as it stands now, with the reader's own edits.
   * A question about the draft comes back prefixed with ANSWER: so the page can tell the two apart.
   */
  function revisePrompt(base, draft, request, format) {
    const kind = DRAFT_KIND[format] || "draft";
    const keep =
      format === "reply"
        ? `Reply with the full revised message, then a line containing just "SOURCES:", then the "- " list of links or file paths it relies on.`
        : format === "query"
          ? "Reply with only the revised query on one line, no code fences."
          : "Reply with the full revised update only, in the same format, with no preamble.";
    return `${base}

## Current ${kind}
This is the draft as it stands now, including any edits I made by hand. Keep my edits unless I ask otherwise.
${draft}

## What I want changed
${request}

${keep}
If what I wrote is a question about the draft rather than a change to it, start your reply with "ANSWER:" and answer it instead of rewriting.`;
  }

  /** First line of a reply, stripped of fences and quotes, for the GitHub query feature. */
  function cleanQuery(text) {
    return String(text)
      .replace(/```\w*/g, "")
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean)
      ?.replace(/^`|`$/g, "")
      .replace(/^(query:\s*)/i, "") || "";
  }

  return {
    supported,
    AIError,
    status,
    ask,
    cached,
    remember,
    MODES,
    modeFor,
    itemPrompt,
    askBuild,
    askAugment,
    slackBuild,
    splitSources,
    huntPrompt,
    splitReport,
    reportPrompt,
    findClones,
    gitInfo,
    huntCheckout,
    planPrompt,
    standupPrompt,
    catchUpPrompt,
    triagePrompt,
    searchQueryPrompt,
    followUpPrompt,
    answerKey,
    CACHE_KEY,
    revisePrompt,
    cleanQuery,
  };
})();
