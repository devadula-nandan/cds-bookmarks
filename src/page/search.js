// The search box (Carbon search, with its results in Carbon contained lists): your PRs and issues, repo links
// and page actions, plus asking Bob or searching GitHub.

import { repoShort } from "../core.js";
import { enabledRepos, repoLabel } from "../repos.js";
import uFuzzy from "../vendor/ufuzzy.js";
import { bobAsk, bobCatchUp, bobFind, bobPlan, bobSlack, bobStandup } from "./bob.js";
import { prettyLabel, requestSync, toggleActivity } from "./header.js";
import { icon } from "./icons.js";
import { html, nothing, render } from "./lit.js";
import { isDark, openSettings, toggleTheme } from "./settings.js";
import { openReport, todayActions } from "./today.js";
import { $, $$, aiOn, connected, data, go, searchUrl, shownRepos, state } from "./ui.js";
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
    ...(r.slug ? [{ group: "Repos", label: r.name, hint: r.slug, iconName: "book", url: `https://github.com/${r.slug}`, terms: `${r.short} ${r.id}` }] : []),
    ...r.groups.flatMap((g) => g.links.map((l) => ({ group: "Links", label: `${r.short} · ${prettyLabel(l.label)}`, hint: g.title, iconName: "link", url: l.href, terms: `${r.name} ${r.id}` }))),
  ]);
}

function actionEntries() {
  const act = (label, iconName, run, terms = "", bob = false) => ({ group: "Actions", label, iconName, run, terms, bob });
  const bob = aiOn();
  const dark = isDark();
  return [
    connected() && act("Sync now", "refresh", () => requestSync(true), "refresh reload"),
    act("Copy standup update", "copy", todayActions["copy-standup"], "standup slack"),
    bob && data() && act("Write standup with Bob", "sparkle", bobStandup, "standup slack ai bob", true),
    bob && data() && act("Plan my day with Bob", "sparkle", bobPlan, "plan schedule day ai bob", true),
    bob && act("Catch me up with Bob", "sparkle", bobCatchUp, "activity summary ai bob", true),
    bob && act("Draft a Slack reply with Bob", "slack", bobSlack, "slack support question thread reply help", true),
    bob && state.settings.bugHunt && act("Hunt for a bug now", "bug", todayActions["hunt-run"], "bug hunt bob daily", true),
    bob && state.bugHunts[0] && act("Open the latest bug report", "bug", () => openReport(state.bugHunts[0]), "bug hunt report daily"),
    act("Open activity", "bell", () => toggleActivity(true), "notifications"),
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
  return repo && { group: "Go to", label: `${repoShort(repo.slug)}#${m[2]}`, hint: "Open on GitHub", iconName: "arrowRight", url: `https://github.com/${repo.slug}/issues/${m[2]}` };
}

const isQuestion = (q) => q.split(/\s+/).length >= 3 && (/\?$/.test(q) || /^(what|how|why|which|where|when|who|can|could|should|is|are|do|does|did|any|summari[sz]e|explain|list|show me|tell me|help)\b/i.test(q));

/**
 * Fuzzy matching: every word must match, in any order, forgiving one typo per word ("guidebaner" finds
 * Guidebanner). Unicode-aware, for titles with accents and emoji.
 */
const fuzzy = new uFuzzy({
  intraMode: 1,
  unicode: true,
  interSplit: "[^\\p{L}\\d']+",
  intraSplit: "\\p{Ll}\\p{Lu}",
  intraBound: "\\p{L}\\d|\\d\\p{L}|\\p{Ll}\\p{Lu}",
  intraChars: "[\\p{L}\\d']",
  intraContr: "'\\p{L}{1,2}\\b",
});

/** The best matches for `q`, best first. The label leads each entry's text, so matches in it rank higher. */
function search(entries, q) {
  const [idxs, info, order] = fuzzy.search(
    entries.map((e) => `${e.label} ${e.hint || ""} ${e.terms || ""}`),
    q,
    1
  );
  if (!idxs) return [];
  return order ? order.map((i) => entries[info.idx[i]]) : idxs.map((i) => entries[i]);
}

// ---------- the results list ----------

const ORDER = { "Go to": 0, Work: 1, Repos: 2, Links: 3, Actions: 4, Search: 5 };

/** `e` is cds-search's input event, which carries the new text before the element's value has it. */
function update(e) {
  const q = (e?.detail?.value ?? input().value).trim();
  if (!q) return close();
  const matched = search([...workEntries(), ...linkEntries(), ...actionEntries()], q).slice(0, 8);
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
    { group: "Search", label: `Search GitHub for “${q}”`, iconName: "github", url: searchUrl(`org:carbon-design-system ${q}`) },
    { group: "Search", label: `Search the web for “${q}”`, iconName: "globe", web: q },
  ].sort((a, b) => ORDER[a.group] - ORDER[b.group]);
  // A question goes to Bob on Enter; anything else lands on the best match.
  active = bob.length && !jump && isQuestion(q) ? results.findIndex((r) => r.ask) : 0;
  draw();
}

function draw() {
  const groups = [];
  results.forEach((r, i) => {
    if (groups.at(-1)?.name !== r.group) groups.push({ name: r.group, items: [] });
    groups.at(-1).items.push({ r, i });
  });
  render(
    groups.map(
      (g) => html`<cds-contained-list label=${g.name} size="md">
        ${g.items.map(
          ({ r, i }) => html`<cds-contained-list-item clickable class=${r.bob ? "bob-btn" : nothing} data-index=${i}>
            ${icon(r.iconName, 16, { slot: "icon" })}
            <span class="item__row"><span class="item__body search__text">${r.label}${r.hint ? html`<span class="search__hint">${r.hint}</span>` : nothing}</span>${i === active ? html`<cds-tag size="sm" type="gray">Enter</cds-tag>` : nothing}</span>
          </cds-contained-list-item>`
        )}
      </cds-contained-list>`
    ),
    list()
  );
  list().hidden = false;
}

function close() {
  results = [];
  list().hidden = true;
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

/** Moves focus through the results (from the box, to the first one); up past the first, back to the box. */
function step(by) {
  const items = $$("cds-contained-list-item", list());
  const at = items.indexOf(document.activeElement);
  const next = at + by;
  if (next < 0) return focusSearch();
  // A clickable list item doesn't take focus itself: its button, in its shadow root, does.
  const item = items[Math.min(next, items.length - 1)];
  (item?.shadowRoot?.querySelector("button") || item)?.focus();
}

export function bindSearch() {
  input().addEventListener("cds-search-input", update);
  input().addEventListener("focus", () => update());
  // Closes once focus leaves both the box and its results.
  $("#search").addEventListener("focusout", () => setTimeout(() => !$("#search").contains(document.activeElement) && close(), 120));
  $("#search").addEventListener("keydown", (e) => {
    const inBox = e.target === input();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!results.length) return;
      e.preventDefault();
      if (!inBox || e.key === "ArrowDown") step(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" && inBox) {
      e.preventDefault();
      choose(active, e.metaKey || e.ctrlKey);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      if (!inBox) return focusSearch();
      if (input().value) {
        input().value = "";
        close();
      } else input().blur();
    }
  });
  list().addEventListener("click", (e) => {
    const item = e.target.closest("[data-index]");
    if (item) choose(+item.dataset.index, e.metaKey || e.ctrlKey);
  });
}
