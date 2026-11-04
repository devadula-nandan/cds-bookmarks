// The Today card: today's meetings on a timeline, the bug of the day, to-dos and the standup button.

import { askBob, issueFormPrompt, jsonReply, todaysAnswer, withoutSteps } from "../bob.js";
import { fmtTime, parseTime, plural, repoShort, storage, todayKey, uid, updateDay } from "../core.js";
import { followUpPrompt, followUpReply, huntableRepos, isHunting } from "../hunt.js";
import { standup } from "../insights.js";
import { todaysMeetings } from "../sync.js";
import { openBob, renderBob } from "./bob.js";
import { icon } from "./icons.js";
import { html, live, nothing, render, repeat } from "./lit.js";
import { $, agoText, aiOn, connected, copyText, data, dayLabel, duration, fact, state, toast, vscodeUrl } from "./ui.js";

/** Meetings on a timeline. A meeting in progress shows how far along it is; otherwise a "now" line sits before the next one. */
function agenda(meetings, now) {
  const live = meetings.find((m) => now >= m.start && now < m.end);
  const next = live ? null : meetings.find((m) => m.start > now);
  const nowRow = html`<li class="agenda__now"><span class="agenda__dot" data-tooltip="Now · ${fmtTime(now)}"></span><span class="agenda__line"></span><span class="agenda__when">${next ? `${next.title} in ${duration(Math.ceil((next.start - now) / 60000))}` : "Done for today"}</span></li>`;
  const rows = meetings.flatMap((m) => {
    const isLive = m === live;
    const when = isLive ? html`<span class="agenda__live">${duration(Math.ceil((m.end - now) / 60000))} left</span>` : duration(m.minutes);
    const progress = isLive ? html`<span class="agenda__progress" style="--done: ${Math.round(((now - m.start) / (m.end - m.start)) * 100)}%"></span>` : nothing;
    const item = html`<li class="agenda__item ${now >= m.end ? "is-past" : ""} ${isLive ? "is-live" : ""} ${m === next ? "is-next" : ""}"><span class="agenda__dot" data-tooltip="${fmtTime(m.start)} – ${fmtTime(m.end)}"></span><span class="agenda__title" data-tooltip=${m.title}>${m.title}</span><span class="agenda__when">${when}</span>${progress}</li>`;
    return m === next ? [nowRow, item] : [item];
  });
  if (!live && !next) rows.push(nowRow);
  return html`<ol class="agenda">${rows}</ol>`;
}

function meetingsView(now) {
  const meetings = todaysMeetings(state.settings, now);
  if (!meetings.length) return html`<p class="quiet">No meetings today.</p>`;
  // Once the last meeting is over, fold the timeline so the to-dos get the room.
  if (meetings.every((m) => now >= m.end))
    return html`<details class="agenda-done"><summary>${icon("check", 14)}${plural(meetings.length, "meeting")} done for today${icon("chevronDown", 14)}</summary>${agenda(meetings, now)}</details>`;
  return agenda(meetings, now);
}

function huntCard() {
  if (!aiOn() || !state.settings.bugHunt) return nothing;
  const hs = state.huntState;
  const latest = state.bugHunts[0];
  const running = isHunting(hs);
  const clones = huntableRepos(state.settings).length;
  let body;
  if (running) body = html`<p class="hunt__status bob-shimmer"><span class="bob__spinner"></span>Bob is reading ${repoShort(hs.repo)}…<span class="hunt__ago">${agoText(hs.startedAt)}</span></p>`;
  else if (!clones) body = html`<p class="hunt__status">Add a local clone to a repo to start.</p><button class="btn btn--ghost btn--sm hunt__action" data-action="repo-editor">Edit repositories</button>`;
  else if (latest) {
    const where = [repoShort(latest.repo), latest.file && `${latest.file.split("/").pop()}${latest.line ? `:${latest.line}` : ""}`, latest.effort, latest.found && latest.confidence && `${latest.confidence} confidence`].filter(Boolean).join(" · ");
    body = html`<button class="hunt__report bob-btn ${latest.found ? "" : "is-empty"} ${latest.incomplete ? "is-incomplete" : ""}" data-action="hunt-open" data-id=${latest.id}>
              <span class="hunt__title">${latest.title}</span>
              <span class="hunt__meta">${dayLabel(latest.at, true)} · ${where}</span>
            </button>`;
  } else body = html`<p class="hunt__status">First hunt at ${fmtTime(parseTime(state.settings.bugHuntTime))}.</p>`;
  // Still marked running after the stale window: it was cut off (browser closed or worker stopped).
  const error = hs.running && !running ? "The last hunt was interrupted before it finished." : hs.error && hs.lastDay === todayKey() ? `Today's hunt failed: ${hs.error}` : "";
  return html`
    <section class="hunt" aria-label="Bug of the day">
      <h3 class="subhead">${icon("bug", 14)}Bug of the day</h3>
      ${body}${error ? html`<p class="hunt__error">${error}</p>` : nothing}
      ${clones && !running ? html`<button class="btn btn--ghost btn--sm bob-btn hunt__action" data-action="hunt-run">${icon("sparkle", 14)}Hunt ${latest ? "again" : "now"}</button>` : nothing}
    </section>`;
}

function standupButton() {
  if (!connected()) return nothing;
  const ready = !!data();
  if (!aiOn()) return html`<button class="btn btn--ghost btn--block" data-action="copy-standup" ?disabled=${!ready} data-tooltip="Yesterday, today and blockers from your GitHub activity">${icon("copy", 16)}Copy standup update</button>`;
  const drafted = state.answered.has(todaysAnswer("standup"));
  return html`<button class="btn btn--ghost btn--block bob-btn ${drafted ? "bob-made" : ""}" data-action="bob-standup" ?disabled=${!ready}>${icon("sparkle", 16)}${drafted ? "Today's standup draft" : "Write standup with Bob"}</button>`;
}

export function renderToday() {
  const todos = state.day.todos;
  const open = todos.filter((t) => !t.done).length;
  render(
    html`<header class="panel__head">
        <h2>Today</h2>
        <button class="btn btn--ghost btn--sm" data-action="settings" data-section="meetings">Edit</button>
      </header>
      ${meetingsView(new Date())}
      ${huntCard()}
      <div class="today__todos">
        <h3 class="subhead">To-dos ${open ? html`<span>${open}</span>` : nothing}</h3>
        <ul class="todos">
          ${repeat(
            todos,
            (t) => t.id,
            (t) => html`<li class="todo ${t.done ? "is-done" : ""}">
              <label><input type="checkbox" data-action="todo-toggle" data-id=${t.id} .checked=${live(t.done)}><span>${t.text}</span></label>
              <button class="icon-btn icon-btn--sm todo__remove" data-action="todo-remove" data-id=${t.id} aria-label="Remove ${t.text}">${icon("x", 14)}</button>
            </li>`
          )}
        </ul>
        <form class="todo-form" data-form="todo">${icon("plus", 16)}<input name="text" placeholder="Add a to-do" autocomplete="off" aria-label="New to-do"></form>
      </div>
      ${connected() ? html`<footer class="today__foot">${standupButton()}</footer>` : nothing}`,
    $("#today")
  );
}

// ---------- to-dos ----------

export async function addTodos(texts) {
  const todos = texts.map((text) => ({ id: uid(), text, done: false }));
  state.day.todos.push(...todos);
  renderToday();
  await updateDay((day) => day.todos.push(...todos));
}

async function changeTodo(id, change) {
  state.day.todos = change(state.day.todos);
  renderToday();
  await updateDay((day) => (day.todos = change(day.todos)));
}

export const toggleTodo = (id, done) => changeTodo(id, (todos) => todos.map((t) => (t.id === id ? { ...t, done } : t)));

// ---------- bug of the day ----------

/** Asks the background worker to start a hunt; progress and the report arrive through storage. */
async function huntNow() {
  const res = await chrome.runtime.sendMessage({ type: "bug-hunt" }).catch((err) => ({ ok: false, error: err.message }));
  if (res?.ok) toast("Bob is hunting. This can take a few minutes, and you can keep working.");
  else toast(res?.error || "Couldn't start the bug hunt.", res?.skipped ? "neutral" : "error");
}

/**
 * A new GitHub issue for a bug report: the repo's Bug report form with the title, description and the
 * form's other text fields (`report.issue`, filled in by Bob) set. GitHub can't prefill dropdowns, so
 * Bob's picks for those (`report.issue.pick`) are shown under the report instead. The steps to reproduce
 * go in the form's own field, so the description leaves them out. GitHub rejects URLs much over 8,000
 * characters, so a long description is trimmed to fit.
 */
function issueUrl(report) {
  const { pick, form, ...fields } = report.issue || {};
  // The report without its steps or any "---" rules around it. Reports from before "Suggested fix" said "Fix".
  let full = withoutSteps(report.markdown.replace(/^(\s*---\s*\n)+|(\n\s*---\s*)+$/g, "")).replace(/\*\*Fix(:?)\*\*/, "**Suggested fix$1**");
  // A hunt of the remote's main swaps the "Where" line for a link to the commit, which GitHub shows as a
  // snippet of the code; a hunt of a local clone keeps it, as that commit may not be on GitHub.
  if (report.branch?.endsWith("/main") && report.file) {
    full = full.replace(/^\*\*Where.*$/m, `**Where:**\n\nhttps://github.com/${report.repo}/blob/${report.head}/${report.file}${report.line ? `#L${report.line}` : ""}`);
  }
  // carbon-charts' form calls the field "what-happened"; the other Carbon repos call it "description".
  const field = report.repo.endsWith("/carbon-charts") ? "what-happened" : "description";
  const url = (text) => `https://github.com/${report.repo}/issues/new?${new URLSearchParams({ ...fields, template: "BUG_REPORT.yaml", title: `[Bug]: ${report.title}`, [field]: text })}`;
  let body = full;
  while (url(body).length > 7000) body = `${full.slice(0, Math.floor(body.length * 0.85))}\n\n…`;
  return url(body);
}

/** Bob's choices for the form's dropdowns, which GitHub can't prefill, to pick by hand. */
function issuePicks(report) {
  const pick = Object.entries(report.issue?.pick || {});
  return pick.length ? html`<p class="facts__note">In the GitHub form, pick: ${pick.map(([label, value], i) => html`${i ? " · " : ""}${label} <strong>${value}</strong>`)}</p>` : nothing;
}

/** Bumped when the issue form prompt changes, so reports filled in before are filled in again. 3: just the steps to reproduce. */
const FORM_VERSION = 3;

/** Reports Bob is filling in the GitHub issue form for, by id. */
const filling = new Set();

const SEVERITY = { high: "error", medium: "warning" };
const CONFIDENCE = { high: "success", low: "warning" };

/** "**Confidence:** High — the same guard is used at line 142." → "High — the same guard is used at line 142." */
const confidenceNote = (markdown) => markdown.match(/^\*\*Confidence:?\*\*:?\s*(.+)$/im)?.[1].replace(/[*`]/g, "") || "";

/** What the report says about itself, and what to do with it: under the sheet's title. Read live, so it follows changes. */
function reportFacts(id) {
  const report = state.bugHunts.find((h) => h.id === id);
  if (!report) return nothing;
  const code = report.file && vscodeUrl(report.path, report.file, report.line);
  const busy = filling.has(report.id);
  const verdict = (value, text) => html`<button class="segmented__opt" data-action="hunt-verdict" data-id=${report.id} data-verdict=${value} aria-pressed=${report.verdict === value}>${text}</button>`;
  const related = report.related || [];
  return html`
    <div class="facts">
      <div class="facts__row">
        ${report.severity ? fact("alert", `${report.severity[0].toUpperCase()}${report.severity.slice(1)} severity`, { tone: SEVERITY[report.severity] }) : nothing}
        ${report.effort ? fact("clock", report.effort) : nothing}
        ${report.found && report.confidence ? fact("check", `${report.confidence[0].toUpperCase()}${report.confidence.slice(1)} confidence`, { tone: CONFIDENCE[report.confidence], tooltip: confidenceNote(report.markdown) }) : nothing}
        ${report.found
          ? related.length
            ? fact("issue", html`Maybe reported: ${related.map((r, i) => html`${i ? ", " : ""}<a href=${r.url} target="_blank" rel="noopener" data-tooltip="${r.title} (${r.state})">${r.ref}</a>`)}`, { tone: "warning" })
            : fact("issue", "Not reported on GitHub yet")
          : nothing}
        ${fact("git", html`<span class="mono">${String(report.branch).split("/").pop()} ${String(report.head || "").slice(0, 7)}</span>`, { tooltip: `Checked ${report.branch} in ${report.path}` })}
      </div>
      ${report.found || code
        ? html`<div class="facts__row">
            ${code ? html`<a class="btn btn--ghost btn--sm" href=${code}>${icon("code", 14)}Open in VS Code</a>` : nothing}
            ${report.found ? html`<button class="btn btn--primary btn--sm" data-action="hunt-issue" data-id=${report.id} ?disabled=${busy} data-tooltip="Opens the repo's Bug report form with this report filled in">${icon("github", 14)}${busy ? "Bob is filling in the form…" : "Open a GitHub issue"}</button>` : nothing}
            ${report.found
              ? html`<span class="facts__links" role="group" aria-label="Was it a real bug?" data-tooltip="Bob sees your answer on the next hunt in this repo"><span class="segmented segmented--sm">${verdict("real", "Real bug")}${verdict("not", "Not a bug")}</span></span>`
              : nothing}
          </div>`
        : nothing}
      ${issuePicks(report)}
      ${report.revisedFor
        ? html`<p class="bob__revised">${icon("sparkle", 14)}<span data-tooltip=${report.revisedFor}>Version ${(report.versions?.length || 0) + 1}, revised after “${report.revisedFor}”</span><button class="btn btn--ghost btn--sm" data-action="hunt-undo" data-id=${report.id}>Undo</button></p>`
        : nothing}
    </div>`;
}

/**
 * The report as the sheet shows it. Its title is the sheet's, and Where and Confidence are in the facts, so
 * those go; a bold label opening a paragraph ("**What's wrong:**") becomes a heading, like the review brief's.
 */
function reportBody(tokens) {
  const out = [];
  for (const t of tokens) {
    if (t.type === "hr" || (t.type === "heading" && t.depth <= 2 && !out.length)) continue;
    if (t.type === "paragraph" && /^\*\*(Where|Confidence)\b/i.test(t.raw)) continue;
    const [label, ...rest] = t.type === "paragraph" ? t.tokens : [];
    if (label?.type !== "strong" || !/:\s*$/.test(label.text)) {
      if (t.type !== "space" || out.length) out.push(t);
      continue;
    }
    const text = label.text.replace(/:\s*$/, "");
    out.push({ type: "heading", depth: 3, raw: label.raw, text, tokens: [{ type: "text", raw: text, text }] });
    if (rest[0]?.type === "text") rest[0] = { ...rest[0], text: rest[0].text.trimStart(), raw: rest[0].raw.trimStart() };
    if (rest.some((r) => r.type !== "text" || r.text.trim())) out.push({ type: "paragraph", raw: "", text: "", tokens: rest });
  }
  return out;
}

/** Under the report: earlier hunts, to open or delete. */
function reportMore(id) {
  const earlier = state.bugHunts.filter((h) => h.id !== id).slice(0, 8);
  if (!earlier.length) return nothing;
  return html`
    <details class="hunt-earlier"><summary class="bob__label">Earlier hunts <span>${earlier.length}</span>${icon("chevronDown", 14)}</summary>
      <ul class="hunt-list">${repeat(
        earlier,
        (h) => h.id,
        (h) => html`<li class="hunt-list__row">
          <button class="hunt-list__item bob-btn bob-made" data-action="hunt-open" data-id=${h.id} data-tooltip=${h.title}>${icon("sparkle", 14)}<span class="hunt-list__title">${h.title}</span><span class="hunt-list__meta">${repoShort(h.repo)} · ${dayLabel(h.at, true)}${h.verdict ? ` · ${h.verdict === "real" ? "real bug" : "not a bug"}` : ""}</span></button>
          <button class="icon-btn icon-btn--sm hunt-list__delete" data-action="hunt-delete" data-id=${h.id} data-tooltip="Delete" aria-label="Delete ${h.title}">${icon("trash", 14)}</button>
        </li>`
      )}</ul>
    </details>`;
}

/** The report with this id. Read fresh each time: a storage change replaces the objects in state.bugHunts. */
const reportById = (id) => state.bugHunts.find((h) => h.id === id);

/** What a revision changes, kept as a version so Undo can go back to it. */
const VERSIONED = ["markdown", "found", "incomplete", "title", "file", "line", "severity", "effort", "confidence", "related", "revisedFor", "revisedAt"];
const snapshot = (report) => Object.fromEntries(VERSIONED.map((k) => [k, report[k] ?? null]));

const sheetTitle = (report) => (report.found ? report.title : "Bug hunt: nothing found");
const sheetSubtitle = (report) => `Bug of the day · ${repoShort(report.repo)}${report.file ? ` · ${report.file.split("/").pop()}${report.line ? `:${report.line}` : ""}` : ""}`;

/**
 * A hunt report in the Bob sheet. Follow-ups ("draft the fix", "is this really a bug?") run in the same
 * clone and are saved on the report, so reopening it brings them back. When a follow-up changes what
 * the report says, Bob rewrites it: the new version replaces the report, and the old one is kept for Undo.
 */
export function openReport(report) {
  if (!report) return;
  const spec = {
    title: sheetTitle(report),
    subtitle: sheetSubtitle(report),
    trigger: `[data-action="hunt-open"][data-id="${CSS.escape(report.id)}"]`,
    // The hunt's own worktree: follow-ups such as "draft the fix" may edit files there.
    opts: { workspace: report.path, edit: true },
    answer: { text: report.markdown, at: report.revisedAt || report.at, label: report.revisedFor ? "Revised" : "Reported", log: report.log },
    thread: report.thread,
    // The turns after the report itself, which the prompt has as it stands now.
    followUp: (turns, question) => followUpPrompt(reportById(report.id), turns.slice(1), question),
    answered: ([first, ...thread]) => {
      const current = reportById(report.id);
      if (!current) return; // deleted meanwhile
      const reply = thread.at(-1);
      const { answer, revision } = followUpReply(reply.text);
      reply.text = answer || "I've revised the report.";
      if (revision) {
        current.versions = [...(current.versions || []), snapshot(current)];
        // The issue form was filled in from the old text, so it's filled in again.
        Object.assign(current, revision, { revisedFor: thread.at(-2).text, revisedAt: reply.at, issue: null });
        Object.assign(first, { text: current.markdown, at: reply.at, label: "Revised" });
        Object.assign(spec, { title: sheetTitle(current), subtitle: sheetSubtitle(current) });
      }
      current.thread = thread;
      saveHunts();
    },
    head: () => reportFacts(report.id),
    transform: reportBody,
    extra: () => reportMore(report.id),
    // Files Bob cites open in VS Code, in the hunt's worktree.
    files: (file, line) => {
      const href = vscodeUrl(report.path, file, line);
      return href ? { href } : null;
    },
    regenerate: false,
  };
  openBob(spec);
}

async function saveHunts() {
  renderBob();
  renderToday();
  await storage.set({ bugHunts: state.bugHunts });
}

export const todayActions = {
  "copy-standup": () => copyText(standup(data()), "Standup update copied"),
  "todo-remove": (el) => changeTodo(el.dataset.id, (todos) => todos.filter((t) => t.id !== el.dataset.id)),
  "hunt-run": huntNow,
  "hunt-open": (el) => openReport(reportById(el.dataset.id)),
  // The first time, Bob fills in the form's fields from the repo's template; they're saved on the report.
  // Forms filled by an older version of the prompt (`form` below FORM_VERSION) are filled again.
  "hunt-issue": async (el) => {
    const report = state.bugHunts.find((h) => h.id === el.dataset.id);
    if (!(report.issue?.form >= FORM_VERSION)) {
      filling.add(report.id);
      renderBob();
      try {
        const { text } = await askBob(issueFormPrompt(report), state.settings, { workspace: report.path });
        const issue = jsonReply(text);
        if (!issue) throw new Error("Bob's reply had no JSON in it");
        report.issue = { ...issue, form: FORM_VERSION };
        await saveHunts();
      } catch (err) {
        toast(`Couldn't fill in the issue form (${err.message}). Opening it with the title and description only.`, "error");
      }
      filling.delete(report.id);
      renderBob();
    }
    chrome.tabs.create({ url: issueUrl(report) });
  },
  // Clicking the chosen answer again clears it.
  "hunt-verdict": (el) => {
    const report = state.bugHunts.find((h) => h.id === el.dataset.id);
    report.verdict = report.verdict === el.dataset.verdict ? null : el.dataset.verdict;
    return saveHunts();
  },
  // Back to the version before the latest revision; the conversation stays. The sheet reopens to show it.
  "hunt-undo": (el) => {
    const report = reportById(el.dataset.id);
    Object.assign(report, report.versions.pop(), { issue: null });
    saveHunts();
    openReport(report);
  },
  "hunt-delete": (el) => {
    state.bugHunts = state.bugHunts.filter((h) => h.id !== el.dataset.id);
    return saveHunts();
  },
};
