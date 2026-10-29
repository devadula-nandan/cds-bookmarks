// Talking to GitHub: one GraphQL query for the whole dashboard, plus the notifications inbox.
// Every call names its host: github.com or a GitHub Enterprise Server such as github.ibm.com.

import { apiUrl, previousWorkday, todayKey } from "./core.js";
import { isBot } from "./insights.js";

class GitHubError extends Error {
  constructor(message, status, sso = null) {
    super(message);
    this.status = status;
    // Set when an org's SAML SSO hasn't been authorized for the token: the page links to it.
    this.sso = sso;
  }
}

async function request(host, path, token, init = {}) {
  const url = apiUrl(host, path);
  let res;
  try {
    res = await fetch(url, {
      ...init,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  } catch {
    throw new GitHubError(`Couldn't reach ${new URL(url).host}. Check your network, VPN or proxy.`, 0);
  }
  const header = res.headers.get("X-GitHub-SSO") || "";
  const sso = header.match(/url=(\S+)/)?.[1] || (header.includes("required") ? `https://${host}/settings/tokens` : null);
  if (res.status === 401) throw new GitHubError(`${host} rejected the token (401). It may be expired, revoked, or for a different GitHub host.`, 401);
  if (!res.ok) throw new GitHubError(`${host} request failed (${res.status})`, res.status, sso);
  return { json: await res.json(), sso, scopes: res.headers.get("X-OAuth-Scopes") };
}

/** Returns `{ data, errors, sso, scopes }`; `scopes` is null for fine-grained tokens. */
async function graphql(host, token, query, variables = {}) {
  const { json, sso, scopes } = await request(host, "/graphql", token, { method: "POST", body: JSON.stringify({ query, variables }) });
  const errors = [...new Set((json.errors || []).map((e) => e.message))];
  if (errors.length && !json.data) throw new GitHubError(errors[0], 200, sso);
  return { data: json.data, errors, sso, scopes };
}

export async function fetchViewer(host, token) {
  const { data, scopes } = await graphql(host, token, "query { viewer { login name } }");
  return { ...data.viewer, scopes };
}

// ---------- the dashboard query ----------

const PR_FIELDS = `
  __typename id number title url createdAt updatedAt isDraft mergedAt
  reviewDecision mergeable additions deletions
  repository { nameWithOwner }
  author { login }
  labels(first: 6) { nodes { name } }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
  latestReviews(first: 10) { nodes { state author { login } } }`;

const ISSUE_FIELDS = `
  __typename id number title url createdAt updatedAt
  repository { nameWithOwner }
  author { login }
  labels(first: 6) { nodes { name } }`;

/** Threads the viewer follows: their 👀 reactions and the latest replies. */
const FOLLOW_FIELDS = `
  closed
  reactionGroups { content viewerHasReacted }
  recent: comments(last: 10) { nodes { author { login } createdAt url reactionGroups { content viewerHasReacted } } }`;

const MY_REVIEW = "myReviews: reviews(author: $login, last: 1) { nodes { state submittedAt } }";

const TRIAGE_LABELS = ["status: needs triage 🕵️‍♀️", "status: needs triage :female_detective:"];

const search = (name, first, extra = "", prExtra = "") => `
  ${name}: search(type: ISSUE, query: $${name}, first: ${first}) {
    issueCount
    nodes { ... on PullRequest { ${PR_FIELDS} ${extra} ${prExtra} } ... on Issue { ${ISSUE_FIELDS} ${extra} } }
  }`;

function dashboardQuery(repos) {
  const health = repos
    .map((r, i) => {
      const [owner, name] = r.slug.split("/");
      return `
      repo${i}: repository(owner: "${owner}", name: "${name}") {
        releases(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { tagName publishedAt url isPrerelease } }
        defaultBranchRef { name target { ... on Commit { oid committedDate url messageHeadline statusCheckRollup { state } } } }
      }`;
    })
    .join("");
  return `
    query Dashboard($reviews: String!, $mine: String!, $assigned: String!, $mentions: String!, $triage: String!, $merged: String!,
                    $reviewed: String!, $commented: String!, $eyes: String!, $reviewedOpen: String!, $watched: [ID!]!, $login: String!) {
      viewer { login name }
      rateLimit { remaining limit }
      ${search("reviews", 50)}
      ${search("mine", 50)}
      ${search("assigned", 50)}
      ${search("mentions", 30)}
      ${search("triage", 30)}
      ${search("merged", 30)}
      ${search("reviewed", 30)}
      ${search("commented", 30, FOLLOW_FIELDS)}
      ${search("eyes", 40, FOLLOW_FIELDS)}
      ${search("reviewedOpen", 30, "", MY_REVIEW)}
      watched: nodes(ids: $watched) { ... on PullRequest { ${PR_FIELDS} ${FOLLOW_FIELDS} } ... on Issue { ${ISSUE_FIELDS} ${FOLLOW_FIELDS} } }
      ${health}
    }`;
}

const eyesOn = (groups) => (groups || []).some((g) => g.content === "EYES" && g.viewerHasReacted);

/** A GraphQL node → the flat item the app uses. */
function toItem(node, login) {
  if (!node?.repository) return null;
  const isPR = node.__typename === "PullRequest";
  const reviews = node.latestReviews?.nodes || [];
  const commit = node.commits?.nodes?.[0]?.commit;
  const myReview = node.myReviews?.nodes?.[0];
  const comments = node.recent?.nodes;
  const reply = comments?.filter((c) => c.author?.login !== login && !isBot(c.author?.login)).at(-1);
  return {
    id: node.id,
    kind: isPR ? "pr" : "issue",
    number: node.number,
    title: node.title,
    url: node.url,
    repo: node.repository.nameWithOwner,
    author: node.author?.login || "ghost",
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    labels: (node.labels?.nodes || []).map((l) => l.name),
    ...(isPR && {
      draft: node.isDraft,
      reviewDecision: node.reviewDecision,
      mergeable: node.mergeable,
      additions: node.additions,
      deletions: node.deletions,
      mergedAt: node.mergedAt,
      ci: commit?.statusCheckRollup?.state || null,
      lastCommitAt: commit?.committedDate || null,
      myReview: myReview && { state: myReview.state, at: myReview.submittedAt },
      approvals: reviews.filter((r) => r.state === "APPROVED").map((r) => r.author?.login),
      changeRequests: reviews.filter((r) => r.state === "CHANGES_REQUESTED").map((r) => r.author?.login),
    }),
    // Only for threads the viewer follows.
    follow: comments && {
      eyes: eyesOn(node.reactionGroups) || comments.some((c) => eyesOn(c.reactionGroups)),
      closed: node.closed,
      myCommentAt: comments.filter((c) => c.author?.login === login).at(-1)?.createdAt || null,
      lastReply: reply ? { author: reply.author?.login || "ghost", at: reply.createdAt, url: reply.url } : null,
    },
  };
}

const list = (result, login) => ({ total: result?.issueCount || 0, items: (result?.nodes || []).map((n) => toItem(n, login)).filter(Boolean) });

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

export async function fetchDashboard({ host, token, login, repos, includeTeamReviews, watching = {} }) {
  const scope = repos.map((r) => `repo:${r.slug}`).join(" ");
  const daysAgo = (n) => todayKey(new Date(Date.now() - n * 86400000));
  const queries = {
    reviews: `is:pr is:open draft:false archived:false ${includeTeamReviews ? "review-requested" : "user-review-requested"}:${login} ${scope}`,
    mine: `is:pr is:open author:${login} ${scope}`,
    assigned: `is:open assignee:${login} archived:false ${scope}`,
    mentions: `is:open mentions:${login} -author:${login} updated:>=${daysAgo(7)} ${scope}`,
    triage: `is:issue is:open label:${TRIAGE_LABELS.map((l) => `"${l}"`).join(",")} ${scope}`,
    merged: `is:pr is:merged author:${login} merged:>=${daysAgo(7)} ${scope}`,
    reviewed: `is:pr reviewed-by:${login} -author:${login} updated:>=${todayKey(previousWorkday())} ${scope}`,
    commented: `is:open commenter:${login} -author:${login} updated:>=${daysAgo(30)} ${scope} sort:updated-desc`,
    // There's no "reacted by me" search, so scan what changed lately for the viewer's 👀.
    eyes: `is:open updated:>=${daysAgo(3)} ${scope} sort:updated-desc`,
    reviewedOpen: `is:pr is:open reviewed-by:${login} -author:${login} ${scope}`,
  };

  const { data, errors, sso, scopes } = await graphql(host, token, dashboardQuery(repos), { ...queries, watched: Object.keys(watching).slice(0, 60), login });
  const failed = Object.keys(queries).filter((k) => !data[k]);
  if (failed.length === Object.keys(queries).length) throw new GitHubError(errors[0] || `${host} returned no data for your searches.`, 200, sso);

  const health = {};
  repos.forEach((r, i) => {
    const node = data[`repo${i}`];
    const head = node?.defaultBranchRef?.target;
    if (!node) return;
    health[r.slug] = {
      release: node.releases?.nodes?.[0] || null,
      main: head && {
        branch: node.defaultBranchRef.name,
        state: head.statusCheckRollup?.state || null,
        url: head.url,
        sha: head.oid.slice(0, 7),
        message: head.messageHeadline,
        committedAt: head.committedDate,
      },
    };
  });

  const eyed = [...list(data.eyes, login).items, ...(data.watched || []).map((n) => toItem(n, login)).filter(Boolean)];
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
    reviewedOpen: list(data.reviewedOpen),
    following: following(list(data.commented, login).items, eyed, watching),
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
export async function fetchInbox(host, token, repos) {
  const slugs = new Set(repos.map((r) => r.slug.toLowerCase()));
  const { json } = await request(host, "/notifications?per_page=50", token);
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
          : t.subject.url.replace(t.repository.url, t.repository.html_url).replace(/\/pulls\/(\d+)/, "/pull/$1").replace("/commits/", "/commit/")
        : `${t.repository.html_url}/notifications`,
    }));
}
