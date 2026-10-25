// The Today card: today's meetings on a timeline, the bug of the day, to-dos and the standup button.

import { todaysAnswer } from "../bob.js";
import { esc, fmtTime, parseTime, plural, repoShort, storage, todayKey, uid, updateDay } from "../core.js";
import { huntableRepos, isHunting } from "../hunt.js";
import { standup } from "../insights.js";
import { todaysMeetings } from "../sync.js";
import { openBob } from "./bob.js";
import { icon } from "./icons.js";
import { $, agoText, aiOn, connected, copyText, data, dayLabel, duration, keepFocus, setHtml, state, toast, vscodeUrl } from "./ui.js";

/** Meetings on a timeline. A meeting in progress shows how far along it is; otherwise a "now" line sits before the next one. */
function agenda(meetings, now) {
  const live = meetings.find((m) => now >= m.start && now < m.end);
  const next = live ? null : meetings.find((m) => m.start > now);
  const nowRow = `<li class="agenda__now"><span class="agenda__dot" data-tooltip="Now · ${fmtTime(now)}"></span><span class="agenda__line"></span><span class="agenda__when">${next ? `${esc(next.title)} in ${duration(Math.ceil((next.start - now) / 60000))}` : "Done for today"}</span></li>`;
  const rows = meetings.map((m) => {
    const isLive = m === live;
    const when = isLive ? `<span class="agenda__live">${duration(Math.ceil((m.end - now) / 60000))} left</span>` : duration(m.minutes);
    const progress = isLive ? `<span class="agenda__progress" style="--done: ${Math.round(((now - m.start) / (m.end - m.start)) * 100)}%"></span>` : "";
    const item = `<li class="agenda__item${now >= m.end ? " is-past" : ""}${isLive ? " is-live" : ""}${m === next ? " is-next" : ""}"><span class="agenda__dot" data-tooltip="${fmtTime(m.start)} – ${fmtTime(m.end)}"></span><span class="agenda__title" data-tooltip="${esc(m.title)}">${esc(m.title)}</span><span class="agenda__when">${when}</span>${progress}</li>`;
    return m === next ? nowRow + item : item;
  });
  if (!live && !next) rows.push(nowRow);
  return `<ol class="agenda">${rows.join("")}</ol>`;
}

function meetingsHtml(now) {
  const meetings = todaysMeetings(state.settings, now);
  if (!meetings.length) return `<p class="quiet">No meetings today.</p>`;
  // Once the last meeting is over, fold the timeline so the to-dos get the room.
  if (meetings.every((m) => now >= m.end))
    return `<details class="agenda-done"><summary>${icon("check", 14)}${plural(meetings.length, "meeting")} done for today${icon("chevronDown", 14)}</summary>${agenda(meetings, now)}</details>`;
  return agenda(meetings, now);
}

function huntCard() {
  if (!aiOn() || !state.settings.bugHunt) return "";
  const hs = state.huntState;
  const latest = state.bugHunts[0];
  const running = isHunting(hs);
  const clones = huntableRepos(state.settings).length;
  let body;
  if (running) body = `<p class="hunt__status bob-shimmer"><span class="bob__spinner"></span>Bob is reading ${esc(repoShort(hs.repo))}…<span class="hunt__ago" data-ago="${esc(hs.startedAt)}">${agoText(hs.startedAt)}</span></p>`;
  else if (!clones) body = `<p class="hunt__status">Add a local clone to a repo to start.</p><button class="btn btn--ghost btn--sm hunt__action" data-action="repo-editor">Edit repositories</button>`;
  else if (latest) {
    const where = [repoShort(latest.repo), latest.file && `${latest.file.split("/").pop()}${latest.line ? `:${latest.line}` : ""}`, latest.effort, latest.found && latest.confidence && `${latest.confidence} confidence`].filter(Boolean).join(" · ");
    body = `<button class="hunt__report bob-btn ${latest.found ? "" : "is-empty"}" data-action="hunt-open" data-id="${esc(latest.id)}">
              <span class="hunt__title">${esc(latest.title)}</span>
              <span class="hunt__meta">${esc(dayLabel(latest.at, true))} · ${esc(where)}</span>
            </button>`;
  } else body = `<p class="hunt__status">First hunt at ${fmtTime(parseTime(state.settings.bugHuntTime))}.</p>`;
  // Still marked running after the stale window: it was cut off (browser closed or worker stopped).
  const error = hs.running && !running ? "The last hunt was interrupted before it finished." : hs.error && hs.lastDay === todayKey() ? `Today's hunt failed: ${esc(hs.error)}` : "";
  return `
    <section class="hunt" aria-label="Bug of the day">
      <h3 class="subhead">${icon("bug", 14)}Bug of the day</h3>
      ${body}${error ? `<p class="hunt__error">${error}</p>` : ""}
      ${clones && !running ? `<button class="btn btn--ghost btn--sm bob-btn hunt__action" data-action="hunt-run">${icon("sparkle", 14)}Hunt ${latest ? "again" : "now"}</button>` : ""}
    </section>`;
}

function standupButton() {
  if (!connected()) return "";
  const ready = !!data();
  if (!aiOn()) return `<button class="btn btn--ghost btn--block" data-action="copy-standup" ${ready ? "" : "disabled"} data-tooltip="Yesterday, today and blockers from your GitHub activity">${icon("copy", 16)}Copy standup update</button>`;
  const drafted = state.answered.has(todaysAnswer("standup"));
  return `<button class="btn btn--ghost btn--block bob-btn${drafted ? " bob-made" : ""}" data-action="bob-standup" ${ready ? "" : "disabled"}>${icon("sparkle", 16)}${drafted ? "Today's standup draft" : "Write standup with Bob"}</button>`;
}

export function renderToday() {
  const el = $("#today");
  const todos = state.day.todos;
  const open = todos.filter((t) => !t.done).length;
  keepFocus(el, () =>
    setHtml(
      el,
      `<header class="panel__head">
        <h2>Today</h2>
        <button class="btn btn--ghost btn--sm" data-action="settings" data-section="meetings">Edit</button>
      </header>
      ${meetingsHtml(new Date())}
      ${huntCard()}
      <div class="today__todos">
        <h3 class="subhead">To-dos ${open ? `<span>${open}</span>` : ""}</h3>
        <ul class="todos">
          ${todos
            .map(
              (t) => `<li class="todo ${t.done ? "is-done" : ""}">
                <label><input type="checkbox" data-action="todo-toggle" data-id="${esc(t.id)}" data-focus="todo-${esc(t.id)}" ${t.done ? "checked" : ""}><span>${esc(t.text)}</span></label>
                <button class="icon-btn icon-btn--sm todo__remove" data-action="todo-remove" data-id="${esc(t.id)}" aria-label="Remove ${esc(t.text)}">${icon("x", 14)}</button>
              </li>`
            )
            .join("")}
        </ul>
        <form class="todo-form" data-form="todo">${icon("plus", 16)}<input name="text" placeholder="Add a to-do" autocomplete="off" aria-label="New to-do" data-focus="todo-input"></form>
      </div>
      ${connected() ? `<footer class="today__foot">${standupButton()}</footer>` : ""}`
    )
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

/** Details under a hunt report: confidence, a VS Code link, related issues and earlier hunts. */
function reportDetails(report, earlierOpen) {
  const chips = [report.severity && `${report.severity} severity`, report.effort, report.confidence && `${report.confidence} confidence`].filter(Boolean);
  const code = report.file && vscodeUrl(report.path, report.file, report.line);
  const earlier = state.bugHunts.filter((h) => h.id !== report.id).slice(0, 8);
  return `
    <div class="bob__report-meta">
      ${chips.length ? `<p class="bob__chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</p>` : ""}
      ${code ? `<p class="bob__label"><a class="link link--bob" href="${esc(code)}">${icon("code", 14)}Open ${esc(report.file.split("/").pop())}${report.line ? `:${report.line}` : ""} in VS Code</a></p>` : ""}
      <p class="bob__label">Checked ${esc(repoShort(report.repo))} at <span class="mono">${esc(report.branch)} ${esc(String(report.head || "").slice(0, 7))}</span> in <span class="mono">${esc(report.path)}</span></p>
      ${
        report.related?.length
          ? `<p class="bob__label">Possibly already reported</p><ul class="bob__links">${report.related.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.ref)}</a> ${esc(r.title)} <span class="quiet-inline">${esc(r.state)}</span></li>`).join("")}</ul>`
          : report.found
            ? `<p class="bob__label">No matching GitHub issue found.</p>`
            : ""
      }
      ${
        earlier.length
          ? `<details class="hunt-earlier" ${earlierOpen ? "open" : ""}><summary class="bob__label">Earlier hunts <span>${earlier.length}</span>${icon("chevronDown", 14)}</summary>
             <ul class="hunt-list">${earlier
               .map(
                 (h) => `<li class="hunt-list__row">
                   <button class="hunt-list__item bob-btn bob-made" data-action="hunt-open" data-id="${esc(h.id)}" data-tooltip="${esc(h.title)}">${icon("sparkle", 14)}<span class="hunt-list__title">${esc(h.title)}</span><span class="hunt-list__meta">${esc(repoShort(h.repo))} · ${esc(dayLabel(h.at, true))}</span></button>
                   <button class="icon-btn icon-btn--sm hunt-list__delete" data-action="hunt-delete" data-id="${esc(h.id)}" data-tooltip="Delete" aria-label="Delete ${esc(h.title)}">${icon("trash", 14)}</button>
                 </li>`
               )
               .join("")}</ul></details>`
          : ""
      }
    </div>`;
}

/** A hunt report in the Bob sheet. Follow-ups ("draft the fix", "write the issue") run in the same clone. */
export function openReport(report, earlierOpen = false) {
  if (!report) return;
  openBob({
    title: report.found ? "Bug of the day" : "Bug hunt",
    subtitle: `${repoShort(report.repo)}${report.file ? ` · ${report.file}${report.line ? `:${report.line}` : ""}` : ""}`,
    trigger: `[data-action="hunt-open"][data-id="${CSS.escape(report.id)}"]`,
    prompt: `You found this bug earlier in a local clone of ${report.repo} at ${report.branch}:\n\n${report.markdown}`,
    opts: { workspace: report.path },
    answer: { text: report.markdown, at: report.at, label: "Reported", log: report.log },
    extra: reportDetails(report, earlierOpen),
    regenerate: false,
  });
}

export const todayActions = {
  "copy-standup": () => copyText(standup(data()), "Standup update copied"),
  "todo-remove": (el) => changeTodo(el.dataset.id, (todos) => todos.filter((t) => t.id !== el.dataset.id)),
  "hunt-run": huntNow,
  // From the Earlier hunts list, the next report keeps that list open.
  "hunt-open": (el) => openReport(state.bugHunts.find((h) => h.id === el.dataset.id), !!el.closest(".hunt-earlier")),
  "hunt-delete": async (el) => {
    el.closest("li").remove();
    state.bugHunts = state.bugHunts.filter((h) => h.id !== el.dataset.id);
    await storage.set({ bugHunts: state.bugHunts });
  },
};
