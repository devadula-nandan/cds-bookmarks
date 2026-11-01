// The repository editor (Settings → Repositories → Edit repositories): a Carbon modal with a form over every option of an
// entry in bookmarks.json. Saving keeps the list in this browser (`repoData`), ahead of the file; Export
// JSON downloads it to replace bookmarks.json, and Reset loads the file back in.

import { storage } from "../core.js";
import { fileRepos, rawRepos } from "../repos.js";
import { icon } from "./icons.js";
import { html, live, nothing, render, repeat } from "./lit.js";
import { $, logo, toast } from "./ui.js";

const GROUPS = [
  ["github", "GitHub"],
  ["website", "Website"],
  ["storybooks", "Storybooks"],
  ["others", "Playgrounds"],
];
// Optional fields: left out of the JSON when blank.
const OPTIONAL = new Set(["short", "clone", "approvals", "readyLabel", "versionedHref", "version"]);

let draft = [];
// Repos unfolded in the editor (by entry, so moving one keeps it open).
const unfolded = new WeakSet();

/** Opens in place of Settings: Carbon modals don't stack. */
async function openEditor() {
  draft = rawRepos();
  renderEditor();
  $("#settings").open = false;
  $("#repo-editor").open = true;
}

function field(path, label, value, { mono = false, placeholder = "" } = {}) {
  return html`<cds-text-input class=${mono ? "mono" : nothing} label=${label} data-path=${path} .value=${live(value ?? "")} placeholder=${placeholder} autocomplete="off" spellcheck="false"></cds-text-input>`;
}

const remove = (path, label) => html`<cds-icon-button kind="ghost" size="md" data-action="editor-remove" data-path=${path} align="left" aria-label=${label}>${icon("trash", 16, { slot: "icon" })}<span slot="tooltip-content">${label}</span></cds-icon-button>`;

function linkRow(path, link, j) {
  const p = `${path}.buttons.${j}`;
  return html`
    <div class="editor-link">
      ${field(`${p}.label`, "Label", link.label)}
      ${field(`${p}.href`, "URL", link.href, { mono: true, placeholder: "https://…" })}
      ${field(`${p}.versionedHref`, "Versioned URL", link.versionedHref, { mono: true, placeholder: "Optional, uses <v>" })}
      ${field(`${p}.version`, "Version", link.version, { placeholder: "Optional" })}
      ${remove(p, `Remove ${link.label || "link"}`)}
    </div>`;
}

function groupBlock(entry, i, key, fallback) {
  const group = entry[key];
  if (!group) return nothing;
  const path = `${i}.${key}`;
  return html`
    <cds-form-group class="editor-group" legend-text="${group.title || fallback} links">
      <div class="editor-group__head">
        ${field(`${path}.title`, `${fallback} group title`, group.title)}
        <cds-button kind="danger--ghost" size="sm" data-action="editor-remove" data-path=${path}>Remove group</cds-button>
      </div>
      ${(group.buttons || []).map((link, j) => linkRow(path, link, j))}
      <cds-button kind="ghost" size="sm" data-action="editor-add-link" data-path=${path}>Add link${icon("plus", 16, { slot: "icon" })}</cds-button>
    </cds-form-group>`;
}

function repoBlock(entry, i) {
  const missing = GROUPS.filter(([key]) => !entry[key]);
  return html`
    <cds-accordion-item class="editor-repo" data-index=${i} ?open=${unfolded.has(entry)} title="${entry.name || "Untitled repo"}${entry.id ? ` (${entry.id})` : ""}">
      <div class="editor-repo__tools">
        <span class="editor-repo__logo" aria-hidden="true">${logo(entry.icon)}</span>
        <cds-button kind="ghost" size="sm" data-action="editor-move" data-index=${i} data-by="-1" ?disabled=${!i}>Move up${icon("arrowUp", 16, { slot: "icon" })}</cds-button>
        <cds-button kind="ghost" size="sm" data-action="editor-move" data-index=${i} data-by="1" ?disabled=${i >= draft.length - 1}>Move down${icon("arrowDown", 16, { slot: "icon" })}</cds-button>
        <cds-button kind="danger--ghost" size="sm" data-action="editor-remove" data-path=${i}>Remove repo${icon("trash", 16, { slot: "icon" })}</cds-button>
      </div>
      <div class="fields">
        ${field(`${i}.id`, "ID", entry.id, { mono: true, placeholder: "cds" })}
        ${field(`${i}.name`, "Name", entry.name, { placeholder: "Carbon Design System" })}
        ${field(`${i}.short`, "Short name", entry.short, { placeholder: "Optional, for tight spots" })}
        ${field(`${i}.clone`, "Local clone", entry.clone, { mono: true, placeholder: "Optional, like ~/Source/carbon" })}
        ${field(`${i}.approvals`, "Approvals to merge", entry.approvals, { placeholder: "1" })}
        ${field(`${i}.readyLabel`, "Ready-to-merge label", entry.readyLabel, { placeholder: "Optional, like status: ready to merge 🎉" })}
      </div>
      <p class="hint">A PR counts as ready once it has that many approvals (and no visual review label). <b>Ready to merge</b> then adds the label and turns on auto-merge.</p>
      <cds-textarea class="mono editor-svg" rows="3" label="Logo (SVG)" data-path="${i}.icon" spellcheck="false" .value=${live(entry.icon || "")}></cds-textarea>
      <p class="hint">The GitHub repo comes from a GitHub link to its issues or pulls, and the sprint board from a link labelled “Board”.</p>
      ${GROUPS.map(([key, title]) => groupBlock(entry, i, key, title))}
      ${missing.length ? html`<p class="editor-add">${missing.map(([key, title]) => html`<cds-button kind="ghost" size="sm" data-action="editor-add-group" data-index=${i} data-key=${key}>${title} group${icon("plus", 16, { slot: "icon" })}</cds-button>`)}</p>` : nothing}
    </cds-accordion-item>`;
}

function renderEditor() {
  render(
    html`
      <cds-modal-header>
        <cds-modal-close-button></cds-modal-close-button>
        <cds-modal-heading>Edit repositories</cds-modal-heading>
      </cds-modal-header>
      <cds-modal-body class="editor">
        <p class="hint">Everything in the repo bar, search and work list. Saving keeps this list in this browser, ahead of <cds-code-snippet type="inline">bookmarks.json</cds-code-snippet>; use <b>Export JSON</b> to update the file.</p>
        <div class="editor__tools">
          <cds-file-uploader-button button-kind="ghost" size="sm" accept="application/json .json" data-editor-import>Import JSON</cds-file-uploader-button>
          <cds-button kind="ghost" size="sm" data-action="editor-reset">Reset to bookmarks.json</cds-button>
          <cds-button kind="ghost" size="sm" data-action="repo-export">Export JSON</cds-button>
        </div>
        <cds-accordion size="lg">${repeat(draft, (entry) => entry, repoBlock)}</cds-accordion>
        <cds-button kind="tertiary" size="sm" data-action="editor-add-repo">Add repository${icon("plus", 16, { slot: "icon" })}</cds-button>
      </cds-modal-body>
      <cds-modal-footer>
        <cds-modal-footer-button kind="secondary" data-action="editor-close">Cancel</cds-modal-footer-button>
        <cds-modal-footer-button kind="primary" data-action="editor-save">Save</cds-modal-footer-button>
      </cds-modal-footer>`,
    $("#repo-editor")
  );
}

/** Walks "2.github.buttons.0" to [parent, key]. */
function locate(path) {
  const keys = path.split(".").map((k) => (/^\d+$/.test(k) ? Number(k) : k));
  const last = keys.pop();
  return [keys.reduce((o, k) => o[k], draft), last];
}

export function bindEditor() {
  const el = $("#repo-editor");
  el.addEventListener("input", (e) => {
    const path = e.target.dataset.path;
    if (!path) return;
    const [parent, key] = locate(path);
    const value = e.target.value;
    if (OPTIONAL.has(key) && !value.trim()) delete parent[key];
    else parent[key] = value;
  });
  el.addEventListener("cds-accordion-item-toggled", (e) => {
    if (!e.target.matches(".editor-repo")) return;
    const entry = draft[e.target.dataset.index];
    if (entry) e.target.open ? unfolded.add(entry) : unfolded.delete(entry);
  });
  el.addEventListener("cds-file-uploader-button-changed", async (e) => {
    const file = e.detail.addedFiles?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error("expected a list of repos");
      draft = parsed;
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

function problems() {
  const ids = draft.map((e) => String(e.id || "").trim());
  const out = [];
  draft.forEach((e, i) => {
    if (!ids[i]) out.push(`repo ${i + 1} needs an ID`);
    else if (ids.indexOf(ids[i]) !== i) out.push(`ID “${ids[i]}” is used twice`);
    if (!String(e.name || "").trim()) out.push(`${ids[i] || `repo ${i + 1}`} needs a name`);
  });
  return out;
}

async function save() {
  const issues = problems();
  if (issues.length) return toast(`Can't save: ${issues.slice(0, 2).join("; ")}`, "error");
  // Matching the file again means there's nothing to keep: drop the saved copy so file updates come through.
  const same = JSON.stringify(draft) === JSON.stringify(await fileRepos());
  if (same) await storage.remove("repoData");
  else await storage.set({ repoData: draft });
  // The page reloads on the change (see onStorage), so everything picks up the new list.
}

export const editorActions = {
  "repo-editor": openEditor,
  "repo-export": () => ($("#repo-editor").open ? exportJson(draft) : exportJson()),
  "editor-close": () => ($("#repo-editor").open = false),
  "editor-save": save,
  "editor-reset": async () => {
    draft = await fileRepos();
    renderEditor();
    toast("Loaded bookmarks.json. Save to use it.");
  },
  "editor-add-repo": () => {
    const entry = { id: "", name: "", github: { title: "GitHub", buttons: [{ label: "Issues", href: "https://github.com/OWNER/REPO/issues" }] } };
    draft.push(entry);
    unfolded.add(entry);
    renderEditor();
  },
  "editor-add-group": (el) => {
    const entry = draft[el.dataset.index];
    entry[el.dataset.key] = { title: GROUPS.find(([k]) => k === el.dataset.key)[1], buttons: [] };
    renderEditor();
  },
  "editor-add-link": (el) => {
    const [parent, key] = locate(el.dataset.path);
    (parent[key].buttons ||= []).push({ label: "", href: "" });
    renderEditor();
  },
  "editor-remove": (el) => {
    const [parent, key] = locate(el.dataset.path);
    if (Array.isArray(parent)) parent.splice(key, 1);
    else delete parent[key];
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
