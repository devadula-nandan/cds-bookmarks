DD.github = (() => {
  const API = "https://api.github.com";

  class GitHubError extends Error {
    constructor(message, status, sso = null) {
      super(message);
      this.status = status;
      this.sso = sso;
    }
  }

  /** `X-GitHub-SSO: required; url=…` is sent when an org's SAML SSO hasn't been authorized for the token. */
  function ssoUrl(res) {
    const header = res.headers.get("X-GitHub-SSO") || "";
    return header.match(/url=(\S+)/)?.[1] || (header.includes("required") ? "https://github.com/settings/tokens" : null);
  }

  async function send(url, init) {
    try {
      return await fetch(url, init);
    } catch {
      throw new GitHubError("Couldn't reach api.github.com. Check your network, VPN or proxy.", 0);
    }
  }

  function headers(token, extra = {}) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...extra,
    };
  }

  /** Returns `{ data, errors, sso, scopes }`; `scopes` is null for fine-grained tokens. */
  async function graphql(token, query, variables = {}) {
    const res = await send(`${API}/graphql`, {
      method: "POST",
      headers: headers(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ query, variables }),
    });
    const sso = ssoUrl(res);
    if (res.status === 401) throw new GitHubError("GitHub rejected the token (401). It may be expired, revoked, or for a different GitHub host.", 401);
    if (!res.ok) throw new GitHubError(`GitHub GraphQL request failed (${res.status})`, res.status, sso);
    const json = await res.json();
    const errors = [...new Set((json.errors || []).map((e) => e.message))];
    if (errors.length && !json.data) throw new GitHubError(errors[0], 200, sso);
    if (errors.length) console.warn("GraphQL partial errors", json.errors);
    return { data: json.data, errors, sso, scopes: res.headers.get("X-OAuth-Scopes") };
  }

  async function rest(token, path, { method = "GET", body } = {}) {
    const res = await send(`${API}${path}`, {
      method,
      headers: headers(token, body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new GitHubError(`GitHub ${method} ${path} failed (${res.status})`, res.status, ssoUrl(res));
    return res.status === 204 || res.status === 205 ? null : res.json().catch(() => null);
  }

  const PR_FIELDS = `
    __typename
    id number title url createdAt updatedAt isDraft
    reviewDecision mergeable additions deletions
    repository { nameWithOwner }
    author { login avatarUrl }
    labels(first: 6) { nodes { name color } }
    comments { totalCount }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    latestReviews(first: 10) { nodes { state author { login } } }
    mergedAt
  `;

  const ISSUE_FIELDS = `
    __typename
    id number title url createdAt updatedAt
    repository { nameWithOwner }
    author { login avatarUrl }
    labels(first: 6) { nodes { name color } }
    comments { totalCount }
  `;

  const SEARCH = (alias, variable, first) => `
    ${alias}: search(type: ISSUE, query: $${variable}, first: ${first}) {
      issueCount
      nodes { ... on PullRequest { ${PR_FIELDS} } ... on Issue { ${ISSUE_FIELDS} } }
    }`;

  const TRIAGE_LABELS = `label:"status: needs triage 🕵️‍♀️","status: needs triage :female_detective:"`;

  function buildQuery(repos) {
    const repoBlocks = repos
      .map((r, i) => {
        const [owner, name] = r.slug.split("/");
        return `
        repo${i}: repository(owner: "${owner}", name: "${name}") {
          nameWithOwner
          issues(states: OPEN) { totalCount }
          triage: issues(states: OPEN, labels: ["status: needs triage 🕵️‍♀️", "status: needs triage :female_detective:"]) { totalCount }
          pullRequests(states: OPEN) { totalCount }
          releases(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) {
            nodes { tagName name publishedAt url isPrerelease }
          }
          defaultBranchRef {
            name
            target { ... on Commit { oid committedDate url messageHeadline statusCheckRollup { state } } }
          }
        }`;
      })
      .join("\n");

    return `
      query Dashboard($reviews: String!, $mine: String!, $assigned: String!, $mentions: String!,
                      $triage: String!, $merged: String!, $reviewed: String!) {
        viewer { login name avatarUrl }
        rateLimit { remaining limit resetAt cost }
        ${SEARCH("reviews", "reviews", 50)}
        ${SEARCH("mine", "mine", 50)}
        ${SEARCH("assigned", "assigned", 50)}
        ${SEARCH("mentions", "mentions", 30)}
        ${SEARCH("triage", "triage", 30)}
        ${SEARCH("merged", "merged", 30)}
        ${SEARCH("reviewed", "reviewed", 30)}
        ${repoBlocks}
      }`;
  }

  function normalizeItem(node) {
    if (!node || !node.repository) return null;
    const isPR = node.__typename === "PullRequest";
    const reviews = node.latestReviews?.nodes || [];
    return {
      id: node.id,
      kind: isPR ? "pr" : "issue",
      number: node.number,
      title: node.title,
      url: node.url,
      repo: node.repository.nameWithOwner,
      author: node.author?.login || "ghost",
      avatar: node.author?.avatarUrl || "",
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      labels: (node.labels?.nodes || []).map((l) => ({ name: l.name, color: l.color })),
      comments: node.comments?.totalCount || 0,
      ...(isPR && {
        draft: node.isDraft,
        reviewDecision: node.reviewDecision,
        mergeable: node.mergeable,
        additions: node.additions,
        deletions: node.deletions,
        ci: node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state || null,
        approvals: reviews.filter((r) => r.state === "APPROVED").map((r) => r.author?.login),
        changeRequests: reviews.filter((r) => r.state === "CHANGES_REQUESTED").map((r) => r.author?.login),
        mergedAt: node.mergedAt,
      }),
    };
  }

  function list(search) {
    return {
      total: search?.issueCount || 0,
      items: (search?.nodes || []).map(normalizeItem).filter(Boolean),
    };
  }

  async function fetchViewer(token) {
    const { data, scopes } = await graphql(token, "query { viewer { login name avatarUrl } }");
    return { ...data.viewer, scopes };
  }

  async function fetchDashboard({ token, login, repos, includeTeamReviews }) {
    const scope = repos.map((r) => `repo:${r.slug}`).join(" ");
    const since = DD.util.isoDate(DD.util.previousWorkday());
    const weekAgo = DD.util.isoDate(new Date(Date.now() - 7 * 86400000));
    const reviewQualifier = includeTeamReviews ? "review-requested" : "user-review-requested";

    const variables = {
      reviews: `is:pr is:open draft:false archived:false ${reviewQualifier}:${login} ${scope}`,
      mine: `is:pr is:open author:${login} ${scope}`,
      assigned: `is:open assignee:${login} archived:false ${scope}`,
      mentions: `is:open mentions:${login} -author:${login} updated:>=${weekAgo} ${scope}`,
      triage: `is:issue is:open ${TRIAGE_LABELS} ${scope}`,
      merged: `is:pr is:merged author:${login} merged:>=${weekAgo} ${scope}`,
      reviewed: `is:pr reviewed-by:${login} -author:${login} updated:>=${since} ${scope}`,
    };

    const { data, errors, sso, scopes } = await graphql(token, buildQuery(repos), variables);
    const searches = Object.keys(variables);
    if (searches.every((k) => !data[k])) throw new GitHubError(errors[0] || "GitHub returned no data for your searches.", 200, sso);

    const repoHealth = {};
    repos.forEach((r, i) => {
      const node = data[`repo${i}`];
      if (!node) return;
      const head = node.defaultBranchRef?.target;
      repoHealth[r.slug] = {
        openIssues: node.issues?.totalCount ?? null,
        triage: node.triage?.totalCount ?? null,
        openPRs: node.pullRequests?.totalCount ?? null,
        release: node.releases?.nodes?.[0] || null,
        main: head
          ? {
              branch: node.defaultBranchRef.name,
              state: head.statusCheckRollup?.state || null,
              url: head.url,
              sha: head.oid?.slice(0, 7),
              message: head.messageHeadline,
              committedAt: head.committedDate,
            }
          : null,
      };
    });

    return {
      fetchedAt: new Date().toISOString(),
      viewer: data.viewer,
      rateLimit: data.rateLimit,
      reviews: list(data.reviews),
      mine: list(data.mine),
      assigned: list(data.assigned),
      mentions: list(data.mentions),
      triage: list(data.triage),
      merged: list(data.merged),
      reviewed: list(data.reviewed),
      repos: repoHealth,
      warnings: errors,
      failed: searches.filter((k) => !data[k]),
      sso,
      scopes,
    };
  }

  function subjectHtmlUrl(thread) {
    const api = thread.subject?.url;
    const repoUrl = thread.repository?.html_url;
    if (!api) return repoUrl ? `${repoUrl}/notifications` : "https://github.com/notifications";
    if (thread.subject.type === "Release") return `${repoUrl}/releases`;
    return api
      .replace("https://api.github.com/repos/", "https://github.com/")
      .replace(/\/pulls\/(\d+)/, "/pull/$1")
      .replace(/\/commits\//, "/commit/");
  }

  /**
   * GitHub's notifications API only works with classic tokens that have the
   * `notifications` (or `repo`) scope; fine-grained tokens get a 403.
   */
  async function fetchInbox(token, repos) {
    const slugs = new Set(repos.map((r) => r.slug.toLowerCase()));
    const threads = await rest(token, "/notifications?per_page=50");
    return (threads || [])
      .filter((t) => slugs.has(t.repository.full_name.toLowerCase()))
      .map((t) => ({
        id: t.id,
        reason: t.reason,
        unread: t.unread,
        updatedAt: t.updated_at,
        repo: t.repository.full_name,
        type: t.subject.type,
        title: t.subject.title,
        url: subjectHtmlUrl(t),
      }));
  }

  function markThreadRead(token, id) {
    return rest(token, `/notifications/threads/${id}`, { method: "PATCH" });
  }

  function markThreadDone(token, id) {
    return rest(token, `/notifications/threads/${id}`, { method: "DELETE" });
  }

  // ---------- detail for AI context (fetched on demand, never during sync) ----------

  const CHECKS = `
    statusCheckRollup { state contexts(first: 60) { nodes {
      __typename
      ... on CheckRun { databaseId name status conclusion title summary detailsUrl
        annotations(first: 8) { nodes { path message annotationLevel location { start { line } } } } }
      ... on StatusContext { context state description targetUrl }
    } } }`;

  const DETAIL = `
    query Detail($id: ID!) {
      node(id: $id) {
        ... on PullRequest {
          body baseRefName headRefName changedFiles
          files(first: 80) { nodes { path additions deletions } }
          comments(last: 8) { nodes { author { login } body createdAt } }
          reviews(last: 8) { nodes { author { login } state body submittedAt } }
          reviewThreads(last: 30) { nodes { isResolved isOutdated path line comments(first: 4) { nodes { author { login } body } } } }
          commits(last: 1) { nodes { commit { oid ${CHECKS} } } }
        }
        ... on Issue {
          body
          comments(last: 10) { nodes { author { login } body createdAt } }
        }
      }
    }`;

  function failedChecks(rollup) {
    return (rollup?.contexts?.nodes || [])
      .filter((c) => (c.__typename === "CheckRun" ? ["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"].includes(c.conclusion) : ["FAILURE", "ERROR"].includes(c.state)))
      .map((c) =>
        c.__typename === "CheckRun"
          ? {
              id: c.databaseId,
              name: c.name,
              conclusion: c.conclusion,
              title: c.title,
              summary: c.summary,
              url: c.detailsUrl,
              annotations: (c.annotations?.nodes || []).map((a) => ({ path: a.path, line: a.location?.start?.line, level: a.annotationLevel, message: a.message })),
            }
          : { name: c.context, conclusion: c.state, title: c.description, url: c.targetUrl, annotations: [] }
      );
  }

  /** Body, discussion, review threads and failing checks for one PR or issue. */
  async function fetchDetail(token, id) {
    const { data } = await graphql(token, DETAIL, { id });
    const n = data.node || {};
    const commit = n.commits?.nodes?.[0]?.commit;
    return {
      body: n.body || "",
      baseRef: n.baseRefName,
      headRef: n.headRefName,
      changedFiles: n.changedFiles,
      files: (n.files?.nodes || []).map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
      comments: (n.comments?.nodes || []).map((c) => ({ author: c.author?.login || "ghost", body: c.body, at: c.createdAt })),
      reviews: (n.reviews?.nodes || []).map((r) => ({ author: r.author?.login || "ghost", state: r.state, body: r.body, at: r.submittedAt })),
      threads: (n.reviewThreads?.nodes || []).map((t) => ({
        resolved: t.isResolved,
        outdated: t.isOutdated,
        path: t.path,
        line: t.line,
        comments: (t.comments?.nodes || []).map((c) => ({ author: c.author?.login || "ghost", body: c.body })),
      })),
      sha: commit?.oid || null,
      failed: failedChecks(commit?.statusCheckRollup),
    };
  }

  /** Failing checks on a branch head, for a broken main. */
  async function fetchCommitChecks(token, slug, expression) {
    const [owner, name] = slug.split("/");
    const { data } = await graphql(
      token,
      `query($owner: String!, $name: String!, $expr: String!) { repository(owner: $owner, name: $name) { object(expression: $expr) { ... on Commit { oid message ${CHECKS} } } } }`,
      { owner, name, expr: expression }
    );
    const c = data.repository?.object;
    return { sha: c?.oid || null, message: c?.message || "", failed: failedChecks(c?.statusCheckRollup) };
  }

  /** Bodies for a handful of issues at once (triage). */
  async function fetchBodies(token, ids) {
    if (!ids.length) return {};
    const { data } = await graphql(token, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Issue { id body } ... on PullRequest { id body } } }`, { ids });
    return Object.fromEntries((data.nodes || []).filter(Boolean).map((n) => [n.id, n.body || ""]));
  }

  async function fetchDiff(token, slug, number) {
    const res = await send(`${API}/repos/${slug}/pulls/${number}`, { headers: headers(token, { Accept: "application/vnd.github.diff" }) });
    if (!res.ok) throw new GitHubError(`Couldn't load the diff (${res.status})`, res.status, ssoUrl(res));
    return res.text();
  }

  /**
   * The tail of a GitHub Actions job log around its error lines. The API
   * redirects to signed blob storage, which the manifest grants access to.
   */
  async function fetchJobLog(token, slug, jobId) {
    const res = await send(`${API}/repos/${slug}/actions/jobs/${jobId}/logs`, { headers: headers(token) });
    if (!res.ok) throw new GitHubError(`Couldn't load the job log (${res.status})`, res.status);
    return res.text();
  }

  return { fetchViewer, fetchDashboard, fetchInbox, markThreadRead, markThreadDone, fetchDetail, fetchCommitChecks, fetchBodies, fetchDiff, fetchJobLog, GitHubError };
})();
