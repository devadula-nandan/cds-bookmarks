window.DD = window.DD || {};

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
    const diff = Date.now() - new Date(input).getTime();
    const s = Math.round(diff / 1000);
    if (s < 45) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    if (d < 30) return `${d}d ago`;
    const mo = Math.round(d / 30);
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.round(mo / 12)}y ago`;
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
    return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  },

  uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  },

  debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  },

  repoShort(slug) {
    return String(slug || "").split("/").pop();
  },

  hexToRgba(hex, alpha) {
    const n = parseInt(hex, 16);
    if (Number.isNaN(n)) return `rgba(128,128,128,${alpha})`;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  },

  async copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  },
};

/** Live, in-memory app state shared by views and the notification center. */
DD.state = {
  data: null,
  inbox: null,
  inboxError: null,
  syncing: false,
  error: null,
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

function mergeRituals(defaults, saved) {
  if (!saved?.length) return defaults.map((r) => ({ ...r }));
  const extras = defaults.filter((r) => r.auto && !saved.some((s) => s.id === r.id || s.auto === r.auto));
  if (!extras.length) return saved;
  const lastAuto = saved.reduce((i, r, idx) => (r.auto ? idx : i), -1);
  const at = lastAuto + 1;
  return [...saved.slice(0, at), ...extras, ...saved.slice(at)];
}

DD.store = {
  KEYS: {
    settings: "devdash:settings",
    cache: "devdash:cache",
    snapshot: "devdash:snapshot",
    notifications: "devdash:notifications",
    day: "devdash:day:",
  },

  defaults() {
    return {
      token: "",
      login: "",
      demo: false,
      theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "g100" : "white",
      openInNewTab: true,
      pollMinutes: 3,
      includeTeamReviews: false,
      desktopNotifications: false,
      sound: false,
      dnd: false,
      workStart: "09:30",
      workEnd: "18:30",
      meetings: [
        { id: "standup", title: "Daily standup", time: "10:00", minutes: 15, days: [1, 2, 3, 4, 5] },
      ],
      rituals: [
        { id: "main", label: "Check main is green on every repo", auto: "mainGreen" },
        { id: "reviews", label: "Clear the review queue", auto: "reviews" },
        { id: "own", label: "Unblock my PRs (CI, conflicts, feedback)", auto: "ownBlocked" },
        { id: "mentions", label: "Reply to mentions", auto: "mentions" },
        { id: "assigned", label: "Work on assigned issues", auto: "assigned" },
        { id: "triage", label: "Triage new issues" },
        { id: "board", label: "Update the sprint board" },
        { id: "standup", label: "Post standup update" },
      ],
      notifyOn: {
        reviewRequested: true,
        ciFailed: true,
        ciPassed: true,
        changesRequested: true,
        approved: true,
        merged: true,
        conflict: true,
        mentioned: true,
        assigned: true,
        mainBroken: true,
        release: true,
        githubInbox: true,
        meetings: true,
      },
      disabledRepos: [],
      repoScope: null,
      staleReviewDays: 2,
    };
  },

  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },

  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn("Storage write failed", key, err);
    }
  },

  get settings() {
    if (!this._settings) {
      const saved = this.read(this.KEYS.settings, {});
      const defaults = this.defaults();
      if (!saved.theme) saved.theme = localStorage.getItem("theme") || defaults.theme;
      this._settings = {
        ...defaults,
        ...saved,
        notifyOn: { ...defaults.notifyOn, ...(saved.notifyOn || {}) },
        meetings: Array.isArray(saved.meetings) ? saved.meetings : defaults.meetings,
        rituals: mergeRituals(defaults.rituals, saved.rituals),
      };
    }
    return this._settings;
  },

  saveSettings(patch) {
    Object.assign(this.settings, patch);
    this.write(this.KEYS.settings, this.settings);
    if (patch.theme) localStorage.setItem("theme", patch.theme);
    DD.bus.emit("settings", patch);
  },

  /** Per-day state: checked rituals, dismissed/snoozed focus items, personal todos. */
  day(date = new Date()) {
    const key = this.KEYS.day + DD.util.todayKey(date);
    const state = this.read(key, null) || { rituals: {}, dismissed: {}, todos: [], notified: {} };
    if (!this.read(key, null)) {
      const yesterday = this.read(this.KEYS.day + DD.util.todayKey(DD.util.previousWorkday(date)), null);
      if (yesterday?.todos) state.todos = yesterday.todos.filter((t) => !t.done);
      this.pruneDays();
    }
    return state;
  },

  saveDay(state, date = new Date()) {
    this.write(this.KEYS.day + DD.util.todayKey(date), state);
  },

  updateDay(mutator) {
    const state = this.day();
    mutator(state);
    this.saveDay(state);
    DD.bus.emit("day", state);
    return state;
  },

  pruneDays() {
    const cutoff = Date.now() - 14 * 86400000;
    Object.keys(localStorage)
      .filter((k) => k.startsWith(this.KEYS.day))
      .forEach((k) => {
        const date = new Date(k.slice(this.KEYS.day.length));
        if (date.getTime() < cutoff) localStorage.removeItem(k);
      });
  },
};
