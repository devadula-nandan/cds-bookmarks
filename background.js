// The background service worker: syncs GitHub every minute or so, raises desktop notifications,
// keeps the toolbar badge current, and runs the daily bug hunt.

import { loadDay, normalizeSettings, plural, storage } from "./src/core.js";
import { hunt, canHunt, maybeHunt } from "./src/hunt.js";
import { bucket, focusQueue, isSnoozed } from "./src/insights.js";
import { reloadRepos, reposReady } from "./src/repos.js";
import { notify, sync, tick } from "./src/sync.js";

async function openTab(url) {
  const tab = await chrome.tabs.create(url ? { url } : {});
  chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

/** The badge counts what needs you now (snoozed items excluded); red when something is urgent. */
async function updateBadge() {
  const { cache, settings, snoozedUntilChange } = await storage.get(["cache", "settings", "snoozedUntilChange"]);
  const s = normalizeSettings(settings);
  const data = s.token ? cache?.data : null;
  const { snoozed } = await loadDay();
  const now = data ? focusQueue(data, s).filter((t) => bucket(t) === "now" && !isSnoozed(t, snoozed, snoozedUntilChange)) : [];
  await chrome.action.setBadgeText({ text: now.length ? String(now.length) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: now.some((t) => t.priority === "urgent") ? "#da1e28" : "#0f62fe" });
  await chrome.action.setTitle({ title: now.length ? `${plural(now.length, "thing")} need${now.length === 1 ? "s" : ""} you` : "Dev Dashboard" });
}

// Every minute: meeting reminders, a sync when one is due, and the daily bug hunt.
chrome.alarms.onAlarm.addListener(async () => {
  await reposReady;
  await tick();
  maybeHunt();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.repoData) reloadRepos();
  if (Object.keys(changes).some((k) => ["cache", "settings", "snoozedUntilChange"].includes(k) || k.startsWith("day:"))) updateBadge();
});

// Messages from the new tab page.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "sync") reposReady.then(sync).then(reply);
  // Replies as soon as the hunt starts: it can outlast Chrome's 5-minute limit on a reply. The page
  // follows along through `huntState` and `bugHunts` in storage.
  if (msg.type === "bug-hunt")
    reposReady.then(canHunt).then((ready) => {
      reply(ready);
      if (ready.ok) hunt();
    });
  if (msg.type === "test-notification")
    notify([{ title: "Notifications are working", body: "Reviews, CI failures and mentions will show up like this.", url: "https://github.com/notifications" }]).then(
      () => reply({ ok: true }),
      (err) => reply({ ok: false, error: err.message })
    );
  return true; // the reply comes later
});

chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
  openTab(id.slice(id.indexOf("|") + 1) || null);
});

chrome.action.onClicked.addListener(() => openTab());

chrome.runtime.onInstalled.addListener(({ reason }) => {
  updateBadge();
  if (reason === "install") openTab();
});

// The worker restarts often; only create the alarm if it's missing, or every restart would reset it.
chrome.alarms.get("tick").then((alarm) => alarm || chrome.alarms.create("tick", { periodInMinutes: 1, delayInMinutes: 0.1 }));
