/** Page state: what storage holds, per-browser view preferences, and what's derived from them. */

const ins = DD.insights;

export const ext = DD.storage.isExtension && !!globalThis.chrome?.runtime?.id;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const CLASSIC_TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,notifications,read:org&description=Dev%20Dashboard";

export const UI_KEY = "devdash-ui";

/** Per-browser view preferences; losing them is harmless. */
export const ui = (() => {
  const fallback = { tab: "focus" };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(UI_KEY) || "{}") };
  } catch {
    return fallback;
  }
})();

export function saveUi() {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {}
}

export const state = {
  settings: DD.settings.defaults(),
  cache: null,
  status: {},
  day: { todos: [], snoozed: {} },
  activity: [],
  seenAt: null,
  clearedAt: null,
  demo: null,
  huntState: {},
  bugHunts: [],
  followHidden: {},
  untilChange: {},
  // Keys of Bob's saved answers, so buttons can say an answer is ready before anyone clicks.
  answered: new Set(),
};

export function data() {
  if (state.settings.demo) return (state.demo ||= DD.demo.data(state.settings.login || "you"));
  return state.cache?.data || null;
}

export function connected() {
  return !!(state.settings.token || state.settings.demo);
}

export function allTasks() {
  const d = data();
  return d ? ins.focusQueue(d, state.settings) : [];
}

export function visibleTasks() {
  return allTasks().filter((t) => !ins.isSnoozed(t, state.day.snoozed, state.untilChange));
}

export function activity() {
  if (state.settings.demo) {
    const base = Date.now();
    return DD.demo.notifications().map((n, i) => ({ ...n, id: n.key, createdAt: new Date(base - (i + 1) * 47 * 60000).toISOString() }));
  }
  const cleared = state.clearedAt ? Date.parse(state.clearedAt) : 0;
  return state.activity.filter((a) => Date.parse(a.createdAt) > cleared);
}

export function unread() {
  const seen = state.seenAt ? Date.parse(state.seenAt) : 0;
  return activity().filter((a) => Date.parse(a.createdAt) > seen).length;
}

/** Assigned issues and mentions that aren't already in reviews or my PRs. */
export function issueItems(d) {
  const taken = new Set([...d.reviews.items, ...d.mine.items].map((i) => i.id));
  const out = [];
  const add = (why) => (item) => {
    if (taken.has(item.id)) return;
    taken.add(item.id);
    out.push({ item, why });
  };
  d.assigned.items.forEach(add("assigned"));
  d.mentions.items.forEach(add("mention"));
  return out;
}

export function mainTone(main) {
  if (!main?.state) return null;
  if (["FAILURE", "ERROR"].includes(main.state)) return "error";
  if (["PENDING", "EXPECTED"].includes(main.state)) return "warning";
  return main.state === "SUCCESS" ? "success" : null;
}

export function searchUrl(q) {
  return `https://github.com/search?type=issues&q=${encodeURIComponent(q)}`;
}

/** Repos switched on in Settings, for the bar and search. */
export function shownRepos() {
  return DD.repos.all.filter((r) => !state.settings.disabledRepos.includes(r.id));
}

export function repoScope() {
  return DD.repos.enabled(state.settings).map((r) => `repo:${r.slug}`).join(" ");
}

/**
 * A vscode:// link to a local clone (optionally a file and line in it).
 * Clone paths are saved as "~/…"; the helper tells us the home folder.
 */
export function vscodeUrl(clone, file, line) {
  if (!clone) return null;
  const home = state.settings.homeDir;
  const dir = clone.startsWith("~") ? (home ? home + clone.slice(1) : null) : clone;
  if (!dir) return null;
  const path = file ? `${dir.replace(/\/$/, "")}/${file}${line ? `:${line}` : ""}` : dir;
  return `vscode://file${encodeURI(path.startsWith("/") ? path : `/${path}`)}`;
}

/** Bob needs the extension (native messaging) and is opt-in. */
export function aiOn() {
  return ext && DD.ai.supported && state.settings.ai;
}

/** Row key → what Bob should look at, rebuilt on every work render. */
export const aiTargets = new Map();
