// The Today card: today's meetings on a timeline, the bug of the day, to-dos and the standup button.

import { askBob, issueFormPrompt, jsonReply, todaysAnswer } from "../bob.js";
import { fmtTime, parseTime, plural, repoShort, storage, todayKey, uid, updateDay } from "../core.js";
import { huntableRepos, isHunting } from "../hunt.js";
import { standup } from "../insights.js";
import { todaysMeetings } from "../sync.js";
import { openBob, renderBob } from "./bob.js";
import { icon } from "./icons.js";
import { html, live, nothing, render, repeat } from "./lit.js";
import { $, agoText, aiOn, connected, copyText, data, dayLabel, duration, state, toast, vscodeUrl } from "./ui.js";

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
 * Bob's picks for those (`report.issue.pick`) are shown under the report instead. GitHub rejects URLs
 * much over 8,000 characters, so a long description is trimmed to fit.
 */
function issueUrl(report) {
  const { pick, ...fields } = report.issue || {};
  // The report as is, without any "---" rules around it. Reports from before "Suggested fix" said "Fix".
  let full = report.markdown.replace(/^(\s*---\s*\n)+|(\n\s*---\s*)+$/g, "").trim().replace(/\*\*Fix(:?)\*\*/, "**Suggested fix$1**");
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
  return pick.length ? html`<p class="bob__label">In the GitHub form, pick: ${pick.map(([label, value], i) => html`${i ? " · " : ""}${label} <strong>${value}</strong>`)}</p>` : nothing;
}

/** Reports Bob is filling in the GitHub issue form for, by id. */
const filling = new Set();

/** Details under a hunt report: confidence, links to the code and a new GitHub issue, related issues and earlier hunts. Read live, so it follows changes. */
function reportDetails(id) {
  const report = state.bugHunts.find((h) => h.id === id);
  if (!report) return nothing;
  const chips = [report.severity && `${report.severity} severity`, report.effort, report.confidence && `${report.confidence} confidence`].filter(Boolean);
  const verdict = (value, text) => html`<button class="btn btn--ghost btn--sm hunt-verdict" data-action="hunt-verdict" data-id=${report.id} data-verdict=${value} aria-pressed=${report.verdict === value}>${text}</button>`;
  const code = report.file && vscodeUrl(report.path, report.file, report.line);
  const earlier = state.bugHunts.filter((h) => h.id !== report.id).slice(0, 8);
  const busy = filling.has(report.id);
  return html`
    <div class="bob__report-meta">
      ${chips.length ? html`<p class="bob__chips">${chips.map((c) => html`<span class="chip">${c}</span>`)}</p>` : nothing}
      <p class="bob__label bob__links-row">
        ${code ? html`<a class="link link--bob" href=${code}>${icon("code", 14)}Open ${report.file.split("/").pop()}${report.line ? `:${report.line}` : ""} in VS Code</a>` : nothing}
        ${report.found ? html`<button class="link link--bob" data-action="hunt-issue" data-id=${report.id} ?disabled=${busy} data-tooltip="Opens the repo's Bug report form with this report filled in">${icon("github", 14)}${busy ? "Bob is filling in the form…" : "Open a GitHub issue"}</button>` : nothing}
      </p>
      ${issuePicks(report)}
      ${report.found
        ? html`<div class="hunt-verdicts">
            <div class="hunt-verdicts__row" role="group" aria-labelledby="verdict-${report.id}"><span class="bob__label" id="verdict-${report.id}">Was it a real bug?</span>${verdict("real", "Real bug")}${verdict("not", "Not a bug")}</div>
            <p class="quiet-inline">Bob sees your answer on the next hunt in this repo.</p>
          </div>`
        : nothing}
      <p class="bob__label">Checked ${repoShort(report.repo)} at <span class="mono">${report.branch} ${String(report.head || "").slice(0, 7)}</span> in <span class="mono">${report.path}</span></p>
      ${report.related?.length
        ? html`<p class="bob__label">Possibly already reported</p><ul class="bob__links">${report.related.map((r) => html`<li><a href=${r.url} target="_blank" rel="noopener">${r.ref}</a> ${r.title} <span class="quiet-inline">${r.state}</span></li>`)}</ul>`
        : report.found
          ? html`<p class="bob__label">No matching GitHub issue found.</p>`
          : nothing}
      ${earlier.length
        ? html`<details class="hunt-earlier"><summary class="bob__label">Earlier hunts <span>${earlier.length}</span>${icon("chevronDown", 14)}</summary>
            <ul class="hunt-list">${repeat(
              earlier,
              (h) => h.id,
              (h) => html`<li class="hunt-list__row">
                <button class="hunt-list__item bob-btn bob-made" data-action="hunt-open" data-id=${h.id} data-tooltip=${h.title}>${icon("sparkle", 14)}<span class="hunt-list__title">${h.title}</span><span class="hunt-list__meta">${repoShort(h.repo)} · ${dayLabel(h.at, true)}${h.verdict ? ` · ${h.verdict === "real" ? "real bug" : "not a bug"}` : ""}</span></button>
                <button class="icon-btn icon-btn--sm hunt-list__delete" data-action="hunt-delete" data-id=${h.id} data-tooltip="Delete" aria-label="Delete ${h.title}">${icon("trash", 14)}</button>
              </li>`
            )}</ul></details>`
        : nothing}
    </div>`;
}

/** A hunt report in the Bob sheet. Follow-ups ("draft the fix", "write the issue") run in the same clone. */
export function openReport(report) {
  if (!report) return;
  openBob({
    title: report.found ? "Bug of the day" : "Bug hunt",
    subtitle: `${repoShort(report.repo)}${report.file ? ` · ${report.file}${report.line ? `:${report.line}` : ""}` : ""}`,
    trigger: `[data-action="hunt-open"][data-id="${CSS.escape(report.id)}"]`,
    prompt: `You found this bug earlier in a local clone of ${report.repo} at ${report.branch}:\n\n${report.markdown}`,
    // The hunt's own worktree: follow-ups such as "draft the fix" may edit files there.
    opts: { workspace: report.path, edit: true },
    answer: { text: report.markdown, at: report.at, label: "Reported", log: report.log },
    extra: () => reportDetails(report.id),
    regenerate: false,
  });
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
  "hunt-open": (el) => openReport(state.bugHunts.find((h) => h.id === el.dataset.id)),
  // The first time, Bob fills in the form's fields from the repo's template; they're saved on the report.
  // Forms filled before dropdown picks were kept are filled again.
  "hunt-issue": async (el) => {
    const report = state.bugHunts.find((h) => h.id === el.dataset.id);
    if (!report.issue?.pick) {
      filling.add(report.id);
      renderBob();
      try {
        const { text } = await askBob(issueFormPrompt(report), state.settings, { workspace: report.path });
        report.issue = jsonReply(text);
        if (!report.issue) throw new Error("Bob's reply had no JSON in it");
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
  "hunt-delete": (el) => {
    state.bugHunts = state.bugHunts.filter((h) => h.id !== el.dataset.id);
    return saveHunts();
  },
};
