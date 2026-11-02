// The search box: your PRs and issues, repo links and page actions, plus asking Bob or searching GitHub.

import { esc, repoShort } from "../core.js";
import { enabledRepos, repoLabel } from "../repos.js";
import { bobAsk, bobCatchUp, bobFind, bobPlan, bobSlack, bobStandup } from "./bob.js";
import { prettyLabel, requestSync } from "./header.js";
import { icon } from "./icons.js";
import { openSettings, toggleTheme } from "./settings.js";
import { openReport, todayActions } from "./today.js";
import { $, aiOn, connected, data, go, hosts, repoScope, searchUrl, shownRepos, state } from "./ui.js";
import { unsnooze } from "./work.js";

const input = () => $("#search-input");
const list = () => $("#search-results");
let results = [];
let active = 0;

// ---------- what can be found ----------

function workEntries() {
  const d = data();
  if (!d) return [];
  const seen = new Set();
  const out = [];
  for (const [key, tag] of [["reviews", "Review"], ["mine", "My PR"], ["assigned", "Assigned"], ["mentions", "Mention"], ["triage", "Triage"], ["merged", "Merged"]])
    for (const i of d[key].items) {
      if (seen.has(i.id)) continue;
      seen.add(i.id);
      out.push({ group: "Work", label: i.title, hint: `${repoLabel(i.repo)} #${i.number} · ${tag}`, iconName: i.kind === "pr" ? "pr" : "issue", url: i.url, terms: `${i.number} #${i.number} ${i.author} ${repoShort(i.repo)} ${i.labels.join(" ")}` });
    }
  return out;
}

function linkEntries() {
  return shownRepos().flatMap((r) => [
    ...(r.slug ? [{ group: "Repos", label: r.name, hint: r.slug, iconName: "book", url: r.url, terms: `${r.short} ${r.id}` }] : []),
    ...r.groups.flatMap((g) => g.links.map((l) => ({ group: "Links", label: `${r.short} · ${prettyLabel(l.label)}`, hint: g.title, iconName: "link", url: l.href, terms: `${r.name} ${r.id}` }))),
  ]);
}

function actionEntries() {
  const act = (label, iconName, run, terms = "", bob = false) => ({ group: "Actions", label, iconName, run, terms, bob });
  const bob = aiOn();
  const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  return [
    connected() && act("Sync now", "refresh", () => requestSync(true), "refresh reload"),
    act("Copy standup update", "copy", todayActions["copy-standup"], "standup slack"),
    bob && data() && act("Write standup with Bob", "sparkle", bobStandup, "standup slack ai bob", true),
    bob && data() && act("Plan my day with Bob", "sparkle", bobPlan, "plan schedule day ai bob", true),
    bob && act("Catch me up with Bob", "sparkle", bobCatchUp, "activity summary ai bob", true),
    bob && act("Draft a Slack reply with Bob", "slack", bobSlack, "slack support question thread reply help", true),
    bob && state.settings.bugHunt && act("Hunt for a bug now", "bug", todayActions["hunt-run"], "bug hunt bob daily", true),
    bob && state.bugHunts[0] && act("Open the latest bug report", "bug", () => openReport(state.bugHunts[0]), "bug hunt report daily"),
    act("Open activity", "bell", () => $("#activity").showPopover(), "notifications"),
    act("Open settings", "gear", () => openSettings(), "preferences token"),
    act(`Switch to ${dark ? "light" : "dark"} theme`, "moon", toggleTheme, "theme dark light"),
    (Object.keys(state.day.snoozed).length || Object.keys(state.untilChange).length) && act("Restore snoozed items", "snooze", () => unsnooze(), "unsnooze"),
  ].filter(Boolean);
}

/** "carbon#123", "labs 456" or "#789" jumps straight to an issue or PR. */
function jumpEntry(q) {
  const m = q.trim().match(/^(?:([a-z][\w.-]*)\s*)?#?(\d{1,6})$/i);
  if (!m) return null;
  const alias = (m[1] || "").toLowerCase();
  const repos = enabledRepos(state.settings);
  const repo = alias ? repos.find((r) => [r.id, r.short, r.name, repoShort(r.slug)].some((n) => n.toLowerCase().replace(/\s+/g, "-").startsWith(alias))) : repos[0];
  return repo && { group: "Go to", label: `${repoShort(repo.slug)}#${m[2]}`, hint: "Open on GitHub", iconName: "arrowRight", url: `${repo.url}/issues/${m[2]}` };
}

const isQuestion = (q) => q.split(/\s+/).length >= 3 && (/\?$/.test(q) || /^(what|how|why|which|where|when|who|can|could|should|is|are|do|does|did|any|summari[sz]e|explain|list|show me|tell me|help)\b/i.test(q));

/** Every term must appear; matches at the start of the label or a word score higher. */
function score(entry, terms) {
  const label = entry.label.toLowerCase();
  const hay = `${label} ${entry.hint || ""} ${entry.terms || ""}`.toLowerCase();
  if (!terms.every((t) => hay.includes(t))) return -1;
  return terms.reduce((s, t) => s + (label.startsWith(t) ? 4 : label.includes(` ${t}`) ? 2 : label.includes(t) ? 1 : 0), 0);
}

// ---------- the results list ----------

const ORDER = { "Go to": 0, Work: 1, Repos: 2, Links: 3, Actions: 4, Search: 5 };

function update() {
  const q = input().value.trim();
  if (!q) return close();
  const terms = q.toLowerCase().split(/\s+/);
  const matched = [...workEntries(), ...linkEntries(), ...actionEntries()]
    .map((entry) => ({ entry, s: score(entry, terms) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map((x) => x.entry);
  const jump = jumpEntry(q);
  const bob = aiOn()
    ? [
        { group: "Search", label: `Ask Bob “${q}”`, hint: "About your work and links", iconName: "sparkle", run: () => bobAsk(q), bob: true, ask: true },
        { group: "Search", label: `Find with Bob: “${q}”`, hint: "Builds a GitHub search", iconName: "sparkle", run: () => bobFind(q), bob: true },
      ]
    : [];
  results = [
    ...(jump ? [jump] : []),
    ...matched,
    ...bob,
    ...(hosts().length ? hosts() : ["github.com"]).map((h, _, all) => ({
      group: "Search",
      label: `Search ${all.length > 1 ? h : "GitHub"} for “${q}”`,
      iconName: "github",
      url: searchUrl(`${h === "github.com" ? "org:carbon-design-system" : repoScope(h)} ${q}`, h),
    })),
    { group: "Search", label: `Search the web for “${q}”`, iconName: "globe", web: q },
  ].sort((a, b) => ORDER[a.group] - ORDER[b.group]);
  // A question goes to Bob on Enter; anything else lands on the best match.
  active = bob.length && !jump && isQuestion(q) ? results.findIndex((r) => r.ask) : 0;
  draw();
}

function draw() {
  let group = "";
  list().innerHTML = results
    .map((r, i) => {
      const heading = r.group !== group ? (r.group === "Search" ? `<li class="search__sep"></li>` : `<li class="search__group">${esc(r.group)}</li>`) : "";
      group = r.group;
      return `${heading}<li class="search__item ${r.bob ? "bob-btn" : ""} ${i === active ? "is-active" : ""}" id="sr-${i}" role="option" aria-selected="${i === active}" data-index="${i}">${icon(r.iconName, 16)}<span class="search__label">${esc(r.label)}</span>${r.hint ? `<span class="search__hint">${esc(r.hint)}</span>` : ""}</li>`;
    })
    .join("");
  list().hidden = false;
  input().setAttribute("aria-expanded", "true");
  input().setAttribute("aria-activedescendant", `sr-${active}`);
  $(`#sr-${active}`)?.scrollIntoView({ block: "nearest" });
}

function close() {
  results = [];
  list().hidden = true;
  input().setAttribute("aria-expanded", "false");
}

function choose(i, newTab) {
  const r = results[i];
  if (!r) return;
  input().value = "";
  close();
  if (r.run) r.run();
  else if (r.web) chrome.search.query({ text: r.web, disposition: newTab ? "NEW_TAB" : "CURRENT_TAB" });
  else go(r.url, newTab);
}

export const focusSearch = () => input().focus();

export function bindSearch() {
  input().addEventListener("input", update);
  input().addEventListener("focus", update);
  input().addEventListener("blur", () => setTimeout(close, 120));
  input().addEventListener("keydown", (e) => {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && results.length) {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      draw();
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active, e.metaKey || e.ctrlKey);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      if (input().value) {
        input().value = "";
        close();
      } else input().blur();
    }
  });
  list().addEventListener("mousedown", (e) => e.preventDefault());
  list().addEventListener("click", (e) => {
    const li = e.target.closest("[data-index]");
    if (li) choose(+li.dataset.index, e.metaKey || e.ctrlKey);
  });
}
