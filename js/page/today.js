/** The Today card: meetings, to-dos, the standup and the bug of the day. */

import { bobContext, openBob, todaysAnswer } from "./bob.js";
import { agoText, copyText, dayLabel, duration, keepFocus, setHtml, toast } from "./pieces.js";
import { $, aiOn, connected, data, ext, state, vscodeUrl } from "./state.js";
import { checkWorker } from "./top.js";

const { collapse } = DD.motion;
const { esc, plural } = DD.util;
const { icon } = DD.icons;
const ins = DD.insights;

/**
 * Today's meetings on a timeline. A meeting in progress shows how far along
 * it is; otherwise a "now" line sits between the last meeting and the next.
 */
function agendaHtml(meetings, now, showNow = true) {
  const live = meetings.filter((m) => now >= m.start && now < m.end);
  const nextAt = live.length ? -1 : meetings.findIndex((m) => m.start > now);
  const next = meetings[nextAt];
  const { fmtTime } = DD.util;
  const dot = (tip, label) => `<span class="agenda__dot" data-tooltip="${esc(tip)}"></span><span class="sr-only">${esc(label)}</span>`;
  const nowRow = `<li class="agenda__now">
      ${dot(`Now · ${fmtTime(now)}`, `Now, ${fmtTime(now)}:`)}<span class="agenda__line"></span>
      <span class="agenda__when">${next ? `${esc(next.title)} in ${duration(Math.ceil((next.start - now) / 60000))}` : "Done for today"}</span>
    </li>`;
  const rows = meetings.map((m, i) => {
    const length = m.minutes;
    const isLive = live.includes(m);
    const past = now >= m.end;
    const when = isLive ? `<span class="agenda__live">${duration(Math.ceil((m.end - now) / 60000))} left</span>` : duration(length);
    const progress = isLive ? `<span class="agenda__progress" style="--done: ${Math.round(((now - m.start) / (m.end - m.start)) * 100)}%"></span>` : "";
    const row = `<li class="agenda__item${past ? " is-past" : ""}${isLive ? " is-live" : ""}${i === nextAt ? " is-next" : ""}">
        ${dot(`${fmtTime(m.start)} – ${fmtTime(m.end)}`, `${fmtTime(m.start)}:`)}<span class="agenda__title" data-tooltip="${esc(m.title)}">${esc(m.title)}</span><span class="agenda__when">${when}</span>${progress}
      </li>`;
    return i === nextAt ? nowRow + row : row;
  });
  if (showNow && !live.length && nextAt < 0) rows.push(nowRow);
  return `<ol class="agenda">${rows.join("")}</ol>`;
}

let agendaOpen = false;

export function renderToday() {
  const el = $("#today");
  const now = new Date();
  const meetings = DD.sync.todaysMeetings(state.settings, now);
  const todos = state.day.todos;
  const open = todos.filter((t) => !t.done).length;
  const d = data();

  // Once the last meeting ends the timeline has nothing left to say; fold it so the to-dos get the room.
  const done = meetings.length && meetings.every((m) => now >= m.end);
  const agenda = !meetings.length
    ? `<p class="quiet">No meetings today.</p>`
    : done
      ? `<details class="agenda-done" ${agendaOpen ? "open" : ""}><summary>${icon("check", 14)}${plural(meetings.length, "meeting")} done for today${icon("chevronDown", 14)}</summary>${agendaHtml(meetings, now, false)}</details>`
      : agendaHtml(meetings, now);

  keepFocus(el, () => {
    setHtml(
      el,
      `
      <header class="panel__head">
        <h2>Today</h2>
        <button class="btn btn--ghost btn--sm" data-action="settings" data-section="schedule">Edit</button>
      </header>
      ${agenda}
      ${huntCard()}
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
               ${
                 aiOn()
                   ? state.answered.has(todaysAnswer("standup"))
                     ? `<button class="btn btn--ghost btn--block bob-btn bob-made" data-action="ai-standup" ${d ? "" : "disabled"} data-tooltip="Open the draft Bob wrote today">${icon("sparkle", 16)}Today's standup draft</button>`
                     : `<button class="btn btn--ghost btn--block bob-btn" data-action="ai-standup" ${d ? "" : "disabled"} data-tooltip="Bob writes it from your PRs, reviews and to-dos; edit before copying">${icon("sparkle", 16)}Write standup with Bob</button>`
                   : `<button class="btn btn--ghost btn--block" data-action="copy-standup" ${d ? "" : "disabled"} data-tooltip="Yesterday, today and blockers from your GitHub activity">${icon("copy", 16)}Copy standup update</button>`
               }
             </footer>`
          : ""
      }`
    );
  });
}

function huntCard() {
  if (!aiOn() || !state.settings.bugHunt) return "";
  const s = state.settings;
  const hs = state.huntState || {};
  const latest = state.bugHunts[0];
  const clones = DD.hunt.huntable(s);
  let body;
  if (DD.hunt.running(hs))
    body = `<p class="hunt__status bob-shimmer" role="status"><span class="bob__spinner" aria-hidden="true"></span>Bob is reading ${esc(DD.util.repoShort(hs.repo))}… <span data-ago="${esc(hs.startedAt)}">${agoText(hs.startedAt)}</span></p>`;
  else if (!clones.length) body = `<p class="hunt__status">Add a local clone of a repo to start.</p><button class="btn btn--ghost btn--sm hunt__action" data-action="settings" data-section="bob">Open Bob settings</button>`;
  else if (latest) {
    // Bob's claim, so its confidence is up front.
    const where = [DD.util.repoShort(latest.repo), latest.file ? `${latest.file.split("/").pop()}${latest.line ? `:${latest.line}` : ""}` : "", latest.effort, latest.found && latest.confidence && `${latest.confidence} confidence`].filter(Boolean).join(" · ");
    body = `<button class="hunt__report bob-btn ${latest.found ? "" : "is-empty"}" data-action="hunt-open" data-id="${esc(latest.id)}">
              <span class="hunt__title">${esc(latest.title)}</span>
              <span class="hunt__meta">${latest.day === DD.util.todayKey() ? "Today" : esc(dayLabel(latest.at, { dated: true }))} · ${esc(where)}${latest.related?.length ? ` · ${plural(latest.related.length, "related issue")}` : ""}</span>
            </button>`;
  } else body = `<p class="hunt__status">First hunt at ${esc(DD.util.fmtTime(DD.util.parseTime(s.bugHuntTime)))}.</p>`;
  // A hunt still marked running after the stale window was cut off (browser closed or worker stopped).
  const interrupted = hs.running && !DD.hunt.running(hs);
  const error =
    interrupted ? `<p class="hunt__error">The last hunt was interrupted before it finished.</p>`
    : hs.error && hs.lastDay === DD.util.todayKey() ? `<p class="hunt__error">Today's hunt failed: ${esc(hs.error)}</p>`
    : "";
  return `
    <section class="hunt" aria-label="Bug of the day">
      <h3 class="subhead">${icon("bug", 14)}Bug of the day</h3>
      ${body}${error}
      ${clones.length && !DD.hunt.running(hs) ? `<button class="btn btn--ghost btn--sm bob-btn hunt__action" data-action="hunt-run">${icon("sparkle", 14)}Hunt ${latest ? "again" : "now"}</button>` : ""}
    </section>`;
}

/** Starts a hunt in the background worker; the result arrives through storage (see onStorage). */
export async function huntNow() {
  if (!ext) return toast("Bug hunts run in the Chrome extension", "error");
  if (!(await checkWorker())) return toast("The background worker is out of date. Click “Reload extension” at the top, then try again.", "error");
  const res = await chrome.runtime.sendMessage({ type: "bug-hunt" }).catch((err) => ({ ok: false, error: err.message }));
  if (res?.ok) toast("Bob is hunting. This can take a few minutes, and you can keep working.");
  else toast(res?.error || "Couldn't start the bug hunt.", res?.skipped ? "neutral" : "error");
}

function huntExtra(report) {
  const chips = [report.severity && `${report.severity} severity`, report.effort, report.confidence && `${report.confidence} confidence`].filter(Boolean);
  const related = report.related?.length
    ? `<p class="bob__label">Possibly already reported</p><ul class="bob__links">${report.related.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.ref)}</a> ${esc(r.title)} <span class="quiet-inline">${esc(String(r.state).toLowerCase())}</span></li>`).join("")}</ul>`
    : report.found
      ? `<p class="bob__label">No matching GitHub issue found.</p>`
      : "";
  const earlier = state.bugHunts.filter((h) => h.id !== report.id).slice(0, 8);
  return `
    <div class="bob__report-meta">
      ${chips.length ? `<p class="bob__chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</p>` : ""}
      ${report.file && vscodeUrl(report.path, report.file, report.line) ? `<p class="bob__label"><a class="link link--bob" href="${esc(vscodeUrl(report.path, report.file, report.line))}">${icon("code", 14)}Open ${esc(report.file.split("/").pop())}${report.line ? `:${report.line}` : ""} in VS Code</a></p>` : ""}
      <p class="bob__label">Checked ${esc(DD.util.repoShort(report.repo))} at <span class="mono">${esc(report.branch)} ${esc(String(report.head || "").slice(0, 7))}</span> in <span class="mono">${esc(report.path)}</span></p>
      ${related}
      ${
        earlier.length
          ? `<p class="bob__label">Earlier hunts</p>
             <ul class="hunt-list">${earlier
               .map(
                 (h) => `<li><button class="hunt-list__item bob-btn bob-made" data-action="hunt-open" data-id="${esc(h.id)}" data-tooltip="${esc(h.title)}">
                   ${icon("sparkle", 14)}<span class="hunt-list__title">${esc(h.title)}</span><span class="hunt-list__meta">${esc(DD.util.repoShort(h.repo))} · ${esc(dayLabel(h.at, { dated: true }))}</span>
                 </button></li>`
               )
               .join("")}</ul>`
          : ""
      }
    </div>`;
}

export function bobReport(report) {
  if (!report) return;
  openBob({
    title: report.found ? "Bug of the day" : "Bug hunt",
    subtitle: `${DD.util.repoShort(report.repo)}${report.file ? ` · ${report.file}${report.line ? `:${report.line}` : ""}` : ""}`,
    extra: huntExtra(report),
    regenerate: false,
    trigger: `[data-action="hunt-open"][data-id="${CSS.escape(report.id)}"]`,
    build: async () => ({
      prompt: DD.ai.reportPrompt(bobContext(), report),
      answer: report.markdown,
      at: report.at,
      label: "Reported",
      // Follow-ups ("draft the fix", "write the issue") read the same clone.
      opts: { workspace: report.path, maxTurns: 30, timeoutMs: 420000 },
    }),
  });
}

export async function copyStandup() {
  const d = data();
  if (d) copyText(ins.standup(d), "Standup update copied");
}

export const todayActions = {
  "copy-standup": copyStandup,
  "todo-remove": async (el) => {
    await collapse(el.closest(".todo"));
    state.day.todos = state.day.todos.filter((t) => t.id !== el.dataset.id);
    renderToday();
    $('[data-focus="todo-input"]')?.focus();
    await DD.day.update((d) => (d.todos = d.todos.filter((t) => t.id !== el.dataset.id)));
  },
  "hunt-run": huntNow,
  "hunt-open": (el) => bobReport(state.bugHunts.find((h) => h.id === el.dataset.id)),
};

export function bindToday() {
  // <details> toggle doesn't bubble; remember the folded agenda across the once-a-minute re-render.
  $("#today").addEventListener("toggle", (e) => e.target.matches(".agenda-done") && (agendaOpen = e.target.open), true);
}
