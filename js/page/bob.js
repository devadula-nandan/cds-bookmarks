/** The Bob sheet: running a request, drafts and their revisions, minimising, and every Bob entry point. */

import { agoText, copyText, keepFocus, setHtml, toast } from "./pieces.js";
import { $, $$, activity, aiTargets, data, state, visibleTasks } from "./state.js";
import { renderToday } from "./today.js";

const { calm } = DD.motion;
const { esc, plural } = DD.util;
const { icon } = DD.icons;

/**
 * The Bob sheet shows one conversation. `spec.build(stage, signal)` makes the
 * opening prompt (fetching GitHub detail or running lookups, reporting
 * progress through `stage`) and may return run options or a saved `answer`.
 * Follow-ups resend the prompt with the exchange so far, plus fresh lookups
 * when the spec has `augment`. A spec with `input` first asks for text (a
 * pasted Slack thread). Opening answers are cached per item version or day.
 */
/** A new conversation: everything except the spec, the request in flight and its timer. */
// `shown` counts the turns already on screen, so a re-render only animates the new ones.
const blankBob = () => ({ base: "", cacheKey: null, opts: {}, turns: [], error: null, loading: null, minimised: false, shown: 0, wasLoading: false, revisions: [], flash: false });

export const bob = { spec: null, controller: null, timer: 0, ...blankBob() };

export function bobContext() {
  return {
    login: state.settings.login || data()?.viewer?.login || "",
    settings: state.settings,
    data: data(),
    tasks: visibleTasks(),
    meetings: DD.sync.todaysMeetings(state.settings),
    todos: state.day.todos,
    activity: activity(),
  };
}

export function openBob(spec, { fresh = false } = {}) {
  // Asking for the same thing again while it's minimised brings it back instead of starting over.
  if (bob.minimised && !fresh && spec.trigger && spec.trigger === bob.spec?.trigger && spec.subtitle === bob.spec.subtitle) return resumeBob();
  bob.controller?.abort();
  Object.assign(bob, { spec, ...blankBob() });
  const dialog = $("#ai");
  if (!dialog.open) dialog.showModal();
  if (spec.input && !spec.text) return renderBob();
  runBob(null, fresh);
}

export async function runBob(question, fresh = false) {
  // A saved answer needs no context, so show it straight away. Context is gathered only if a follow-up needs it.
  if (!question && !fresh && bob.spec.key) {
    const spec = bob.spec;
    const hit = await DD.ai.cached(spec.key);
    if (bob.spec !== spec) return;
    if (hit) {
      bob.cacheKey = spec.key;
      bob.turns.push({ role: "bob", text: hit.text, at: hit.at, saved: "Saved answer" });
      return renderBob();
    }
  }
  const controller = new AbortController();
  bob.controller = controller;
  bob.error = null;
  const initial = question || bob.base ? "Bob is thinking…" : "Gathering context from GitHub…";
  bob.loading = { stage: initial, since: Date.now() };
  // On a draft the request is shown as a revision note, not a chat bubble (see reviseDraft).
  if (question) bob.turns.push({ role: "user", text: question, revise: drafting() });
  if (question && drafting()) bob.loading.stage = "Revising the draft…";
  renderBob();
  const stage = (text) => {
    if (bob.controller !== controller) return;
    bob.loading.stage = text;
    renderBob();
  };
  // The context Bob answers from. Null if Bob was cancelled meanwhile.
  const gather = async () => {
    const built = await bob.spec.build(stage, controller.signal);
    if (controller.signal.aborted) return null;
    bob.base = built.prompt;
    bob.cacheKey = built.cacheKey || bob.spec.key || null;
    bob.opts = built.opts || {};
    return built;
  };
  try {
    let prompt;
    let opts = bob.opts;
    if (!question) {
      const built = await gather();
      if (!built) return;
      opts = bob.opts;
      if (built.answer) return bob.turns.push({ role: "bob", text: built.answer, at: built.at, saved: built.label || "Saved" });
      prompt = bob.base;
      if (bob.loading.stage === initial) stage("Bob is thinking…");
    } else {
      // The answer came from the cache, so the context it was written from hasn't been fetched yet.
      if (!bob.base) {
        stage("Gathering context from GitHub…");
        if (!(await gather())) return;
        opts = bob.opts;
        stage(drafting() ? "Revising the draft…" : "Bob is thinking…");
      }
      let base = bob.base;
      if (bob.spec.augment) {
        const more = await bob.spec.augment(question, stage, controller.signal);
        if (controller.signal.aborted) return;
        base = [bob.base, more.extra].filter(Boolean).join("\n\n");
        opts = { ...bob.opts, ...more.opts };
      }
      prompt = drafting() ? DD.ai.revisePrompt(base, draftOf(firstBobTurn()), question, bob.spec.format) : DD.ai.followUpPrompt(base, bob.turns.slice(0, -1), question);
    }
    let text = await DD.ai.ask(prompt, state.settings, controller.signal, opts);
    if (controller.signal.aborted) return;
    if (question && drafting()) {
      if (reviseDraft(question, text)) return;
      text = text.replace(/^\s*ANSWER:\s*/i, "");
    }
    bob.turns.push({ role: "bob", text, at: new Date().toISOString() });
    if (!question) DD.ai.remember(bob.cacheKey, { text });
  } catch (err) {
    if (controller.signal.aborted || err.code === "cancelled") {
      if (question && bob.turns.at(-1)?.role === "user") bob.turns.pop();
      if (!bob.turns.length) bob.error = new DD.ai.AIError("You stopped Bob before it answered.", "cancelled");
      return;
    }
    bob.error = err;
  } finally {
    if (bob.controller === controller) {
      bob.controller = null;
      bob.loading = null;
      renderBob();
      if (bob.minimised) toast(bob.error ? `Bob couldn't finish “${bob.spec.title}”` : `“${bob.spec.title}” is ready`, bob.error ? "error" : "success");
    }
  }
}

/** Where today's plan, standup or triage answer is saved. */
export const todaysAnswer = (kind) => `${kind}:${DD.util.todayKey()}`;

/** Answers that are a draft to edit and send. A follow-up on one revises the draft instead of adding to a thread. */
const drafting = () => ["edit", "reply", "query"].includes(bob.spec?.format);

export const firstBobTurn = () => bob.turns.find((t) => t.role === "bob");

/** The draft as it reads now: the reader's own edits if they made any, otherwise Bob's text. */
function draftOf(t) {
  if (!t) return "";
  if (t.draft != null) return t.draft;
  const { format } = bob.spec;
  return format === "reply" ? DD.ai.splitSources(t.text).reply : format === "query" ? DD.ai.cleanQuery(t.text) : t.text;
}

/** Puts Bob's revision in place of the draft and keeps the old one for Undo. False when Bob answered a question instead. */
function reviseDraft(question, text) {
  // A question: it stays in the thread as an ordinary exchange.
  if (/^\s*ANSWER:/i.test(text)) {
    delete bob.turns.at(-1).revise;
    return false;
  }
  bob.turns.pop();
  const first = firstBobTurn();
  const { text: before, draft, at, saved } = first;
  bob.revisions.push({ ask: question, text: before, draft, at, saved });
  // A revised Slack reply that drops its sources keeps the ones it had.
  const keep = bob.spec.format === "reply" && !DD.ai.splitSources(text).sources ? DD.ai.splitSources(first.text).sources : "";
  first.text = keep ? `${text.trim()}\n\nSOURCES:\n${keep}` : text;
  first.at = new Date().toISOString();
  first.saved = "Revised";
  delete first.draft;
  bob.flash = true;
  if (bob.cacheKey) DD.ai.remember(bob.cacheKey, { text: first.text });
  return true;
}

function undoRevision() {
  const last = bob.revisions.pop();
  const first = firstBobTurn();
  if (!last || !first) return;
  Object.assign(first, { text: last.text, draft: last.draft, at: last.at, saved: last.saved });
  if (first.draft === undefined) delete first.draft;
  if (bob.cacheKey) DD.ai.remember(bob.cacheKey, { text: first.text });
  bob.flash = true;
  renderBob();
}

function bobAnswer(t, first) {
  const { format } = bob.spec;
  if (first && drafting()) {
    const last = bob.revisions.at(-1);
    const note = last
      ? `<p class="bob__revised">${icon("sparkle", 14)}<span>Revised: “${esc(last.ask)}”</span><button class="btn btn--ghost btn--sm" data-action="bob-undo">Undo</button></p>`
      : "";
    const flash = bob.flash ? " is-revised" : "";
    if (format === "query")
      return `${note}<form class="field-row" data-form="bob-query">
                <input class="input mono${flash}" name="q" value="${esc(draftOf(t))}" aria-label="GitHub search query" data-focus="bob-query" spellcheck="false">
                <button class="btn btn--primary" type="submit">Search GitHub</button>
              </form>`;
    const sources = format === "reply" ? DD.ai.splitSources(t.text).sources : "";
    const label = format === "reply" ? "Reply draft, editable" : "Draft, editable";
    return `${note}<textarea class="input bob__edit${flash}" rows="${format === "reply" ? 9 : 11}" aria-label="${label}" data-focus="bob-edit" spellcheck="true">${esc(draftOf(t))}</textarea>
            ${sources ? `<div class="bob__answer bob__sources"><h4>Sources</h4>${DD.markdown.render(sources)}</div>` : ""}`;
  }
  return `<div class="bob__answer">${DD.markdown.render(t.text)}</div>`;
}

function renderBob() {
  const el = $("#ai");
  if (!bob.spec) return;
  const { spec, turns, loading, error } = bob;
  const firstBob = turns.find((t) => t.role === "bob");
  const lastBob = turns.findLast((t) => t.role === "bob");
  const todos = lastBob && !loading ? DD.markdown.checklist(lastBob.text) : [];
  const fresh = turns.length < bob.shown ? 0 : bob.shown;
  const thread = turns
    .map((t, i) => {
      if (t.revise) return "";
      const html = t.role === "user" ? `<p class="bob__q">${esc(t.text)}</p>` : bobAnswer(t, t === firstBob) + (t === firstBob && spec.extra ? spec.extra : "");
      return `<div class="bob__turn${i >= fresh ? " is-entering" : ""}">${html}</div>`;
    })
    .join("");
  const input =
    spec.input && !spec.text && !loading
      ? `<form class="bob__input" data-form="bob-input">
           <label class="field"><span>${esc(spec.input.label)}</span>
             <textarea class="input bob__edit" name="text" rows="12" placeholder="${esc(spec.input.placeholder)}" data-focus="bob-input" required></textarea>
           </label>
           <div class="bob__input-foot"><p class="hint">${spec.input.hint || ""}</p><button class="btn btn--primary" type="submit">${icon("sparkle", 16)}${esc(spec.input.submit)}</button></div>
         </form>`
      : "";

  const fix =
    error?.code === "nokey" || error?.code === "missing"
      ? `<button class="btn btn--primary btn--sm" data-action="settings" data-section="bob">Bob settings</button>`
      : "";
  const failure = error
    ? `<div class="notice ${error.code === "cancelled" ? "" : "notice--error"}" role="alert">${icon("alert", 16)}<div class="notice__body">
         <p class="notice__title">${error.code === "missing" ? "Bob helper not found" : error.code === "license" ? "Accept Bob Shell's license" : error.code === "nokey" ? "Bob API key problem" : error.code === "cancelled" ? "Stopped" : "Bob couldn't answer"}</p>
         <p class="notice__text">${esc(error.message)}</p>
         <div class="notice__actions">${fix}<button class="btn btn--sm" data-action="bob-retry">Try again</button></div>
       </div></div>`
    : "";
  const waiting = loading
    ? `<div class="bob__loading bob-shimmer${bob.wasLoading ? "" : " is-entering"}" role="status"><span class="bob__spinner" aria-hidden="true"></span><span>${esc(loading.stage)}</span><span class="bob__elapsed mono" data-since="${loading.since}">${Math.round((Date.now() - loading.since) / 1000)}s</span><button class="btn btn--ghost btn--sm" data-action="bob-cancel">Cancel</button></div>`
    : "";
  const meta = firstBob ? `<span class="bob__meta">${firstBob.saved || "Answered"} <span data-ago="${esc(firstBob.at)}">${agoText(firstBob.at)}</span></span>` : "";
  const tools = lastBob
    ? `<div class="bob__tools">
         <button class="btn btn--ghost btn--sm" data-action="bob-copy">${icon("copy", 14)}Copy</button>
         ${todos.length ? `<button class="btn btn--ghost btn--sm" data-action="bob-todos">${icon("plus", 14)}Add ${plural(todos.length, "to-do")}</button>` : ""}
         ${spec.input ? `<button class="btn btn--ghost btn--sm" data-action="bob-edit-input" ${loading ? "disabled" : ""}>${icon("message", 14)}New thread</button>` : ""}
         ${spec.regenerate === false ? "" : `<button class="btn btn--ghost btn--sm bob-btn" data-action="bob-regenerate" ${loading ? "disabled" : ""}>${icon("refresh", 14)}Regenerate</button>`}
         ${meta}
       </div>`
    : "";
  const follow = lastBob
    ? `<form class="bob__follow" data-form="bob-follow">
         <input class="input" name="q" placeholder="${drafting() ? (spec.format === "query" ? "Refine it: only open ones, since last week…" : "Ask for changes: shorter, friendlier, add the PR links…") : "Ask a follow-up"}" autocomplete="off" aria-label="${drafting() ? "Changes to the draft" : "Follow-up question"}" data-focus="bob-follow" ${loading ? "disabled" : ""}>
         <button class="icon-btn" type="submit" aria-label="Send" ${loading ? "disabled" : ""}>${icon("send", 16)}</button>
       </form>`
    : "";

  keepFocus(el, () => {
    el.innerHTML = `
      <header class="sheet__head bob__head">
        <span class="chip-icon tone-info ${loading ? "is-thinking" : ""}">${icon("sparkle", 20)}</span>
        <div class="bob__title">
          <h2>${esc(spec.title)}</h2>
          ${spec.subtitle ? (spec.url ? `<a class="bob__subtitle" href="${esc(spec.url)}" target="_blank" rel="noopener">${esc(spec.subtitle)}</a>` : `<p class="bob__subtitle">${esc(spec.subtitle)}</p>`) : ""}
        </div>
        ${loading
          ? `<button class="icon-btn" data-action="bob-minimise" data-focus="bob-dismiss" aria-label="Minimise" data-tooltip="Minimise. Bob keeps working">${icon("minus", 18)}</button>`
          : `<button class="icon-btn" data-action="bob-close" data-focus="bob-dismiss" aria-label="Close">${icon("x", 18)}</button>`}
      </header>
      <div class="sheet__body bob__body">${input}${thread}${waiting}${failure}</div>
      ${tools || follow ? `<footer class="bob__foot">${tools}${follow}</footer>` : ""}`;
  });
  const body = $(".bob__body", el);
  if (loading || bob.turns.at(-1)?.role === "user") body.scrollTop = body.scrollHeight;
  else if (bob.turns.length > 1) $$(".bob__q", body).at(-1)?.scrollIntoView({ block: "start" });

  bob.shown = turns.length;
  bob.wasLoading = !!loading;
  bob.flash = false;
  clearInterval(bob.timer);
  if (loading)
    bob.timer = setInterval(() => {
      const t = $(".bob__elapsed", el);
      if (t) t.textContent = `${Math.round((Date.now() - +t.dataset.since) / 1000)}s`;
    }, 1000);
  markBobTrigger();
}

export function closeBob() {
  bob.controller?.abort();
  clearInterval(bob.timer);
  bob.spec = null;
  bob.minimised = false;
  if ($("#ai").open) $("#ai").close();
  markBobTrigger();
}

/** Hides Bob while it works. The button that opened it shows its status and brings it back. */
export function minimiseBob() {
  bob.minimised = true;
  if ($("#ai").open) $("#ai").close();
  markBobTrigger();
}

export function resumeBob() {
  bob.minimised = false;
  $("#ai").showModal();
  renderBob();
}

/** Bob buttons: a ripple from where the pointer comes in (a brighter one where it presses) and a glow that follows it. */
export function bindBobMagic() {
  const bobBtn = (e) => {
    const btn = e.target.closest?.(".bob-btn");
    return btn && !btn.disabled ? btn : null;
  };
  function ripple(btn, e, press) {
    if (calm()) return;
    const fx = btn.querySelector(":scope > .bob-fx") || btn.appendChild(Object.assign(document.createElement("span"), { className: "bob-fx" }));
    const r = btn.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    // Big enough to reach the farthest corner from where it starts.
    const size = 2 * Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));
    const dot = Object.assign(document.createElement("span"), { className: `bob-ripple${press ? " bob-ripple--press" : ""}` });
    dot.style.cssText = `left: ${x}px; top: ${y}px; width: ${size}px; height: ${size}px`;
    dot.addEventListener("animationend", () => dot.remove());
    fx.append(dot);
  }
  // The glow sits under the pointer, so it only shows once the pointer has placed it (data-glow); a button
  // re-rendered under a still pointer would otherwise light up at its centre.
  function place(btn, e) {
    const r = btn.getBoundingClientRect();
    btn.style.setProperty("--mx", `${e.clientX - r.left}px`);
    btn.style.setProperty("--my", `${e.clientY - r.top}px`);
    btn.dataset.glow = "";
  }
  // pointerenter doesn't bubble, but capture-phase listeners on the document still see it.
  document.addEventListener(
    "pointerenter",
    (e) => {
      if (!e.target.classList?.contains("bob-btn") || e.target.disabled) return;
      place(e.target, e);
      ripple(e.target, e);
    },
    true
  );
  document.addEventListener("pointerdown", (e) => {
    const btn = bobBtn(e);
    if (btn) ripple(btn, e, true);
  });
  document.addEventListener("pointermove", (e) => {
    const btn = bobBtn(e);
    if (btn) place(btn, e);
  });
}

/**
 * Puts a minimised Bob's status (running, done, error) on whatever matches its spec's `trigger` selector.
 * When none of those is showing (a row on another tab, say), a pill under the greeting carries it instead.
 */
export function markBobTrigger() {
  const status = bob.minimised && bob.spec ? (bob.loading ? "running" : bob.error ? "error" : "done") : null;
  const targets = status && bob.spec.trigger ? $$(bob.spec.trigger) : [];
  for (const el of $$("[data-bob-status]")) if (!targets.includes(el) && !el.closest("#bob-pill")) delete el.dataset.bobStatus;
  for (const el of targets) el.dataset.bobStatus = status;
  // Rendered is enough: a row holding Bob's status always shows its buttons (and they may still be fading in).
  const onScreen = targets.some((el) => el.checkVisibility());
  const words = { running: "working…", done: "ready", error: "couldn't finish" };
  const pill = status && !onScreen
    ? `<button class="pill-btn bob-pill bob-btn" data-bob-status="${status}" data-tooltip="Bring Bob back">${icon("sparkle", 14)}<span>${esc(bob.spec.title)}</span><b>${words[status]}</b></button>`
    : "";
  // setHtml only touches the DOM on a change, which matters here: a MutationObserver calls this on every page mutation.
  setHtml($("#bob-pill"), pill);
  $("#bob-pill").hidden = !pill;
}

function bobItem(key) {
  const target = aiTargets.get(key);
  if (!target) return;
  const mode = DD.ai.modeFor(target.item || {}, target.kind);
  const subject = target.item || target.task;
  const ref = target.item ? DD.util.itemRef(subject) : target.task.ref;
  openBob({
    title: DD.ai.MODES[mode].label,
    subtitle: `${ref} · ${subject.title}`,
    url: subject.url,
    trigger: `[data-action="ai-item"][data-key="${CSS.escape(key)}"]`,
    key: DD.ai.answerKey(target),
    build: () => DD.ai.itemPrompt(bobContext(), target),
  });
}

export function bobAsk(q) {
  openBob({
    title: "Ask Bob",
    subtitle: q,
    trigger: "#search .search__icon",
    build: (stage, signal) => DD.ai.askBuild(bobContext(), q, stage, signal),
    augment: (question, stage, signal) => DD.ai.askAugment(bobContext(), question, stage, signal),
  });
}

export function bobSlack() {
  openBob({
    title: "Slack reply",
    subtitle: "Bob drafts a reply grounded in GitHub, the code and the website",
    trigger: '[data-action="ai-slack"]',
    format: "reply",
    input: {
      label: "Slack thread",
      placeholder: "Paste the whole thread here, oldest message first…",
      hint: "Bob looks up related issues and PRs, reads carbondesignsystem.com pages and your local clone when they help, and cites what it used.",
      submit: "Draft reply",
    },
    build(stage, signal) {
      return DD.ai.slackBuild(bobContext(), this.text, stage, signal);
    },
    augment: (question, stage, signal) => DD.ai.askAugment(bobContext(), question, stage, signal),
  });
}

export function bobFind(q) {
  openBob({ title: "Find on GitHub", subtitle: q, format: "query", trigger: "#search .search__icon", build: async () => ({ prompt: DD.ai.searchQueryPrompt(bobContext(), q) }) });
}

export function bobPlan() {
  openBob({ title: "Plan my day", subtitle: new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }), trigger: '[data-action="ai-plan"]', key: todaysAnswer("plan"), build: async () => ({ prompt: DD.ai.planPrompt(bobContext()) }) });
}

export function bobStandup() {
  openBob({ title: "Standup update", subtitle: "Edit it, then copy it into Slack", format: "edit", trigger: '[data-action="ai-standup"]', key: todaysAnswer("standup"), build: async () => ({ prompt: DD.ai.standupPrompt(bobContext()) }) });
}

export function bobCatchUp() {
  const all = activity();
  const since = state.lastSeenAt ? Date.parse(state.lastSeenAt) : 0;
  let entries = all.filter((a) => Date.parse(a.createdAt) > since);
  if (entries.length < 3) entries = all.filter((a) => Date.now() - Date.parse(a.createdAt) < 86400000);
  if (entries.length < 3) entries = all.slice(0, 30);
  if ($("#activity").matches(":popover-open")) $("#activity").hidePopover();
  openBob({ title: "Catch me up", subtitle: plural(entries.length, "update"), trigger: '[data-action="ai-catchup"]', build: async () => ({ prompt: DD.ai.catchUpPrompt(bobContext(), entries) }) });
}

function bobTriage() {
  const d = data();
  openBob({ title: "Triage", subtitle: `${plural(Math.min(12, d.triage.items.length), "issue")} waiting for triage`, trigger: '[data-action="ai-triage"]', key: todaysAnswer("triage"), build: async () => ({ prompt: await DD.ai.triagePrompt(bobContext()) }) });
}

async function bobCopy() {
  const last = bob.turns.findLast((t) => t.role === "bob");
  // On a draft, Copy takes the draft as it reads now (edits included), even after a question about it; otherwise the last answer.
  copyText(drafting() ? draftOf(firstBobTurn()) : last?.text ?? "");
}

async function bobTodos() {
  const items = DD.markdown.checklist(bob.turns.findLast((t) => t.role === "bob")?.text).map((text) => ({ id: DD.util.uid(), text, done: false }));
  if (!items.length) return;
  state.day.todos.push(...items);
  renderToday();
  await DD.day.update((d) => d.todos.push(...items));
  toast(`Added ${plural(items.length, "to-do")}`, "success");
}

export const bobActions = {
  "ai-item": (el) => bobItem(el.dataset.key),
  "ai-plan": bobPlan,
  "ai-standup": bobStandup,
  "ai-catchup": bobCatchUp,
  "ai-triage": bobTriage,
  "bob-close": closeBob,
  "bob-minimise": minimiseBob,
  "bob-cancel": () => bob.controller?.abort(),
  "bob-retry": () => {
    const last = bob.turns.at(-1);
    if (last?.role !== "user") return openBob(bob.spec, { fresh: true });
    bob.turns.pop();
    runBob(last.text);
  },
  "bob-regenerate": () => openBob(bob.spec, { fresh: true }),
  "bob-copy": bobCopy,
  "bob-undo": undoRevision,
  // The button itself says "Copied", so no toast.
  "copy-code": async (el) => {
    if (!(await copyText(el.closest(".code").querySelector("code").textContent, null))) return;
    el.textContent = "Copied";
    setTimeout(() => el.isConnected && (el.textContent = "Copy"), 1500);
  },
  "bob-todos": bobTodos,
  "ai-slack": bobSlack,
  "bob-edit-input": () => {
    bob.spec.text = null;
    openBob(bob.spec);
  },
};
