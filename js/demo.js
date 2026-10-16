/** Sample data so the dashboard can be explored before connecting GitHub. */
DD.demo = (() => {
  const H = 3600000;
  const ago = (hours) => new Date(Date.now() - hours * H).toISOString();
  let seq = 0;

  function pr(repo, number, title, author, opts = {}) {
    return {
      id: `demo-pr-${++seq}`,
      kind: "pr",
      number,
      title,
      url: `https://github.com/${repo}/pull/${number}`,
      repo,
      author,
      avatar: "",
      createdAt: ago(opts.created ?? 30),
      updatedAt: ago(opts.updated ?? 2),
      labels: opts.labels || [],
      comments: opts.comments ?? 3,
      draft: !!opts.draft,
      reviewDecision: opts.decision || "REVIEW_REQUIRED",
      mergeable: opts.mergeable || "MERGEABLE",
      additions: opts.add ?? 120,
      deletions: opts.del ?? 40,
      ci: opts.ci === undefined ? "SUCCESS" : opts.ci,
      approvals: opts.approvals || [],
      changeRequests: opts.changeRequests || [],
      mergedAt: opts.mergedAt || null,
    };
  }

  function issue(repo, number, title, author, opts = {}) {
    return {
      id: `demo-issue-${++seq}`,
      kind: "issue",
      number,
      title,
      url: `https://github.com/${repo}/issues/${number}`,
      repo,
      author,
      avatar: "",
      createdAt: ago(opts.created ?? 72),
      updatedAt: ago(opts.updated ?? 5),
      labels: opts.labels || [],
      comments: opts.comments ?? 2,
    };
  }

  const L = {
    v12: { name: "version: 12", color: "82cfff" },
    bug: { name: "type: bug 🐛", color: "da1e28" },
    a11y: { name: "type: a11y ♿", color: "8a3ffc" },
    triage: { name: "status: needs triage 🕵️‍♀️", color: "f1c21b" },
    enh: { name: "type: enhancement 💡", color: "0f62fe" },
    visual: { name: "status: visual review 🔍", color: "82cfff" },
  };

  function data(login = "you") {
    seq = 0;
    const C = "carbon-design-system/carbon";
    const P = "carbon-design-system/ibm-products";
    const A = "carbon-design-system/carbon-ai-chat";
    const LABS = "carbon-design-system/carbon-labs";
    const CHARTS = "carbon-design-system/carbon-charts";
    const wrap = (items) => ({ total: items.length, items });

    return {
      fetchedAt: new Date().toISOString(),
      viewer: { login, name: "Sample Developer", avatarUrl: "" },
      rateLimit: { remaining: 4992, limit: 5000, cost: 8 },
      reviews: wrap([
        pr(C, 23703, "fix(combobox): announce selected option to screen readers", "tay1orjones", { created: 70, labels: [L.a11y], add: 84, del: 12 }),
        pr(C, 23582, "feat(datatable): sticky header for expandable rows", "riddhybansal", { created: 26, ci: "FAILURE", add: 412, del: 97 }),
        pr(P, 9961, "feat(tearsheet): migrate to Carbon v12 tokens", "makafsal", { created: 6, labels: [L.v12], add: 230, del: 188 }),
        pr(A, 2549, "fix(chat): keep scroll anchored while streaming", "ethanwinograd", { created: 3, ci: "PENDING", add: 56, del: 20 }),
      ]),
      mine: wrap([
        pr(C, 23717, "chore(filterable multiselect): make v12 visual updates 2.0", login, { created: 80, updated: 1, labels: [L.visual, L.v12], decision: "CHANGES_REQUESTED", changeRequests: ["tw15egan"], add: 722, del: 130 }),
        pr(C, 23503, "perf(floating-ui): react dropdown, combobox, multiselect", login, { created: 500, updated: 30, mergeable: "CONFLICTING", ci: "PENDING", add: 359, del: 288 }),
        pr(P, 9958, "fix(sidepanel): restore focus to trigger on close", login, { created: 20, ci: "FAILURE", add: 44, del: 9 }),
        pr(A, 2538, "feat(web-components): expose custom footer slot", login, { created: 50, decision: "APPROVED", approvals: ["ethanwinograd"], add: 98, del: 14 }),
        pr(C, 22317, "docs: add composable file uploader story", login, { created: 900, updated: 200, draft: true, add: 576, del: 0 }),
      ]),
      assigned: wrap([
        issue(C, 23665, "[Bug]: MultiSelect clears selection when filtering with keyboard", "ariellalgilmore", { labels: [L.bug, L.v12] }),
        issue(P, 9940, "Datagrid: column resize handle not keyboard accessible", "elycheea", { labels: [L.a11y] }),
        issue(A, 2490, "Support custom loading states in chat header", "marijohannessen", { labels: [L.enh], created: 300 }),
      ]),
      mentions: wrap([
        pr(C, 23694, "feat(react): publish migrated ibm-products components in v12", "tay1orjones", { created: 40, updated: 3 }),
        issue(C, 23688, "Discussion: floating-ui middleware defaults", "tw15egan", { updated: 8 }),
      ]),
      triage: wrap([
        issue(P, 9966, "[Bug]: Tearsheet narrow overflows on small screens", "someone", { labels: [L.triage], created: 10 }),
        issue(C, 23729, "[Bug]: Tooltip flickers inside overflow menu", "contributor", { labels: [L.triage], created: 5 }),
        issue(A, 2552, "[Feature]: allow markdown tables in responses", "user123", { labels: [L.triage], created: 20 }),
      ]),
      merged: wrap([
        pr(C, 23663, "fix(menu): close nested menus on escape", login, { created: 120, mergedAt: ago(20), decision: "APPROVED" }),
        pr(P, 9930, "chore(deps): bump carbon to 11.118", login, { created: 140, mergedAt: ago(70), decision: "APPROVED" }),
      ]),
      reviewed: wrap([
        pr(C, 23726, "fix(tabs): overflow buttons respect RTL", "riddhybansal", { decision: "APPROVED" }),
        pr(C, 23716, "chore(icons): sync latest pictograms", "carbon-bot", { decision: "APPROVED" }),
        pr(A, 2544, "fix: reset chat improvements", "ethanwinograd", { decision: "APPROVED" }),
      ]),
      repos: {
        [C]: {
          openIssues: 973,
          openPRs: 93,
          release: { tagName: "v11.118.0", publishedAt: ago(220), url: `https://github.com/${C}/releases`, isPrerelease: false },
          main: { branch: "main", state: "FAILURE", url: `https://github.com/${C}/commits/main`, sha: "e0ccb27", message: "fix(ProgressIndicator): add Storybook controls (#22973)", committedAt: ago(4) },
        },
        [P]: {
          openIssues: 323,
          openPRs: 17,
          release: { tagName: "v2.101.0", publishedAt: ago(52), url: `https://github.com/${P}/releases`, isPrerelease: false },
          main: { branch: "main", state: "SUCCESS", url: `https://github.com/${P}/commits/main`, sha: "114ff7d", message: "docs: add migration overview story (#9938)", committedAt: ago(30) },
        },
        [A]: {
          openIssues: 376,
          openPRs: 21,
          release: { tagName: "v1.23.0-rc.0", publishedAt: ago(70), url: `https://github.com/${A}/releases`, isPrerelease: true },
          main: { branch: "main", state: "SUCCESS", url: `https://github.com/${A}/commits/main`, sha: "8ec4033", message: "fix: reset chat improvements (#2541)", committedAt: ago(13) },
        },
        [LABS]: {
          openIssues: 94,
          openPRs: 22,
          release: { tagName: "v0.24.0", publishedAt: ago(120), url: `https://github.com/${LABS}/releases`, isPrerelease: false },
          main: { branch: "main", state: "SUCCESS", url: `https://github.com/${LABS}/commits/main`, sha: "3fa91c2", message: "feat(ai-chat): add workspace shell (#812)", committedAt: ago(9) },
        },
        [CHARTS]: {
          openIssues: 251,
          openPRs: 31,
          release: { tagName: "v1.27.1", publishedAt: ago(200), url: `https://github.com/${CHARTS}/releases`, isPrerelease: false },
          main: { branch: "main", state: "SUCCESS", url: `https://github.com/${CHARTS}/commits/main`, sha: "a7d02e4", message: "fix(axes): respect timeScale locale (#2034)", committedAt: ago(26) },
        },
      },
    };
  }

  /** A few notifications so the notification center isn't empty in sample mode. */
  function notifications() {
    const C = "carbon-design-system/carbon";
    const P = "carbon-design-system/ibm-products";
    const A = "carbon-design-system/carbon-ai-chat";
    return [
      { type: "release", title: "ibm-products v2.101.0 released", body: "Stable release", url: `https://github.com/${P}/releases`, repo: P },
      { type: "approved", title: "carbon-ai-chat#2538 approved", body: "ethanwinograd approved · feat(web-components): expose custom footer slot", url: `https://github.com/${A}/pull/2538`, repo: A },
      { type: "mention", title: "Mentioned on carbon#23688", body: "Discussion: floating-ui middleware defaults", url: `https://github.com/${C}/issues/23688`, repo: C },
      { type: "changes", title: "Changes requested on carbon#23717", body: "tw15egan · chore(filterable multiselect): make v12 visual updates 2.0", url: `https://github.com/${C}/pull/23717`, repo: C },
      { type: "mainBroken", title: "main is failing on carbon", body: "fix(ProgressIndicator): add Storybook controls (#22973)", url: `https://github.com/${C}/commits/main`, repo: C },
      { type: "ciFailed", title: "CI failed on ibm-products#9958", body: "fix(sidepanel): restore focus to trigger on close", url: `https://github.com/${P}/pull/9958/checks`, repo: P },
      { type: "review", title: "Review requested: ibm-products#9961", body: "makafsal · feat(tearsheet): migrate to Carbon v12 tokens", url: `https://github.com/${P}/pull/9961`, repo: P },
    ].map((n, i) => ({ ...n, key: `demo:${i}` }));
  }

  return { data, notifications };
})();
