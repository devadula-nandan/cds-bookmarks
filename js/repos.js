/**
 * Builds the repository registry from `bookmarksData` (bookmarks-data.js), so
 * links stay editable in one place. The GitHub slug is read from the "Issues"
 * link, and the sprint board from the "Board" link.
 */
DD.repos = (() => {
  const LINK_GROUP_KEYS = ["github", "website", "storybooks", "others"];
  const GROUP_TITLES = { others: "Playgrounds" };
  const ACCENTS = ["blue", "purple", "teal", "magenta", "cyan", "green"];

  function findSlug(entry) {
    const hrefs = (entry.github?.buttons || []).map((b) => b.href || "");
    for (const href of hrefs) {
      const match = href.match(/github\.com\/([^/]+\/[^/?#]+)\/(issues|pulls)/);
      if (match) return match[1];
    }
    return null;
  }

  function findBoard(entry) {
    return (entry.github?.buttons || []).find((b) => /board/i.test(b.label))?.href || null;
  }

  function linkGroups(entry) {
    return LINK_GROUP_KEYS.filter((key) => entry[key]?.buttons?.length).map((key) => ({
      key,
      title: GROUP_TITLES[key] || entry[key].title,
      links: entry[key].buttons.map((b) => ({
        label: b.label,
        href: b.href,
        versionedHref: b.versionedHref,
        version: b.version,
      })),
    }));
  }

  const source = typeof bookmarksData !== "undefined" ? bookmarksData : [];
  const all = source.map((entry, index) => ({
    id: entry.id,
    name: entry.name,
    logo: entry.icon,
    slug: findSlug(entry),
    board: findBoard(entry),
    accent: ACCENTS[index % ACCENTS.length],
    groups: linkGroups(entry),
  }));

  return {
    all,
    enabled() {
      const disabled = DD.store.settings.disabledRepos || [];
      return all.filter((r) => r.slug && !disabled.includes(r.id));
    },
    bySlug(slug) {
      return all.find((r) => r.slug?.toLowerCase() === String(slug).toLowerCase());
    },
    byId(id) {
      return all.find((r) => r.id === id);
    },
  };
})();

/** The repo the dashboard is focused on (null = all repos), and data narrowed to it. */
DD.scope = (() => {
  const LISTS = ["reviews", "mine", "assigned", "mentions", "triage", "merged", "reviewed"];
  let memo = { data: null, slug: null, result: null };

  function current() {
    const slug = DD.store.settings.repoScope;
    return DD.repos.enabled().find((r) => r.slug === slug) || null;
  }

  function set(slug) {
    DD.store.saveSettings({ repoScope: slug || null });
  }

  /** Search totals are per query, so a scoped total comes from the matching items; triage uses the exact per-repo count. */
  function data(raw) {
    const repo = current();
    if (!raw || !repo) return raw;
    if (memo.data === raw && memo.slug === repo.slug) return memo.result;
    const out = { ...raw, repos: raw.repos?.[repo.slug] ? { [repo.slug]: raw.repos[repo.slug] } : {} };
    LISTS.forEach((key) => {
      const items = (raw[key]?.items || []).filter((i) => i.repo === repo.slug);
      out[key] = { total: items.length, items };
    });
    const triage = raw.repos?.[repo.slug]?.triage;
    if (triage != null) out.triage.total = triage;
    memo = { data: raw, slug: repo.slug, result: out };
    return out;
  }

  function inbox(raw) {
    const repo = current();
    return raw && repo ? raw.filter((t) => t.repo === repo.slug) : raw;
  }

  return { current, set, data, inbox };
})();
