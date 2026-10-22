/** Search: PRs, issues, links and actions, plus asking Bob. */

import { openActivity } from "./activity.js";
import { bobAsk, bobCatchUp, bobFind, bobPlan, bobSlack, bobStandup } from "./bob.js";
import { openSettings, setDemo, toggleTheme } from "./settings.js";
import { $, aiOn, connected, data, ext, searchUrl, shownRepos, state } from "./state.js";
import { bobReport, copyStandup, huntNow } from "./today.js";
import { prettyLabel, requestSync } from "./top.js";
import { unsnooze } from "./work.js";

const { esc } = DD.util;
const { icon } = DD.icons;

export const search = (() => {
  const input = () => $("#search-input");
  const list = () => $("#search-results");
  let results = [];
  let index = 0;

  function linkIndex() {
    const out = [];
    shownRepos().forEach((r) => {
      if (r.slug) out.push({ group: "Repos", label: r.name, hint: r.slug, iconName: "book", url: `https://github.com/${r.slug}`, terms: `${r.short} ${r.id}` });
      r.groups.forEach((g) =>
        g.links.forEach((l) => out.push({ group: "Links", label: `${r.short} · ${prettyLabel(l.label)}`, hint: g.title, iconName: "link", url: l.href, terms: `${r.name} ${r.id}` }))
      );
    });
    return out;
  }

  function workIndex() {
    const d = data();
    if (!d) return [];
    const seen = new Set();
    const out = [];
    [
      ["reviews", "Review"],
      ["mine", "My PR"],
      ["assigned", "Assigned"],
      ["mentions", "Mention"],
      ["triage", "Triage"],
      ["merged", "Merged"],
    ].forEach(([key, tag]) =>
      d[key].items.forEach((i) => {
        if (seen.has(i.id)) return;
        seen.add(i.id);
        out.push({
          group: "Work",
          label: i.title,
          hint: `${DD.repos.label(i.repo)} #${i.number} · ${tag}`,
          iconName: i.kind === "pr" ? "pr" : "issue",
          url: i.url,
          terms: `${i.number} #${i.number} ${i.author} ${DD.util.repoShort(i.repo)} ${i.labels.map((l) => l.name).join(" ")}`,
        });
      })
    );
    return out;
  }

  function actionIndex() {
    const s = state.settings;
    const act = (label, iconName, run, terms = "") => ({ group: "Actions", label, iconName, run, terms });
    const bobAct = (...args) => ({ ...act(...args), bob: true });
    return [
      connected() && act("Sync now", "refresh", () => requestSync(true), "refresh reload"),
      act("Copy standup update", "copy", copyStandup, "standup slack"),
      aiOn() && data() && bobAct("Write standup with Bob", "sparkle", bobStandup, "standup slack ai bob"),
      aiOn() && data() && bobAct("Plan my day with Bob", "sparkle", bobPlan, "plan schedule day ai bob"),
      aiOn() && bobAct("Catch me up with Bob", "sparkle", bobCatchUp, "activity summary ai bob"),
      aiOn() && bobAct("Draft a Slack reply with Bob", "slack", bobSlack, "slack support question thread reply help"),
      aiOn() && state.settings.bugHunt && bobAct("Hunt for a bug now", "bug", huntNow, "bug hunt bob daily"),
      aiOn() && state.bugHunts[0] && act("Open the latest bug report", "bug", () => bobReport(state.bugHunts[0]), "bug hunt report daily"),
      act("Open activity", "bell", openActivity, "notifications"),
      act("Open settings", "gear", () => openSettings(), "preferences token"),
      act(`Switch to ${document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches) ? "light" : "dark"} theme`, "moon", toggleTheme, "theme dark light"),
      Object.keys(state.day.snoozed).length && act("Restore snoozed items", "snooze", unsnooze, "unsnooze"),
      s.demo ? act("Exit sample data", "x", () => setDemo(false)) : null,
    ].filter(Boolean);
  }

  /** "carbon#123", "products 456" or "#789" jumps straight to an issue or PR. */
  function jump(q) {
    const m = q.trim().match(/^(?:([a-z][\w.-]*)\s*)?#?(\d{1,6})$/i);
    if (!m) return null;
    const alias = (m[1] || "").toLowerCase();
    const repos = DD.repos.enabled(state.settings);
    const repo = alias
      ? repos.find((r) => [r.id, r.short, r.name, DD.util.repoShort(r.slug)].some((n) => n.toLowerCase().replace(/\s+/g, "-").startsWith(alias)))
      : repos[0];
    if (!repo) return null;
    return { group: "Go to", label: `${DD.util.repoShort(repo.slug)}#${m[2]}`, hint: `Open on GitHub`, iconName: "arrowRight", url: `https://github.com/${repo.slug}/issues/${m[2]}` };
  }

  function isQuestion(q) {
    const words = q.split(/\s+/).length;
    return words >= 3 && (/\?$/.test(q) || /^(what|what's|whats|how|why|which|where|when|who|can|could|should|is|are|do|does|did|any|summari[sz]e|explain|list|show me|tell me|help)\b/i.test(q));
  }

  function score(item, terms) {
    const label = item.label.toLowerCase();
    const hay = `${label} ${(item.hint || "").toLowerCase()} ${(item.terms || "").toLowerCase()}`;
    if (!terms.every((t) => hay.includes(t))) return -1;
    let s = 0;
    terms.forEach((t) => {
      if (label.startsWith(t)) s += 4;
      else if (new RegExp(`(^|[\\s·(:/#-])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(label)) s += 2;
      else if (label.includes(t)) s += 1;
    });
    return s;
  }

  function update() {
    const q = input().value.trim();
    if (!q) return close();
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const ORDER = { "Go to": 0, Work: 1, Repos: 2, Links: 3, Actions: 4 };
    const matched = [...workIndex(), ...linkIndex(), ...actionIndex()]
      .map((item) => ({ item, s: score(item, terms) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || ORDER[a.item.group] - ORDER[b.item.group])
      .slice(0, 8)
      .map((x) => x.item)
      .sort((a, b) => ORDER[a.group] - ORDER[b.group]);
    const target = jump(q);
    const go = target && !matched.some((r) => r.url && target.url.replace("/issues/", "/") === r.url.replace(/\/(issues|pull)\//, "/")) ? target : null;
    const bobItems = aiOn()
      ? [
          { group: "Search", label: `Ask Bob “${q}”`, hint: "About your work and links", iconName: "sparkle", ask: q, bob: true },
          { group: "Search", label: `Find with Bob: “${q}”`, hint: "Builds a GitHub search", iconName: "sparkle", find: q, bob: true },
        ]
      : [];
    results = [
      ...(go ? [go] : []),
      ...matched,
      ...bobItems,
      { group: "Search", label: `Search GitHub for “${q}”`, iconName: "github", url: searchUrl(`org:carbon-design-system ${q}`) },
      { group: "Search", label: `Search the web for “${q}”`, iconName: "globe", web: q },
    ];
    // A question goes to Bob on Enter; anything else still lands on the best match.
    index = bobItems.length && !go && isQuestion(q) ? results.findIndex((r) => r.ask) : 0;
    draw();
  }

  function draw() {
    let group = "";
    list().innerHTML = results
      .map((r, i) => {
        const head = r.group !== group && r.group !== "Search" ? `<li class="search__group" role="presentation">${esc((group = r.group))}</li>` : "";
        if (r.group === "Search" && group !== "Search") {
          group = "Search";
          return `<li class="search__sep" role="presentation"></li>${option(r, i)}`;
        }
        return head + option(r, i);
      })
      .join("");
    list().hidden = false;
    input().setAttribute("aria-expanded", "true");
    input().setAttribute("aria-activedescendant", `sr-${index}`);
    $(`#sr-${index}`)?.scrollIntoView({ block: "nearest" });
  }

  function option(r, i) {
    return `<li class="search__item ${r.bob ? "bob-btn" : ""} ${i === index ? "is-active" : ""}" id="sr-${i}" role="option" aria-selected="${i === index}" data-index="${i}">${icon(r.iconName, 16)}<span class="search__label">${esc(r.label)}</span>${r.hint ? `<span class="search__hint">${esc(r.hint)}</span>` : ""}</li>`;
  }

  function close() {
    results = [];
    list().hidden = true;
    list().innerHTML = "";
    input().setAttribute("aria-expanded", "false");
    input().removeAttribute("aria-activedescendant");
  }

  function run(i, newTab) {
    const r = results[i];
    if (!r) return;
    input().value = "";
    close();
    if (r.run) return r.run();
    if (r.ask) return bobAsk(r.ask);
    if (r.find) return bobFind(r.find);
    if (r.web) return webSearch(r.web, newTab);
    go(r.url, newTab);
  }

  function bind() {
    input().addEventListener("input", update);
    input().addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!results.length) return;
        e.preventDefault();
        index = (index + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
        draw();
      } else if (e.key === "Enter") {
        e.preventDefault();
        run(index, e.metaKey || e.ctrlKey);
      } else if (e.key === "Escape") {
        e.stopPropagation();
        if (input().value) {
          input().value = "";
          close();
        } else input().blur();
      }
    });
    input().addEventListener("blur", () => setTimeout(close, 120));
    input().addEventListener("focus", () => input().value.trim() && update());
    list().addEventListener("mousedown", (e) => e.preventDefault());
    list().addEventListener("click", (e) => {
      const li = e.target.closest("[data-index]");
      if (li) run(+li.dataset.index, e.metaKey || e.ctrlKey);
    });
  }

  return { bind, focus: () => input().focus() };
})();

export function go(url, newTab) {
  if (!url) return;
  if (newTab) window.open(url, "_blank", "noopener");
  else location.assign(url);
}

function webSearch(text, newTab) {
  if (ext && chrome.search?.query) return chrome.search.query({ text, disposition: newTab ? "NEW_TAB" : "CURRENT_TAB" });
  go(`https://www.google.com/search?q=${encodeURIComponent(text)}`, newTab);
}
