// Talking to GitHub: one GraphQL query for the whole dashboard, the notifications inbox, and the few
// changes the page makes for you (labels, auto-merge, re-runs, review requests, closing a PR).

import { previousWorkday, todayKey } from "./core.js";
import { isBot } from "./insights.js";

const API = "https://api.github.com";

class GitHubError extends Error {
  constructor(message, status, sso = null) {
    super(message);
    this.status = status;
    // Set when an org's SAML SSO hasn't been authorized for the token: the page links to it.
    this.sso = sso;
  }
}

/** "2026-11-30 12:00:00 UTC" (how GitHub says when a token expires) → ISO, or null. */
function expiry(header) {
  if (!header) return null;
  const at = Date.parse(header) || Date.parse(header.replace(" ", "T").replace(" UTC", "Z"));
  return at ? new Date(at).toISOString() : null;
}

async function request(path, token, init = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      ...init,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  } catch {
    throw new GitHubError("Couldn't reach api.github.com. Check your network, VPN or proxy.", 0);
  }
  const header = res.headers.get("X-GitHub-SSO") || "";
  const sso = header.match(/url=(\S+)/)?.[1] || (header.includes("required") ? "https://github.com/settings/tokens" : null);
  // Some changes answer with no body (204), or an empty one (re-runs).
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  if (res.status === 401) throw new GitHubError("GitHub rejected the token (401). It may be expired, revoked, or for a different GitHub host.", 401);
  if (!res.ok) throw new GitHubError(json?.message ? `GitHub said: ${json.message} (${res.status})` : `GitHub request failed (${res.status})`, res.status, sso);
  return { json, sso, scopes: res.headers.get("X-OAuth-Scopes"), expires: expiry(res.headers.get("GitHub-Authentication-Token-Expiration")) };
}

/** Returns `{ data, errors, sso, scopes, expires }`; `scopes` is null for fine-grained tokens. */
async function graphql(token, query, variables = {}) {
  const { json, sso, scopes, expires } = await request("/graphql", token, { method: "POST", body: JSON.stringify({ query, variables }) });
  const errors = [...new Set((json.errors || []).map((e) => e.message))];
  if (errors.length && !json.data) throw new GitHubError(errors[0], 200, sso);
  return { data: json.data, errors, sso, scopes, expires };
}

export async function fetchViewer(token) {
  const { data, scopes } = await graphql(token, "query { viewer { login name } }");
  return { ...data.viewer, scopes };
}

// ---------- the dashboard query ----------

const ACTOR = "author { __typename login }";

const PR_FIELDS = `
  __typename id number title url createdAt updatedAt isDraft mergedAt
  reviewDecision mergeable additions deletions changedFiles
  autoMergeRequest { enabledAt } mergeQueueEntry { state position }
  repository { nameWithOwner }
  ${ACTOR}
  labels(first: 10) { nodes { name } }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
  latestReviews(first: 10) { nodes { state ${ACTOR} } }`;

/** When a PR was marked ready for review. Timelines are slow to fetch, so only the lists that need it ask. */
const READY = "readyEvents: timelineItems(itemTypes: [READY_FOR_REVIEW_EVENT], last: 1) { nodes { ... on ReadyForReviewEvent { createdAt } } }";

const ISSUE_FIELDS = `
  __typename id number title url createdAt updatedAt
  repository { nameWithOwner }
  ${ACTOR}
  labels(first: 10) { nodes { name } }`;

/** Threads the viewer follows: their 👀 reactions and the latest replies. */
const FOLLOW_FIELDS = `
  closed
  reactionGroups { content viewerHasReacted }
  recent: comments(last: 10) { nodes { ${ACTOR} createdAt url reactionGroups { content viewerHasReacted } } }`;

const MY_REVIEW = "myReviews: reviews(author: $login, last: 1) { nodes { state submittedAt } }";

/** When reviews were requested, so a review's age counts from the request rather than from the PR's creation. */
const REQUESTS = "requests: timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 10) { nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { __typename ... on User { login } } } } }";

/** The first reviews on a merged PR, for how long it waited. */
const FIRST_REVIEWS = `firstReviews: reviews(first: 10) { nodes { submittedAt ${ACTOR} } }`;

/** Every check on a commit, so CI can be judged from the newest run of each (see ciState). */
const CONTEXTS = `contexts(first: 100) { nodes {
  __typename
  ... on CheckRun { name status conclusion startedAt detailsUrl checkSuite { createdAt app { slug } workflowRun { databaseId workflow { databaseId } } } }
  ... on StatusContext { context state targetUrl createdAt }
} }`;

const CHECKS = `checks: commits(last: 1) { nodes { commit { statusCheckRollup { ${CONTEXTS} } } } }`;

/** Whether I may turn on auto-merge, for Ready to merge. Slow (50 PRs take over 10 seconds), so only my own PRs ask. */
const CAN_AUTO_MERGE = "viewerCanEnableAutoMerge";

const TRIAGE_LABELS = ["status: needs triage 🕵️‍♀️", "status: needs triage :female_detective:"];

const search = (name, first, extra = "", prExtra = "") => `
  ${name}: search(type: ISSUE, query: $${name}, first: ${first}) {
    issueCount
    nodes { ... on PullRequest { ${PR_FIELDS} ${extra} ${prExtra} } ... on Issue { ${ISSUE_FIELDS} ${extra} } }
  }`;

/** Each search: how many results, extra fields for issues and PRs, and extra fields for PRs only. */
const SEARCHES = {
  reviews: [50, "", READY + REQUESTS],
  mine: [50, "", READY + CHECKS + CAN_AUTO_MERGE],
  assigned: [50],
  mentions: [30],
  triage: [30],
  merged: [30, "", READY + FIRST_REVIEWS],
  reviewed: [50, "", MY_REVIEW],
  commented: [30, FOLLOW_FIELDS],
  eyes: [30, FOLLOW_FIELDS],
  reviewedOpen: [30, "", MY_REVIEW],
};

/**
 * The dashboard is fetched as four queries side by side. One query for everything took about as long as
 * GitHub allows (10 seconds) and failed with a 502 when it ran over. Parts are quicker, and if one part
 * fails the rest still show. Review requests (up to 50 PRs with team requests on) and the 👀 scan are the
 * slowest, so each gets a part of its own; each part takes about 3–6 seconds.
 */
const PARTS = [["reviews"], ["mine", "mentions"], ["eyes"], ["assigned", "triage", "merged", "reviewed", "commented", "reviewedOpen"]];
// The lightest part also brings the viewer, repo health and the threads remembered by id.
const EXTRAS_PART = PARTS[3];

function dashboardQuery(names, repos) {
  const health = repos
    .map((r, i) => {
      const [owner, name] = r.slug.split("/");
      return `
      repo${i}: repository(owner: "${owner}", name: "${name}") {
        viewerDefaultMergeMethod
        releases(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { tagName publishedAt url isPrerelease } }
        defaultBranchRef { name target { ... on Commit { oid committedDate url messageHeadline statusCheckRollup { state ${CONTEXTS} } } } }
      }`;
    })
    .join("");
  const body = names.map((n) => search(n, ...SEARCHES[n])).join("");
  const extras = names === EXTRAS_PART;
  const vars = [...names.map((n) => `$${n}: String!`), ...(body.includes("$login") ? ["$login: String!"] : []), ...(extras ? ["$watched: [ID!]!"] : [])];
  return `
    query Dashboard(${vars.join(", ")}) {
      ${body}
      ${extras ? `viewer { login name }\n      rateLimit { remaining limit }\n      ${health}\n      watched: nodes(ids: $watched) { ... on PullRequest { ${PR_FIELDS} ${FOLLOW_FIELDS} } ... on Issue { ${ISSUE_FIELDS} ${FOLLOW_FIELDS} } }` : ""}
    }`;
}

const eyesOn = (groups) => (groups || []).some((g) => g.content === "EYES" && g.viewerHasReacted);

/** A login as GitHub's REST API spells it. GraphQL leaves the "[bot]" off apps, which made codecov and netlify look human. */
const who = (actor) => (!actor ? "ghost" : actor.__typename === "Bot" ? `${actor.login}[bot]` : actor.login);

const FAILED = ["FAILURE", "ERROR", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED", "CANCELLED", "STUCK"];

// GitHub Actions stops a job after 6 hours, so a check still running after that is stuck and needs a re-run.
const STUCK_MS = 6 * 3600000;

function result(n) {
  if (n.__typename !== "CheckRun") return n.state;
  if (n.status === "COMPLETED") return n.conclusion;
  return n.startedAt && Date.now() - Date.parse(n.startedAt) > STUCK_MS ? "STUCK" : "PENDING";
}

/**
 * CI from the newest run of each workflow. GitHub's own rollup counts every run on the commit, so a run that
 * was cancelled and started again (Carbon cancels CI whenever a PR is pushed or marked ready) leaves a stale
 * failure on a green PR, sometimes under a job name the new run doesn't use, such as "avt-runner" before its
 * matrix expanded. Only GitHub Actions counts: on Carbon, the Netlify previews and the Mend scan fail often
 * without blocking a merge. A repo with no Actions checks falls back to all of them.
 * Returns `{ state, failing: [{ name, url, runId }] }`, or null when there's nothing to go on.
 */
function ciState(nodes = []) {
  const actions = nodes.filter((n) => n.checkSuite?.app?.slug === "github-actions");
  const counted = actions.length ? actions : nodes;
  // The newest check suite of each workflow (or app); older suites were superseded, whatever they reported.
  const suiteOf = (n) => n.checkSuite?.workflowRun?.workflow?.databaseId ?? n.checkSuite?.app?.slug ?? "status";
  const newestSuite = new Map();
  for (const n of counted) if ((n.checkSuite?.createdAt || "") > (newestSuite.get(suiteOf(n)) || "")) newestSuite.set(suiteOf(n), n.checkSuite.createdAt);
  // Within it, the newest run of each check: a re-run of a failed job replaces the failure.
  const newest = new Map();
  for (const n of counted) {
    if (n.checkSuite && n.checkSuite.createdAt !== newestSuite.get(suiteOf(n))) continue;
    const name = n.name || n.context;
    const key = `${suiteOf(n)}/${name}`;
    if (name && (!newest.has(key) || (n.startedAt || n.createdAt || "") > (newest.get(key).startedAt || newest.get(key).createdAt || ""))) newest.set(key, n);
  }
  if (!newest.size) return null;
  const runs = [...newest.values()].map((n) => {
    const res = result(n);
    return { name: `${n.name || n.context}${res === "STUCK" ? " (stuck)" : ""}`, url: n.detailsUrl || n.targetUrl || null, runId: n.checkSuite?.workflowRun?.databaseId || null, result: res };
  });
  const failing = runs.filter((r) => FAILED.includes(r.result)).map(({ name, url, runId }) => ({ name, url, runId }));
  const pending = runs.some((r) => r.result === "PENDING" || r.result === "EXPECTED");
  return { state: failing.length ? "FAILURE" : pending ? "PENDING" : "SUCCESS", failing };
}

/** The newest review request for me (or, failing that, for one of my teams). */
function requestedAt(node, login) {
  const asked = node.requests?.nodes?.filter((e) => e.createdAt) || [];
  return (asked.filter((e) => e.requestedReviewer?.login === login).at(-1) || asked.filter((e) => e.requestedReviewer?.__typename === "Team").at(-1))?.createdAt || null;
}

/** A GraphQL node → the flat item the app uses. `ctx` is `{ login, approvals: { slug: count } }`. */
function toItem(node, ctx) {
  if (!node?.repository) return null;
  const { login } = ctx;
  const isPR = node.__typename === "PullRequest";
  const reviews = node.latestReviews?.nodes || [];
  const commit = node.commits?.nodes?.[0]?.commit;
  const checks = node.checks && ciState(node.checks.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes || []);
  const myReview = node.myReviews?.nodes?.[0];
  const author = who(node.author);
  const comments = node.recent?.nodes;
  const reply = comments?.filter((c) => c.author && c.author.login !== login && !isBot(who(c.author))).at(-1);
  const repo = node.repository.nameWithOwner;
  return {
    id: node.id,
    kind: isPR ? "pr" : "issue",
    number: node.number,
    title: node.title,
    url: node.url,
    repo,
    author,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    labels: (node.labels?.nodes || []).map((l) => l.name),
    ...(isPR && {
      draft: node.isDraft,
      // When it was marked ready for review (its creation, if it never was a draft): reviews wait from here.
      readyAt: node.readyEvents?.nodes?.[0]?.createdAt || node.createdAt,
      requestedAt: requestedAt(node, login),
      reviewDecision: node.reviewDecision,
      mergeable: node.mergeable,
      additions: node.additions,
      deletions: node.deletions,
      files: node.changedFiles,
      mergedAt: node.mergedAt,
      ci: checks?.state || commit?.statusCheckRollup?.state || null,
      failingChecks: checks?.failing || [],
      lastCommitAt: commit?.committedDate || null,
      myReview: myReview && { state: myReview.state, at: myReview.submittedAt },
      approvals: reviews.filter((r) => r.state === "APPROVED").map((r) => who(r.author)),
      changeRequests: reviews.filter((r) => r.state === "CHANGES_REQUESTED").map((r) => who(r.author)),
      // How many approvals the repo wants before merging (Settings → Repositories → Edit repositories).
      approvalsNeeded: ctx.approvals?.[repo] || 1,
      queue: node.mergeQueueEntry ? { state: node.mergeQueueEntry.state, position: node.mergeQueueEntry.position } : null,
      autoMerge: !!node.autoMergeRequest,
      canAutoMerge: !!node.viewerCanEnableAutoMerge,
      firstReviewAt: node.firstReviews?.nodes?.find((r) => who(r.author) !== author && !isBot(who(r.author)))?.submittedAt || null,
    }),
    // Only for threads the viewer follows.
    follow: comments && {
      eyes: eyesOn(node.reactionGroups) || comments.some((c) => eyesOn(c.reactionGroups)),
      closed: node.closed,
      myCommentAt: comments.filter((c) => c.author?.login === login).at(-1)?.createdAt || null,
      lastReply: reply ? { author: who(reply.author), at: reply.createdAt, url: reply.url } : null,
    },
  };
}

const list = (result, ctx) => ({ total: result?.issueCount || 0, items: (result?.nodes || []).map((n) => toItem(n, ctx)).filter(Boolean) });

/**
 * Threads to follow: ones with the viewer's 👀 (spotted among recently updated items, then remembered
 * by id in `watching`) and ones they commented on. A reply is new when it's after the viewer's last
 * comment, or after the thread was first watched.
 */
function following(commented, eyed, watching) {
  const out = new Map();
  const add = (item, reason) => {
    if (!item.follow || item.follow.closed) return;
    const entry = out.get(item.id) || { ...item, reasons: [] };
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    out.set(item.id, entry);
  };
  eyed.filter((i) => i.follow?.eyes).forEach((i) => add(i, "eyes"));
  commented.forEach((i) => add(i, "commented"));
  const now = new Date().toISOString();
  return [...out.values()].map((i) => {
    const since = i.follow.myCommentAt || watching[i.id]?.addedAt || (i.reasons.includes("eyes") ? now : null);
    const reply = i.follow.lastReply;
    return { ...i, follow: { ...i.follow, newReply: !!reply && (!since || reply.at > since) } };
  });
}

export async function fetchDashboard({ token, login, repos, includeTeamReviews, watching = {} }) {
  const scope = repos.map((r) => `repo:${r.slug}`).join(" ");
  const daysAgo = (n) => todayKey(new Date(Date.now() - n * 86400000));
  const queries = {
    reviews: `is:pr is:open draft:false archived:false ${includeTeamReviews ? "review-requested" : "user-review-requested"}:${login} ${scope}`,
    mine: `is:pr is:open author:${login} ${scope}`,
    assigned: `is:open assignee:${login} archived:false ${scope}`,
    mentions: `is:open mentions:${login} -author:${login} updated:>=${daysAgo(7)} ${scope}`,
    triage: `is:issue is:open label:${TRIAGE_LABELS.map((l) => `"${l}"`).join(",")} ${scope}`,
    merged: `is:pr is:merged author:${login} merged:>=${daysAgo(7)} ${scope}`,
    // A week of reviews: the standup takes the ones since the last workday, the Pull requests tab the week.
    reviewed: `is:pr reviewed-by:${login} -author:${login} updated:>=${daysAgo(7)} ${scope}`,
    commented: `is:open commenter:${login} -author:${login} updated:>=${daysAgo(30)} ${scope} sort:updated-desc`,
    // There's no "reacted by me" search, so scan what changed lately for the viewer's 👀.
    eyes: `is:open updated:>=${daysAgo(3)} ${scope} sort:updated-desc`,
    reviewedOpen: `is:pr is:open reviewed-by:${login} -author:${login} ${scope}`,
  };

  const watched = Object.keys(watching).slice(0, 60);
  const results = await Promise.allSettled(
    PARTS.map((names) => {
      const vars = Object.fromEntries(names.map((n) => [n, queries[n]]));
      const query = dashboardQuery(names, repos);
      return graphql(token, query, { ...vars, ...(query.includes("$login") && { login }), ...(names === EXTRAS_PART && { watched }) });
    })
  );
  const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!ok.length) throw results[0].reason;
  const data = Object.assign({}, ...ok.map((r) => r.data));
  const errors = [...ok.flatMap((r) => r.errors), ...results.filter((r) => r.status === "rejected").map((r) => r.reason.message)];
  const { sso, scopes, expires } = ok[0];
  const failed = Object.keys(queries).filter((k) => !data[k]);
  if (failed.length === Object.keys(queries).length) throw new GitHubError(errors[0] || "GitHub returned no data for your searches.", 200, sso);

  const ctx = { login, approvals: Object.fromEntries(repos.map((r) => [r.slug, r.approvals])) };
  const health = {};
  repos.forEach((r, i) => {
    const node = data[`repo${i}`];
    const head = node?.defaultBranchRef?.target;
    if (!node) return;
    const contexts = head?.statusCheckRollup?.contexts?.nodes;
    const ci = ciState(contexts);
    health[r.slug] = {
      release: node.releases?.nodes?.[0] || null,
      mergeMethod: node.viewerDefaultMergeMethod || "SQUASH",
      main: head && {
        branch: node.defaultBranchRef.name,
        state: ci?.state || head.statusCheckRollup?.state || null,
        failing: ci?.failing || [],
        url: head.url,
        sha: head.oid.slice(0, 7),
        message: head.messageHeadline,
        committedAt: head.committedDate,
      },
    };
  });

  const eyed = [...list(data.eyes, ctx).items, ...(data.watched || []).map((n) => toItem(n, ctx)).filter(Boolean)];
  return {
    fetchedAt: new Date().toISOString(),
    viewer: data.viewer,
    rateLimit: data.rateLimit,
    tokenExpires: expires,
    reviews: list(data.reviews, ctx),
    mine: list(data.mine, ctx),
    assigned: list(data.assigned, ctx),
    mentions: list(data.mentions, ctx),
    triage: list(data.triage, ctx),
    merged: list(data.merged, ctx),
    reviewed: list(data.reviewed, ctx),
    reviewedOpen: list(data.reviewedOpen, ctx),
    following: following(list(data.commented, ctx).items, eyed, watching),
    // Every thread seen this sync, with or without the viewer's 👀, to keep the watch list current.
    eyesSeen: eyed.map((i) => ({ id: i.id, eyes: !!i.follow?.eyes && !i.follow.closed })),
    repos: health,
    warnings: errors,
    failed,
    sso,
    scopes,
  };
}

// ---------- the notifications inbox ----------

/** GitHub's own notifications for these repos. Needs a classic token with the `notifications` or `repo` scope. */
export async function fetchInbox(token, repos) {
  const slugs = new Set(repos.map((r) => r.slug.toLowerCase()));
  const { json } = await request("/notifications?per_page=50", token);
  return json
    .filter((t) => slugs.has(t.repository.full_name.toLowerCase()))
    .map((t) => ({
      id: t.id,
      reason: t.reason,
      unread: t.unread,
      updatedAt: t.updated_at,
      repo: t.repository.full_name,
      title: t.subject.title,
      url: t.subject.url
        ? t.subject.type === "Release"
          ? `${t.repository.html_url}/releases`
          : t.subject.url.replace("https://api.github.com/repos/", "https://github.com/").replace(/\/pulls\/(\d+)/, "/pull/$1").replace("/commits/", "/commit/")
        : `${t.repository.html_url}/notifications`,
    }));
}

// ---------- changes made from the page ----------
// Each runs as the token's owner, only when the user clicks for it.

export const addLabels = (token, slug, number, labels) => request(`/repos/${slug}/issues/${number}/labels`, token, { method: "POST", body: JSON.stringify({ labels }) });

/** GitHub merges the PR, or adds it to the merge queue, once its checks and reviews pass. A merge queue ignores `method`. */
export async function enableAutoMerge(token, prId, method = "SQUASH") {
  const { errors } = await graphql(token, "mutation($id: ID!, $method: PullRequestMergeMethod) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method }) { clientMutationId } }", { id: prId, method });
  if (errors.length) throw new GitHubError(errors[0], 200);
}

export const rerunFailedJobs = (token, slug, runId) => request(`/repos/${slug}/actions/runs/${runId}/rerun-failed-jobs`, token, { method: "POST" });

export const requestReviewers = (token, slug, number, reviewers) => request(`/repos/${slug}/pulls/${number}/requested_reviewers`, token, { method: "POST", body: JSON.stringify({ reviewers }) });

export const removeReviewer = (token, slug, number, login) => request(`/repos/${slug}/pulls/${number}/requested_reviewers`, token, { method: "DELETE", body: JSON.stringify({ reviewers: [login] }) });

/** "closed" or "open" (to undo a close). */
export const setPrState = (token, slug, number, state) => request(`/repos/${slug}/pulls/${number}`, token, { method: "PATCH", body: JSON.stringify({ state }) });
