/**
 * Builds the repository registry from `bookmarksData` (bookmarks-data.js), so
 * links stay editable in one place. The GitHub slug is read from the "Issues"
 * link, and the sprint board from the "Board" link.
 */
DD.repos = (() => {
  const LINK_GROUP_KEYS = ["github", "website", "storybooks", "others"];
  const GROUP_TITLES = { github: "GitHub", others: "Playgrounds" };
  const SHORT_NAMES = { cds: "Carbon", c4ai: "AI Chat", labs: "Labs", charts: "Charts" };

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
  const all = source.map((entry) => ({
    id: entry.id,
    name: entry.name,
    short: SHORT_NAMES[entry.id] || entry.name,
    logo: entry.icon,
    slug: findSlug(entry),
    board: findBoard(entry),
    groups: linkGroups(entry),
  }));

  return {
    all,
    /** Repos with a GitHub slug that the user hasn't switched off. */
    enabled(settings) {
      const disabled = settings?.disabledRepos || [];
      return all.filter((r) => r.slug && !disabled.includes(r.id));
    },
    bySlug(slug) {
      return all.find((r) => r.slug?.toLowerCase() === String(slug).toLowerCase());
    },
    /** Display name for a slug, falling back to the bare repo name. */
    label(slug) {
      return this.bySlug(slug)?.short || DD.util.repoShort(slug);
    },
  };
})();
