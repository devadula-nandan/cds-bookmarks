// The repositories the dashboard covers, from bookmarks.json — or from the copy edited in
// Settings → Repositories, which is saved in this browser as `repoData` and wins over the file.

import { repoShort, storage } from "./core.js";

const GROUPS = { github: "GitHub", website: "Website", storybooks: "Storybooks", others: "Playgrounds" };

/** Every repo, filled in place by loadRepos(). */
export const repos = [];
let raw = [];

/** One bookmarks.json entry → what the rest of the app uses. */
function build(entry) {
  const links = entry.github?.buttons || [];
  return {
    id: entry.id,
    name: entry.name,
    short: entry.short || entry.name,
    logo: entry.icon,
    clone: entry.clone || null,
    // The GitHub repo comes from its issues or pulls link; the sprint board from a link labelled "Board".
    slug: links.map((b) => b.href?.match(/github\.com\/([^/]+\/[^/?#]+)\/(issues|pulls)/)?.[1]).find(Boolean) || null,
    board: links.find((b) => /board/i.test(b.label))?.href || null,
    groups: Object.keys(GROUPS)
      .filter((key) => entry[key]?.buttons?.length)
      .map((key) => ({ title: key === "website" || key === "storybooks" ? entry[key].title : GROUPS[key], links: entry[key].buttons })),
  };
}

export async function fileRepos() {
  try {
    return await (await fetch(chrome.runtime.getURL("bookmarks.json"))).json();
  } catch (err) {
    console.error("Couldn't load bookmarks.json", err);
    return [];
  }
}

export async function loadRepos() {
  const { repoData } = await storage.get("repoData");
  raw = Array.isArray(repoData) ? repoData : await fileRepos();
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
