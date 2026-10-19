/**
 * Shared by the new tab page and the background service worker, so nothing in
 * here may touch `window` or the DOM.
 */
globalThis.DD = globalThis.DD || {};

DD.util = {
  esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },

  timeAgo(input) {
    if (!input) return "";
    const s = Math.round((Date.now() - new Date(input).getTime()) / 1000);
    if (s < 45) return "now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.round(h / 24);
    if (d < 30) return `${d}d`;
    const mo = Math.round(d / 30);
    return mo < 12 ? `${mo}mo` : `${Math.round(mo / 12)}y`;
  },

  ageDays(input) {
    return (Date.now() - new Date(input).getTime()) / 86400000;
  },

  todayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  },

  isoDate(date) {
    return DD.util.todayKey(date);
  },

  /** Start of the previous working day (skips weekends). */
  previousWorkday(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    do {
      d.setDate(d.getDate() - 1);
    } while (d.getDay() === 0 || d.getDay() === 6);
    return d;
  },

  parseTime(hhmm, base = new Date()) {
    const [h, m] = String(hhmm || "0:0").split(":").map(Number);
    const d = new Date(base);
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
  },

  fmtTime(date) {
    return new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  },

  uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  },

  repoShort(slug) {
    return String(slug || "").split("/").pop();
  },

  plural(n, word, many = `${word}s`) {
    return `${n} ${n === 1 ? word : many}`;
  },
};

DD.bus = {
  handlers: {},
  on(event, fn) {
    (this.handlers[event] ||= []).push(fn);
  },
  emit(event, payload) {
    (this.handlers[event] || []).forEach((fn) => fn(payload));
  },
};

/**
 * Key/value storage. Inside the extension this is `chrome.storage.local`, which
 * the background worker shares; served as a plain web page it falls back to
 * localStorage so the page can still be previewed or hosted.
 */
DD.storage = (() => {
  const ext = !!globalThis.chrome?.storage?.local;
  const PREFIX = "dd:";
  const listeners = [];

  function readLocal(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  function emit(changes) {
    if (Object.keys(changes).length) listeners.forEach((fn) => fn(changes));
  }

  if (ext) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      emit(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])));
    });
  } else if (globalThis.addEventListener) {
    globalThis.addEventListener("storage", (e) => {
      if (e.key?.startsWith(PREFIX)) emit({ [e.key.slice(PREFIX.length)]: readLocal(e.key.slice(PREFIX.length)) });
    });
  }

  return {
    isExtension: ext,

    /** `keys` may be a string, an array, or null for everything. */
    async get(keys) {
      if (ext) return chrome.storage.local.get(keys);
      const list =
        keys == null
          ? Object.keys(localStorage)
              .filter((k) => k.startsWith(PREFIX))
              .map((k) => k.slice(PREFIX.length))
          : [].concat(keys);
      const out = {};
      list.forEach((k) => {
        const v = readLocal(k);
        if (v !== undefined) out[k] = v;
      });
      return out;
    },

    async set(items) {
      if (ext) return chrome.storage.local.set(items);
      Object.entries(items).forEach(([k, v]) => {
        try {
          localStorage.setItem(PREFIX + k, JSON.stringify(v));
        } catch (err) {
          console.warn("Storage write failed", k, err);
        }
      });
      emit(items);
    },

    async remove(keys) {
      if (ext) return chrome.storage.local.remove(keys);
      [].concat(keys).forEach((k) => localStorage.removeItem(PREFIX + k));
      emit(Object.fromEntries([].concat(keys).map((k) => [k, undefined])));
    },

    async clear() {
      if (ext) return chrome.storage.local.clear();
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
      keys.forEach((k) => localStorage.removeItem(k));
    },

    onChange(fn) {
      listeners.push(fn);
    },
  };
})();

DD.settings = (() => {
  function defaults() {
    return {
      token: "",
      login: "",
      demo: false,
      theme: "system",
      pollMinutes: 3,
      includeTeamReviews: false,
      staleReviewDays: 2,
      notifications: true,
      notifyOn: {
        reviewRequested: true,
        ciFailed: true,
        ciPassed: false,
        changesRequested: true,
        approved: true,
        merged: true,
        conflict: true,
        mentioned: true,
        assigned: true,
        mainBroken: true,
        release: false,
        githubInbox: false,
        meetings: true,
      },
      disabledRepos: [],
      meetings: [{ id: "standup", title: "Daily standup", time: "10:00", minutes: 15, days: [1, 2, 3, 4, 5] }],
    };
  }

  function normalize(saved = {}) {
    const base = defaults();
    return {
      ...base,
      ...saved,
      notifyOn: { ...base.notifyOn, ...(saved.notifyOn || {}) },
      meetings: Array.isArray(saved.meetings) ? saved.meetings : base.meetings,
      disabledRepos: Array.isArray(saved.disabledRepos) ? saved.disabledRepos : [],
    };
  }

  async function load() {
    const { settings } = await DD.storage.get("settings");
    return normalize(settings);
  }

  /** Read-modify-write so a patch from one context never drops another's fields. */
  async function save(patch) {
    const next = { ...(await load()), ...patch };
    await DD.storage.set({ settings: next });
    return next;
  }

  return { defaults, normalize, load, save };
})();

/** Per-day state the page owns: to-dos (unfinished ones carry over) and snoozed work. */
DD.day = (() => {
  const PREFIX = "day:";
  const KEEP_DAYS = 14;

  function key(date = new Date()) {
    return PREFIX + DD.util.todayKey(date);
  }

  function blank() {
    return { todos: [], snoozed: {} };
  }

  async function load(date = new Date()) {
    const k = key(date);
    const all = await DD.storage.get(null);
    if (all[k]) return { ...blank(), ...all[k] };

    const previous = Object.keys(all)
      .filter((x) => x.startsWith(PREFIX) && x < k)
      .sort()
      .pop();
    const state = blank();
    if (previous) state.todos = (all[previous].todos || []).filter((t) => !t.done);

    const cutoff = PREFIX + DD.util.todayKey(new Date(Date.now() - KEEP_DAYS * 86400000));
    const stale = Object.keys(all).filter((x) => x.startsWith(PREFIX) && x < cutoff);
    if (stale.length) await DD.storage.remove(stale);
    return state;
  }

  async function update(mutator, date = new Date()) {
    const state = await load(date);
    mutator(state);
    await DD.storage.set({ [key(date)]: state });
    return state;
  }

  return { key, load, update, PREFIX };
})();
