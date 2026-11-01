// The review brief's extras in the Bob sheet: the PR's facts at the top, files Bob cites opening in the PR's
// diff, and a box to approve, request changes or comment without leaving the page.

import { plural, timeAgo } from "../core.js";
import { submitReview } from "../github.js";
import { askedAt, isBot, prState, reviewSize } from "../insights.js";
import { requestSync } from "./header.js";
import { icon } from "./icons.js";
import { html, live, nothing } from "./lit.js";
import { armed, confirmed, fact, findItem, state, toast } from "./ui.js";

// ---------- the facts ----------

const CI = {
  SUCCESS: ["check", "success", "CI passing"],
  FAILURE: ["x", "error", "CI failing"],
  ERROR: ["x", "error", "CI failing"],
  PENDING: ["clock", "", "CI running"],
  EXPECTED: ["clock", "", "CI running"],
};

const MY_REVIEW = { APPROVED: "You approved", CHANGES_REQUESTED: "You requested changes", COMMENTED: "You commented", DISMISSED: "Your review was dismissed" };

/** What's known about the PR from the last sync: who, how big, CI, approvals, how long it's waited. Read live, so a sync updates it. */
export function reviewFacts(id) {
  const pr = findItem(id);
  if (!pr) return nothing;
  const [ciIcon, ciTone, ciText] = CI[pr.ci] || [];
  const failing = pr.failingChecks?.length ? `: ${pr.failingChecks.map((c) => c.name).join(", ")}` : "";
  const approved = (pr.approvals?.length || 0) >= (pr.approvalsNeeded || 1);
  const days = (Date.now() - Date.parse(askedAt(pr))) / 86400000;
  const fresh = pr.myReview && pr.lastCommitAt > pr.myReview.at;
  return html`
    <div class="facts">
      <div class="facts__row">
        ${fact("user", html`<b>${pr.author}</b>${isBot(pr.author) ? " (bot)" : ""}`)}
        ${pr.additions != null
          ? fact("code", html`<span class="mono"><span class="t-add">+${pr.additions}</span> <span class="t-del">−${pr.deletions}</span></span> in ${plural(pr.files || 0, "file")}`, { tooltip: `${reviewSize(pr)} review` })
          : nothing}
        ${ciText ? fact(ciIcon, `${ciText}${failing}`, { tone: ciTone }) : nothing}
        ${pr.changeRequests?.length
          ? fact("message", `Changes requested by ${pr.changeRequests.join(", ")}`, { tone: "warning" })
          : fact("check", `${pr.approvals?.length || 0} of ${pr.approvalsNeeded || 1} approvals`, { tone: approved ? "success" : "", tooltip: pr.approvals?.join(", ") })}
        ${fact("clock", `Asked ${timeAgo(askedAt(pr))} ago`, { tone: !isBot(pr.author) && days >= state.settings.staleReviewDays ? "warning" : "", tooltip: new Date(askedAt(pr)).toLocaleString() })}
        ${pr.draft ? fact("draft", "Draft") : nothing}
        ${prState(pr) === "conflict" ? fact("alert", "Merge conflict", { tone: "warning" }) : nothing}
        ${pr.myReview ? fact(fresh ? "refresh" : "eye", `${MY_REVIEW[pr.myReview.state] || "You reviewed"} ${timeAgo(pr.myReview.at)} ago${fresh ? " · new commits since" : ""}`, { tone: fresh ? "warning" : "" }) : nothing}
      </div>
      <div class="facts__row">
        ${pr.labels.slice(0, 4).map((l) => html`<span class="chip">${l}</span>`)}
        <span class="facts__links">
          <a class="btn btn--ghost btn--sm" href="${pr.url}/files" target="_blank" rel="noopener">${icon("code", 14)}Files changed</a>
          <a class="btn btn--ghost btn--sm" href="${pr.url}/checks" target="_blank" rel="noopener">${icon("check", 14)}Checks</a>
        </span>
      </div>
    </div>`;
}

// ---------- files Bob cites ----------

/** Where Bob's links to files go in a review brief: the PR's Files changed view (the click adds the file's anchor). */
export const diffLinks = (id) => () => {
  const pr = findItem(id);
  return pr ? { href: `${pr.url}/files`, diff: true } : null;
};

/** GitHub anchors a file in a PR's diff by the SHA-256 of its path; "R42" is line 42 on the new side. */
async function openDiff(el) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(el.dataset.file)));
  const hash = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  window.open(`${el.getAttribute("href")}#diff-${hash}${el.dataset.line ? `R${el.dataset.line}` : ""}`, "_blank", "noopener");
}

// ---------- submitting a review ----------

const EVENTS = {
  APPROVE: { label: "Approve", busy: "Approving…", confirm: "Click again to approve", done: "Approved" },
  REQUEST_CHANGES: { label: "Request changes", busy: "Sending…", confirm: "Click again to request changes", done: "Requested changes on" },
  COMMENT: { label: "Comment", busy: "Sending…", confirm: "Click again to comment", done: "Commented on" },
};

/** What's typed in each PR's review box, kept across re-renders and sessions until it's sent. */
const drafts = new Map();
/** PRs whose review is being sent, by id → the event. */
const sending = new Map();

let redraw = () => {};

/** The box under the brief: a comment and the three ways to submit it. `rerender` redraws the sheet. */
export function reviewForm(id, rerender) {
  redraw = rerender;
  const pr = findItem(id);
  if (!pr) return nothing;
  const busy = sending.get(id);
  const button = (event, primary = false) => {
    const e = EVENTS[event];
    return html`<button class="btn btn--sm ${primary ? "btn--primary" : ""}" type="button" data-action="review-submit" data-id=${id} data-event=${event} ?disabled=${!!busy}>${busy === event ? e.busy : armed.get(`review:${event}:${id}`) || e.label}</button>`;
  };
  return html`
    <section class="review-box" aria-label="Your review">
      <p class="bob__label">Your review on #${pr.number}</p>
      <textarea class="input review-box__body" rows="3" placeholder="Leave a comment (needed to request changes or comment; optional to approve). Markdown works." data-review-body=${id} .value=${live(drafts.get(id) || "")} ?disabled=${!!busy}></textarea>
      <div class="review-box__actions">
        ${button("APPROVE", true)}${button("REQUEST_CHANGES")}${button("COMMENT")}
        <span class="quiet-inline">Posts as you on GitHub.</span>
      </div>
    </section>`;
}

/** Keeps what's typed in a review box. */
export function bindReview(root) {
  root.addEventListener("input", (e) => e.target.dataset.reviewBody && drafts.set(e.target.dataset.reviewBody, e.target.value));
}

async function submit(el) {
  const { id, event } = el.dataset;
  const pr = findItem(id);
  const body = (drafts.get(id) || "").trim();
  if (!pr) return toast("This PR isn't in your last sync anymore.", "error");
  if (event !== "APPROVE" && !body) return toast(`Write a comment first: GitHub needs one to ${event === "COMMENT" ? "comment" : "request changes"}.`, "error");
  if (!confirmed(`review:${event}:${id}`, EVENTS[event].confirm, redraw)) return;
  sending.set(id, event);
  redraw();
  try {
    await submitReview(state.settings.token, pr.repo, pr.number, event, body);
    drafts.delete(id);
    toast(`${EVENTS[event].done} #${pr.number}`, "success");
    requestSync();
  } catch (err) {
    toast(`Couldn't send the review: ${err.message}`, "error");
  }
  sending.delete(id);
  redraw();
}

export const reviewActions = {
  "open-diff": openDiff,
  "review-submit": submit,
};
