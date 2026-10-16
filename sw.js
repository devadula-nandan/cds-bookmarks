/* Dev Dashboard service worker — push notifications + background GitHub inbox poll. */
const VERSION = "48";
const DB_NAME = "devdash-push";
const DB_STORE = "kv";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(openFromNotification(data));
});

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "devdash-sync") event.waitUntil(pollInbox("periodicsync"));
});

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "notify") event.waitUntil(show(msg.payload || {}));
  if (msg.type === "poll") event.waitUntil(pollInbox("message"));
});

function dashboardUrl() {
  return new URL("./", self.location).href;
}

function iconUrl() {
  return new URL("icons/icon-192.png", self.location).href;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readConfig() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get("config");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function writeConfig(patch) {
  const current = (await readConfig()) || {};
  const next = { ...current, ...patch };
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(next, "config");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  return next;
}

function threadUrl(thread) {
  const api = thread.subject?.url;
  const repoUrl = thread.repository?.html_url;
  if (!api) return repoUrl ? `${repoUrl}/notifications` : "https://github.com/notifications";
  if (thread.subject.type === "Release") return `${repoUrl}/releases`;
  return api
    .replace("https://api.github.com/repos/", "https://github.com/")
    .replace(/\/pulls\/(\d+)/, "/pull/$1")
    .replace(/\/commits\//, "/commit/");
}

function repoShort(slug) {
  return String(slug || "").split("/").pop();
}

function settingFor(reason) {
  switch (reason) {
    case "review_requested":
      return "reviewRequested";
    case "mention":
    case "team_mention":
      return "mentioned";
    case "assign":
      return "assigned";
    case "ci_activity":
      return "ciFailed";
    case "release":
      return "release";
    default:
      return "githubInbox";
  }
}

function typeFor(reason) {
  switch (reason) {
    case "review_requested":
      return "review";
    case "mention":
    case "team_mention":
      return "mention";
    case "assign":
      return "assigned";
    case "ci_activity":
      return "ciFailed";
    case "release":
      return "release";
    default:
      return "inbox";
  }
}

async function show(n) {
  const title = n.title || "Dev Dashboard";
  return self.registration.showNotification(title, {
    body: n.body || "",
    tag: n.tag || n.key || n.id || title,
    icon: iconUrl(),
    badge: iconUrl(),
    data: { url: n.url || dashboardUrl(), id: n.id || null },
    renotify: !!n.renotify,
  });
}

async function handlePush(event) {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  if (!payload.title && !payload.body) {
    return pollInbox("push");
  }
  return show({
    title: payload.title || "Dev Dashboard",
    body: payload.body || "",
    url: payload.url,
    tag: payload.tag || payload.key,
    id: payload.id,
  });
}

async function anyVisibleClient() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return windows.some((c) => c.visibilityState === "visible" || c.visibilityState == null);
}

async function openFromNotification(data) {
  const dash = dashboardUrl();
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (client.url.startsWith(dash) && "focus" in client) {
      await client.focus();
      client.postMessage({ type: "notification-click", id: data.id || null, url: data.url || dash });
      return;
    }
  }
  await self.clients.openWindow(data.url || dash);
}

async function pollInbox(reason) {
  if (await anyVisibleClient()) return;
  const config = await readConfig();
  if (!config?.token || !config.enabled || config.dnd) return;

  const res = await fetch("https://api.github.com/notifications?per_page=50", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) return;

  const threads = await res.json();
  const repos = new Set((config.repos || []).map((s) => s.toLowerCase()));
  const last = config.lastInbox || {};
  const notifyOn = config.notifyOn || {};
  const nextInbox = { ...last };
  const events = [];

  for (const thread of threads) {
    const slug = thread.repository?.full_name || "";
    if (repos.size && !repos.has(slug.toLowerCase())) continue;
    if (!thread.unread) continue;
    const setting = settingFor(thread.reason);
    if (notifyOn[setting] === false) continue;
    const stamp = thread.updated_at;
    if (last[thread.id] === stamp) continue;
    nextInbox[thread.id] = stamp;
    events.push({
      type: typeFor(thread.reason),
      tag: `inbox:${thread.id}:${stamp}`,
      title: `${repoShort(slug)}: ${thread.subject?.title || "GitHub update"}`,
      body: `GitHub · ${String(thread.reason || "update").replace(/_/g, " ")}`,
      url: threadUrl(thread),
    });
  }

  await writeConfig({ lastInbox: nextInbox, lastPollAt: new Date().toISOString(), lastPollReason: reason });

  const burst = events.length > 5;
  if (burst) {
    await show({
      title: `${events.length} new GitHub updates`,
      body: "Open Dev Dashboard to see them.",
      url: dashboardUrl(),
      tag: "devdash-burst",
    });
    return;
  }
  for (const event of events) await show(event);
}
