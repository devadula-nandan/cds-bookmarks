// The repositories the dashboard covers, from bookmarks.json — or from the copy edited in
// Settings → Repositories, which is saved in this browser as `repoData` and wins over the file.

import { repoShort, storage } from "./core.js";

const GROUPS = ["github", "website", "storybooks", "others"];

/** Every repo, filled in place by loadRepos(). */
export const repos = [];
let raw = [];

/** One bookmarks.json entry → what the rest of the app uses. */
function build(entry) {
  const links = entry.github?.buttons || [];
  // The GitHub repo comes from its issues or pulls link, on github.com or a GitHub Enterprise host.
  const [, host = null, slug = null] = links.map((b) => b.href?.match(/^https:\/\/([^/]+)\/([^/]+\/[^/?#]+)\/(issues|pulls)/)).find(Boolean) || [];
  return {
    id: entry.id,
    name: entry.name,
    short: entry.short || entry.name,
    logo: entry.icon,
    clone: entry.clone || null,
    host,
    slug,
    url: slug && `https://${host}/${slug}`,
    // The sprint board is the link labelled "Board".
    board: links.find((b) => /board/i.test(b.label))?.href || null,
    groups: GROUPS.filter((key) => entry[key]?.buttons?.length).map((key) => ({ title: entry[key].title, links: entry[key].buttons })),
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

async function loadRepos() {
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

/** The GitHub hosts the enabled repos are on, github.com first. */
export const repoHosts = (settings) => [...new Set(enabledRepos(settings).map((r) => r.host))].sort((a, b) => (b === "github.com") - (a === "github.com"));

/** "owner/name", or "github.ibm.com/owner/name" off github.com, for prompts. */
export const repoName = (r) => (r.host === "github.com" ? r.slug : `${r.host}/${r.slug}`);

/** "Carbon" for "carbon-design-system/carbon". */
export const repoLabel = (slug) => repoBySlug(slug)?.short || repoShort(slug);
