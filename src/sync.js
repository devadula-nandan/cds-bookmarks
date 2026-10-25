// Syncing runs in the background worker: fetch GitHub, compare with the last sync, log what changed
// to Activity and raise a desktop notification for the changes the user asked to hear about.

import { fmtTime, itemRef as ref, loadSettings, parseTime, repoShort, saveSettings, storage, todayKey, uid } from "./core.js";
import { fetchDashboard, fetchInbox, fetchViewer } from "./github.js";
import { hasConflict } from "./insights.js";
import { enabledRepos } from "./repos.js";

/** Every kind of activity: its icon and tone in the Activity drawer, and the notification setting it obeys. */
export const EVENT_TYPES = {
  review: { icon: "eye", tone: "info", setting: "reviewRequested" },
  ciFailed: { icon: "x", tone: "error", setting: "ciFailed" },
  ciPassed: { icon: "check", tone: "success", setting: "ciPassed" },
  changes: { icon: "message", tone: "warning", setting: "changesRequested" },
  approved: { icon: "check", tone: "success", setting: "approved" },
  merged: { icon: "merge", tone: "success", setting: "merged" },
  conflict: { icon: "alert", tone: "warning", setting: "conflict" },
  mention: { icon: "at", tone: "info", setting: "mentioned" },
  assigned: { icon: "user", tone: "info", setting: "assigned" },
  mainBroken: { icon: "alert", tone: "error", setting: "mainBroken" },
  mainFixed: { icon: "check", tone: "success", setting: "mainBroken" },
  release: { icon: "tag", tone: "neutral", setting: "release" },
  inbox: { icon: "inbox", tone: "neutral", setting: "githubInbox" },
  meeting: { icon: "calendar", tone: "info", setting: "meetings" },
  reply: { icon: "message", tone: "info", setting: "replies" },
  recheck: { icon: "refresh", tone: "warning", setting: "recheck" },
  bugHunt: { icon: "bug", tone: "warning", setting: "bugHunt" },
};

const URGENT = ["ciFailed", "mainBroken", "changes", "conflict", "bugHunt"];

/** Desktop notifications. The id carries the URL, so a click still works after the worker was suspended. */
export async function notify(events) {
  for (const e of events)
    await chrome.notifications.create(`${uid()}|${e.url || ""}`, { type: "basic", iconUrl: "icons/icon-128.png", title: e.title, message: e.body || "", priority: URGENT.includes(e.type) ? 1 : 0 });
}

/** Adds events to Activity, then notifies about the ones the user opted into (one summary when there are many). */
export async function record(events, settings) {
  const { activity = [] } = await storage.get("activity");
  const known = new Set(activity.map((a) => a.key));
  const at = new Date().toISOString();
  const fresh = events.filter((e) => !known.has(e.key)).map((e) => ({ createdAt: at, ...e }));
  if (!fresh.length) return;
  await storage.set({ activity: [...fresh, ...activity].slice(0, 100) });
  const loud = fresh.filter((e) => settings.notifications && settings.notifyOn[EVENT_TYPES[e.type]?.setting] !== false);
  if (loud.length > 4) await notify([{ type: "inbox", title: `${loud.length} updates on GitHub`, body: "Open a new tab to catch up." }]);
  else await notify(loud);
}

// ---------- what changed since the last sync ----------

/** The parts of a sync worth comparing next time. */
function snapshot(data, inbox) {
  const ids = (l) => l.items.map((i) => i.id);
  const byRepo = (pick) => Object.fromEntries(Object.entries(data.repos).map(([slug, r]) => [slug, pick(r)]));
  return {
    reviews: ids(data.reviews),
    mentions: ids(data.mentions),
    assigned: ids(data.assigned),
    merged: ids(data.merged),
    mine: Object.fromEntries(data.mine.items.map((p) => [p.id, { ci: p.ci, decision: p.reviewDecision, conflict: hasConflict(p) }])),
    main: byRepo((r) => r.main?.state || null),
    release: byRepo((r) => r.release?.tagName || null),
    inbox: inbox && Object.fromEntries(inbox.map((t) => [t.id, t.updatedAt])),
    following: Object.fromEntries(data.following.map((i) => [i.id, i.follow.lastReply?.at || null])),
    reviewedOpen: Object.fromEntries(data.reviewedOpen.items.map((p) => [p.id, p.lastCommitAt])),
  };
}

function changes(prev, data, inbox) {
  const events = [];
  const add = (type, key, title, body, url, repo) => events.push({ type, key, title, body, url, repo });
  const red = (s) => s === "FAILURE" || s === "ERROR";
  const stamp = data.fetchedAt;

  for (const pr of data.reviews.items) if (!prev.reviews.includes(pr.id)) add("review", `review:${pr.id}`, `Review requested: ${ref(pr)}`, `${pr.author} · ${pr.title}`, pr.url, pr.repo);

  for (const pr of data.mine.items) {
    const before = prev.mine[pr.id];
    if (!before) continue;
    if (pr.ci !== before.ci && red(pr.ci)) add("ciFailed", `ci:${pr.id}:${stamp}`, `CI failed on ${ref(pr)}`, pr.title, `${pr.url}/checks`, pr.repo);
    if (pr.ci !== before.ci && pr.ci === "SUCCESS" && before.ci) add("ciPassed", `ci:${pr.id}:${stamp}`, `CI passed on ${ref(pr)}`, pr.title, pr.url, pr.repo);
    if (pr.reviewDecision !== before.decision && pr.reviewDecision === "APPROVED")
      add("approved", `dec:${pr.id}:${stamp}`, `${ref(pr)} approved`, `${pr.approvals.join(", ") || "A reviewer"} · ${pr.title}`, pr.url, pr.repo);
    if (pr.reviewDecision !== before.decision && pr.reviewDecision === "CHANGES_REQUESTED")
      add("changes", `dec:${pr.id}:${stamp}`, `Changes requested on ${ref(pr)}`, `${pr.changeRequests.join(", ") || "A reviewer"} · ${pr.title}`, pr.url, pr.repo);
    if (hasConflict(pr) && !before.conflict) add("conflict", `conflict:${pr.id}:${stamp}`, `Merge conflict on ${ref(pr)}`, pr.title, pr.url, pr.repo);
  }

  for (const pr of data.merged.items) if (!prev.merged.includes(pr.id)) add("merged", `merged:${pr.id}`, `Merged: ${ref(pr)}`, pr.title, pr.url, pr.repo);
  for (const i of data.mentions.items) if (!prev.mentions.includes(i.id)) add("mention", `mention:${i.id}`, `Mentioned on ${ref(i)}`, i.title, i.url, i.repo);
  for (const i of data.assigned.items) if (!prev.assigned.includes(i.id)) add("assigned", `assigned:${i.id}`, `Assigned: ${ref(i)}`, i.title, i.url, i.repo);

  for (const [slug, { main, release }] of Object.entries(data.repos)) {
    const before = prev.main[slug];
    if (before !== undefined && red(main?.state) && !red(before)) add("mainBroken", `main:${slug}:${main.sha}`, `main is failing on ${repoShort(slug)}`, main.message, main.url, slug);
    if (red(before) && main?.state === "SUCCESS") add("mainFixed", `mainfix:${slug}:${main.sha}`, `main is green again on ${repoShort(slug)}`, main.message, main.url, slug);
    const tag = release?.tagName;
    if (tag && prev.release[slug] && prev.release[slug] !== tag)
      add("release", `release:${slug}:${tag}`, `${repoShort(slug)} ${tag} released`, release.isPrerelease ? "Pre-release" : "Stable release", release.url, slug);
  }

  for (const i of data.following) {
    const reply = i.follow.lastReply;
    if (i.follow.newReply && reply && prev.following[i.id] !== reply.at) add("reply", `reply:${i.id}:${reply.at}`, `${reply.author} replied on ${ref(i)}`, i.title, reply.url || i.url, i.repo);
  }

  for (const pr of data.reviewedOpen.items) {
    const before = prev.reviewedOpen[pr.id];
    if (before !== undefined && pr.lastCommitAt !== before && pr.myReview && pr.lastCommitAt > pr.myReview.at)
      add("recheck", `recheck:${pr.id}:${pr.lastCommitAt}`, `New commits on ${ref(pr)} since your review`, `${pr.author} · ${pr.title}`, `${pr.url}/files`, pr.repo);
  }

  // GitHub inbox items the lists above don't already cover.
  if (inbox && prev.inbox)
    for (const t of inbox)
      if (t.unread && prev.inbox[t.id] !== t.updatedAt && !["review_requested", "mention", "assign"].includes(t.reason))
        add("inbox", `inbox:${t.id}:${t.updatedAt}`, `${repoShort(t.repo)}: ${t.title}`, `GitHub · ${t.reason.replace(/_/g, " ")}`, t.url, t.repo);

  return events;
}

/**
 * The 👀 watch list: a thread joins when a sync sees my 👀 on it, and leaves when the 👀 is removed,
 * the thread closes, or 60 days pass.
 */
function updateWatching(watching, seen) {
  const next = { ...watching };
  const now = new Date().toISOString();
  for (const { id, eyes } of seen) eyes ? (next[id] ||= { addedAt: now }) : delete next[id];
  const cutoff = new Date(Date.now() - 60 * 86400000).toISOString();
  for (const id of Object.keys(next)) if (next[id].addedAt < cutoff) delete next[id];
  return next;
}

async function setStatus(patch) {
  const { status = {} } = await storage.get("status");
  await storage.set({ status: { ...status, ...patch } });
}

/** One full sync. Results land in storage (`cache`, `status`, `activity`), where the page picks them up. */
export async function sync() {
  const settings = await loadSettings();
  if (!settings.token) return { skipped: true };
  const { status = {} } = await storage.get("status");
  if (status.syncing && Date.now() - Date.parse(status.startedAt || 0) < 60000) return { skipped: true };
  await setStatus({ syncing: true, startedAt: new Date().toISOString() });

  try {
    let login = settings.login;
    if (!login) {
      ({ login } = await fetchViewer(settings.token));
      await saveSettings({ login });
    }
    const repos = enabledRepos(settings);
    const { watching = {}, snapshot: prev } = await storage.get(["watching", "snapshot"]);
    const [data, inbox] = await Promise.all([
      fetchDashboard({ token: settings.token, login, repos, includeTeamReviews: settings.includeTeamReviews, watching }),
      fetchInbox(settings.token, repos).catch((err) => err),
    ]);
    const inboxOk = Array.isArray(inbox) ? inbox : null;
    const inboxError = inboxOk ? null : [401, 403, 404].includes(inbox.status) ? "This token can't read GitHub notifications." : inbox.message;

    const next = snapshot(data, inboxOk);
    // The first sync only records a baseline; after that, differences become activity.
    const events = prev ? changes({ ...next, ...prev, inbox: prev.inbox || next.inbox }, data, inboxOk) : [];
    await storage.set({ cache: { data }, snapshot: next, watching: updateWatching(watching, data.eyesSeen) });
    await setStatus({ syncing: false, at: new Date().toISOString(), error: null, errorSso: null, inboxError });
    if (data.scopes !== settings.tokenScopes) await saveSettings({ tokenScopes: data.scopes });
    await record(events, await loadSettings());
    return { ok: true };
  } catch (err) {
    console.error("Sync failed", err);
    await setStatus({ syncing: false, at: new Date().toISOString(), error: err.message, errorSso: err.sso || null });
    return { ok: false, error: err.message };
  }
}

// ---------- meetings ----------

/** Today's recurring meetings, with start and end times. */
export function todaysMeetings(settings, now = new Date()) {
  return settings.meetings
    .filter((m) => !m.days?.length || m.days.includes(now.getDay()))
    .map((m) => {
      const start = parseTime(m.time, now);
      return { ...m, start, end: new Date(start.getTime() + (m.minutes || 15) * 60000) };
    })
    .sort((a, b) => a.start - b.start);
}

/** A notification five minutes before each meeting, once. */
async function remind(settings) {
  if (!settings.notifications || !settings.notifyOn.meetings) return;
  const now = new Date();
  const today = todayKey(now);
  const { reminded = {} } = await storage.get("reminded");
  const sent = reminded[today] || {};
  const due = todaysMeetings(settings, now).filter((m) => !sent[m.id] && (m.start - now) / 60000 <= 5 && m.start - now > -60000);
  if (!due.length) return;
  due.forEach((m) => (sent[m.id] = true));
  await storage.set({ reminded: { [today]: sent } });
  await notify(
    due.map((m) => {
      const mins = Math.ceil((m.start - now) / 60000);
      return { type: "meeting", title: mins > 0 ? `${m.title} in ${mins} min` : `${m.title} is starting`, body: `${fmtTime(m.start)} · ${m.minutes} min` };
    })
  );
}

/** Every minute (the worker's alarm): meeting reminders, then a sync when one is due. */
export async function tick() {
  const settings = await loadSettings();
  await remind(settings);
  const { status = {} } = await storage.get("status");
  if (Date.now() - Date.parse(status.at || 0) >= settings.pollMinutes * 60000 - 5000) await sync();
}
