// Small helpers, storage, settings and per-day state.
// Shared by the background worker and the new tab page, so nothing here may touch the DOM.

export const storage = chrome.storage.local;

// ---------- text and time ----------

export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** "carbon" for "carbon-design-system/carbon". */
export const repoShort = (slug) => String(slug || "").split("/").pop();

/** "carbon#123" for an issue or PR. */
export const itemRef = (item) => `${repoShort(item.repo)}#${item.number}`;

/** "now", "5m", "3h", "2d", "4mo", "1y". */
export function timeAgo(at) {
  if (!at) return "";
  const minutes = Math.round((Date.now() - new Date(at)) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo` : `${Math.round(months / 12)}y`;
}

export const ageDays = (at) => (Date.now() - new Date(at)) / 86400000;

/** "2026-10-25" in local time. */
export const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Midnight at the start of the previous weekday. */
export function previousWorkday(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  do d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}

/** "14:30" on the day of `base`, as a Date. */
export function parseTime(hhmm, base = new Date()) {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  const d = new Date(base);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

export const fmtTime = (date) => new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// ---------- settings ----------

export const NOTIFY_LABELS = {
  reviewRequested: "Review requests",
  ciFailed: "CI fails on my PR",
  ciPassed: "CI passes on my PR",
  changesRequested: "Changes requested",
  approved: "My PR is approved",
  merged: "My PR is merged",
  conflict: "Merge conflicts",
  mentioned: "Mentions",
  assigned: "Assignments",
  mainBroken: "main breaks or recovers",
  release: "New releases",
  githubInbox: "Other GitHub inbox activity",
  meetings: "Meeting reminders",
  replies: "Replies on threads I follow",
  recheck: "New commits on PRs I reviewed",
  bugHunt: "Bug of the day",
};

const OFF_BY_DEFAULT = ["ciPassed", "release", "githubInbox"];

export function defaultSettings() {
  return {
    token: "",
    login: "",
    theme: "system",
    pollMinutes: 3,
    includeTeamReviews: false,
    staleReviewDays: 2,
    notifications: true,
    notifyOn: Object.fromEntries(Object.keys(NOTIFY_LABELS).map((k) => [k, !OFF_BY_DEFAULT.includes(k)])),
    disabledRepos: [],
    ai: false,
    bobKey: "",
    homeDir: "",
    bugHunt: false,
    bugHuntTime: "09:00",
    meetings: [{ id: "standup", title: "Daily standup", time: "10:00", minutes: 15, days: [1, 2, 3, 4, 5] }],
  };
}

/** Saved settings filled in with defaults for anything missing. */
export function normalizeSettings(saved = {}) {
  const base = defaultSettings();
  return { ...base, ...saved, notifyOn: { ...base.notifyOn, ...saved.notifyOn } };
}

export async function loadSettings() {
  return normalizeSettings((await storage.get("settings")).settings);
}

/** Read-modify-write, so a patch from the page never drops a field the worker just wrote. */
export async function saveSettings(patch) {
  const next = { ...(await loadSettings()), ...patch };
  await storage.set({ settings: next });
  return next;
}

// ---------- today's to-dos and snoozes ----------
// One storage entry per day ("day:2026-10-25"). Unfinished to-dos carry over to the next day.

const DAY = "day:";
export const dayKey = (date = new Date()) => DAY + todayKey(date);

export async function loadDay() {
  const key = dayKey();
  const { [key]: today } = await storage.get(key);
  if (today) return today;
  // A new day: carry over yesterday's unfinished to-dos, and forget days older than two weeks.
  const all = await storage.get(null);
  const days = Object.keys(all).filter((k) => k.startsWith(DAY)).sort();
  const previous = days.filter((k) => k < key).pop();
  const cutoff = dayKey(new Date(Date.now() - 14 * 86400000));
  const stale = days.filter((k) => k < cutoff);
  if (stale.length) await storage.remove(stale);
  return { todos: previous ? all[previous].todos.filter((t) => !t.done) : [], snoozed: {} };
}

export async function updateDay(change) {
  const day = await loadDay();
  change(day);
  await storage.set({ [dayKey()]: day });
}
