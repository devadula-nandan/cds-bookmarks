// The Bob sheet. Every Bob button starts a session; several can run at once. Sessions work minimised:
// the button that started one shows its status, a toast says when it's done, and clicking either opens
// it in the sheet. Answers that need no waiting (saved ones, bug reports) open straight away.

import {
  BobError,
  MODES,
  TEST_PROMPT,
  answerKey,
  answerPrefix,
  askBob,
  askPrompt,
  catchUpPrompt,
  cleanQuery,
  earlierAnswer,
  findPrompt,
  followUpPrompt,
  itemPrompt,
  modeFor,
  planDay,
  planKey,
  planPrompt,
  revisePrompt,
  saveAnswer,
  savedAnswer,
  slackPrompt,
  standupPrompt,
  todaysAnswer,
  triagePrompt,
} from "../bob.js";
import { itemRef, plural, uid } from "../core.js";
import { enabledRepos, repoBySlug } from "../repos.js";
import { todaysMeetings } from "../sync.js";
import { icon } from "./icons.js";
import { html, live, nothing, render, unsafeHTML } from "./lit.js";
import { checklist, markdown } from "./markdown.js";
import { bindReview, diffLinks, reviewFacts, reviewForm } from "./review.js";
import { toggleActivity } from "./header.js";
import { addTodos } from "./today.js";
import { $, $$, activityList, agoText, bobTargets, copyText, data, go, searchUrl, state, toast } from "./ui.js";

// Each answer has a "Bob Shell log" toggle with Bob's full transcript. Comment out the next line to remove them all.
let SHOW_LOGS = false;
SHOW_LOGS = true;

const sheet = () => $("#ai");
const sessions = [];
let shown = null; // the session in the sheet
let timer = 0;

// ---------- sessions ----------

/**
 * Starts a session. `spec` says what to ask and how to show it:
 *   title, subtitle, url        the sheet's heading
 *   prompt, opts                what Bob gets (opts.workspace: run in that local clone)
 *   key                         where the answer is saved, so asking again is instant
 *   keyPrefix                   what keys for earlier versions of the same item start with: one is shown, marked out of date
 *   trigger, fallback           selectors for the button that shows this session's status (fallback: its tab)
 *   format                      "edit", "reply" or "query": the answer is a draft to edit and revise
 *   input                       ask for text first (the Slack thread); spec.makePrompt(text) builds the prompt
 *   answer, extra, regenerate   a ready-made answer (bug reports), a function for what goes under it, and whether Regenerate shows
 *   head                        a function for what goes under the title (a PR's facts)
 *   files, transform            where links to files in the repo go, and a reshaping of the answer (see markdown())
 */
export async function openBob(spec, { fresh = false } = {}) {
  // Asking again for something minimised brings it back instead of starting over.
  const same = !fresh && sessions.find((s) => s.minimised && s.spec.trigger === spec.trigger && s.spec.subtitle === spec.subtitle);
  if (same) return show(same);
  const s = { id: uid(), spec, prompt: spec.prompt, turns: [], revisions: [], minimised: true };
  sessions.push(s);
  if (spec.answer && !fresh) {
    s.turns.push({ role: "bob", ...spec.answer });
    return show(s);
  }
  if (spec.input && !spec.text) return show(s);
  const exact = !fresh && (await savedAnswer(spec.key));
  // An answer about an earlier commit beats starting over: it's shown marked out of date, with Regenerate.
  const saved = exact || (!fresh && spec.keyPrefix && (await earlierAnswer(spec.keyPrefix)));
  if (saved) {
    s.turns.push({ role: "bob", text: saved.text, log: saved.log, at: saved.at, label: exact ? "Saved answer" : "Answered", outdated: !exact });
    return show(s);
  }
  // Started from inside the sheet (Try again): stay in view.
  if (sheet().open) show(s);
  run(s);
}

function show(s) {
  if (shown && shown !== s) leave(shown);
  shown = s;
  s.minimised = false;
  s.toast?.remove();
  sheet().open = true;
  renderBob();
}

/** The sheet stops showing `s`: kept minimised while it works, otherwise closed. */
function leave(s) {
  if (s.controller) s.minimised = true;
  else drop(s);
}

function drop(s) {
  s.controller?.abort();
  sessions.splice(sessions.indexOf(s), 1);
}

/** Closing the sheet, however it happens: its close button, Escape, or a click outside it. */
function hideSheet() {
  if (shown) leave(shown);
  shown = null;
  sheet().open = false;
  clearInterval(timer);
  markTriggers();
}

/** Runs a session's first question, or a follow-up (`question`). */
async function run(s, question) {
  const controller = new AbortController();
  Object.assign(s, { controller, error: null, since: Date.now() });
  const draft = isDraft(s) && firstAnswer(s);
  if (question) s.turns.push({ role: "user", text: question });
  paint(s);
  try {
    const prompt = !question ? s.prompt : draft ? revisePrompt(s.prompt, draftText(s), question) : followUpPrompt(s.prompt, s.turns.slice(0, -1), question);
    const { text, log } = await askBob(prompt, state.settings, { ...s.spec.opts, signal: controller.signal });
    const at = new Date().toISOString();
    if (draft && question) {
      // A change to a draft replaces it; the old version is kept for Undo.
      s.turns.pop();
      s.revisions.push({ ask: question, text: draft.text, draft: draft.draft });
      Object.assign(draft, { text, log, at, label: "Revised", draft: undefined });
    } else s.turns.push({ role: "bob", text, log, at });
    if (!question || draft) saveAnswer(s.spec.key, { text: firstAnswer(s).text, log: SHOW_LOGS ? log : undefined });
  } catch (err) {
    if (err.code !== "cancelled") s.error = err;
    else if (question) s.turns.pop();
    else s.error = new BobError("You stopped Bob before it answered.", "cancelled");
  }
  if (s.controller !== controller) return; // replaced or closed meanwhile
  s.controller = null;
  paint(s);
  if (s.minimised) s.toast = toast(s.error ? `Bob couldn't finish “${s.spec.title}”` : `“${s.spec.title}” is ready`, s.error ? "error" : "success", { label: "Open", run: () => show(s) });
}

const paint = (s) => (s === shown ? renderBob() : markTriggers());
const firstAnswer = (s) => s.turns.find((t) => t.role === "bob");
const isDraft = (s) => ["edit", "reply", "query"].includes(s.spec.format);

/** A draft as it reads now: the user's own edits if they made any, otherwise Bob's text. */
function draftText(s) {
  const first = firstAnswer(s);
  if (!first) return "";
  return first.draft ?? (s.spec.format === "query" ? cleanQuery(first.text) : first.text);
}

// ---------- status on the buttons that started minimised sessions ----------

/**
 * Puts each minimised session's status (running, done, error) on the button that started it, or on its
 * tab (spec.fallback) while that button is on a hidden tab. Clicking a marked button opens the session.
 */
export function markTriggers() {
  const marks = new Map();
  for (const s of sessions) {
    if (!s.minimised) continue;
    const status = s.controller ? "running" : s.error ? "error" : "done";
    let targets = $$(s.spec.trigger);
    if (!targets.some((el) => el.checkVisibility()) && s.spec.fallback) targets = $$(s.spec.fallback);
    for (const el of targets) if (!marks.has(el)) marks.set(el, status);
  }
  for (const el of $$("[data-bob-status]")) if (!marks.has(el)) delete el.dataset.bobStatus;
  for (const [el, status] of marks) if (el.dataset.bobStatus !== status) el.dataset.bobStatus = status;
}

export const hasMinimised = () => sessions.some((s) => s.minimised);

/** A click on a marked button (main.js routes it here). */
export function openFromTrigger(el) {
  const s = sessions.find((x) => x.minimised && el.matches(x.spec.trigger));
  if (s) show(s);
}

// ---------- the sheet ----------

const logToggle = (log) =>
  SHOW_LOGS && log
    ? html`<cds-accordion class="bob__log" size="sm"><cds-accordion-item title="Bob Shell log (${plural(log.split("\n").length, "line")})"><pre>${log}</pre></cds-accordion-item></cds-accordion>`
    : nothing;

/** Markdown → sanitized HTML, kept per answer so a re-render doesn't parse it again. */
const rendered = new WeakMap();
function answerMarkup(s, turn) {
  if (rendered.get(turn)?.text !== turn.text) rendered.set(turn, { text: turn.text, html: unsafeHTML(markdown(turn.text, { files: s.spec.files, transform: s.spec.transform })) });
  return rendered.get(turn).html;
}

function answerView(s, turn) {
  const outdated = turn.outdated
    ? html`<cds-inline-notification class="bob__note" kind="info" low-contrast hide-close-button title="Written before the latest changes." subtitle="Regenerate for an up-to-date answer."></cds-inline-notification>`
    : nothing;
  if (turn !== firstAnswer(s) || !isDraft(s)) return html`${outdated}<div class="bob__answer">${answerMarkup(s, turn)}</div>`;
  const last = s.revisions.at(-1);
  const undo = last ? html`<p class="bob__revised">${icon("sparkle", 16)}<span>Revised: “${last.ask}”</span><cds-button kind="ghost" size="sm" data-action="bob-undo">Undo${icon("undo", 16, { slot: "icon" })}</cds-button></p>` : nothing;
  if (s.spec.format === "query")
    return html`${undo}<form class="field-row" data-form="bob-query"><cds-text-input class="mono" name="q" hide-label label="GitHub search query" .value=${live(draftText(s))} data-draft spellcheck="false"></cds-text-input><cds-button type="submit">Search GitHub</cds-button></form>`;
  return html`${undo}<cds-textarea class="bob__edit" rows="11" hide-label label="Draft, editable" data-draft .value=${live(draftText(s))}></cds-textarea>`;
}

const ERROR_TITLES = { missing: "Bob helper not found", license: "Accept Bob Shell's license", nokey: "Bob API key problem", cancelled: "Stopped" };

/** The AI label next to the title: who wrote the answer, and how. */
const AI_NOTE = html`<cds-ai-label size="xs" alignment="bottom-left" autoalign>
  <div slot="body-text">
    <p class="ai-note__label">AI explained</p>
    <p class="ai-note__title">Written by IBM Bob</p>
    <p class="ai-note__text">Bob works on this computer in agent mode, with gh, the web and your local clones. Check what it says before acting on it.</p>
  </div>
</cds-ai-label>`;

/** Draws the session in the sheet. While Bob works, it redraws every second (`ticking`) for the elapsed time. */
export function renderBob(ticking = false) {
  const s = shown;
  if (!s) return;
  const { spec, turns, error } = s;
  const loading = !!s.controller;
  const first = firstAnswer(s);
  const last = turns.findLast((t) => t.role === "bob");
  const todos = last && !loading ? checklist(last.text) : [];

  const input =
    spec.input && !spec.text
      ? html`<form class="bob__input" data-form="bob-input">
          <cds-textarea name="text" rows="12" label=${spec.input.label} placeholder=${spec.input.placeholder} helper-text=${spec.input.hint} required></cds-textarea>
          <cds-button type="submit">${spec.input.submit}${icon("sparkle", 16, { slot: "icon" })}</cds-button>
        </form>`
      : nothing;
  const thread = turns.map(
    (t) => html`<div class="bob__turn">${t.role === "user" ? html`<p class="bob__q">${t.text}</p>` : html`${answerView(s, t)}${logToggle(t.log)}${t === first && spec.extra ? spec.extra() : nothing}`}</div>`
  );
  const waiting = loading
    ? html`<div class="bob__loading" role="status">
        <div class="bob__loading-row"><cds-inline-loading status="active">Bob is working… <span class="mono">${Math.round((Date.now() - s.since) / 1000)}s</span></cds-inline-loading><cds-button kind="ghost" size="sm" data-action="bob-cancel">Cancel</cds-button></div>
        <cds-ai-skeleton-text paragraph .lineCount=${4}></cds-ai-skeleton-text>
      </div>`
    : nothing;
  const toSettings = error && ["nokey", "missing"].includes(error.code);
  const failure = error
    ? html`<cds-actionable-notification class="bob__note" inline low-contrast hide-close-button .hasFocus=${false} kind=${error.code === "cancelled" ? "info" : "error"} title=${ERROR_TITLES[error.code] || "Bob couldn't answer"} subtitle=${error.message}>
          <cds-actionable-notification-button slot="action" data-action=${toSettings ? "settings" : "bob-retry"} data-section="bob">${toSettings ? "Bob settings" : "Try again"}</cds-actionable-notification-button>
        </cds-actionable-notification>${logToggle(error.log)}`
    : nothing;
  const tools = last
    ? html`<footer class="bob__foot">
        <div class="bob__tools">
          <cds-button kind="ghost" size="sm" data-action="bob-copy">Copy${icon("copy", 16, { slot: "icon" })}</cds-button>
          ${todos.length ? html`<cds-button kind="ghost" size="sm" data-action="bob-todos">Add ${plural(todos.length, "to-do")}${icon("plus", 16, { slot: "icon" })}</cds-button>` : nothing}
          ${spec.input ? html`<cds-button kind="ghost" size="sm" data-action="bob-new-thread" ?disabled=${loading}>New thread${icon("message", 16, { slot: "icon" })}</cds-button>` : nothing}
          ${spec.regenerate === false ? nothing : html`<cds-button kind="ghost" size="sm" class="bob-btn" data-action="bob-regenerate" ?disabled=${loading}>Regenerate${icon("refresh", 16, { slot: "icon" })}</cds-button>`}
          <span class="bob__meta">${first.label || "Answered"} ${agoText(first.at)}</span>
        </div>
        <form class="bob__follow" data-form="bob-follow">
          <cds-text-input name="q" hide-label label="Follow-up" placeholder=${isDraft(s) ? "Ask for changes: shorter, friendlier, add the PR links…" : "Ask a follow-up"} autocomplete="off" ?disabled=${loading}></cds-text-input>
          <cds-icon-button type="submit" kind="primary" align="top-right" aria-label="Send" ?disabled=${loading}>${icon("send", 16, { slot: "icon" })}<span slot="tooltip-content">Send</span></cds-icon-button>
        </form>
      </footer>`
    : nothing;

  render(
    html`
      <cds-modal-header class="bob__head">
        <cds-modal-close-button></cds-modal-close-button>
        ${spec.subtitle ? html`<cds-modal-label>${spec.url ? html`<cds-link inline href=${spec.url} target="_blank">${spec.subtitle}</cds-link>` : spec.subtitle}</cds-modal-label>` : nothing}
        <cds-modal-heading><span class="bob__title">${spec.title}${AI_NOTE}</span></cds-modal-heading>
        ${spec.head ? spec.head() : nothing}
      </cds-modal-header>
      <cds-modal-body class="bob__body">${input}${thread}${waiting}${failure}</cds-modal-body>
      ${tools}`,
    sheet()
  );
  if (ticking) return;
  if (loading) $(".bob__body").scrollTop = $(".bob__body").scrollHeight;
  clearInterval(timer);
  if (loading) timer = setInterval(() => renderBob(true), 1000);
  markTriggers();
}

/** Typing in a draft keeps the edits on its turn, so re-renders and revisions start from them. */
export function bindBobSheet() {
  sheet().addEventListener("input", (e) => {
    if (e.target.matches("[data-draft]") && shown) firstAnswer(shown).draft = e.target.value;
  });
  // Escape, the close button and a click outside close the modal; tidy up the same way. The event arrives
  // late, so skip it if a session was shown again meanwhile.
  sheet().addEventListener("cds-modal-closed", () => !sheet().open && hideSheet());
  bindReview(sheet());
}

/** Forms inside the sheet (main.js routes submits here). */
export function submitBobForm(form, value) {
  const s = shown;
  if (!s || !value) return;
  if (form === "bob-follow" && !s.controller) run(s, value);
  if (form === "bob-query") go(searchUrl(value));
  if (form === "bob-input") {
    // The Slack thread is in: write the draft minimised, like any other Bob button.
    s.spec.text = value;
    s.prompt = s.spec.makePrompt(value);
    run(s); // starts the request first, so hiding the sheet keeps the session (minimised) instead of closing it
    hideSheet();
  }
}

// ---------- the Bob buttons ----------

const repoList = () => enabledRepos(state.settings);

function bobItem(key) {
  const target = bobTargets.get(key);
  const subject = target.item || target.task;
  const mode = modeFor(target.item, target.kind);
  // A review brief shows the PR's facts, links files to its diff, and has a box to submit the review.
  const review = mode === "review" && {
    head: () => reviewFacts(subject.id),
    files: diffLinks(subject.id),
    extra: () => reviewForm(subject.id, renderBob),
  };
  openBob({
    title: MODES[mode].label,
    subtitle: `${target.item ? itemRef(subject) : target.task.ref} · ${subject.title}`,
    url: subject.url,
    trigger: `[data-action="bob-item"][data-key="${CSS.escape(key)}"]`,
    key: answerKey(target),
    keyPrefix: target.item ? answerPrefix(target) : null,
    prompt: itemPrompt(target),
    ...review,
  });
}

export const bobAsk = (q) => openBob({ title: "Ask Bob", subtitle: q, trigger: "#search-icon", prompt: askPrompt(q, state.settings, repoList()) });

export const bobFind = (q) => openBob({ title: "Find on GitHub", subtitle: q, format: "query", trigger: "#search-icon", prompt: findPrompt(q, state.settings, repoList()) });

export function bobSlack() {
  openBob({
    title: "Slack reply",
    subtitle: "Bob drafts a reply grounded in GitHub, the code and the website",
    trigger: '[data-action="bob-slack"]',
    format: "reply",
    input: { label: "Slack thread", placeholder: "Paste the whole thread here, oldest message first…", hint: "Bob looks up related issues, PRs, docs and code, and lists its sources.", submit: "Draft reply" },
    makePrompt: (thread) => slackPrompt(thread, state.settings),
  });
}


/** Plans today's work, or the next weekday's once today's is over (see planDay). */
export function bobPlan() {
  const { date } = planDay();
  openBob({
    title: "Plan my day",
    subtitle: date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
    trigger: '[data-action="bob-plan"]',
    key: planKey(),
    prompt: planPrompt(state.settings, repoList(), todaysMeetings(state.settings, date), state.day.todos),
  });
}

export const bobStandup = () =>
  openBob({ title: "Standup update", subtitle: "Edit it, then copy it into Slack", format: "edit", trigger: '[data-action="bob-standup"]', key: todaysAnswer("standup"), prompt: standupPrompt(state.settings, repoList(), state.day.todos) });

export function bobCatchUp() {
  // What arrived since Activity was last opened; at least the last day, or the last 30 updates.
  const all = activityList();
  let entries = all.filter((a) => a.createdAt > (state.lastSeenAt || ""));
  if (entries.length < 3) entries = all.filter((a) => Date.now() - Date.parse(a.createdAt) < 86400000);
  if (entries.length < 3) entries = all.slice(0, 30);
  toggleActivity(false);
  openBob({ title: "Catch me up", subtitle: plural(entries.length, "update"), trigger: '[data-action="bob-catchup"]', prompt: catchUpPrompt(entries) });
}

function bobTriage() {
  // Most triage is in carbon, so Bob works in its clone when there is one.
  const clone = repoBySlug("carbon-design-system/carbon")?.clone;
  openBob({
    title: "Triage",
    subtitle: `${plural(data().triage.total, "issue")} waiting for triage`,
    trigger: '[data-action="bob-triage"]',
    fallback: "#tab-issues",
    key: todaysAnswer("triage"),
    prompt: triagePrompt(state.settings, repoList()),
    opts: { workspace: clone },
  });
}

const bobTest = () => openBob({ title: "Test prompt", subtitle: "Checks that Bob Shell can answer", trigger: '[data-action="bob-test"]', prompt: TEST_PROMPT });

export const bobActions = {
  "bob-item": (el) => bobItem(el.dataset.key),
  "bob-plan": bobPlan,
  "bob-standup": bobStandup,
  "bob-catchup": bobCatchUp,
  "bob-triage": bobTriage,
  "bob-slack": bobSlack,
  "bob-test": () => {
    $("#settings").open = false;
    bobTest();
  },
  "bob-hide": hideSheet,
  "bob-cancel": () => shown?.controller?.abort(),
  "bob-retry": () => {
    const s = shown;
    const last = s.turns.at(-1);
    if (last?.role !== "user") return openBob(s.spec, { fresh: true });
    s.turns.pop();
    run(s, last.text);
  },
  // Regenerating takes a while, so it runs minimised like a fresh ask.
  "bob-regenerate": () => {
    const spec = shown.spec;
    hideSheet();
    openBob(spec, { fresh: true });
  },
  "bob-undo": () => {
    const last = shown.revisions.pop();
    Object.assign(firstAnswer(shown), { text: last.text, draft: last.draft, label: "Answered" });
    saveAnswer(shown.spec.key, { text: last.text });
    renderBob();
  },
  "bob-copy": () => copyText(isDraft(shown) ? draftText(shown) : shown.turns.findLast((t) => t.role === "bob").text),
  "bob-todos": async () => {
    const texts = checklist(shown.turns.findLast((t) => t.role === "bob").text);
    await addTodos(texts);
    toast(`Added ${plural(texts.length, "to-do")}`, "success");
  },
  "bob-new-thread": () => {
    const spec = { ...shown.spec, text: null };
    hideSheet();
    openBob(spec, { fresh: true });
  },
  // Carbon's copy button says "Copied" itself.
  "copy-quote": (el) => copyText(el.closest("[data-copy]").dataset.copy, null),
};
