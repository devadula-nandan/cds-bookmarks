/** The activity drawer. */

import { dayLabel, iconChip, timeEl } from "./pieces.js";
import { $, $$, activity, aiOn, state } from "./state.js";
import { renderTools } from "./top.js";

const { esc } = DD.util;
const { icon } = DD.icons;
const { stagger } = DD.motion;

export function renderActivity() {
  const list = activity();
  const seen = state.seenAt ? Date.parse(state.seenAt) : 0;
  let current = "";
  const items = list
    .map((a) => {
      const meta = DD.sync.TYPES[a.type] || { icon: "activity", tone: "neutral" };
      const label = dayLabel(a.createdAt);
      const head = label !== current ? `<li class="drawer__day">${(current = label)}</li>` : "";
      return `${head}
        <li class="item ${Date.parse(a.createdAt) > seen ? "is-new" : ""}">
          ${iconChip(meta.icon, meta.tone)}
          <div class="item__body">
            ${a.url ? `<a class="item__title" href="${esc(a.url)}">${esc(a.title)}</a>` : `<span class="item__title">${esc(a.title)}</span>`}
            ${a.body ? `<p class="item__meta">${esc(a.body)}</p>` : ""}
          </div>
          <div class="item__end">${timeEl(a.createdAt)}</div>
        </li>`;
    })
    .join("");

  const s = state.settings;
  const off = !s.notifications ? "Desktop notifications are off." : "";
  $("#activity").innerHTML = `
    <header class="drawer__head">
      <h2>Activity</h2>
      <div class="drawer__actions">
        ${aiOn() && list.length ? `<button class="btn btn--ghost btn--sm bob-btn" data-action="ai-catchup">${icon("sparkle", 14)}Catch me up</button>` : ""}
        ${list.length && !s.demo ? `<button class="btn btn--ghost btn--sm" data-action="clear-activity">Clear</button>` : ""}
        <button class="icon-btn icon-btn--sm" data-action="close-activity" aria-label="Close">${icon("x", 16)}</button>
      </div>
    </header>
    ${
      list.length
        ? `<ul class="items drawer__list">${items}</ul>`
        : `<div class="empty">${iconChip("bell", "neutral")}<p class="empty__title">No activity yet</p><p class="empty__text">Approvals, CI results, merges and releases show up here as they happen.</p></div>`
    }
    <footer class="drawer__foot">${off} <button class="btn btn--ghost btn--sm" data-action="settings" data-section="notifications">Notification settings</button></footer>`;
}

export function openActivity() {
  const drawer = $("#activity");
  if (!drawer.matches(":popover-open")) drawer.showPopover();
}

/** Content is built right before the drawer opens; it counts as seen once it's on screen. */
export function bindActivity() {
  const drawer = $("#activity");
  drawer.addEventListener("beforetoggle", (e) => e.newState === "open" && renderActivity());
  drawer.addEventListener("toggle", async (e) => {
    if (e.newState !== "open") return renderTools();
    $(".drawer__head .icon-btn", drawer)?.focus();
    stagger($$(".drawer__list > .item", drawer), "translateX(12px)", { duration: 240, delay: 60 });
    state.lastSeenAt = state.seenAt;
    state.seenAt = new Date().toISOString();
    await DD.storage.set({ activitySeenAt: state.seenAt });
  });
}

export const activityActions = {
  activity: () => $("#activity").togglePopover(),
  "close-activity": () => $("#activity").hidePopover(),
  "clear-activity": async () => {
    state.clearedAt = new Date().toISOString();
    renderActivity();
    renderTools();
    await DD.storage.set({ activityClearedAt: state.clearedAt });
  },
};
