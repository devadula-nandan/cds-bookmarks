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
      port.onMessage.addListener((reply) => finish(reply?.ok ? resolve : reject, reply?.ok ? reply : new AIError(reply?.error || "Bob didn't answer.")));
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
      return { ok: true, version: reply.version };
    } catch (err) {
      return { ok: false, code: err.code, error: err.message };
    }
  }

  async function ask(prompt, settings, signal) {
    if (!settings.bobKey) throw new AIError("Add your Bob API key in Settings → Bob.", "nokey");
    const reply = await call({ type: "ask", prompt, key: settings.bobKey, teamId: settings.bobTeamId || undefined }, signal);
    return reply.text;
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

  const refOf = (i) => `${repoShort(i.repo)}#${i.number}`;
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

  function preamble(ctx) {
    const now = new Date();
    return [
      `You are Bob, helping ${ctx.login || "a developer"}, who works on IBM's Carbon Design System, from their browser new-tab dashboard.`,
      `It is ${now.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}.`,
      "Rules:",
      "- Work only from the context below. Don't call tools or read files; everything you need is here. If something isn't in the context, say so in one line.",
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
    if (kind === "review") return "review";
    if (kind === "mention") return "mention";
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
      return { mode, prompt: parts.join("\n\n"), cacheKey: `main:${task.repo}:${health?.sha}` };
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
    return { mode, prompt: parts.filter(Boolean).join("\n\n"), cacheKey: `${mode}:${item.id}:${item.updatedAt}` };
  }

  function askPrompt(ctx, question) {
    return [preamble(ctx), workContext(ctx), `## Recent activity\n${activityContext(ctx.activity, 15)}`, linksContext(), `## My question\n${question}`].join("\n\n");
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

  // ---------- rendering ----------

  function inline(text) {
    const { esc } = DD.util;
    const codes = [];
    let s = String(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = esc(s)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => `<a href="${url}" target="_blank" rel="noopener">${label}</a>`)
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener">${url.replace(/^https:\/\/(www\.)?github\.com\//, "")}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>");
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  }

  /** A small, escape-first Markdown renderer: headings, lists, task lists, quotes, code, links. */
  function markdown(src) {
    const { esc } = DD.util;
    const lines = String(src || "").replace(/\r/g, "").split("\n");
    const out = [];
    let list = null;
    let para = [];
    const flushPara = () => {
      if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
      para = [];
    };
    const closeList = () => {
      if (list) out.push(`</${list}>`);
      list = null;
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = line.match(/^\s*```(\w*)/);
      if (fence) {
        flushPara();
        closeList();
        const body = [];
        while (++i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i]);
        out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.*)/);
      const task = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)/);
      const bullet = line.match(/^\s*(?:[-*+•])\s+(.*)/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)/);
      const quote = line.match(/^\s*>\s?(.*)/);
      if (!line.trim()) {
        flushPara();
        closeList();
      } else if (heading) {
        flushPara();
        closeList();
        out.push(`<h4>${inline(heading[2])}</h4>`);
      } else if (task || bullet || numbered) {
        flushPara();
        const tag = numbered && !task && !bullet ? "ol" : "ul";
        if (list !== tag) {
          closeList();
          out.push(`<${tag}>`);
          list = tag;
        }
        out.push(task ? `<li class="is-task${task[1].trim() ? " is-done" : ""}">${inline(task[2])}</li>` : `<li>${inline((bullet || numbered)[1])}</li>`);
      } else if (quote) {
        flushPara();
        closeList();
        const body = [quote[1]];
        while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) body.push(lines[++i].replace(/^\s*>\s?/, ""));
        out.push(`<blockquote>${body.map(inline).join("<br>")}</blockquote>`);
      } else {
        closeList();
        para.push(line);
      }
    }
    flushPara();
    closeList();
    return out.join("");
  }

  /** Unchecked "- [ ] …" lines, as plain to-do text. */
  function checklist(text) {
    return String(text || "")
      .split("\n")
      .map((l) => l.match(/^\s*[-*+]\s+\[ \]\s+(.*)/)?.[1])
      .filter(Boolean)
      .map((t) =>
        t
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/\*\*|`/g, "")
          .trim()
      );
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
    askPrompt,
    planPrompt,
    standupPrompt,
    catchUpPrompt,
    triagePrompt,
    searchQueryPrompt,
    followUpPrompt,
    cleanQuery,
    markdown,
    checklist,
  };
})();
