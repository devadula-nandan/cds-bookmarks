// The repositories the dashboard covers, from bookmarks.json — or from the copy edited in
// Settings → Repositories, which is saved in this browser as `repoData` and wins over the file.
// An entry holds only what can't be worked out: the GitHub repo, and optionally a name, a local clone,
// the approvals a PR needs, a logo and extra links. The rest (the usual GitHub links, the sprint board)
// is inferred here, and the ready-to-merge label is read from the repo's labels on each sync.

import { repoShort, storage } from "./core.js";

/** Every repo, filled in place by loadRepos(). */
export const repos = [];
let raw = [];

/** "carbon-design-system/carbon" from that, or from any github.com link into the repo. */
export const slugOf = (value) =>
  String(value || "")
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
    .match(/^([\w.-]+\/[\w.-]+?)(?:\.git)?(?:[/?#]|$)/)?.[1] || null;

/** "Carbon AI chat" for "carbon-design-system/carbon-ai-chat": the name when the entry doesn't give one. */
export const nameOf = (slug) => {
  const text = repoShort(slug).replace(/[-_.]+/g, " ");
  return text && text[0].toUpperCase() + text.slice(1);
};

/** The GitHub links every repo gets. */
const githubLinks = (slug) => ({
  Issues: `https://github.com/${slug}/issues`,
  "Issues - commented": `https://github.com/${slug}/issues?q=is%3Aissue%20state%3Aopen%20commenter%3A%40me`,
  "Pull Requests - assigned to me": `https://github.com/${slug}/pulls?q=is%3Apr+is%3Aopen+user-review-requested%3A%40me`,
  "Pull Requests - opened by me": `https://github.com/${slug}/pulls/@me`,
});

/** A repo's issues or pulls link → its slug. */
const issuesSlug = (href) => href?.match(/github\.com\/([^/]+\/[^/?#]+)\/(issues|pulls)/)?.[1];

/** An entry in the old shape ({ id, name, short, github: { buttons }, website, … }) → today's. */
export function upgradeRepo(entry) {
  const old = ["github", "website", "storybooks", "others"].filter((key) => entry?.[key]);
  if (!old.length) return entry;
  const repo = old.flatMap((key) => entry[key].buttons || []).map((b) => issuesSlug(b.href)).find(Boolean) || "";
  const links = {};
  for (const key of old) {
    // The repo's own issues and pulls links are the ones every repo gets now.
    const kept = (entry[key].buttons || []).filter((b) => b.href && issuesSlug(b.href) !== repo);
    if (kept.length) links[entry[key].title] = Object.fromEntries(kept.map((b) => [b.label, b.href]));
  }
  const { clone, approvals, icon } = entry;
  return JSON.parse(JSON.stringify({ repo, name: entry.short || entry.name, clone, approvals, icon, links: Object.keys(links).length ? links : undefined }));
}

/** One bookmarks.json entry → what the rest of the app uses. */
function build(entry, i) {
  const slug = slugOf(entry.repo);
  const name = entry.name || nameOf(slug) || "Untitled repo";
  const { GitHub, ...rest } = entry.links || {};
  const groups = Object.entries({ GitHub: { ...GitHub, ...(slug && githubLinks(slug)) }, ...rest })
    .map(([title, links]) => ({ title, links: Object.entries(links || {}).map(([label, href]) => ({ label, href })) }))
    .filter((g) => g.links.length);
  return {
    id: slug ? slug.toLowerCase().replace(/[^a-z0-9-]/g, "-") : `repo-${i}`,
    name,
    short: name,
    logo: entry.icon,
    clone: entry.clone || null,
    slug,
    // The sprint board is whichever link points at a GitHub project.
    board: groups.flatMap((g) => g.links).find((l) => /github\.com\/orgs\/[^/]+\/projects\/\d+/.test(l.href))?.href || null,
    // The repo's merge rule: approvals a PR needs (Carbon: 2).
    approvals: Number(entry.approvals) || 1,
    groups,
  };
}

export async function fileRepos() {
  try {
    return (await (await fetch(chrome.runtime.getURL("bookmarks.json"))).json()).map(upgradeRepo);
  } catch (err) {
    console.error("Couldn't load bookmarks.json", err);
    return [];
  }
}

async function loadRepos() {
  const { repoData } = await storage.get("repoData");
  raw = Array.isArray(repoData) ? repoData.map(upgradeRepo) : await fileRepos();
  repos.splice(0, repos.length, ...raw.map(build));
  return repos;
}

/** Resolves once the list has loaded. Reassigned when the background worker reloads it. */
export let reposReady = loadRepos();
export const reloadRepos = () => (reposReady = loadRepos());

/** The entries as stored, for the editor and Export JSON. */
export const rawRepos = () => structuredClone(raw);

/** Repos with a GitHub repo that the user hasn't switched off. */
export const enabledRepos = (settings) => repos.filter((r) => r.slug && !settings.disabledRepos.includes(r.id));

export const repoBySlug = (slug) => repos.find((r) => r.slug?.toLowerCase() === String(slug).toLowerCase());

/** "Carbon" for "carbon-design-system/carbon". */
export const repoLabel = (slug) => repoBySlug(slug)?.short || repoShort(slug);
