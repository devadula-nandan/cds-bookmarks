// Bob (IBM's AI assistant). Requests go over Chrome native messaging to ai-helper/bob-host.js, which
// runs Bob Shell on this computer. Prompts are plain questions plus links: Bob looks things up itself
// with gh, the web and the local clone. Nothing is sent until the user clicks a Bob action.

import { ageDays, fmtTime, itemRef, logins, parseTime, previousWorkday, storage, todayKey, uid } from "./core.js";
import { prState } from "./insights.js";
import { repoName } from "./repos.js";

export class BobError extends Error {
  constructor(message, code = "failed", log = null) {
    super(message);
    this.code = code; // "missing", "nokey", "license", "cancelled" or "failed"
    this.log = log;
  }
}

// ---------- talking to the helper ----------

function helperError(message = "Bob didn't answer.", log) {
  const text = String(message).replace(/^Error:\s*/, "");
  if (/license agreement is required|accept the license/i.test(text))
    return new BobError("Bob Shell needs its license accepted once. In Terminal, run `bob --show-license` to read it, then `bob --accept-license`.", "license", log);
  if (/api key is required|invalid api key|unauthori[sz]ed|401/i.test(text)) return new BobError(`Bob rejected the API key. Check it in Settings → Bob. (${text})`, "nokey", log);
  return new BobError(text, "failed", log);
}

/** One request per connection, so closing it (Cancel) stops Bob. */
function call(message, signal) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative("com.devdashboard.bob");
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      port.disconnect();
      fn(value);
    };
    port.onMessage.addListener((reply) => (reply?.ok ? finish(resolve, reply) : finish(reject, helperError(reply?.error, reply?.log))));
    port.onDisconnect.addListener(() => {
      const msg = chrome.runtime.lastError?.message || "The Bob helper stopped unexpectedly.";
      const missing = /not found|forbidden|not registered/i.test(msg);
      finish(reject, new BobError(missing ? "The Bob helper isn't installed. Run ai-helper/install.sh from the extension folder." : msg, missing ? "missing" : "failed"));
    });
    signal?.addEventListener("abort", () => finish(reject, new BobError("Cancelled", "cancelled")));
    port.postMessage({ id: uid(), ...message });
  });
}

/** Whether the helper and Bob Shell are installed: `{ ok, version, home }` or `{ ok: false, code, error }`. */
export async function bobStatus() {
  try {
    const reply = await call({ type: "ping" });
    return { ok: true, version: reply.version, home: reply.home };
  } catch (err) {
    return { ok: false, code: err.code, error: err.message };
  }
}

/**
 * Asks Bob, with no turn or time limit (`signal` cancels). `workspace` runs it in a local clone.
 * Returns `{ text, log }`, where `log` is Bob Shell's whole transcript.
 */
export async function askBob(prompt, settings, { signal, workspace } = {}) {
  if (!settings.bobKey) throw new BobError("Add your Bob API key in Settings → Bob.", "nokey");
  const reply = await call({ type: "ask", prompt, key: settings.bobKey, workspace }, signal);
  return { text: reply.text, log: reply.log };
}

export const gitInfo = (path) => call({ type: "git-info", path });

/** Fetches the latest main of `slug` into the bug hunter's own worktree of the clone at `path`. */
export const huntCheckout = (path, slug, host) => call({ type: "hunt-checkout", path, slug, host });

// ---------- saved answers ----------
// Opening answers are kept, so asking again (or reopening) is instant. The page marks rows that have one.

export const ANSWERS = "aiCache";

export async function savedAnswer(key) {
  return key ? (await storage.get(ANSWERS))[ANSWERS]?.[key] || null : null;
}

export async function saveAnswer(key, entry) {
  if (!key) return;
  const { [ANSWERS]: all = {} } = await storage.get(ANSWERS);
  all[key] = { ...entry, at: new Date().toISOString() };
  const newest = Object.entries(all).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 40);
  await storage.set({ [ANSWERS]: Object.fromEntries(newest) });
}

/** Where today's plan, standup or triage answer is saved. */
export const todaysAnswer = (kind) => `${kind}:${todayKey()}`;

// ---------- prompts ----------

const HOW = "Look things up as you need to: gh for GitHub, the web, and the local clone if you're running in one. Reply with only the answer, with no notes about what you looked up. Be concise and lead with the answer. Use GitHub Markdown and link issues and PRs.";
const SLACK = 'Format for Slack, not Markdown: *bold*, `code`, "• " bullets, links as <url|text>.';

/** The kind of help each work row gets, with its button label and question. */
export const MODES = {
  review: { label: "Review brief", verb: "Brief me on this review", ask: "I've been asked to review this pull request. Give me a review brief: what it does, where to look, possible issues, and up to 3 comments I could leave." },
  ci: { label: "Why CI is failing", verb: "Explain the CI failure", ask: "CI is failing on my pull request. Find the failing checks and their logs, then tell me the likely cause, how to fix it, and whether it looks flaky." },
  main: { label: "Why main is failing", verb: "Explain why main is failing", ask: "The default branch is failing at this commit. Find the failing checks and their logs, then tell me the likely cause, whether it blocks other PRs, the next step, and whether it looks flaky." },
  changes: { label: "Requested changes", verb: "Turn review feedback into a checklist", ask: 'Reviewers requested changes on my pull request. Turn their unresolved feedback into a "- [ ] " checklist, one task per request with the file:line and reviewer, then list comments that need a reply.' },
  conflict: { label: "Resolve the conflict", verb: "Help me resolve the conflict", ask: "My pull request has a merge conflict. Tell me which files likely conflict and give the commands to rebase onto the latest base branch and push safely." },
  ready: { label: "Merge message", verb: "Write the squash-merge message", ask: "My pull request is approved and green. Write the squash-merge commit message in Conventional Commits format, in a single code block." },
  nudge: { label: "Nudge reviewers", verb: "Draft a nudge for reviewers", ask: "Nobody has reviewed my pull request yet. Draft a short, friendly Slack message asking for a review, and suggest who might review it." },
  mention: { label: "What they need", verb: "What do they need from me?", ask: "Someone mentioned me here. Tell me what they need, the context, and a short reply I could post." },
  issue: { label: "Issue plan", verb: "Summarize and plan this issue", ask: 'This issue is on my plate. Summarize it, give a "- [ ] " plan of 3–6 steps, and list open questions.' },
  summary: { label: "PR summary", verb: "Summarize where this PR stands", ask: "Summarize where this pull request stands, what's left before it can merge, and my next action." },
};

/** Which kind of help fits a row, from the list it's in (`kind`) or the item itself. */
export function modeFor(item = {}, kind) {
  if (kind === "main") return "main";
  if (kind === "review" || kind === "recheck") return "review";
  if (kind === "mention" || kind === "reply") return "mention";
  if (kind === "ciFailed") return "ci";
  if (["changes", "conflict", "ready", "nudge"].includes(kind)) return kind;
  if (item.kind === "issue") return "issue";
  const state = prState(item);
  if (state === "ciFailed") return "ci";
  if (["changes", "conflict", "ready"].includes(state)) return state;
  return state === "waiting" && ageDays(item.createdAt) >= 3 ? "nudge" : "summary";
}

/** Where a row's answer is saved. Any update to the item makes a new key, so a stale answer isn't reused. */
export function answerKey({ item, kind, task }) {
  const mode = modeFor(item, kind);
  return mode === "main" ? task.key : `${mode}:${item.id}:${item.updatedAt}`;
}

export function itemPrompt({ item, kind, task }) {
  const mode = modeFor(item, kind);
  const link = mode === "main" ? `${task.repo} at ${task.url}` : `${itemRef(item)}: ${item.url}`;
  return `${MODES[mode].ask}\n${link}\n\n${HOW}`;
}

const me = (settings) => `I'm ${logins(settings) || "a developer"} on GitHub, working on IBM's Carbon Design System`;
const repoList = (repos) => repos.map(repoName).join(", ");
const now = () => new Date().toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

export const askPrompt = (question, settings, repos) => `${question}\n\n${me(settings)} (repos: ${repoList(repos)}). It's ${now()}.\n${HOW}`;

// Working hours, for Plan my day.
const WORK_START = "09:00";
const WORK_END = "17:00";
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

/**
 * The working day a plan is for, and when it starts: today from now (or 9 AM) until 5 PM, or the
 * next weekday from 9 AM once today's work is over or it's the weekend.
 */
export function planDay(now = new Date()) {
  if (!isWeekend(now) && now < parseTime(WORK_END, now)) return { date: now, from: now < parseTime(WORK_START, now) ? parseTime(WORK_START, now) : now };
  const next = new Date(now);
  do next.setDate(next.getDate() + 1);
  while (isWeekend(next));
  return { date: next, from: parseTime(WORK_START, next) };
}

/** Where a plan is saved: under the day it's for, so this evening's plan for Monday reopens on Monday morning. */
export const planKey = () => `plan:${todayKey(planDay().date)}`;

/** `meetings` are that day's (sync.js todaysMeetings for the plan's date). */
export function planPrompt(settings, repos, meetings, todos) {
  const { date, from } = planDay();
  const day = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const ahead = meetings.filter((m) => m.end > from);
  return `${me(settings)}. It's ${now()}. I work ${fmtTime(parseTime(WORK_START))} to ${fmtTime(parseTime(WORK_END))}, Monday to Friday.
Plan my work for ${day}, from ${fmtTime(from)} to ${fmtTime(parseTime(WORK_END))}. Don't schedule anything outside those hours.
Meetings that day (keep these slots free): ${ahead.map((m) => `${fmtTime(m.start)}–${fmtTime(m.end)} ${m.title}`).join("; ") || "none"}. Leave a lunch break around 12:30.
Use gh to see what needs me in ${repoList(repos)}: issues assigned to me, my open PRs and their CI, review requests and mentions.
My to-dos: ${todos.filter((t) => !t.done).map((t) => t.text).join("; ") || "none"}.
Priorities: the issues assigned to me are my top priority. Give them the longest focus blocks (at least half the day, in the morning when possible), most important first. Only something urgent comes before them: a broken main or failing CI on my own PRs. Fit reviews, to-dos and mentions into the shorter gaps, the most overdue reviews first.
Reply with only the plan, with no notes about what you looked up: a first line saying which day it's for, then **Plan**, a time-blocked list like "- **10:15–11:00** Work on [carbon#123](url)" with the meetings in their slots, then **Top to-dos**, a "- [ ] " checklist of the 3–5 most important things, starting with the assigned issues. Under 18 lines.`;
}

export function standupPrompt(settings, repos, todos) {
  return `${me(settings)}. Write my standup update to paste into Slack.
Use gh to see what I merged, reviewed and worked on since ${previousWorkday().toDateString()} in ${repoList(repos)}, and what's open or blocked now.
To-dos I finished: ${todos.filter((t) => t.done).map((t) => t.text).join("; ") || "none"}.
${SLACK} Put *Yesterday*, *Today* and *Blockers* on their own lines, with refs like carbon#123. First person, brief, at most 5 bullets per section; "• None" if nothing is blocked. Reply with only the update.`;
}

export function catchUpPrompt(entries) {
  const lines = entries.map((a) => `- ${a.createdAt.slice(0, 16).replace("T", " ")} · ${a.title}${a.body ? ` — ${a.body}` : ""}${a.url ? ` (${a.url})` : ""}`);
  return `Catch me up on this GitHub activity (newest first), in under 10 lines: **Needs me** — what I should act on, most urgent first, with links; then **FYI** — the rest, grouped.\n\n${lines.join("\n")}\n\n${HOW}`;
}

export function triagePrompt(settings, repos) {
  return `${me(settings)}. Help me triage the open issues labelled "status: needs triage 🕵️‍♀️" in ${repoList(repos)}.
Use gh to read each issue and its comments, look for duplicates and linked PRs, check whether it's already fixed, and read the code to confirm bugs.
For each issue, one bullet: the link, a one-line summary, then **type** (bug, feature, docs, question), **package**, **severity** (sev 1–4 for bugs), and "ready" or what to ask the reporter. Flag duplicates. End with **Pick up** — the one or two I could fix quickly.
${HOW}`;
}

export function slackPrompt(thread, settings) {
  return `${me(settings)}. Draft my reply in this Slack thread as a Carbon maintainer. Ground every claim in GitHub, the Carbon website (carbondesignsystem.com) or the code; never invent props, APIs, tokens or versions. If it's unclear, say what we'd need (package and version, a repro). Point to an existing issue or PR when one covers it.
Friendly, direct and brief. ${SLACK} End with a "Sources:" list of the links you used.

Slack thread (oldest first):
${thread}`;
}

export function findPrompt(request, settings, repos) {
  return `Turn this request into a single GitHub issues/PR search query. Today is ${todayKey()}; my login is ${logins(settings) || "@me"}; my repos are ${repoList(repos)}.
Use qualifiers like repo:, org:, is:pr, is:issue, is:open, author:, assignee:, involves:, review-requested:, label:"…", created:>=YYYY-MM-DD, updated: and sort:updated-desc. With no repo named, scope it with org:carbon-design-system.
Reply with only the query on one line.

Request: ${request}`;
}

/** Fills the repo's GitHub bug report form for a bug-of-the-day report. The reply is JSON: field id → value. */
export function issueFormPrompt(report) {
  return `Fill in ${report.repo}'s GitHub bug report form for the bug below. You're in a clone of it: read the form at .github/ISSUE_TEMPLATE/BUG_REPORT.yaml (or fetch it with gh if it isn't there).
Reply with only one JSON object mapping each field's id to its value, and nothing else:
- Dropdowns: exactly one of that field's options, character for character (YAML folds long options onto one line with single spaces). For multi-select dropdowns, join several options with ", ".
- The package version: the "version" in that package's package.json here.
- Browser: the browsers the bug affects (all of them if it isn't browser-specific).
- The reproduction link: a public Storybook or StackBlitz URL where the bug shows, such as the component's story on the repo's deployed Storybook.
- Steps to reproduce: a short numbered Markdown list.
- Severity: from how much the bug blocks a user.
- Project name: "Carbon Design System".
- Leave out the title and description (they're filled in already), checkboxes, and anything you can't fill.

The bug:
${report.markdown}`;
}

export const TEST_PROMPT = "Reply with one short sentence confirming you can read this, and name the model you are if you know it.";

/** A follow-up: the first question, the conversation so far, and the new question. */
export function followUpPrompt(first, turns, question) {
  const history = turns.map((t) => `${t.role === "user" ? "Me" : "You"}: ${t.text}`).join("\n\n");
  return `${first}\n\n--- Our conversation so far ---\n${history}\n\n--- My follow-up ---\n${question}`;
}

/** A change to a draft (standup, Slack reply, search query), keeping the user's own edits. */
export const revisePrompt = (first, draft, request) => `${first}\n\n--- The current draft, including my edits ---\n${draft}\n\n--- Change it like this ---\n${request}\n\nReply with only the full revised draft.`;

/** The first line of a reply, without code fences or quotes: the search query. */
export const cleanQuery = (text) => String(text).replace(/```\w*/g, "").split("\n").map((l) => l.trim()).find(Boolean)?.replace(/^`|`$/g, "") || "";
