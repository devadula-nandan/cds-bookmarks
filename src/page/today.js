// The Today card: today's meetings on a timeline, the bug of the day, to-dos and the standup button.

import { askBob, issueFormPrompt, jsonReply, todaysAnswer, withoutSteps } from "../bob.js";
import { fmtTime, parseTime, plural, repoShort, storage, todayKey, uid, updateDay } from "../core.js";
import { huntableRepos, isHunting } from "../hunt.js";
import { standup } from "../insights.js";
import { todaysMeetings } from "../sync.js";
import { openBob, renderBob } from "./bob.js";
import { icon } from "./icons.js";
import { html, nothing, render, repeat } from "./lit.js";
import { $, agoText, aiOn, connected, copyText, data, dayLabel, duration, fact, state, tip, toast, vscodeUrl } from "./ui.js";

/** Meetings as a vertical Carbon progress indicator: done, in progress (with the time left), and to come (the next one with how long until it starts). */
function agenda(meetings, now) {
  const live = meetings.find((m) => now >= m.start && now < m.end);
  const next = live ? null : meetings.find((m) => m.start > now);
  const left = (at) => duration(Math.ceil((at - now) / 60000));
  return html`<cds-progress-indicator class="agenda" vertical>
    ${meetings.map((m) => {
      const when = m === live ? `${left(m.end)} left` : m === next ? `in ${left(m.start)}` : duration(m.minutes);
      return html`<cds-progress-step state=${now >= m.end ? "complete" : m === live ? "current" : "incomplete"} label=${m.title} secondary-label="${fmtTime(m.start)} · ${when}"></cds-progress-step>`;
    })}
  </cds-progress-indicator>`;
}

function meetingsView(now) {
  const meetings = todaysMeetings(state.settings, now);
  if (!meetings.length) return html`<p class="quiet">No meetings today.</p>`;
  // Once the last meeting is over, fold the timeline so the to-dos get the room.
  if (meetings.every((m) => now >= m.end))
    return html`<cds-accordion class="agenda-done" size="sm"><cds-accordion-item title="${plural(meetings.length, "meeting")} done for today">${agenda(meetings, now)}</cds-accordion-item></cds-accordion>`;
  return agenda(meetings, now);
}

function huntCard() {
  if (!aiOn() || !state.settings.bugHunt) return nothing;
  const hs = state.huntState;
  const latest = state.bugHunts[0];
  const running = isHunting(hs);
  const clones = huntableRepos(state.settings).length;
  let body;
  if (running) body = html`<cds-inline-loading class="hunt__status" status="active">Bob is reading ${repoShort(hs.repo)}… ${agoText(hs.startedAt)}</cds-inline-loading>`;
  else if (!clones) body = html`<p class="hunt__status">Add a local clone to a repo to start.</p><cds-button class="is-flush" kind="ghost" size="sm" data-action="repo-editor">Edit repositories</cds-button>`;
  else if (latest) {
    const where = [repoShort(latest.repo), latest.file && `${latest.file.split("/").pop()}${latest.line ? `:${latest.line}` : ""}`, latest.effort, latest.found && latest.confidence && `${latest.confidence} confidence`].filter(Boolean).join(" · ");
    body = html`<cds-clickable-tile class="hunt__report ${latest.found ? "" : "is-empty"}" data-action="hunt-open" data-id=${latest.id}>
              <span class="hunt__title">${latest.title}</span>
              <span class="hunt__meta">${dayLabel(latest.at, true)} · ${where}</span>
            </cds-clickable-tile>`;
  } else body = html`<p class="hunt__status">First hunt at ${fmtTime(parseTime(state.settings.bugHuntTime))}.</p>`;
  // Still marked running after the stale window: it was cut off (browser closed or worker stopped).
  const error = hs.running && !running ? "The last hunt was interrupted before it finished." : hs.error && hs.lastDay === todayKey() ? `Today's hunt failed: ${hs.error}` : "";
  return html`
    <section class="hunt" aria-label="Bug of the day">
      <h3 class="cds--type-heading-compact-01 subhead">${icon("bug", 16)}Bug of the day</h3>
      ${body}${error ? html`<cds-inline-notification class="hunt__error" kind="error" low-contrast hide-close-button title="" subtitle=${error}></cds-inline-notification>` : nothing}
      ${clones && !running ? html`<cds-button kind="ghost" size="sm" class="is-flush bob-btn hunt__action" data-action="hunt-run">Hunt ${latest ? "again" : "now"}${icon("sparkle", 16, { slot: "icon" })}</cds-button>` : nothing}
    </section>`;
}

function standupButton() {
  if (!connected()) return nothing;
  const ready = !!data();
  if (!aiOn()) return tip("Yesterday, today and blockers from your GitHub activity", html`<cds-button class="is-block" kind="tertiary" size="md" data-action="copy-standup" ?disabled=${!ready}>Copy standup update${icon("copy", 16, { slot: "icon" })}</cds-button>`, { control: true });
  const drafted = state.answered.has(todaysAnswer("standup"));
  return html`<cds-button class="is-block bob-btn ${drafted ? "bob-made" : ""}" kind="tertiary" size="md" data-action="bob-standup" ?disabled=${!ready}>${drafted ? "Today's standup draft" : "Write standup with Bob"}${icon("sparkle", 16, { slot: "icon" })}</cds-button>`;
}

export function renderToday() {
  const todos = state.day.todos;
  const open = todos.filter((t) => !t.done).length;
  render(
    html`<header class="panel__head">
        <h2 class="cds--type-heading-03">Today</h2>
        <cds-button kind="ghost" size="sm" data-action="settings" data-section="meetings">Edit</cds-button>
      </header>
      ${meetingsView(new Date())}
      ${huntCard()}
      <div class="today__todos">
        <h3 class="cds--type-heading-compact-01 subhead">To-dos ${open ? html`<cds-tag size="sm" type="gray">${open}</cds-tag>` : nothing}</h3>
        <cds-contained-list class="todos" size="sm">
          ${repeat(
            todos,
            (t) => t.id,
            (t) => html`<cds-contained-list-item class="todo ${t.done ? "is-done" : ""}">
              <div class="item__row">
                <cds-checkbox class="item__body" label-text=${t.text} data-action="todo-toggle" data-id=${t.id} .checked=${t.done}></cds-checkbox>
                <cds-icon-button class="todo__remove" kind="ghost" size="sm" data-action="todo-remove" data-id=${t.id} align="left" aria-label="Remove ${t.text}">${icon("x", 16, { slot: "icon" })}<span slot="tooltip-content">Remove</span></cds-icon-button>
              </div>
            </cds-contained-list-item>`
          )}
        </cds-contained-list>
        <form class="todo-form" data-form="todo"><cds-text-input name="text" size="sm" hide-label label="New to-do" placeholder="Add a to-do" autocomplete="off"></cds-text-input></form>
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
  const verdict = (value, text) => html`<cds-selectable-tag size="md" text=${text} data-action="hunt-verdict" data-id=${report.id} data-verdict=${value} .selected=${report.verdict === value}></cds-selectable-tag>`;
  const related = report.related || [];
  return html`
    <div class="facts">
      <div class="facts__row">
        ${report.severity ? fact("alert", `${report.severity[0].toUpperCase()}${report.severity.slice(1)} severity`, { tone: SEVERITY[report.severity] }) : nothing}
        ${report.effort ? fact("clock", report.effort) : nothing}
        ${report.found && report.confidence ? fact("check", `${report.confidence[0].toUpperCase()}${report.confidence.slice(1)} confidence`, { tone: CONFIDENCE[report.confidence], tooltip: confidenceNote(report.markdown) }) : nothing}
        ${report.found
          ? related.length
            ? fact("issue", html`Maybe reported: ${related.map((r, i) => html`${i ? ", " : ""}<cds-link inline href=${r.url} target="_blank" rel="noopener" title="${r.title} (${r.state})">${r.ref}</cds-link>`)}`, { tone: "warning" })
            : fact("issue", "Not reported on GitHub yet")
          : nothing}
        ${fact("git", html`<span class="mono">${String(report.branch).split("/").pop()} ${String(report.head || "").slice(0, 7)}</span>`, { tooltip: `Checked ${report.branch} in ${report.path}` })}
      </div>
      ${report.found || code
        ? html`<div class="facts__row">
            ${report.found
              ? busy
                ? html`<cds-inline-loading status="active">Bob is filling in the form…</cds-inline-loading>`
                : tip("Opens the repo's Bug report form with this report filled in", html`<cds-button size="sm" data-action="hunt-issue" data-id=${report.id}>Open a GitHub issue${icon("github", 16, { slot: "icon" })}</cds-button>`, { control: true })
              : nothing}
            ${code ? html`<cds-button kind="ghost" size="sm" href=${code}>Open in VS Code${icon("code", 16, { slot: "icon" })}</cds-button>` : nothing}
            ${report.found
              ? html`<span class="facts__links verdict" role="group" aria-label="Was it a real bug?">${tip("Bob sees your answer on the next hunt in this repo", "Was it a real bug?")}${verdict("real", "Real bug")}${verdict("not", "Not a bug")}</span>`
              : nothing}
          </div>`
        : nothing}
      ${issuePicks(report)}
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
    <cds-accordion class="hunt-earlier" size="md"><cds-accordion-item title="Earlier hunts (${earlier.length})">
      <cds-contained-list size="md">${repeat(
        earlier,
        (h) => h.id,
        (h) => html`<cds-contained-list-item clickable data-action="hunt-open" data-id=${h.id}>
          <span class="hunt-list__title">${h.title}</span>
          <span class="hunt-list__meta">${repoShort(h.repo)} · ${dayLabel(h.at, true)}${h.verdict ? ` · ${h.verdict === "real" ? "real bug" : "not a bug"}` : ""}</span>
          <cds-icon-button slot="action" kind="ghost" size="sm" data-action="hunt-delete" data-id=${h.id} align="left" aria-label="Delete ${h.title}">${icon("trash", 16, { slot: "icon" })}<span slot="tooltip-content">Delete</span></cds-icon-button>
        </cds-contained-list-item>`
      )}</cds-contained-list>
    </cds-accordion-item></cds-accordion>`;
}

/** A hunt report in the Bob sheet. Follow-ups ("draft the fix", "write the issue") run in the same clone. */
export function openReport(report) {
  if (!report) return;
  const where = report.file ? ` · ${report.file.split("/").pop()}${report.line ? `:${report.line}` : ""}` : "";
  openBob({
    title: report.found ? report.title : "Bug hunt: nothing found",
    subtitle: `Bug of the day · ${repoShort(report.repo)}${where}`,
    trigger: `[data-action="hunt-open"][data-id="${CSS.escape(report.id)}"]`,
    prompt: `You found this bug earlier in a local clone of ${report.repo} at ${report.branch}:\n\n${report.markdown}`,
    // The hunt's own worktree: follow-ups such as "draft the fix" may edit files there.
    opts: { workspace: report.path, edit: true },
    answer: { text: report.markdown, at: report.at, label: "Reported", log: report.log },
    head: () => reportFacts(report.id),
    transform: reportBody,
    extra: () => reportMore(report.id),
    // Files Bob cites open in VS Code, in the hunt's worktree.
    files: (file, line) => {
      const href = vscodeUrl(report.path, file, line);
      return href ? { href } : null;
    },
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
  "hunt-delete": (el) => {
    state.bugHunts = state.bugHunts.filter((h) => h.id !== el.dataset.id);
    return saveHunts();
  },
};
