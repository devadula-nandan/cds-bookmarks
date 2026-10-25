// Bug of the day. Once a day (at `settings.bugHuntTime`, or as soon as Chrome is open after it) Bob reads
// the latest main of one local clone and reports the most obvious easy-to-fix bug. Repos with a clone take
// turns. Runs in the background worker; the page's "Hunt now" asks the worker to start one.

import { askBob, gitInfo, huntCheckout } from "./bob.js";
import { loadSettings, parseTime, repoShort, storage, todayKey, uid } from "./core.js";
import { enabledRepos } from "./repos.js";
import { record } from "./sync.js";

// A hunt still "running" after this long was cut off (browser closed, worker stopped).
const STALE_MS = 25 * 60000;

export const huntableRepos = (settings) => enabledRepos(settings).filter((r) => r.clone);

export const isHunting = (huntState) => !!huntState?.running && Date.now() - Date.parse(huntState.startedAt || 0) < STALE_MS;

function prompt(slug, branch, head, previous) {
  return `You're hunting for one real bug in ${slug}, checked out locally at ${branch} (${String(head).slice(0, 7)}). Read and search the code; don't change anything.

Find the single most obvious bug that's easy to fix — something a maintainer could fix in under an hour with a small diff: inverted conditions, off-by-one errors, a missing null check, the wrong variable, listeners never cleaned up, a stale React hook dependency, wrong ARIA, misspelled class names or tokens, copy-paste mistakes. Not wanted: style nits, refactors, missing features, TODOs, test-only problems.
Prefer library source (for example packages/) over docs, stories or examples. Look somewhere different from these earlier finds:
${previous || "- none yet"}

Read the surrounding code and its callers to make sure it's really a bug. If you find nothing you're confident about, say so. Then search GitHub with gh for an existing issue about it.

Report in GitHub Markdown: a "## title" line, then **Where**, **What's wrong** (quote the lines), **Why it's a bug** (what a user would see, how to reproduce), **Fix** (a minimal \`\`\`diff), and **Confidence** (high, medium or low, with one line of reasoning).
Finish with this JSON block and nothing after it:
\`\`\`json
{"found": true, "title": "…", "file": "path/from/repo/root", "line": 123, "severity": "low|medium|high", "effort": "e.g. 15 min", "confidence": "high|medium|low", "related": [{"ref": "carbon#123", "title": "…", "url": "…", "state": "open|closed"}]}
\`\`\``;
}

/** The Markdown report, and the JSON summary block at its end. */
function splitReport(text) {
  const blocks = [...String(text).matchAll(/```json\s*([\s\S]*?)```/g)];
  const last = blocks.at(-1);
  let meta = null;
  try {
    meta = last && JSON.parse(last[1]);
  } catch {}
  return { markdown: (last ? text.slice(0, last.index) : text).trim(), meta };
}

/** Whether a hunt can start now, and why not. Quick, so the page gets an answer right away. */
export async function canHunt() {
  const settings = await loadSettings();
  if (!settings.ai || !settings.bobKey) return { ok: false, error: "Turn on Bob and add your API key first." };
  if (!huntableRepos(settings).length) return { ok: false, error: "Add a local clone to at least one repo in Settings → Repositories → Edit repositories." };
  const { huntState } = await storage.get("huntState");
  if (isHunting(huntState)) return { ok: false, skipped: true, error: "A bug hunt is already running." };
  return { ok: true };
}

/** Called every minute by the background worker: hunts once a day, after the chosen time. */
export async function maybeHunt(now = new Date()) {
  const settings = await loadSettings();
  if (!settings.ai || !settings.bugHunt || !settings.bobKey || !huntableRepos(settings).length) return;
  const { huntState = {} } = await storage.get("huntState");
  if (isHunting(huntState) || huntState.lastDay === todayKey(now) || now < parseTime(settings.bugHuntTime, now)) return;
  await hunt();
}

export async function hunt() {
  const ready = await canHunt();
  if (!ready.ok) return ready;
  const settings = await loadSettings();
  const { bugHunts = [] } = await storage.get("bugHunts");

  // Today's repo (they take turns), or the next one whose clone is still on disk.
  const list = huntableRepos(settings);
  const start = Math.floor(Date.now() / 86400000) % list.length;
  let repo = null;
  for (let i = 0; i < list.length && !repo; i++) {
    const next = list[(start + i) % list.length];
    if (await gitInfo(next.clone).then(() => true, () => false)) repo = next;
  }
  if (!repo) return { ok: false, error: "None of the local clones were found. Check the paths in Settings → Repositories → Edit repositories." };

  const day = todayKey();
  // lastDay is set up front, so a failed hunt isn't retried every minute; "Hunt again" retries by hand.
  await storage.set({ huntState: { running: true, startedAt: new Date().toISOString(), repo: repo.slug, lastDay: day } });
  // An extension API call every 20s keeps the worker from being stopped as idle mid-hunt.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  try {
    // Hunt the latest main in a worktree of its own; if that fails (offline, say), hunt the clone as it is.
    const git = await huntCheckout(repo.clone, repo.slug).catch(() => gitInfo(repo.clone).then((info) => ({ ...info, path: repo.clone })));
    const previous = bugHunts
      .filter((h) => h.repo === repo.slug && h.found)
      .slice(0, 15)
      .map((h) => `- ${h.file}${h.line ? `:${h.line}` : ""} — ${h.title}`)
      .join("\n");
    const { text, log } = await askBob(prompt(repo.slug, git.branch, git.head, previous), settings, { workspace: git.path, maxTurns: 60, timeoutMs: 15 * 60000 });
    const { markdown, meta } = splitReport(text);
    const found = !!meta?.title && meta.found !== false;
    const report = {
      id: uid(),
      at: new Date().toISOString(),
      day,
      repo: repo.slug,
      path: git.path,
      branch: git.branch,
      head: git.head,
      found,
      title: found ? meta.title : "No obvious bug found",
      file: meta?.file || null,
      line: meta?.line || null,
      severity: meta?.severity || null,
      effort: meta?.effort || null,
      confidence: meta?.confidence || null,
      related: Array.isArray(meta?.related) ? meta.related : [],
      markdown,
      log,
    };
    await storage.set({ bugHunts: [report, ...bugHunts].slice(0, 30), huntState: { running: false, lastDay: day, at: report.at, repo: repo.slug } });
    await record(
      [
        {
          type: "bugHunt",
          key: `hunt:${report.id}`,
          title: found ? `Bug of the day: ${report.title}` : `No obvious bug found in ${repoShort(repo.slug)} today`,
          body: found ? `${repoShort(repo.slug)} · ${report.file}${report.line ? `:${report.line}` : ""}` : "Bob will look somewhere else tomorrow.",
          url: "",
          repo: repo.slug,
        },
      ],
      settings
    );
    return { ok: true };
  } catch (err) {
    console.error("Bug hunt failed", err);
    await storage.set({ huntState: { running: false, lastDay: day, at: new Date().toISOString(), repo: repo.slug, error: err.message || String(err) } });
    return { ok: false, error: err.message };
  } finally {
    clearInterval(keepAlive);
  }
}
