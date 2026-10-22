/* Dev Dashboard — background worker: polls GitHub, raises OS notifications, keeps the toolbar badge current. */
importScripts("bookmarks-data.js", "js/core.js", "js/repos.js", "js/github.js", "js/insights.js", "js/sync.js", "js/ai.js", "js/hunt.js");

const ALARM = "tick";
const ICON = "icons/icon-128.png";

async function ensureAlarm() {
  if (!(await chrome.alarms.get(ALARM))) chrome.alarms.create(ALARM, { periodInMinutes: 1, delayInMinutes: 0.1 });
}

/** Notification ids carry their target URL, so a click still works after the worker has been suspended. */
DD.sync.setNotifier(async (events) => {
  for (const e of events) {
    await chrome.notifications.create(`${DD.util.uid()}|${e.url || ""}`, {
      type: "basic",
      iconUrl: ICON,
      title: e.title,
      message: e.body || "",
      priority: ["ciFailed", "mainBroken", "changes", "conflict", "bugHunt"].includes(e.type) ? 1 : 0,
    });
  }
});

async function openTab(url) {
  const tab = await chrome.tabs.create(url ? { url } : {});
  if (tab?.windowId != null) chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
  openTab(id.slice(id.indexOf("|") + 1) || null);
});

chrome.action.onClicked.addListener(() => openTab());

/** Badge = how many things need you now (snoozed ones excluded); red when something is urgent. */
async function updateBadge() {
  const { cache, settings: raw } = await DD.storage.get(["cache", "settings"]);
  const settings = DD.settings.normalize(raw);
  const data = settings.token && !settings.demo ? cache?.data : null;
  if (!data) return chrome.action.setBadgeText({ text: "" });
  const { snoozed = {} } = await DD.day.load();
  const { snoozedUntilChange = {} } = await DD.storage.get("snoozedUntilChange");
  const now = DD.insights.focusQueue(data, settings).filter((t) => !DD.insights.isSnoozed(t, snoozed, snoozedUntilChange) && DD.insights.bucket(t) === "now");
  await chrome.action.setBadgeText({ text: now.length ? String(now.length) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: now.some((t) => t.priority === "urgent") ? "#da1e28" : "#0f62fe" });
  await chrome.action.setTitle({ title: now.length ? `${DD.util.plural(now.length, "thing")} need${now.length === 1 ? "s" : ""} you` : "Dev Dashboard" });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (Object.keys(changes).some((k) => k === "cache" || k === "settings" || k === "snoozedUntilChange" || k.startsWith(DD.day.PREFIX))) updateBadge();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  await DD.sync.tick();
  // The daily bug hunt can take several minutes; the native messaging port keeps the worker alive meanwhile.
  DD.hunt.maybeRun();
});

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.type === "ping") {
    respond({ ok: true, rev: DD.REV });
    return false;
  }
  if (msg?.type === "sync") {
    DD.sync.run().then(respond);
    return true;
  }
  // Reply as soon as the hunt starts: it can outlast Chrome's 5-minute limit on a message reply.
  // The page follows progress and results through huntState and bugHunts in storage.
  if (msg?.type === "bug-hunt") {
    DD.hunt
      .check()
      .then((ready) => {
        respond(ready);
        if (ready.ok) DD.hunt.run({ slug: msg.slug });
      })
      .catch((err) => respond({ ok: false, error: err?.message || String(err) }));
    return true;
  }
  if (msg?.type === "test-notification") {
    chrome.notifications
      .create(`test-${Date.now()}|https://github.com/notifications`, {
        type: "basic",
        iconUrl: ICON,
        title: "Notifications are working",
        message: "Reviews, CI failures and mentions will show up like this.",
      })
      .then(() => respond({ ok: true }), (err) => respond({ ok: false, error: err.message }));
    return true;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  ensureAlarm();
  updateBadge();
  if (reason === "install") openTab();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  DD.sync.tick();
});

ensureAlarm();
