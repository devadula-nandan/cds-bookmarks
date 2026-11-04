// The repository editor (Settings → Repositories → Edit repositories). It asks only for what can't be
// inferred: the GitHub repo, and optionally a name, a local clone, the approvals a PR needs and extra
// links (see repos.js for the rest). Saving keeps the list in this browser (`repoData`), ahead of the
// file; Export JSON downloads it to replace bookmarks.json, and Reset loads the file back in.

import { storage } from "../core.js";
import { fileRepos, nameOf, rawRepos, slugOf, upgradeRepo } from "../repos.js";
import { icon } from "./icons.js";
import { html, live, nothing, render, repeat } from "./lit.js";
import { $, logo, toast } from "./ui.js";

let draft = [];
// The links box as typed, so re-rendering while someone types doesn't reformat it under them.
const linksText = new WeakMap();

async function openEditor() {
  draft = rawRepos();
  renderEditor();
  const dialog = $("#repo-editor");
  if (!dialog.open) dialog.showModal();
}

/**
 * Extra links as text: a line with a URL is a link (its label is the text before the URL), and a line
 * without one starts a group. Links before any group go under GitHub or Links, by where they point.
 */
function parseLinks(text) {
  const links = {};
  let group = null;
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const href = line.match(/https?:\/\/\S+$/)?.[0];
    if (!href) {
      group = line.replace(/:$/, "");
      continue;
    }
    const github = /^https?:\/\/(www\.)?github\.com\//.test(href);
    const label = line.slice(0, -href.length).trim().replace(/[:–-]$/, "").trim() || (/\/projects\/\d+/.test(href) ? "Board" : href.replace(/^https?:\/\/(www\.)?/, "").split(/[/?#]/)[0]);
    (links[group || (github ? "GitHub" : "Links")] ||= {})[label] = href;
  }
  return links;
}

const linksToText = (links = {}) =>
  Object.entries(links)
    .map(([group, list]) => [group, ...Object.entries(list).map(([label, href]) => `${label} ${href}`)].join("\n"))
    .join("\n\n");

function field(i, key, label, value, { mono = false, placeholder = "", type = "text" } = {}) {
  return html`<label class="field"><span>${label}</span><input class="input ${mono ? "mono" : ""}" type=${type} min=${type === "number" ? "1" : nothing} data-index=${i} data-key=${key} .value=${live(String(value ?? ""))} placeholder=${placeholder} autocomplete="off" spellcheck="false"></label>`;
}

function repoBlock(entry, i) {
  const slug = slugOf(entry.repo);
  const name = entry.name || nameOf(slug);
  return html`
    <section class="editor-repo">
      <header class="editor-repo__head">
        <span class="editor-repo__logo" aria-hidden="true">${logo(entry.icon)}</span>
        <span class="editor-repo__name">${name || "New repository"}<small class="mono">${slug || ""}</small></span>
        <button class="icon-btn icon-btn--sm" data-action="editor-move" data-index=${i} data-by="-1" aria-label="Move up" data-tooltip="Move up" ?disabled=${!i}>${icon("arrowUp", 14)}</button>
        <button class="icon-btn icon-btn--sm" data-action="editor-move" data-index=${i} data-by="1" aria-label="Move down" data-tooltip="Move down" ?disabled=${i >= draft.length - 1}>${icon("arrowDown", 14)}</button>
        <button class="icon-btn icon-btn--sm" data-action="editor-remove" data-index=${i} aria-label="Remove ${name || "repo"}" data-tooltip="Remove repo">${icon("trash", 14)}</button>
      </header>
      <div class="fields">
        ${field(i, "repo", "GitHub repo", entry.repo, { mono: true, placeholder: "owner/repo, or paste its link" })}
        ${field(i, "name", "Name", entry.name, { placeholder: nameOf(slug) || "Carbon" })}
        ${field(i, "clone", "Local clone", entry.clone, { mono: true, placeholder: "Optional, like ~/Source/carbon" })}
        ${field(i, "approvals", "Approvals to merge", entry.approvals, { type: "number", placeholder: "1" })}
      </div>
      <label class="field"><span>Extra links</span><textarea class="input mono editor-links" rows="3" data-index=${i} data-key="links" spellcheck="false" placeholder=${"Board https://github.com/orgs/…/projects/39\n\nStorybooks\nReact https://react.carbondesignsystem.com/"} .value=${live(linksText.get(entry) ?? linksToText(entry.links))}></textarea></label>
    </section>`;
}

function renderEditor() {
  render(
    html`
      <header class="sheet__head">
        <h2>Edit repositories</h2>
        <button class="icon-btn" data-action="editor-close" aria-label="Close">${icon("x", 18)}</button>
      </header>
      <div class="sheet__body">
        <p class="hint">
          Each repo gets its Issues and Pull Requests links, and <b>Ready to merge</b> uses the repo's own “ready to merge” label if it has one. Under <b>Extra links</b>, put one link per line (<code>Label https://…</code>); a line with no link starts a group, and a link to a GitHub project is the sprint board.
        </p>
        ${repeat(draft, (entry) => entry, repoBlock)}
        <button class="btn btn--sm" data-action="editor-add-repo">${icon("plus", 14)}Add repository</button>
      </div>
      <footer class="editor__foot">
        <label class="btn btn--ghost btn--sm">Import JSON<input type="file" accept="application/json,.json" data-editor-import hidden></label>
        <button class="btn btn--ghost btn--sm" data-action="editor-reset">Reset to bookmarks.json</button>
        <span class="editor__spacer"></span>
        <button class="btn btn--sm" data-action="repo-export">Export JSON</button>
        <button class="btn btn--primary btn--sm" data-action="editor-save">Save</button>
      </footer>`,
    $("#repo-editor")
  );
}

export function bindEditor() {
  const el = $("#repo-editor");
  el.addEventListener("input", (e) => {
    const { index, key } = e.target.dataset;
    const entry = draft[index];
    if (!entry || !key) return;
    const value = e.target.value;
    if (key === "links") {
      linksText.set(entry, value);
      entry.links = parseLinks(value);
    } else entry[key] = value;
    // Blank optional fields are left out of the JSON.
    if (!value.trim() || (key === "links" && !Object.keys(entry.links).length)) delete entry[key];
    renderEditor();
  });
  el.addEventListener("change", async (e) => {
    if (!e.target.matches("[data-editor-import]")) return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error("expected a list of repos");
      draft = parsed.map(upgradeRepo);
      renderEditor();
      toast(`Imported ${file.name}. Save to use it.`, "success");
    } catch (err) {
      toast(`Couldn't import ${file.name}: ${err.message}`, "error");
    }
  });
}

/** Downloads `list` as bookmarks.json. */
function exportJson(list = rawRepos()) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(list, null, 2) + "\n"], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "bookmarks.json" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The draft as it's saved: the repo as "owner/repo", approvals as a number. */
const cleaned = () =>
  draft.map((entry) => {
    const out = { ...entry, repo: slugOf(entry.repo) || entry.repo };
    if (out.approvals) out.approvals = Number(out.approvals) || 1;
    if (out.approvals === 1) delete out.approvals;
    return out;
  });

function problems(list) {
  const slugs = list.map((e) => slugOf(e.repo)?.toLowerCase());
  const out = [];
  list.forEach((e, i) => {
    if (!slugs[i]) out.push(`repo ${i + 1} needs a GitHub repo, like owner/repo`);
    else if (slugs.indexOf(slugs[i]) !== i) out.push(`${e.repo} is listed twice`);
  });
  return out;
}

async function save() {
  const list = cleaned();
  const issues = problems(list);
  if (issues.length) return toast(`Can't save: ${issues.slice(0, 2).join("; ")}`, "error");
  // Matching the file again means there's nothing to keep: drop the saved copy so file updates come through.
  const same = JSON.stringify(list) === JSON.stringify(await fileRepos());
  if (same) await storage.remove("repoData");
  else await storage.set({ repoData: list });
  // The page reloads on the change (see onStorage), so everything picks up the new list.
}

export const editorActions = {
  "repo-editor": openEditor,
  "repo-export": () => ($("#repo-editor").open ? exportJson(cleaned()) : exportJson()),
  "editor-close": () => $("#repo-editor").close(),
  "editor-save": save,
  "editor-reset": async () => {
    draft = await fileRepos();
    renderEditor();
    toast("Loaded bookmarks.json. Save to use it.");
  },
  "editor-add-repo": () => {
    draft.push({ repo: "" });
    renderEditor();
    $("#repo-editor .editor-repo:last-of-type input")?.focus();
  },
  "editor-remove": (el) => {
    draft.splice(Number(el.dataset.index), 1);
    renderEditor();
  },
  "editor-move": (el) => {
    const i = Number(el.dataset.index);
    const j = i + Number(el.dataset.by);
    if (j < 0 || j >= draft.length) return;
    [draft[i], draft[j]] = [draft[j], draft[i]];
    renderEditor();
  },
};
