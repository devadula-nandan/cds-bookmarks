// The Bob sheet. Every Bob button starts a session; several can run at once. Sessions work minimised:
// the button that started one shows its status, a toast says when it's done, and clicking either opens
// it in the sheet. Answers that need no waiting (saved ones, bug reports) open straight away.

import {
  BobError,
  MODES,
  TEST_PROMPT,
  answerKey,
  askBob,
  askPrompt,
  catchUpPrompt,
  cleanQuery,
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
import { esc, itemRef, plural, uid } from "../core.js";
import { enabledRepos, repoBySlug } from "../repos.js";
import { todaysMeetings } from "../sync.js";
import { icon } from "./icons.js";
import { checklist, markdown } from "./markdown.js";
import { addTodos } from "./today.js";
import { $, $$, activityList, agoText, bobTargets, copyText, data, go, keepFocus, searchUrl, state, toast } from "./ui.js";

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
 *   trigger, fallback           selectors for the button that shows this session's status (fallback: its tab)
 *   format                      "edit", "reply" or "query": the answer is a draft to edit and revise
 *   input                       ask for text first (the Slack thread); spec.makePrompt(text) builds the prompt
 *   answer, extra, regenerate   a ready-made answer (bug reports), markup under it, and whether Regenerate shows
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
  const saved = !fresh && (await savedAnswer(spec.key));
  if (saved) {
    s.turns.push({ role: "bob", text: saved.text, log: saved.log, at: saved.at, label: "Saved answer" });
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
  if (!sheet().open) sheet().showModal();
  render();
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

/** Closing the sheet, however it happens: the ✕ or minimise button, Escape, or a click on the backdrop. */
function hideSheet() {
  if (shown) leave(shown);
  shown = null;
  if (sheet().open) sheet().close();
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

const paint = (s) => (s === shown ? render() : markTriggers());
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

const logToggle = (log) => (SHOW_LOGS && log ? `<details class="bob__log"><summary>${icon("code", 14)}Bob Shell log <span>${plural(log.split("\n").length, "line")}</span></summary><pre>${esc(log)}</pre></details>` : "");

function answerHtml(s, turn) {
  if (turn !== firstAnswer(s) || !isDraft(s)) return `<div class="bob__answer">${markdown(turn.text)}</div>`;
  const last = s.revisions.at(-1);
  const undo = last ? `<p class="bob__revised">${icon("sparkle", 14)}<span>Revised: “${esc(last.ask)}”</span><button class="btn btn--ghost btn--sm" data-action="bob-undo">Undo</button></p>` : "";
  if (s.spec.format === "query")
    return `${undo}<form class="field-row" data-form="bob-query"><input class="input mono" name="q" value="${esc(draftText(s))}" aria-label="GitHub search query" data-focus="bob-draft" spellcheck="false"><button class="btn btn--primary" type="submit">Search GitHub</button></form>`;
  return `${undo}<textarea class="input bob__edit" rows="11" aria-label="Draft, editable" data-focus="bob-draft">${esc(draftText(s))}</textarea>`;
}

function render() {
  const s = shown;
  if (!s) return;
  const { spec, turns, error } = s;
  const loading = !!s.controller;
  const first = firstAnswer(s);
  const last = turns.findLast((t) => t.role === "bob");
  const todos = last && !loading ? checklist(last.text) : [];

  const input =
    spec.input && !spec.text
      ? `<form class="bob__input" data-form="bob-input">
           <label class="field"><span>${esc(spec.input.label)}</span><textarea class="input bob__edit" name="text" rows="12" placeholder="${esc(spec.input.placeholder)}" data-focus="bob-input" required></textarea></label>
           <div class="bob__input-foot"><p class="hint">${spec.input.hint}</p><button class="btn btn--primary" type="submit">${icon("sparkle", 16)}${esc(spec.input.submit)}</button></div>
         </form>`
      : "";
  const thread = turns
    .map((t) => `<div class="bob__turn">${t.role === "user" ? `<p class="bob__q">${esc(t.text)}</p>` : answerHtml(s, t) + logToggle(t.log) + (t === first && spec.extra ? spec.extra : "")}</div>`)
    .join("");
  const waiting = loading
    ? `<div class="bob__loading bob-shimmer" role="status"><span class="bob__spinner"></span><span>Bob is working…</span><span class="bob__elapsed mono">${Math.round((Date.now() - s.since) / 1000)}s</span><button class="btn btn--ghost btn--sm" data-action="bob-cancel">Cancel</button></div>`
    : "";
  const errorTitle = { missing: "Bob helper not found", license: "Accept Bob Shell's license", nokey: "Bob API key problem", cancelled: "Stopped" }[error?.code] || "Bob couldn't answer";
  const failure = error
    ? `<div class="notice ${error.code === "cancelled" ? "" : "notice--error"}" role="alert">${icon("alert", 16)}<div class="notice__body">
         <p class="notice__title">${errorTitle}</p>
         <p class="notice__text">${esc(error.message)}</p>
         <div class="notice__actions">${["nokey", "missing"].includes(error.code) ? `<button class="btn btn--primary btn--sm" data-action="settings" data-section="bob">Bob settings</button>` : ""}<button class="btn btn--sm" data-action="bob-retry">Try again</button></div>
       </div></div>${logToggle(error.log)}`
    : "";
  const tools = last
    ? `<div class="bob__tools">
         <button class="btn btn--ghost btn--sm" data-action="bob-copy">${icon("copy", 14)}Copy</button>
         ${todos.length ? `<button class="btn btn--ghost btn--sm" data-action="bob-todos">${icon("plus", 14)}Add ${plural(todos.length, "to-do")}</button>` : ""}
         ${spec.input ? `<button class="btn btn--ghost btn--sm" data-action="bob-new-thread" ${loading ? "disabled" : ""}>${icon("message", 14)}New thread</button>` : ""}
         ${spec.regenerate === false ? "" : `<button class="btn btn--ghost btn--sm bob-btn" data-action="bob-regenerate" ${loading ? "disabled" : ""}>${icon("refresh", 14)}Regenerate</button>`}
         <span class="bob__meta">${first.label || "Answered"} <span data-ago="${esc(first.at)}">${agoText(first.at)}</span></span>
       </div>
       <form class="bob__follow" data-form="bob-follow">
         <input class="input" name="q" placeholder="${isDraft(s) ? "Ask for changes: shorter, friendlier, add the PR links…" : "Ask a follow-up"}" autocomplete="off" aria-label="Follow-up" data-focus="bob-follow" ${loading ? "disabled" : ""}>
         <button class="icon-btn" type="submit" aria-label="Send" ${loading ? "disabled" : ""}>${icon("send", 16)}</button>
       </form>`
    : "";

  keepFocus(sheet(), () => {
    sheet().innerHTML = `
      <header class="sheet__head bob__head">
        <span class="chip-icon tone-info ${loading ? "is-thinking" : ""}">${icon("sparkle", 20)}</span>
        <div class="bob__title">
          <h2>${esc(spec.title)}</h2>
          ${spec.subtitle ? (spec.url ? `<a class="bob__subtitle" href="${esc(spec.url)}" target="_blank">${esc(spec.subtitle)}</a>` : `<p class="bob__subtitle">${esc(spec.subtitle)}</p>`) : ""}
        </div>
        <button class="icon-btn" data-action="bob-hide" aria-label="${loading ? "Minimise" : "Close"}" data-tooltip="${loading ? "Minimise. Bob keeps working" : "Close"}">${icon(loading ? "minus" : "x", 18)}</button>
      </header>
      <div class="sheet__body bob__body">${input}${thread}${waiting}${failure}</div>
      ${tools ? `<footer class="bob__foot">${tools}</footer>` : ""}`;
  });
  if (loading) $(".bob__body").scrollTop = $(".bob__body").scrollHeight;

  clearInterval(timer);
  if (loading) timer = setInterval(() => ($(".bob__elapsed") ? ($(".bob__elapsed").textContent = `${Math.round((Date.now() - s.since) / 1000)}s`) : null), 1000);
  markTriggers();
}

/**
 * Bob buttons (.bob-btn) light up under the pointer: a ripple where it comes in (a brighter one on press) and
 * a glow that follows it. Skipped when the system asks for reduced motion.
 */
export function bindBobEffects() {
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const button = (e) => {
    const btn = e.target.closest?.(".bob-btn");
    return btn && !btn.disabled ? btn : null;
  };
  function ripple(btn, e, press = false) {
    if (calm()) return;
    const fx = btn.querySelector(":scope > .bob-fx") || btn.appendChild(Object.assign(document.createElement("span"), { className: "bob-fx" }));
    const r = btn.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    // Big enough to reach the farthest corner.
    const size = 2 * Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));
    const dot = Object.assign(document.createElement("span"), { className: `bob-ripple${press ? " bob-ripple--press" : ""}` });
    dot.style.cssText = `left: ${x}px; top: ${y}px; width: ${size}px; height: ${size}px`;
    dot.onanimationend = () => dot.remove();
    fx.append(dot);
  }
  // The glow only shows once the pointer has placed it (data-glow), so a button re-rendered under a still pointer doesn't light up at its centre.
  function glow(btn, e) {
    const r = btn.getBoundingClientRect();
    btn.style.setProperty("--mx", `${e.clientX - r.left}px`);
    btn.style.setProperty("--my", `${e.clientY - r.top}px`);
    btn.dataset.glow = "";
  }
  // pointerenter doesn't bubble, but a capturing listener on the document still sees it.
  document.addEventListener(
    "pointerenter",
    (e) => {
      if (!e.target.classList?.contains("bob-btn") || e.target.disabled) return;
      glow(e.target, e);
      ripple(e.target, e);
    },
    true
  );
  document.addEventListener("pointerdown", (e) => button(e) && ripple(button(e), e, true));
  document.addEventListener("pointermove", (e) => button(e) && glow(button(e), e));
}

/** Typing in a draft keeps the edits on its turn, so re-renders and revisions start from them. */
export function bindBobSheet() {
  sheet().addEventListener("input", (e) => {
    if (e.target.dataset.focus === "bob-draft" && shown) firstAnswer(shown).draft = e.target.value;
  });
  // Escape closes the dialog natively; tidy up the same way as the close button. The event arrives
  // late, so skip it if a session was shown again meanwhile.
  sheet().addEventListener("close", () => !sheet().open && hideSheet());
  sheet().addEventListener("click", (e) => e.target === sheet() && hideSheet());
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
  openBob({
    title: MODES[modeFor(target.item, target.kind)].label,
    subtitle: `${target.item ? itemRef(subject) : target.task.ref} · ${subject.title}`,
    url: subject.url,
    trigger: `[data-action="bob-item"][data-key="${CSS.escape(key)}"]`,
    key: answerKey(target),
    prompt: itemPrompt(target),
  });
}

export const bobAsk = (q) => openBob({ title: "Ask Bob", subtitle: q, trigger: "#search .search__icon", prompt: askPrompt(q, state.settings, repoList()) });

export const bobFind = (q) => openBob({ title: "Find on GitHub", subtitle: q, format: "query", trigger: "#search .search__icon", prompt: findPrompt(q, state.settings, repoList()) });

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
  $("#activity").hidePopover();
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
    $("#settings").close();
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
    render();
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
  "copy-code": async (el) => {
    if (await copyText(el.closest(".code").querySelector("code").textContent, null)) el.textContent = "Copied";
  },
};
